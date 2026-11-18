/* Shared exact-VMA sampling. See original probe attribution and docs/SOURCES.md. */
#ifndef VMOBSERVE_PROBE_H
#define VMOBSERVE_PROBE_H
#define _GNU_SOURCE
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <unistd.h>

struct faults { long minor, major; };

static void die(const char *message) { perror(message); exit(1); }

static struct faults read_faults(void) {
    struct rusage r;
    if (getrusage(RUSAGE_SELF, &r)) die("getrusage");
    return (struct faults){r.ru_minflt, r.ru_majflt};
}

static struct faults difference(struct faults before) {
    struct faults after = read_faults();
    return (struct faults){after.minor - before.minor, after.major - before.major};
}

/* Guard pages prevent adjacent VMAs from being merged into the measured VMA.
 * No process writes the measured VMA while a snapshot is being taken.
 * Save the complete matching smaps section to stderr for independent audit.
 */
static void snapshot(const char *phase, const char *role, pid_t pid,
                     volatile unsigned char *p, size_t bytes, struct faults faults) {
    char path[80], line[512];
    snprintf(path, sizeof(path), "/proc/%ld/smaps", (long)pid);
    FILE *file = fopen(path, "r");
    if (!file) die("open smaps");
    unsigned long size = 0, rss = 0, pss = 0, pd = 0, sd = 0, huge = 0, swap = 0;
    unsigned long kernel_page = 0;
    int selected = 0, found = 0;
    unsigned fields = 0;
    fprintf(stderr, "BEGIN phase=%s role=%s pid=%ld\n", phase, role, (long)pid);
    while (fgets(line, sizeof(line), file)) {
        unsigned long first, last;
        if (sscanf(line, "%lx-%lx", &first, &last) == 2) {
            if (selected) break;
            selected = first == (uintptr_t)p && last == (uintptr_t)p + bytes;
            if (selected) found = 1;
        }
        if (!selected) continue;
        fputs(line, stderr);
        if (sscanf(line, "Size: %lu kB", &size) == 1) fields |= 1;
        if (sscanf(line, "Rss: %lu kB", &rss) == 1) fields |= 2;
        if (sscanf(line, "Pss: %lu kB", &pss) == 1) fields |= 4;
        if (sscanf(line, "Private_Dirty: %lu kB", &pd) == 1) fields |= 8;
        if (sscanf(line, "Shared_Dirty: %lu kB", &sd) == 1) fields |= 16;
        if (sscanf(line, "AnonHugePages: %lu kB", &huge) == 1) fields |= 32;
        if (sscanf(line, "Swap: %lu kB", &swap) == 1) fields |= 64;
        if (sscanf(line, "KernelPageSize: %lu kB", &kernel_page) == 1) fields |= 128;
    }
    if (ferror(file)) die("read smaps");
    fclose(file);
    fprintf(stderr, "END\n");
    if (!found || fields != 255 || size != bytes / 1024) {
        fprintf(stderr, "Cannot identify complete exact VMA\n"); exit(1);
    }
    printf("{\"kind\":\"sample\",\"phase\":\"%s\",\"role\":\"%s\","
           "\"pid\":%ld,\"size_kib\":%lu,\"rss_kib\":%lu,\"pss_kib\":%lu,"
           "\"private_dirty_kib\":%lu,\"shared_dirty_kib\":%lu,\"huge_kib\":%lu,"
           "\"swap_kib\":%lu,\"kernel_page_kib\":%lu,\"action_minor\":%ld,\"action_major\":%ld}\n",
           phase, role, (long)pid, size, rss, pss, pd, sd, huge, swap, kernel_page,
           faults.minor, faults.major);
    fflush(stdout);
}


#endif
