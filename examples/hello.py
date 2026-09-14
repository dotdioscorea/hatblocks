from typing import List


def greet(name: str) -> None:
    print(f"hello {name}")


def add(a: int, b: int) -> int:
    return a + b


if __name__ == "__main__":
    greet("hatblocks")
    xs: List[int] = [1, 2, 3]
    total = 0
    for n in xs:
        total = total + n
    print(add(total, 0))
