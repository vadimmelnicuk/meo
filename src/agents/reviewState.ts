import * as vscode from 'vscode';

export const AGENT_REVIEW_MODEL_SCHEMES = ['chat-editing-text-model'] as const;
const agentReviewModelSchemeSet = new Set<string>(AGENT_REVIEW_MODEL_SCHEMES);

export type LikelyAgentReviewState = {
  source: 'textDocument' | 'tab';
  uri: vscode.Uri;
};

type ComparableKeyResolver = (uri: vscode.Uri) => string | undefined;
type OpenTextDocumentResolver = (uri: vscode.Uri) => vscode.TextDocument | undefined;

export function normalizeReviewComparisonText(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function areAgentReviewTextsEquivalent(left?: string, right?: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  return normalizeReviewComparisonText(left) === normalizeReviewComparisonText(right);
}

export function isLikelyAgentReviewUri(uri: vscode.Uri): boolean {
  return agentReviewModelSchemeSet.has(uri.scheme);
}

export function getComparableFileUri(
  targetUri: vscode.Uri,
  getComparableResourceKey: ComparableKeyResolver
): vscode.Uri | undefined {
  const comparableKey = getComparableResourceKey(targetUri);
  if (!comparableKey) {
    return undefined;
  }

  return vscode.Uri.file(comparableKey);
}

export function resolveAgentReviewRedirectState(
  triggerUri: vscode.Uri,
  getComparableResourceKey: ComparableKeyResolver,
  getOpenTextDocumentForUri: OpenTextDocumentResolver
): { uri: vscode.Uri; text: string } | undefined {
  if (isLikelyAgentReviewUri(triggerUri)) {
    return getSpecificAgentReviewState(triggerUri, getOpenTextDocumentForUri);
  }

  const targetDocument = getOpenTextDocumentForUri(triggerUri);
  const reviewState = findLikelyAgentReviewState(
    triggerUri,
    getComparableResourceKey,
    getOpenTextDocumentForUri,
    targetDocument?.getText()
  );
  if (!reviewState) {
    return undefined;
  }

  return getSpecificAgentReviewState(reviewState.uri, getOpenTextDocumentForUri);
}

export function findLikelyAgentReviewState(
  targetUri: vscode.Uri,
  getComparableResourceKey: ComparableKeyResolver,
  getOpenTextDocumentForUri: OpenTextDocumentResolver,
  targetText?: string
): LikelyAgentReviewState | undefined {
  for (const relatedDocument of findRelatedAgentReviewDocuments(targetUri, getComparableResourceKey)) {
    if (areAgentReviewTextsEquivalent(targetText, relatedDocument.getText())) {
      continue;
    }

    return {
      source: 'textDocument',
      uri: relatedDocument.uri
    };
  }

  for (const relatedTab of findRelatedAgentReviewTabs(targetUri, getComparableResourceKey)) {
    const relatedText = getOpenTextDocumentForUri(relatedTab.uri)?.getText();
    if (areAgentReviewTextsEquivalent(targetText, relatedText)) {
      continue;
    }

    return {
      source: 'tab',
      uri: relatedTab.uri
    };
  }

  return undefined;
}

export function findRelatedAgentReviewDocuments(
  targetUri: vscode.Uri,
  getComparableResourceKey: ComparableKeyResolver
): vscode.TextDocument[] {
  const targetKey = getComparableResourceKey(targetUri);
  if (!targetKey) {
    return [];
  }

  return vscode.workspace.textDocuments.filter((document) => {
    const uri = document.uri;
    if (uri.toString() === targetUri.toString()) {
      return false;
    }
    if (!isLikelyAgentReviewUri(uri)) {
      return false;
    }
    return getComparableResourceKey(uri) === targetKey;
  });
}

export function findRelatedAgentReviewTabs(
  targetUri: vscode.Uri,
  getComparableResourceKey: ComparableKeyResolver
): Array<{ uri: vscode.Uri; input: vscode.Tab['input'] }> {
  const targetKey = getComparableResourceKey(targetUri);
  if (!targetKey) {
    return [];
  }

  const results: Array<{ uri: vscode.Uri; input: vscode.Tab['input'] }> = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      for (const uri of getTabInputUris(tab.input)) {
        if (uri.toString() === targetUri.toString()) {
          continue;
        }
        if (!isLikelyAgentReviewUri(uri)) {
          continue;
        }
        if (getComparableResourceKey(uri) !== targetKey) {
          continue;
        }
        results.push({ uri, input: tab.input });
      }
    }
  }

  return results;
}

function getSpecificAgentReviewState(
  reviewUri: vscode.Uri,
  getOpenTextDocumentForUri: OpenTextDocumentResolver
): { uri: vscode.Uri; text: string } | undefined {
  if (!isLikelyAgentReviewUri(reviewUri)) {
    return undefined;
  }

  const reviewDocument = getOpenTextDocumentForUri(reviewUri);
  if (!reviewDocument) {
    return undefined;
  }

  return {
    uri: reviewDocument.uri,
    text: reviewDocument.getText()
  };
}

function getTabInputUris(input: vscode.Tab['input']): vscode.Uri[] {
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return [input.uri];
  }

  if (input instanceof vscode.TabInputTextDiff) {
    return [input.original, input.modified];
  }

  if (input instanceof vscode.TabInputNotebook) {
    return [input.uri];
  }

  if (input instanceof vscode.TabInputNotebookDiff) {
    return [input.original, input.modified];
  }

  return [];
}
