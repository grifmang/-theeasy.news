/* Linux x86-64 launcher foundation. Not wired to the application yet.
 * Arguments are operator-owned runtime directory, scratch directory, executable,
 * and executable arguments. Document data must arrive only on stdin.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/capability.h>
#include <linux/landlock.h>
#include <sched.h>
#include <seccomp.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
/* Linux x86-64 assigned fchmodat2 after Debian 12's libc headers shipped. */
#ifndef __NR_fchmodat2
#define __NR_fchmodat2 452
#endif

static void fail_at(int line) {
#ifdef PARSER_SANDBOX_DIAGNOSTICS
    fprintf(stderr, "Isolation prerequisite failed at line %d (errno %d)\n", line, errno);
#else
    (void)line;
#endif
    fputs("Parser isolation unavailable\n", stderr);
    _exit(125);
}
#define fail() fail_at(__LINE__)

static int beneath(const char *child, const char *parent) {
    size_t length = strlen(parent);
    return !strncmp(child, parent, length) && child[length] == '/';
}

static void limits(int resource, rlim_t soft, rlim_t hard) {
    struct rlimit bound = {soft, hard};
    if (setrlimit(resource, &bound)) fail();
}

static int trusted_stdio(int fd, const struct stat *info) {
    if (S_ISFIFO(info->st_mode)) return 1;
    if (!S_ISSOCK(info->st_mode)) return 0;
    // Node/libuv represents child stdio with unnamed Unix socketpairs on Linux.
    // Reject network sockets and named Unix endpoints, even if already connected.
    struct sockaddr_un local = {0}, peer = {0};
    socklen_t local_size = sizeof(local), peer_size = sizeof(peer), type_size = sizeof(int);
    int type = 0;
    return !getsockname(fd, (struct sockaddr *)&local, &local_size) &&
        !getpeername(fd, (struct sockaddr *)&peer, &peer_size) &&
        !getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_size) && type == SOCK_STREAM &&
        local.sun_family == AF_UNIX && peer.sun_family == AF_UNIX &&
        local_size == offsetof(struct sockaddr_un, sun_path) &&
        peer_size == offsetof(struct sockaddr_un, sun_path);
}

static void allow_path(int rules, const char *path, uint64_t access, int optional) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) { if (optional && errno == ENOENT) return; fail(); }
    struct landlock_path_beneath_attr rule = {.allowed_access = access, .parent_fd = fd};
    if (syscall(SYS_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) fail();
    close(fd);
}

int main(int argc, char **argv) {
    if (argc < 4 || seccomp_arch_native() != SCMP_ARCH_X86_64) fail();
    char runtime[PATH_MAX], scratch[PATH_MAX], executable[PATH_MAX];
    if (!realpath(argv[1], runtime) || !realpath(argv[2], scratch) ||
        !realpath(argv[3], executable)) fail();
    struct stat info;
    if (strlen(runtime) <= 1 || strlen(scratch) <= 1 || !strcmp(runtime, scratch) ||
        beneath(runtime, scratch) || beneath(scratch, runtime) || !beneath(executable, runtime)) fail();
    if (stat(runtime, &info) || !S_ISDIR(info.st_mode) ||
        stat(scratch, &info) || !S_ISDIR(info.st_mode)) fail();
    // Never inherit an application database, network endpoint or terminal.
    for (int fd = 0; fd < 3; fd++) {
        if (fstat(fd, &info) || !trusted_stdio(fd, &info)) fail();
    }
    if (syscall(SYS_close_range, 3U, UINT_MAX, 0)) fail();
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_DUMPABLE, 0)) fail();
    struct __user_cap_header_struct header = {_LINUX_CAPABILITY_VERSION_3, 0};
    struct __user_cap_data_struct capabilities[2] = {{0}, {0}};
    if (syscall(SYS_capset, &header, capabilities)) fail();

    limits(RLIMIT_CPU, 2, 3);
    limits(RLIMIT_AS, 512UL*1024*1024, 512UL*1024*1024);
    limits(RLIMIT_FSIZE, 8UL*1024*1024, 8UL*1024*1024);
    limits(RLIMIT_NOFILE, 64, 64);
    limits(RLIMIT_CORE, 0, 0);
    // RLIMIT_NPROC is per real UID (and bypassed by UID 0), not per child.
    // seccomp below denies new processes; runtime threads share AS/CPU limits.
    umask(0077);
    if (chdir(scratch)) fail();
    int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 3) fail();
    uint64_t read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
#ifndef PARSER_SANDBOX_READONLY_SCRATCH
    uint64_t write = LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |
        LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_DIR |
        LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_TRUNCATE;
#endif
    // Handle every filesystem right through ABI 3. No devices/symlinks/sockets
    // or cross-directory links are granted even in the scratch directory.
    struct landlock_ruleset_attr policy = {.handled_access_fs = (1ULL << 15) - 1};
    int rules = syscall(SYS_landlock_create_ruleset, &policy, sizeof(policy), 0);
    if (rules < 0) fail();
    allow_path(rules, runtime, read | LANDLOCK_ACCESS_FS_EXECUTE, 0);
#ifdef PARSER_SANDBOX_READONLY_SCRATCH
    // Production parsers stream all output and use sealed runtime caches. This
    // removes aggregate scratch byte/inode exhaustion, not only per-file writes.
    allow_path(rules, scratch, read, 0);
#else
    // Retained for the focused native adversarial harness, which verifies that
    // writable scratch still cannot execute or escape when explicitly compiled.
    allow_path(rules, scratch, read | write, 0);
#endif
    const char *libraries[] = {"/lib", "/lib64", "/usr/lib", "/usr/lib64"};
    for (size_t i = 0; i < sizeof(libraries)/sizeof(libraries[0]); i++)
        allow_path(rules, libraries[i], read | LANDLOCK_ACCESS_FS_EXECUTE, 1);
    allow_path(rules, "/etc/ld.so.cache", LANDLOCK_ACCESS_FS_READ_FILE, 1);
    if (syscall(SYS_landlock_restrict_self, rules, 0)) fail();
    close(rules);

    scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
    if (!filter) fail();
    const char *denied[] = {"socket", "socketpair", "connect", "bind", "listen",
        "accept", "accept4", "fork", "vfork", "ptrace", "process_vm_readv",
        "process_vm_writev", "pidfd_getfd", "pidfd_open", "pidfd_send_signal",
        "io_uring_setup", "io_uring_enter", "io_uring_register", "bpf",
        "perf_event_open", "open_by_handle_at", "name_to_handle_at", "mount",
        "umount2", "pivot_root", "chroot", "unshare", "setns", "userfaultfd",
        "keyctl", "add_key", "request_key", "reboot", "kexec_load",
        "kexec_file_load", "init_module", "finit_module", "delete_module",
        "setrlimit", "prlimit64", "capset", "tkill", "rt_sigqueueinfo",
        "rt_tgsigqueueinfo", "chmod", "fchmod", "fchmodat", "chown",
        "fchown", "lchown", "fchownat", "utime", "utimes", "futimesat",
        "utimensat", "setxattr", "lsetxattr", "fsetxattr", "removexattr",
        "lremovexattr", "fremovexattr"};
    for (size_t i = 0; i < sizeof(denied)/sizeof(denied[0]); i++) {
        int number = seccomp_syscall_resolve_name(denied[i]);
        if (number == __NR_SCMP_ERROR ||
            seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), number, 0)) fail();
    }
    // clone3 cannot be safely filtered by its pointed-to flags: force fallback.
    // libuv configures nonblocking stdio with ioctl. These three descriptors
    // were verified to be pipes/unnamed socketpairs, not devices or network.
    if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), __NR_fchmodat2, 0) ||
        seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(ioctl), 1,
            SCMP_A0(SCMP_CMP_GT, 2)) ||
        seccomp_rule_add(filter, SCMP_ACT_ERRNO(ENOSYS), SCMP_SYS(clone3), 0) ||
        seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(clone), 1,
            SCMP_A0(SCMP_CMP_MASKED_EQ, CLONE_THREAD, 0)) ||
        seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(kill), 1,
            SCMP_A0(SCMP_CMP_NE, getpid())) ||
        seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(tgkill), 1,
            SCMP_A0(SCMP_CMP_NE, getpid())) || seccomp_load(filter)) fail();
    seccomp_release(filter);
    char *environment[] = {"LANG=C.UTF-8", NULL};
    argv[3] = executable;
    execve(executable, &argv[3], environment);
    fail();
}
