/*
 * Bounded feasibility probe for proj5, generated with Codex assistance.
 * This is a research probe, not a finished contest submission.
 * No third-party implementation copied. Interface semantics consulted:
 * https://docs.kernel.org/filesystems/proc.html
 * https://man7.org/linux/man-pages/man2/getrusage.2.html
 * https://man7.org/linux/man-pages/man2/madvise.2.html
 * The measured object is one isolated anonymous VMA, not whole-process RSS.
 */
#include "../common/probe.h"

struct reply { struct faults faults; unsigned long checksum; };

static void transfer(int fd, void *data, size_t n, int writing) {
    char *cursor = data;
    while (n) {
        ssize_t done = writing ? write(fd, cursor, n) : read(fd, cursor, n);
        if (done < 0 && errno == EINTR) continue;
        if (done <= 0) { fprintf(stderr, "pipe transfer failed\n"); exit(1); }
        cursor += done;
        n -= (size_t)done;
    }
}

static unsigned long checksum(volatile unsigned char *p, size_t bytes, size_t page) {
    unsigned long sum = 0;
    for (size_t i = 0; i < bytes; i += page) sum += p[i];
    return sum;
}

int main(int argc, char **argv) {
    unsigned long mib = 16;
    if (argc > 2) { fprintf(stderr, "usage: memory_probe [MiB: 4..64]\n"); return 2; }
    if (argc == 2) {
        char *end;
        mib = strtoul(argv[1], &end, 10);
        if (*end || mib < 4 || mib > 64) return 2;
    }
    long page_long = sysconf(_SC_PAGESIZE);
    if (page_long <= 0) die("page size");
    size_t page = (size_t)page_long, bytes = mib * 1024 * 1024;
    if (bytes % (4 * page)) return 2;
    struct utsname u;
    if (uname(&u)) die("uname");
    printf("{\"kind\":\"environment\",\"kernel\":\"%s\",\"arch\":\"%s\","
           "\"page_bytes\":%zu,\"mib\":%lu,\"thp_policy\":\"MADV_NOHUGEPAGE\"}\n",
           u.release, u.machine, page, mib);
    void *base = mmap(NULL, bytes + 2 * page, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (base == MAP_FAILED) die("mmap");
    volatile unsigned char *p = (unsigned char *)base + page;
    if (mprotect((void *)p, bytes, PROT_READ | PROT_WRITE)) die("mprotect");
    if (madvise((void *)p, bytes, MADV_NOHUGEPAGE)) die("MADV_NOHUGEPAGE");
    struct faults zero = {0, 0};
    snapshot("untouched", "parent", getpid(), p, bytes, zero);

    struct faults before = read_faults();
    unsigned long read_sum = checksum(p, bytes, page);
    struct faults delta = difference(before);
    snapshot("read_all", "parent", getpid(), p, bytes, delta);
    if (read_sum != 0) return 1;

    before = read_faults();
    for (size_t i = 0; i < bytes; i += 4 * page) p[i] = 1;
    delta = difference(before);
    snapshot("write_quarter", "parent", getpid(), p, bytes, delta);

    before = read_faults();
    for (size_t i = 0; i < bytes; i += page) p[i] = 1;
    delta = difference(before);
    snapshot("write_all", "parent", getpid(), p, bytes, delta);

    int command[2], response[2];
    if (pipe(command) || pipe(response)) die("pipe");
    fflush(NULL);
    pid_t child = fork();
    if (child < 0) die("fork");
    if (child == 0) {
        close(command[1]); close(response[0]);
        char signal = 'R';
        transfer(response[1], &signal, 1, 1);
        transfer(command[0], &signal, 1, 0);
        if (signal != 'W') _exit(1);
        struct reply reply;
        before = read_faults();
        for (size_t i = 0; i < bytes; i += 4 * page) p[i] = 2;
        reply.faults = difference(before);
        reply.checksum = checksum(p, bytes, page);
        transfer(response[1], &reply, sizeof(reply), 1);
        /* Parent samples both live processes while child waits here. */
        transfer(command[0], &signal, 1, 0);
        close(command[0]); close(response[1]);
        _exit(signal == 'Q' ? 0 : 1);
    }
    close(command[0]); close(response[1]);
    char signal;
    transfer(response[0], &signal, 1, 0);
    if (signal != 'R') return 1;
    snapshot("fork_shared", "parent", getpid(), p, bytes, zero);
    snapshot("fork_shared", "child", child, p, bytes, zero);
    signal = 'W'; transfer(command[1], &signal, 1, 1);
    struct reply reply;
    transfer(response[0], &reply, sizeof(reply), 0);
    snapshot("child_write_quarter", "parent", getpid(), p, bytes, zero);
    snapshot("child_write_quarter", "child", child, p, bytes, reply.faults);
    unsigned long parent_sum = checksum(p, bytes, page);
    int isolated = parent_sum == bytes / page && reply.checksum == bytes / page * 5 / 4;
    printf("{\"kind\":\"isolation\",\"parent_sum\":%lu,\"child_sum\":%lu,\"ok\":%s}\n",
           parent_sum, reply.checksum, isolated ? "true" : "false");
    signal = 'Q'; transfer(command[1], &signal, 1, 1);
    close(command[1]); close(response[0]);
    int status;
    if (waitpid(child, &status, 0) != child) die("waitpid");
    if (!WIFEXITED(status) || WEXITSTATUS(status) || !isolated) return 1;
    if (munmap(base, bytes + 2 * page)) die("munmap");
    return 0;
}
