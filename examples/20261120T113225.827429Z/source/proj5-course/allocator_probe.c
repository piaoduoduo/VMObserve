/* Course-inspired malloc observation. Each size uses a fresh process.
 * The original lab3_2/lab3_3 sources are referenced in docs/COURSE.md.
 * smaps includes entire VMAs. It cannot isolate one malloc allocation.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <unistd.h>
#ifndef VMOBSERVE_ACCESS_HEADER
#define VMOBSERVE_ACCESS_HEADER "access_pattern.h"
#endif
#ifndef VMOBSERVE_ACCESS_NAME
#define VMOBSERVE_ACCESS_NAME "reference"
#endif
#include VMOBSERVE_ACCESS_HEADER

struct faults { long minor, major; };
static void die(const char *message) { perror(message); exit(1); }
static struct faults faults(void) {
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage)) die("getrusage");
    return (struct faults){usage.ru_minflt, usage.ru_majflt};
}
static struct faults delta(struct faults before) {
    struct faults after = faults();
    return (struct faults){after.minor - before.minor, after.major - before.major};
}
static void write_all(int fd, const char *buffer, size_t length) {
    while (length) {
        ssize_t count = write(fd, buffer, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) die("write evidence");
        buffer += count;
        length -= (size_t)count;
    }
}
static void snapshot(const char *phase, uintptr_t address, size_t written,
                     struct faults action) {
    uintptr_t program_break = (uintptr_t)sbrk(0);
    if (program_break == (uintptr_t)-1) die("sbrk query");
    fprintf(stderr, "BEGIN phase=%s role=parent pid=%ld\n", phase, (long)getpid());
    int fd = open("/proc/self/smaps", O_RDONLY);
    if (fd < 0) die("open smaps");
    /* Low-level I/O and a static buffer avoid allocating observer heap blocks. */
    static char buffer[8192];
    ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer))) != 0) {
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) die("read smaps");
        write_all(STDERR_FILENO, buffer, (size_t)count);
    }
    close(fd);
    fprintf(stderr, "END\n");
    printf("{\"kind\":\"sample\",\"phase\":\"%s\",\"role\":\"parent\","
           "\"pid\":%ld,\"address\":\"%" PRIxPTR "\",\"program_break\":\"%" PRIxPTR "\","
           "\"written_positions\":%zu,\"action_minor\":%ld,\"action_major\":%ld}\n",
           phase, (long)getpid(), address, program_break, written, action.minor, action.major);
}
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char *end;
    unsigned long kib = strtoul(argv[1], &end, 10);
    if (end == argv[1] || *end || (kib != 1 && kib != 256 && kib != 1024 && kib != 16384)) return 2;
    long page = sysconf(_SC_PAGESIZE);
    if (page <= 0) die("page size");
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    size_t bytes = kib * 1024, positions = (bytes + (size_t)page - 1) / (size_t)page;
    printf("{\"kind\":\"condition\",\"probe_version\":2,\"allocator\":\"malloc\","
           "\"course_code\":\"" VMOBSERVE_ACCESS_NAME "\","
           "\"requested_kib\":%lu,\"page_bytes\":%ld,\"positions\":%zu,"
           "\"thp_policy\":\"system_default\",\"allocation_sequence\":\"fresh_process_single_block\"}\n",
           kib, page, positions);
    snapshot("before_alloc", 0, 0, (struct faults){0, 0});
    struct faults before = faults();
    volatile unsigned char *memory = malloc(bytes);
    if (!memory) die("malloc");
    struct faults action = delta(before);
    uintptr_t address = (uintptr_t)memory;
    snapshot("allocated", address, 0, action);
    size_t limits[] = {(positions + 3) / 4, (positions + 1) / 2, positions};
    const char *phases[] = {"write_quarter", "write_half", "write_all"};
    size_t written = 0;
    for (size_t stage = 0; stage < 3; ++stage) {
        before = faults();
        written = course_touch(memory, (size_t)page, written, limits[stage]);
        action = delta(before);
        snapshot(phases[stage], address, written, action);
    }
    size_t errors = 0;
    for (size_t i = 0; i < positions; ++i)
        if (memory[i * (size_t)page] != 7) ++errors;
    printf("{\"kind\":\"values\",\"checked_positions\":%zu,\"mismatches\":%zu,\"ok\":%s}\n",
           positions, errors, errors ? "false" : "true");
    before = faults();
    free((void *)memory);
    action = delta(before);
    /* The saved integer locates the former range. Freed memory is never read. */
    snapshot("freed", address, 0, action);
    /* Exit 0 means collection completed. The runner returns failure when the
     * recorded task counts/values fail, preserving all six stages for review. */
    return 0;
}
