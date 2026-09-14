import * as vscode from "vscode";

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, scriptFile: string): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", scriptFile));
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
