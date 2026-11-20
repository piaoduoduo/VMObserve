/* Reference answer: extend the prefix, one byte per base-page-sized step. */
#ifndef VMOBSERVE_ACCESS_PATTERN_H
#define VMOBSERVE_ACCESS_PATTERN_H
static size_t course_touch(volatile unsigned char *memory, size_t page_bytes,
                           size_t written, size_t limit) {
    while (written < limit) {
        memory[written * page_bytes] = 7;
        ++written;
    }
    return written;
}
#endif
