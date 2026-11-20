#ifndef GROUP3_SNAPSHOT_H
#define GROUP3_SNAPSHOT_H
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <unistd.h>
static char evidence_buffer[8192];
static char marker_buffer[256];
static void fail(const char *s) { perror(s); exit(1); }
static struct rusage usage(void) {
    struct rusage r;
    if (getrusage(RUSAGE_SELF, &r)) fail("getrusage");
    return r;
}
static void output_all(int fd, const char *p, size_t n) {
    while (n) {
        ssize_t k = write(fd, p, n);
        if (k < 0 && errno == EINTR) continue;
        if (k <= 0) fail("write");
        p += k; n -= (size_t)k;
    }
}
/* No stdio allocation while observing the allocator. All mappings are saved;
 * the Python reader derives metrics from these original smaps blocks. */
static void snapshot(const char *phase, uintptr_t address, unsigned long count,
                     struct rusage before) {
    struct rusage after = usage();
    printf("{\"kind\":\"sample\",\"phase\":\"%s\",\"pid\":%ld,\"address\":\"%" PRIxPTR
           "\",\"program_break\":\"%" PRIxPTR "\",\"count\":%lu,"
           "\"action_minor\":%ld,\"action_major\":%ld,\"total_minor\":%ld,\"total_major\":%ld}\n",
           phase, (long)getpid(), address, (uintptr_t)sbrk(0), count,
           after.ru_minflt-before.ru_minflt, after.ru_majflt-before.ru_majflt,
           after.ru_minflt, after.ru_majflt);
    int marker_length=snprintf(marker_buffer,sizeof marker_buffer,"BEGIN phase=%s pid=%ld\n",phase,(long)getpid());
    output_all(2,marker_buffer,(size_t)marker_length);
    int fd = open("/proc/self/smaps", O_RDONLY);
    if (fd < 0) fail("smaps");
    ssize_t n;
    while ((n = read(fd, evidence_buffer, sizeof evidence_buffer)) > 0)
        output_all(2, evidence_buffer, (size_t)n);
    if (n < 0) fail("read smaps");
    close(fd);
    output_all(2, "END\n", 4);
}
static void setup(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
#endif
