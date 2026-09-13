#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *p = malloc(sizeof(int) * 4);
    if (p == NULL) {
        printf("out of memory\n");
        return 1;
    }
    p[0] = 42;
    printf("%d\n", p[0]);
    free(p);
    return 0;
}
