#include <stddef.h>
int main(void) {
    volatile int *invalid = NULL;
    *invalid = 1; /* Intentional invalid access for the exception experiment. */
    return 0;
}
