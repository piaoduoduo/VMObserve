#define _GNU_SOURCE
#include "group3_snapshot.h"
/* Preserves the supplied lab's 512 MiB, 4096-byte stride and A/B/C writes.
 * Interactive pauses are replaced by complete snapshots at the same stages. */
int main(void) {
    setup();
    const size_t bytes=512UL*1024*1024, stride=4096, positions=bytes/stride;
    printf("{\"kind\":\"condition\",\"mode\":\"demand512\",\"pid\":%ld,"
           "\"bytes\":%zu,\"stride\":%zu,\"page_bytes\":%ld}\n",
           (long)getpid(),bytes,stride,sysconf(_SC_PAGESIZE));
    snapshot("before_alloc",0,0,usage());
    struct rusage before=usage();
    volatile unsigned char *p=malloc(bytes);
    if (!p) fail("malloc");
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
    before=usage(); free((void *)p);
    snapshot("freed",address,0,before);
    return mismatches?1:0;
}
