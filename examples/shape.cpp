#include <iostream>

class Point {
public:
    int x;
    int y;
};

int main() {
    Point p;
    p.x = 3;
    p.y = 4;
    std::cout << p.x << std::endl;
    return 0;
}
