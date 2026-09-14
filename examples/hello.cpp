#include <iostream>
#include <vector>

int main() {
    std::vector<int> xs;
    xs.push_back(1);
    xs.push_back(2);
    for (int x : xs) {
        std::cout << x << std::endl;
    }
    return 0;
}
