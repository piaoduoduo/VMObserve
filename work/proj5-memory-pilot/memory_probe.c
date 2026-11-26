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
#include "../common/pagemap_probe.h"

/* In the paired snapshots the write mask identifies the child's own modifications. */
static void cow_snapshot(const char *phase, const char *role, pid_t pid,
                         volatile unsigned char *p, size_t bytes, size_t page,
                         struct faults delta, size_t write_stride) {
    snapshot(phase, role, pid, p, bytes, delta);
    const size_t indices[] = {0, 1, 2, 3, 4, 5, 6, 7};
    int written[8];
    for (size_t i = 0; i < 8; ++i) written[i] = write_stride && i % write_stride == 0;
    sample_pagemap(pid, phase, role, (uintptr_t)p, bytes, page, indices, NULL, written, 8);
}

struct reply {
    struct faults faults;
    unsigned long checksum, written_pages, mismatches;
};

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

/* Check every page's value, not only a sum that could hide offsetting errors. */
static unsigned long mismatches(volatile unsigned char *p, size_t pages, size_t page,
                                size_t cow_stride) {
    unsigned long count = 0;
    for (size_t i = 0; i < pages; ++i) {
        unsigned char expected = cow_stride && i % cow_stride == 0 ? 2 : 1;
        if (p[i * page] != expected) ++count;
    }
    return count;
}

int main(int argc, char **argv) {
    unsigned long mib = 16;
    if (argc > 3) {
        fprintf(stderr, "usage: memory_probe [MiB: 4..64] [COW: 0|1/8|1/4|1/2|1]\n");
        return 2;
    }
    if (argc >= 2) {
        char *end;
        mib = strtoul(argv[1], &end, 10);
        if (end == argv[1] || *end || mib < 4 || mib > 64) return 2;
    }
    const char *fraction = argc == 3 ? argv[2] : "1/4";
    size_t cow_stride;
    if (!strcmp(fraction, "0")) cow_stride = 0;
    else if (!strcmp(fraction, "1/8")) cow_stride = 8;
    else if (!strcmp(fraction, "1/4")) cow_stride = 4;
    else if (!strcmp(fraction, "1/2")) cow_stride = 2;
    else if (!strcmp(fraction, "1")) cow_stride = 1;
    else { fprintf(stderr, "invalid COW fraction\n"); return 2; }
    long page_long = sysconf(_SC_PAGESIZE);
    if (page_long <= 0) die("page size");
    size_t page = (size_t)page_long, bytes = mib * 1024 * 1024;
    if (bytes % (4 * page) || (cow_stride && bytes % (cow_stride * page))) return 2;
    size_t total_pages = bytes / page;
    size_t cow_pages = cow_stride ? total_pages / cow_stride : 0;
    struct utsname u;
    if (uname(&u)) die("uname");
    printf("{\"kind\":\"environment\",\"kernel\":\"%s\",\"arch\":\"%s\","
           "\"page_bytes\":%zu,\"mib\":%lu,\"thp_policy\":\"MADV_NOHUGEPAGE\","
           "\"probe_version\":2,\"pagemap_version\":1,\"cow_fraction\":\"%s\",\"cow_stride_pages\":%zu,"
           "\"total_pages\":%zu,\"cow_pages\":%zu}\n",
           u.release, u.machine, page, mib, fraction, cow_stride, total_pages, cow_pages);
    void *base = mmap(NULL, bytes + 2 * page, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (base == MAP_FAILED) die("mmap");
    volatile unsigned char *p = (unsigned char *)base + page;
    if (mprotect((void *)p, bytes, PROT_READ | PROT_WRITE)) die("mprotect");
    if (madvise((void *)p, bytes, MADV_NOHUGEPAGE)) die("MADV_NOHUGEPAGE");
    struct faults zero = {0, 0};
    cow_snapshot("untouched", "parent", getpid(), p, bytes, page, zero, 0);

    struct faults before = read_faults();
    unsigned long read_sum = checksum(p, bytes, page);
    struct faults delta = difference(before);
    cow_snapshot("read_all", "parent", getpid(), p, bytes, page, delta, 0);
    if (read_sum != 0) return 1;

    before = read_faults();
    for (size_t i = 0; i < bytes; i += 4 * page) p[i] = 1;
    delta = difference(before);
    cow_snapshot("write_quarter", "parent", getpid(), p, bytes, page, delta, 4);

    before = read_faults();
    for (size_t i = 0; i < bytes; i += page) p[i] = 1;
    delta = difference(before);
    cow_snapshot("write_all", "parent", getpid(), p, bytes, page, delta, 1);

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
        reply.written_pages = 0;
        before = read_faults();
        if (cow_stride) {
            for (size_t i = 0; i < total_pages; i += cow_stride) {
                p[i * page] = 2;
                ++reply.written_pages;
            }
        }
        reply.faults = difference(before);
        reply.checksum = checksum(p, bytes, page);
        reply.mismatches = mismatches(p, total_pages, page, cow_stride);
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
    cow_snapshot("fork_shared", "parent", getpid(), p, bytes, page, zero, 0);
    cow_snapshot("fork_shared", "child", child, p, bytes, page, zero, 0);
    signal = 'W'; transfer(command[1], &signal, 1, 1);
    struct reply reply;
    transfer(response[0], &reply, sizeof(reply), 0);
    cow_snapshot("child_write", "parent", getpid(), p, bytes, page, zero, cow_stride);
    cow_snapshot("child_write", "child", child, p, bytes, page, reply.faults, cow_stride);
    unsigned long parent_sum = checksum(p, bytes, page);
    unsigned long parent_mismatches = mismatches(p, total_pages, page, 0);
    int isolated = parent_sum == total_pages && reply.checksum == total_pages + cow_pages &&
                   reply.written_pages == cow_pages && !parent_mismatches && !reply.mismatches;
    printf("{\"kind\":\"isolation\",\"initial_read_sum\":%lu,\"parent_sum\":%lu,\"child_sum\":%lu,"
           "\"cow_written_pages\":%lu,\"parent_mismatches\":%lu,\"child_mismatches\":%lu,\"ok\":%s}\n",
           read_sum, parent_sum, reply.checksum, reply.written_pages, parent_mismatches, reply.mismatches,
           isolated ? "true" : "false");
    signal = 'Q'; transfer(command[1], &signal, 1, 1);
    close(command[1]); close(response[0]);
    int status;
    if (waitpid(child, &status, 0) != child) die("waitpid");
    if (!WIFEXITED(status) || WEXITSTATUS(status) || !isolated) return 1;
    if (munmap(base, bytes + 2 * page)) die("munmap");
    return 0;
}
