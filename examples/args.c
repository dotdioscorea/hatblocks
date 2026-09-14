#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int main(int argc, char **argv) {
    if (argc > 1) {
        printf("%s\n", argv[1]);
    }
    return add(2, 40);
}
