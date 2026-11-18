/* Course 3.1: relate live C addresses, ELF PT_LOAD ranges and smaps.
 * dl_iterate_phdr reports loaded program headers; no physical frame lookup.
 * Interface reference: https://man7.org/linux/man-pages/man3/dl_iterate_phdr.3.html
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <inttypes.h>
#include <link.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int initialized = 42;
static unsigned char uninitialized[32768];
static const char readonly_data[] = "virtual address experiment";

static int example_function(void) { return initialized; }

static void json_string(const char *s) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}

static void point(const char *name, uintptr_t address) {
    printf("{\"kind\":\"point\",\"symbol\":\"%s\",\"address\":\"%" PRIxPTR "\"}\n", name, address);
}

static int segments(struct dl_phdr_info *info, size_t size, void *context) {
    (void)size;
    int main_object = !info->dlpi_name[0];
    const char *name = main_object ? (const char *)context : info->dlpi_name;
    for (int i = 0; i < info->dlpi_phnum; ++i) {
        const ElfW(Phdr) *p = &info->dlpi_phdr[i];
        if (p->p_type != PT_LOAD || !p->p_memsz) continue;
        printf("{\"kind\":\"segment\",\"object\":");
        json_string(name);
        printf(",\"is_main\":%s,\"index\":%d,\"load_bias\":\"%" PRIxPTR
               "\",\"vaddr\":\"%" PRIxPTR "\",\"offset\":%" PRIu64
               ",\"filesz\":%" PRIu64 ",\"memsz\":%" PRIu64
               ",\"flags\":\"%c%c%c\"}\n",
               main_object ? "true" : "false", i, (uintptr_t)info->dlpi_addr,
               (uintptr_t)p->p_vaddr, (uint64_t)p->p_offset,
               (uint64_t)p->p_filesz, (uint64_t)p->p_memsz,
               p->p_flags & PF_R ? 'r' : '-', p->p_flags & PF_W ? 'w' : '-',
               p->p_flags & PF_X ? 'x' : '-');
    }
    return 0;
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    char executable[4096];
    ssize_t count = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (count < 0 || (size_t)count == sizeof(executable) - 1) {
        perror("readlink executable");
        return 1;
    }
    executable[count] = '\0';
    int stack_local = example_function();
    unsigned char *heap = malloc(4096);
    void *libc_malloc = dlsym(RTLD_DEFAULT, "malloc");
    if (!heap || !libc_malloc) {
        fputs("allocation or libc symbol resolution failed\n", stderr);
        free(heap);
        return 1;
    }
    heap[0] = 7;
    printf("{\"kind\":\"condition\",\"probe_version\":1,\"pid\":%ld,\"page_bytes\":%ld,"
           "\"method\":\"dl_iterate_phdr+smaps\",\"executable\":", (long)getpid(), sysconf(_SC_PAGESIZE));
    json_string(executable);
    puts("}");
    point("function", (uintptr_t)&example_function);
    point("readonly", (uintptr_t)readonly_data);
    point("initialized", (uintptr_t)&initialized);
    point("uninitialized", (uintptr_t)&uninitialized[8192]);
    point("heap", (uintptr_t)heap);
    point("stack", (uintptr_t)&stack_local);
    /* dlsym resolves the implementation address, not the executable's PLT stub. */
    point("libc_malloc", (uintptr_t)libc_malloc);
    dl_iterate_phdr(segments, executable);
    FILE *maps = fopen("/proc/self/smaps", "r");
    if (!maps) { perror("smaps"); free(heap); return 1; }
    fprintf(stderr, "BEGIN phase=layout role=parent pid=%ld\n", (long)getpid());
    char line[1024];
    while (fgets(line, sizeof(line), maps)) fputs(line, stderr);
    int failed = ferror(maps);
    fclose(maps);
    fputs("END\n", stderr);
    free(heap);
    return failed || ferror(stdout) || ferror(stderr) ? 1 : 0;
}
