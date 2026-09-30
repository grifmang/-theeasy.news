/* Filesystem capability probe only; not a production parser sandbox. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
    int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 3) {
        fprintf(stderr, "Landlock ABI >=3 unavailable: abi=%d errno=%d\n", abi, errno);
        return 77;
    }
    char fixture[] = "/tmp/easy-landlock-fixture.XXXXXX";
    int original = mkstemp(fixture);
    if (original < 0) return 1;
    close(original);
    pid_t child = fork();
    if (child < 0) { unlink(fixture); return 1; }
    if (child == 0) {
        struct landlock_ruleset_attr policy = {
            .handled_access_fs = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE
        };
        int rules = syscall(SYS_landlock_create_ruleset, &policy, sizeof(policy), 0);
        if (rules < 0 || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 ||
            syscall(SYS_landlock_restrict_self, rules, 0) != 0) _exit(2);
        close(rules);
        errno = 0;
        int denied = open(fixture, O_RDONLY);
        if (denied >= 0 || errno != EACCES) _exit(3);
        errno = 0;
        denied = open(fixture, O_WRONLY);
        if (denied >= 0 || errno != EACCES) _exit(4);
        _exit(0);
    }
    int status = 0;
    int waited = waitpid(child, &status, 0);
    /* Parent is unrestricted; remove only our exact mkstemp-created fixture. */
    unlink(fixture);
    if (waited != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0) return 1;
    printf("Landlock ABI %d: child read/write denial verified\n", abi);
    return 0;
}
