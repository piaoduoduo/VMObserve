#define _GNU_SOURCE
#include "group3_snapshot.h"
int main(void) {
    setup();
    printf("{\"kind\":\"condition\",\"mode\":\"sequence\",\"pid\":%ld,"
           "\"sizes\":[1024,262144,1048576],\"page_bytes\":%ld}\n",
           (long)getpid(), sysconf(_SC_PAGESIZE));
    snapshot("before_alloc", 0, 0, usage());
    void *blocks[3]; uintptr_t addresses[3];
    const size_t sizes[] = {1024,256*1024,1024*1024};
    const char *phases[] = {"alloc_1KiB","alloc_256KiB","alloc_1MiB"};
    for (int i=0; i<3; ++i) {
        int length=snprintf(marker_buffer,sizeof marker_buffer,"ACTION malloc_%d BEGIN\n",i+1);
        output_all(2,marker_buffer,(size_t)length);
        struct rusage before = usage();
        blocks[i] = malloc(sizes[i]);
        if (!blocks[i]) fail("malloc");
        addresses[i] = (uintptr_t)blocks[i];
        length=snprintf(marker_buffer,sizeof marker_buffer,"ACTION malloc_%d END\n",i+1);
        output_all(2,marker_buffer,(size_t)length);
        snapshot(phases[i], addresses[i], (unsigned long)i+1, before);
    }
    printf("{\"kind\":\"allocations\",\"addresses\":[\"%" PRIxPTR "\",\"%" PRIxPTR
           "\",\"%" PRIxPTR "\"]}\n",addresses[0],addresses[1],addresses[2]);
    output_all(2,"ACTION free_all BEGIN\n",sizeof("ACTION free_all BEGIN\n")-1);
    struct rusage before = usage();
    for (int i=0;i<3;++i) free(blocks[i]);
    output_all(2,"ACTION free_all END\n",sizeof("ACTION free_all END\n")-1);
    snapshot("freed", addresses[0], 0, before);
    return 0;
}
