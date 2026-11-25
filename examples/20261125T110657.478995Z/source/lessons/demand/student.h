/* Student task. This intentionally unfinished starter should FAIL the checks.
 * Fill in only the access loop. Do not change the probe or expected results.
 * memory points to the allocated block; page_bytes is the base page size.
 * written is the previous count; limit is the cumulative target for this stage.
 * Write value 7 at each NEW page-sized position, then return the new count.
 * The caller guarantees 0 <= written <= limit <= ceil(bytes / page_bytes).
 * See WORKSHEET.md. The reference answer is in proj5-course/access_pattern.h.
 */
static size_t course_touch(volatile unsigned char *memory, size_t page_bytes,
                           size_t written, size_t limit) {
    (void)memory;
    (void)page_bytes;
    (void)limit;
    /* TODO: implement the incremental write loop. */
    return written;
}
