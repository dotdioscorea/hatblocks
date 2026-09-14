import * as esbuild from "esbuild";
import { rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  minify: false,
};

const nodeBuild = {
  ...common,
  entryPoints: {
    extension: "src/extension.ts",
    cli: "src/cli.ts",
  },
  outdir: "dist",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode", "web-tree-sitter"],
};

const webviewBuild = {
  ...common,
  entryPoints: {
    editor: "src/webview/editor.ts",
    toolbox: "src/webview/toolbox.ts",
    inspector: "src/webview/inspector.ts",
  },
  outdir: "dist",
  platform: "browser",
  format: "iife",
  target: "es2022",
  loader: { ".css": "text" },
};

async function run() {
  if (!watch) {
    try {
      rmSync("dist", { recursive: true, force: true });
    } catch {
      // first build
    }
  }

  if (watch) {
    const nodeCtx = await esbuild.context(nodeBuild);
    const webCtx = await esbuild.context(webviewBuild);
    await Promise.all([nodeCtx.watch(), webCtx.watch()]);
    console.log("watching…");
    return;
  }

  await Promise.all([esbuild.build(nodeBuild), esbuild.build(webviewBuild)]);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
