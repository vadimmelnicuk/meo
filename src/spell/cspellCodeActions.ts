import type * as vscode from 'vscode';

type Position = { line: number; character: number };
type ReplacementEdit = { range: { start: Position; end: Position }; newText: string };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

function isPosition(value: unknown): value is Position {
  return isRecord(value) &&
    Number.isInteger(value.line) && Number(value.line) >= 0 &&
    Number.isInteger(value.character) && Number(value.character) >= 0;
}

export function cspellReplacementEdit(
  action: vscode.Command | vscode.CodeAction,
  documentUri: string,
  documentVersion: number
): ReplacementEdit | null {
  const command = typeof action.command === 'string' ? action : action.command;
  if (!command || command.command !== 'cSpell.editText') {
    return null;
  }

  // Read CSpell's replacement without executing its command or moving editor focus.
  const args: unknown = 'arguments' in command ? command.arguments : undefined;
  if (!Array.isArray(args) || args.length !== 3) {
    return null;
  }
  const [uri, version, edits] = args;
  if (uri !== documentUri || version !== documentVersion || !Array.isArray(edits) || edits.length !== 1) {
    return null;
  }

  const edit: unknown = edits[0];
  if (!isRecord(edit) || typeof edit.newText !== 'string' || !isRecord(edit.range)) {
    return null;
  }
  const { start, end } = edit.range;
  if (!isPosition(start) || !isPosition(end)) {
    return null;
  }
  if (end.line < start.line || (end.line === start.line && end.character <= start.character)) {
    return null;
  }
  return { range: { start, end }, newText: edit.newText };
}
