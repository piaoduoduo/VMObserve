#define _GNU_SOURCE
#include "group3_snapshot.h"
#ifndef LINK_MODE
#define LINK_MODE "dynamic"
#endif
static const char label[] = "read-only";
static int initialized = 17;
static unsigned char uninitialized[65536];
int main(void) {
    setup();
    int local = 3;
    void *heap = malloc(1024);
    if (!heap) fail("malloc");
    printf("{\"kind\":\"condition\",\"mode\":\"%s\",\"pid\":%ld,\"page_bytes\":%ld}\n",
           LINK_MODE, (long)getpid(), sysconf(_SC_PAGESIZE));
    struct { const char *name; uintptr_t address; } symbols[] = {
        {"function", (uintptr_t)main}, {"readonly", (uintptr_t)label},
        {"initialized", (uintptr_t)&initialized}, {"uninitialized", (uintptr_t)uninitialized},
        {"heap", (uintptr_t)heap}, {"stack", (uintptr_t)&local}};
    for (unsigned i=0; i<sizeof symbols/sizeof symbols[0]; ++i)
        printf("{\"kind\":\"symbol\",\"name\":\"%s\",\"address\":\"%" PRIxPTR "\"}\n",
               symbols[i].name, symbols[i].address);
    snapshot("loaded", (uintptr_t)main, 0, usage());
    free(heap);
    return 0;
}
