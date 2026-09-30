/* Capability probe only: NOT a production parser sandbox. */
#include <errno.h>
#include <seccomp.h>
#include <stdio.h>
#include <sys/socket.h>
#include <unistd.h>

int main(void) {
    scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
    if (!filter) return 1;
    if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(socket), 0) < 0 ||
        seccomp_load(filter) < 0) {
        seccomp_release(filter);
        fputs("seccomp enforcement unavailable\n", stderr);
        return 1;
    }
    seccomp_release(filter);
    errno = 0;
    int network = socket(AF_INET, SOCK_STREAM, 0);
    if (network != -1 || errno != EPERM) {
        if (network >= 0) close(network);
        fputs("socket unexpectedly permitted\n", stderr);
        return 1;
    }
    int descriptors[2];
    if (pipe(descriptors) != 0) return 1;
    close(descriptors[0]);
    close(descriptors[1]);
    puts("seccomp socket denial verified; ordinary pipes remain available");
    return 0;
}
