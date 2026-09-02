import * as vscode from "vscode";

export async function collectEditorContext(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";

  const selection = editor.document.getText(editor.selection);
  if (selection.trim().length > 0) return selection;

  // Collect ±400 lines around cursor to cover large functions
  const line = editor.selection.active.line;
  const start = Math.max(0, line - 400);
  const end = Math.min(editor.document.lineCount - 1, line + 400);
  const range = new vscode.Range(
    start, 0,
    end, editor.document.lineAt(end).text.length
  );

  return editor.document.getText(range);
}

export async function collectSelectionContext(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  return editor.document.getText(editor.selection);
}
