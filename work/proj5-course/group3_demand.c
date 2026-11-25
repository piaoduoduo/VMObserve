#define _GNU_SOURCE
#include "group3_snapshot.h"
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
/* Preserves the supplied lab's 512 MiB, 4096-byte stride and A/B/C writes.
 * Interactive pauses are replaced by complete snapshots at the same stages. */
int main(int argc, char **argv) {
    const char *policy = argc >= 2 ? argv[1] : NULL;
    const char *process_mode = argc == 3 ? argv[2] : NULL;
    if (argc > 3 || (policy && strcmp(policy, "off") && strcmp(policy, "on"))
            || (process_mode && strcmp(process_mode, "allow") && strcmp(process_mode, "disable"))) {
        fputs("Usage: demand512 [off|on [allow|disable]]\n", stderr);
        return 2;
    }
    setup();
    int process_disabled = -1;
    if (process_mode) {
        long disabled = !strcmp(process_mode, "disable") ? 1L : 0L;
        if (prctl(PR_SET_THP_DISABLE, disabled, 0L, 0L, 0L)) fail("PR_SET_THP_DISABLE");
        process_disabled = prctl(PR_GET_THP_DISABLE, 0L, 0L, 0L, 0L);
        if (process_disabled < 0) fail("PR_GET_THP_DISABLE");
    }
    const size_t bytes=512UL*1024*1024, stride=4096, positions=bytes/stride;
    printf("{\"kind\":\"condition\",\"mode\":\"demand512\",\"pid\":%ld,"
           "\"bytes\":%zu,\"stride\":%zu,\"page_bytes\":%ld",
           (long)getpid(),bytes,stride,sysconf(_SC_PAGESIZE));
    if (process_mode)
        printf(",\"process_thp\":\"%s\",\"process_thp_disabled\":%d", process_mode, process_disabled);
    puts("}");
    snapshot("before_alloc",0,0,usage());
    struct rusage before=usage();
    volatile unsigned char *p;
    void *reservation = NULL;
    size_t reserved_bytes = 0;
    if (policy) {
        const long page = sysconf(_SC_PAGESIZE);
        const size_t alignment = 2UL * 1024 * 1024;
        if (page <= 0 || alignment % (size_t)page != 0) {
            fputs("Base page size is incompatible with the 2 MiB alignment\n", stderr);
            return 2;
        }
        /* Protect both ends to isolate the exact 512 MiB VMA from neighboring mappings. */
        reserved_bytes = bytes + 2 * alignment;
        reservation = mmap(NULL, reserved_bytes, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (reservation == MAP_FAILED) fail("mmap");
        uintptr_t start = ((uintptr_t)reservation + page + alignment - 1) & ~(uintptr_t)(alignment - 1);
        p = (volatile unsigned char *)start;
        if (mprotect((void *)p, bytes, PROT_READ | PROT_WRITE)) fail("mprotect");
        int advice = !strcmp(policy, "on") ? MADV_HUGEPAGE : MADV_NOHUGEPAGE;
        int rc = madvise((void *)p, bytes, advice);
        int saved_errno = rc == 0 ? 0 : errno;
        printf("{\"kind\":\"policy\",\"policy\":\"%s\",\"pid\":%ld,\"address\":\"%" PRIxPTR
               "\",\"bytes\":%zu,\"result\":%d,\"errno\":%d}\n",
               policy, (long)getpid(), start, bytes, rc, saved_errno);
    } else {
        p = malloc(bytes);
        if (!p) fail("malloc");
    }
    uintptr_t address=(uintptr_t)p;
    snapshot("allocated",address,0,before);
    const size_t limits[]={positions/4,positions/2,positions};
    const char *phases[]={"write_quarter","write_half","write_all"};
    size_t written=0;
    for (int stage=0;stage<3;++stage) {
        before=usage();
        for (;written<limits[stage];++written) p[written*stride]=(unsigned char)('A'+stage);
        snapshot(phases[stage],address,written,before);
    }
    size_t mismatches=0;
    for (size_t i=0;i<positions;++i) {
        unsigned char expected=i<positions/4?'A':i<positions/2?'B':'C';
        if (p[i*stride]!=expected) ++mismatches;
    }
    printf("{\"kind\":\"values\",\"checked\":%zu,\"mismatches\":%zu}\n",positions,mismatches);
    before=usage();
    if (policy) {
        if (munmap(reservation, reserved_bytes)) fail("munmap");
    } else {
        free((void *)p);
    }
    snapshot("freed",address,0,before);
    return mismatches?1:0;
}
