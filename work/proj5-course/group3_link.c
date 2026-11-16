#define _GNU_SOURCE
#include "group3_snapshot.h"
#include <dlfcn.h>
#include <sys/stat.h>
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
    struct stat executable;
    if (stat("/proc/self/exe", &executable)) fail("stat executable");
#ifdef STATIC_LINK_BUILD
    uintptr_t malloc_address = (uintptr_t)&malloc;
#else
    uintptr_t malloc_address = (uintptr_t)dlsym(RTLD_DEFAULT, "malloc");
    if (!malloc_address) fail("resolve malloc");
#endif
    printf("{\"kind\":\"condition\",\"mode\":\"%s\",\"pid\":%ld,\"page_bytes\":%ld,\"binary_bytes\":%ju}\n",
           LINK_MODE, (long)getpid(), sysconf(_SC_PAGESIZE), (uintmax_t)executable.st_size);
    struct { const char *name; uintptr_t address; } symbols[] = {
        {"function", (uintptr_t)main}, {"readonly", (uintptr_t)label},
        {"initialized", (uintptr_t)&initialized}, {"uninitialized", (uintptr_t)uninitialized},
        {"heap", (uintptr_t)heap}, {"stack", (uintptr_t)&local}, {"libc_malloc", malloc_address}};
    for (unsigned i=0; i<sizeof symbols/sizeof symbols[0]; ++i)
        printf("{\"kind\":\"symbol\",\"name\":\"%s\",\"address\":\"%" PRIxPTR "\"}\n",
               symbols[i].name, symbols[i].address);
    snapshot("loaded", (uintptr_t)main, 0, usage());
    free(heap);
    return 0;
}
