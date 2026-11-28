/* Fixed sentinels in our own experiment region, including our waiting fork child. */
#ifndef VMOBSERVE_PAGEMAP_PROBE_H
#define VMOBSERVE_PAGEMAP_PROBE_H
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <unistd.h>

static int pagemap_admin(void) {
    FILE *status = fopen("/proc/self/status", "r");
    if (!status) return -1;
    char line[256];
    uint64_t caps;
    int admin = -1;
    while (fgets(line, sizeof(line), status)) {
        if (sscanf(line, "CapEff: %" SCNx64, &caps) == 1) {
            admin = (caps >> 21) & 1;
            break;
        }
    }
    fclose(status);
    return admin;
}

static const char *pm_bool(int value) { return value ? "true" : "false"; }

static void sample_pagemap(pid_t pid, const char *phase, const char *role,
        uintptr_t address, size_t bytes, size_t page, const size_t *indices,
        const char *const *labels, const int *written, size_t count) {
    char path[64], reason[64] = "";
    snprintf(path, sizeof(path), "/proc/%ld/pagemap", (long)pid);
    const uint64_t pfn_mask = (UINT64_C(1) << 55) - 1;
    uint64_t raw[count];
    uintptr_t base = address - address % page;
    size_t pages = (address - base + bytes + page - 1) / page;
    size_t present = 0, swapped = 0;
    int admin = pagemap_admin(), zero_frame = 0;
    const char *status = "unmapped", *access = "not_applicable";
    if (address) {
        int fd = open(path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) {
            status = "unavailable";
            snprintf(reason, sizeof(reason), "errno=%d", errno);
            count = 0;
        } else {
            status = "available";
            for (size_t i = 0; i < count; ++i) {
                off_t offset = (off_t)(base / page + indices[i]) * 8;
                ssize_t n;
                do { n = pread(fd, &raw[i], sizeof(raw[i]), offset); } while (n < 0 && errno == EINTR);
                if (n != sizeof(raw[i])) {
                    status = "error";
                    if (n < 0) snprintf(reason, sizeof(reason), "errno=%d", errno);
                    else snprintf(reason, sizeof(reason), "short_read=%zd", n);
                    count = present = swapped = 0;
                    break;
                }
                if (raw[i] >> 63) {
                    ++present;
                    if (!(raw[i] & pfn_mask)) zero_frame = 1;
                }
                swapped += (raw[i] >> 62) & 1;
            }
            close(fd);
            if (present) {
                if (admin == 1 && !zero_frame) access = "visible";
                else {
                    access = "masked";
                    snprintf(reason, sizeof(reason), "%s",
                             admin == 0 ? "requires_cap_sys_admin" : "pfn_not_disclosed");
                }
            }
        }
    } else {
        count = 0;
        snprintf(reason, sizeof(reason), "no_live_allocation");
    }
    printf("{\"kind\":\"pagemap\",\"phase\":\"%s\",\"role\":\"%s\",\"pid\":%ld,"
           "\"source\":\"%s\",\"status\":\"%s\",\"pfn_access\":\"%s\",\"page_bytes\":%zu,"
           "\"cap_sys_admin\":%s,", phase, role, (long)pid, path, status, access, page,
           admin < 0 ? "null" : pm_bool(admin));
    if (*reason) printf("\"reason\":\"%s\",", reason);
    if (address) printf("\"region_start\":\"%" PRIxPTR "\",\"region_pages\":%zu,", base, pages);
    else fputs("\"region_start\":null,\"region_pages\":null,", stdout);
    printf("\"sampled_count\":%zu,\"present_count\":%zu,\"swapped_count\":%zu,\"entries\":[",
           count, present, swapped);
    for (size_t i = 0; i < count; ++i) {
        uint64_t value = raw[i];
        printf("%s{\"page_index\":%zu,\"vaddr\":\"%" PRIxPTR "\",", i ? "," : "",
               indices[i], base + indices[i] * page);
        if (labels) printf("\"label\":\"%s\",", labels[i]);
        printf("\"expected_written\":%s,\"raw_hex\":\"%016" PRIx64 "\","
               "\"present\":%s,\"swapped\":%s,\"file_shared\":%s,\"soft_dirty\":%s,\"pfn\":",
               pm_bool(written[i]), value, pm_bool(value >> 63), pm_bool((value >> 62) & 1),
               pm_bool((value >> 61) & 1), pm_bool((value >> 55) & 1));
        if ((value >> 63) && admin == 1 && !zero_frame) printf("\"%" PRIx64 "\"", value & pfn_mask);
        else fputs("null", stdout);
        putchar('}');
    }
    puts("]}");
}
#endif
