/* The buffers are for checking the access contract, outside measured probes. */
#include <stdio.h>
#include <string.h>
#include "student.h"

enum { MAX_BYTES = 5 * 65536 + 2 };
static unsigned char buffer[MAX_BYTES];

static void check(const char *name, size_t stride, size_t previous, size_t limit) {
    size_t length = 5 * stride + 2;
    unsigned char *memory = buffer + 1;
    memset(buffer, 0xA5, length);
    /* A different marker makes rewriting a prefix page observable. */
    for (size_t i = 0; i < previous; i++) memory[i * stride] = 0x36;
    size_t returned = course_touch(memory, stride, previous, limit);
    long wrong = -1;
    unsigned int expected = 0, actual = 0;
    for (size_t i = 0; i < length; i++) {
        unsigned int want = 0xA5;
        if (i > 0 && (i - 1) % stride == 0) {
            size_t position = (i - 1) / stride;
            if (position < previous) want = 0x36;
            else if (position < limit) want = 7;
        }
        if (buffer[i] != want) {
            wrong = (long)i - 1;
            expected = want;
            actual = buffer[i];
            break;
        }
    }
    printf("{\"check\":\"%s\",\"stride\":%zu,\"previous\":%zu,\"limit\":%zu,"
           "\"returned\":%zu,\"memory_ok\":%s,\"offset\":%ld,\"expected_byte\":%u,\"actual_byte\":%u}\n",
           name, stride, previous, limit, returned, expected == actual ? "true" : "false", wrong, expected, actual);
}

int main(void) {
    check("empty_stage", 4096, 1, 1);
    check("first_position", 4096, 0, 1);
    check("extend_prefix", 4096, 1, 3);
    check("different_stride", 65536, 2, 5);
    return 0;
}
