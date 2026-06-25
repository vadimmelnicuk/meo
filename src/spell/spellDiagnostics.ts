import * as vscode from 'vscode';
import {
  getDefaultSettings,
  mergeSettings,
  searchForConfig,
  spellCheckDocument,
  type CSpellUserSettings,
  type ValidationIssue
} from 'cspell-lib';

export const MEO_SPELL_DIAGNOSTIC_SOURCE = 'MEO Spell';

const maxSpellCheckTextLength = 1_000_000;

export function shouldRunMeoSpellCheck(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file') {
    return false;
  }
  if (document.getText().length > maxSpellCheckTextLength) {
    return false;
  }

  const meoEnabled = vscode.workspace
    .getConfiguration('markdownEditorOptimized', document.uri)
    .get<boolean>('spellCheck.enabled', true);
  if (!meoEnabled) {
    return false;
  }

  return vscode.workspace.getConfiguration('cSpell', document.uri).get<boolean>('enabled', true);
}

export function hasExternalSpellDiagnostics(document: vscode.TextDocument): boolean {
  return vscode.languages.getDiagnostics(document.uri).some((diagnostic) => {
    if (diagnostic.source === MEO_SPELL_DIAGNOSTIC_SOURCE) {
      return false;
    }
    const source = `${diagnostic.source ?? ''}`.toLowerCase();
    return source.includes('spell') || source.includes('cspell');
  });
}

export async function collectMeoSpellDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
  if (!shouldRunMeoSpellCheck(document) || hasExternalSpellDiagnostics(document)) {
    return [];
  }

  const text = document.getText().replace(/\r\n?/g, '\n');
  const settings = await resolveCSpellSettings(document);
  const result = await spellCheckDocument(
    {
      uri: document.uri.toString(),
      text,
      languageId: document.languageId || 'markdown'
    },
    { generateSuggestions: false },
    settings
  );

  if (!result.checked) {
    return [];
  }

  return result.issues.map((issue) => createDiagnostic(document, issue));
}

async function resolveCSpellSettings(document: vscode.TextDocument): Promise<CSpellUserSettings> {
  const localConfig = await searchForConfig(document.uri.fsPath);
  if (!localConfig) {
    return getDefaultSettings();
  }
  return mergeSettings(getDefaultSettings(), localConfig);
}

function createDiagnostic(document: vscode.TextDocument, issue: ValidationIssue): vscode.Diagnostic {
  const offset = Number.isFinite(issue.offset) ? Math.max(0, Math.floor(issue.offset)) : 0;
  const length = Number.isFinite(issue.length) ? Math.max(1, Math.floor(issue.length ?? 1)) : 1;
  const start = document.positionAt(mapNormalizedOffsetToDocumentOffset(document.getText(), offset));
  const end = document.positionAt(mapNormalizedOffsetToDocumentOffset(document.getText(), offset + length));
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(start, end),
    issue.message || `Unknown word: ${issue.text}`,
    vscode.DiagnosticSeverity.Information
  );
  diagnostic.source = MEO_SPELL_DIAGNOSTIC_SOURCE;
  diagnostic.code = issue.text;
  return diagnostic;
}

function mapNormalizedOffsetToDocumentOffset(documentText: string, normalizedOffset: number): number {
  const target = Number.isFinite(normalizedOffset) ? Math.max(0, normalizedOffset) : documentText.length;
  if (target === 0) {
    return 0;
  }

  let normalizedIndex = 0;
  let documentIndex = 0;

  while (documentIndex < documentText.length && normalizedIndex < target) {
    if (documentText.charCodeAt(documentIndex) === 13) {
      if (documentText.charCodeAt(documentIndex + 1) === 10) {
        documentIndex += 2;
      } else {
        documentIndex += 1;
      }
      normalizedIndex += 1;
      continue;
    }

    documentIndex += 1;
    normalizedIndex += 1;
  }

  return documentIndex;
}

