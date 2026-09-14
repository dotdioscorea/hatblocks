#include <stdio.h>

int main(void) {
    double x = 3.9;
    int n = (int)x;
    char *p = (char *)&n;
    printf("%d %p\n", n, (void *)p);
    return 0;
}
