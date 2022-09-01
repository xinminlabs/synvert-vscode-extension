import { join } from "path";
import { machineIdSync } from 'node-machine-id';
import * as vscode from "vscode";
import * as Synvert from "synvert-core";
import { getLastSnippetGroupAndName } from "./utils";
import fs from "fs";
import path from "path";
import type { TestResultExtExt } from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;

  constructor(private readonly _extensionUri: vscode.Uri) { }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for messages from the Sidebar component and execute action
    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case "onSearch": {
          if (!data.snippet) {
            return;
          }
          const results = testSnippet(data.snippet, data.onlyPaths, data.skipPaths);
          webviewView.webview.postMessage({ type: 'doneSearch', results });
          break;
        }
        case "onInfo": {
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        }
        case "onError": {
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        }
      }
    });

  }

  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.file(join(this._extensionUri.path, "media", "reset.css"))
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.file(join(this._extensionUri.path, "media", "vscode.css"))
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(join(this._extensionUri.path, "out", "compiled/sidebar.js"))
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.file(join(this._extensionUri.path, "out", "compiled/sidebar.css"))
    );

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();
    const token = machineIdSync(true);

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <!--
            Use a content security policy to only allow loading images from https or from our extension directory,
            and only allow scripts that have a specific nonce.
          -->
          <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="${styleResetUri}" rel="stylesheet">
          <link href="${styleVSCodeUri}" rel="stylesheet">
          <link href="${styleMainUri}" rel="stylesheet">
          <script nonce="${nonce}">
              const tsvscode = acquireVsCodeApi();
              const token = "${token}";
          </script>

        </head>
        <body>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function testSnippet(snippet: string, onlyPaths: string, skipPaths: string): object[] {
  let results: TestResultExtExt[] = [];
  try {
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      Synvert.Configuration.rootPath = folder.uri.path;
      Synvert.Configuration.onlyPaths = onlyPaths.split(",").map((onlyFile) => onlyFile.trim());
      Synvert.Configuration.skipPaths = skipPaths.split(",").map((skipFile) => skipFile.trim());
      eval(snippet);
      const [group, name] = getLastSnippetGroupAndName();
      const rewriter = Synvert.Rewriter.fetch(group, name);
      const testResults: TestResultExtExt[] = rewriter.test();
      testResults.forEach((result) => {
        const fileSource = fs.readFileSync(path.join(folder.uri.path, result.filePath), "utf-8");
        result.fileSource = fileSource;
      });

      results = [...results, ...testResults];
    }
  }
  } catch (e) {
    // @ts-ignore
    vscode.window.showErrorMessage(`Failed to run synvert: ${e.message}`);
  }
  return results;
}