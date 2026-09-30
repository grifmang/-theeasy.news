#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static void *thread_entry(void *argument) { return argument; }

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    const char *mode = argv[1];
    if (!strcmp(mode, "controlfd"))
        return getenv("SANDBOX_TEST_SECRET") && fcntl(9, F_GETFD) >= 0 ? 0 : 1;
    if (!strcmp(mode, "links")) {
        char link_path[4096];
        if (snprintf(link_path, sizeof(link_path), "%s-link", argv[3]) >= (int)sizeof(link_path)) return 2;
        errno = 0;
        if (open(link_path, O_RDONLY) != -1 || errno != EACCES) return 3;
        errno = 0;
        if (symlink(argv[2], "escape-link") != -1 || errno != EACCES) return 4;
        errno = 0;
        if (link(argv[2], "escape-hardlink") != -1 ||
            (errno != EACCES && errno != EXDEV)) return 5;
        errno = 0;
        if (truncate(argv[2], 0) != -1 || errno != EACCES) return 6;
        return 0;
    }
    if (!strcmp(mode, "scratch-exec")) {
        int source = open(argv[0], O_RDONLY);
        int target = open("copied-worker", O_CREAT|O_EXCL|O_WRONLY, 0700);
        if (source < 0 || target < 0) return 2;
        char data[4096]; ssize_t count;
        while ((count = read(source, data, sizeof(data))) > 0)
            if (write(target, data, (size_t)count) != count) return 3;
        close(source); close(target);
        if (count < 0) return 4;
        execl("./copied-worker", "./copied-worker", "unexpected-execution", argv[2], argv[3], NULL);
        return errno == EACCES ? 0 : 5;
    }
    if (!strcmp(mode, "file-limit")) {
        int target = open("large-file", O_CREAT|O_EXCL|O_WRONLY, 0600);
        if (target < 0) return 2;
        char data[4096] = {0};
        for (int i = 0; i < 2304; i++)
            if (write(target, data, sizeof(data)) != sizeof(data)) return 3;
        return 4;
    }
    if (!strcmp(mode, "fd-limit")) {
        for (int i = 0; i < 128; i++) {
            if (open(argv[3], O_RDONLY) < 0) return errno == EMFILE ? 0 : 1;
        }
        return 2;
    }
    if (!strcmp(mode, "threads")) {
        pthread_t thread;
        int error = pthread_create(&thread, NULL, thread_entry, NULL);
        if (error) { fprintf(stderr, "pthread_create: %d\n", error); return 1; }
        return pthread_join(thread, NULL) == 0 ? 0 : 1;
    }
    if (!strcmp(mode, "cpu")) { for (;;) {} }
    if (!strcmp(mode, "memory")) {
        void *p = mmap(NULL, 1024UL*1024*1024, PROT_READ|PROT_WRITE,
            MAP_PRIVATE|MAP_ANONYMOUS, -1, 0);
        return p == MAP_FAILED && errno == ENOMEM ? 0 : 1;
    }
    if (!strcmp(mode, "checks")) {
        if (getenv("SANDBOX_TEST_SECRET")) return 3;
        errno = 0;
        if (fcntl(9, F_GETFD) != -1 || errno != EBADF) return 4;
        errno = 0;
        if (open(argv[2], O_RDONLY) != -1 || errno != EACCES) return 5;
        errno = 0;
        if (open(argv[2], O_WRONLY) != -1 || errno != EACCES) return 6;
        errno = 0;
        if (socket(AF_INET, SOCK_STREAM, 0) != -1 || errno != EPERM) return 7;
        errno = 0;
        if (socket(AF_UNIX, SOCK_STREAM, 0) != -1 || errno != EPERM) return 8;
        errno = 0;
        if (fork() != -1 || errno != EPERM) return 9;
        int scratch = open("scratch.txt", O_CREAT|O_WRONLY|O_EXCL, 0600);
        if (scratch < 0 || write(scratch, "ok", 2) != 2) return 10;
        close(scratch);
        int runtime = open(argv[3], O_RDONLY);
        if (runtime < 0) return 11;
        close(runtime);
        errno = 0;
        if (open(argv[3], O_WRONLY) != -1 || errno != EACCES) return 12;
        puts("sandbox restrictions verified");
        return 0;
    }
    return 2;
}
