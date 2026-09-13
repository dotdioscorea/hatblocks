#include <stdio.h>

void greet(const char *name) {
    printf("Hello, %s!\n", name);
}

int add(int a, int b) {
    return a + b;
}

int main(void) {
    greet("Hatblocks");
    if (add(2, 3) == 5) {
        printf("math still works\n");
    }
    return 0;
}
