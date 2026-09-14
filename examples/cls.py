class Counter:
    def __init__(self, start: int) -> None:
        self.n = start

    def bump(self) -> int:
        self.n = self.n + 1
        return self.n


try:
    c = Counter(0)
    print(c.bump())
except Exception:
    print("failed")
