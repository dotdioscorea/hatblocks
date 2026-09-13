# Hatblocks

Edit C as Scratch-style blocks, inside VS Code.

C, C++, and Python are first-class. The parser, the block IR, and the editor are separate so more languages can plug in without rewriting the stage.

Not affiliated with Scratch or the Scratch Foundation.

## What you get

- **Blocks mode** — a toggle for every open `.c` / `.h` file. The file *is* the editor, not a markdown-style preview beside it.
- **Parts in the sidebar** — the Hatblocks activity-bar view is the palette. The file stays in the editor group.
- **Green flag Run** — the editor Run button is a flag. It compiles with `clang` or `gcc` and runs in a terminal.
- **The palette is the language** — Preproc, Functions, Control, Operators, Variables, Arrays, Pointers, I/O. Labels are C (`#include`, `int main`, `==`, `malloc`), not Scratch Motion/Sound. C++ and Scratch-the-language are next.

## Use it

```bash
npm install
npm test
npm run compile
```

Then **Run → Start Debugging**. In the Extension Development Host:

1. Click the Hatblocks icon in the activity bar.
2. Turn **Blocks** on (or Command Palette → **Hatblocks: Toggle Blocks Mode**, `⌘⌥H` / `Ctrl+Alt+H`).
3. Open `examples/fizzbuzz.c`.
4. Click the green flag to run.

Status bar: `Hatblocks: Text` / `Hatblocks: Blocks`.

## How it is put together

```
C file  →  tree-sitter  →  IR  →  Scratch-looking stage
                ↑                    ↓
                └──  emit C  ←  snaps / parts ─┘
```

1. Implement `LanguageAdapter` in `src/languages/<id>/` (`parse` + `emit`).
2. Lower the AST to `src/ir/types.ts`.
3. Register it in `src/languages/registry.ts`.
4. Add opcodes in `src/library/catalog.ts` if you need new parts.

## Contributing

Open source (MIT). **PRs into `main`.** CI runs `npm test` and `npm run compile` on every pull request.

Publishing to the VS Code Marketplace is the plan; the source stays public.

## License

MIT. Scratch is a trademark of the Scratch Foundation. Hatblocks is a fan project, not an official Scratch product.
