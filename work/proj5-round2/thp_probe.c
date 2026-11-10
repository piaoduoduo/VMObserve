/* Round-two feasibility probe. Uses the shared exact-VMA smaps reader.
 * Controlled variable: advice on this VMA only. No sysfs changes or privileges.
 * MADV_HUGEPAGE is a request, not a guarantee; actual backing is read from smaps.
 * Reference: https://docs.kernel.org/admin-guide/mm/transhuge.html
 */
#include "../common/probe.h"

int main(int argc, char **argv) {
    if (argc != 3 || (strcmp(argv[1], "on") && strcmp(argv[1], "off")) ||
        (strcmp(argv[2], "sparse") && strcmp(argv[2], "full"))) {
        fprintf(stderr, "usage: thp_probe on|off sparse|full\n"); return 2;
    }
    long page_long = sysconf(_SC_PAGESIZE);
    if (page_long <= 0) die("page size");
    size_t page = (size_t)page_long, huge = 0;
    FILE *huge_file = fopen("/sys/kernel/mm/transparent_hugepage/hpage_pmd_size", "r");
    if (!huge_file || fscanf(huge_file, "%zu", &huge) != 1 || !huge) {
        fprintf(stderr, "PMD huge page size unavailable\n"); return 3;
    }
    fclose(huge_file);
    const size_t bytes = 32 * 1024 * 1024;
    if (!page || bytes % huge || huge % page) return 3;
    size_t reserve = bytes + huge + 2 * page;
    void *base = mmap(NULL, reserve, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (base == MAP_FAILED) die("mmap");
    uintptr_t start = ((uintptr_t)base + page + huge - 1) / huge * huge;
    volatile unsigned char *p = (volatile unsigned char *)start;
    if (mprotect((void *)p, bytes, PROT_READ | PROT_WRITE)) die("mprotect");
    int advice = strcmp(argv[1], "on") == 0 ? MADV_HUGEPAGE : MADV_NOHUGEPAGE;
    if (madvise((void *)p, bytes, advice)) die("madvise");
    size_t stride = strcmp(argv[2], "sparse") == 0 ? huge : page;
    printf("{\"kind\":\"condition\",\"thp_requested\":\"%s\",\"pattern\":\"%s\","
           "\"page_bytes\":%zu,\"huge_bytes\":%zu,\"region_bytes\":%zu,"
           "\"stride_bytes\":%zu,\"writes\":%zu,\"huge_aligned\":true}\n",
           argv[1], argv[2], page, huge, bytes, stride, bytes / stride);
    struct faults zero = {0, 0};
    snapshot("untouched", "parent", getpid(), p, bytes, zero);
    struct faults before = read_faults();
    for (size_t i = 0; i < bytes; i += stride) p[i] = 1;
    struct faults delta = difference(before);
    snapshot("after_write", "parent", getpid(), p, bytes, delta);
    unsigned long sum = 0;
    for (size_t i = 0; i < bytes; i += stride) sum += p[i];
    printf("{\"kind\":\"values\",\"sum\":%lu,\"ok\":%s}\n", sum,
           sum == bytes / stride ? "true" : "false");
    if (munmap(base, reserve)) die("munmap");
    return sum == bytes / stride ? 0 : 1;
}
