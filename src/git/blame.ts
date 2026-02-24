import { runGit, isGitMissingError, stderrText } from './cli';
import type { GitBlameLineResult } from './types';
import { GitCliFailure } from './types';

type GetGitBlameForLineOptions = {
  repoRoot: string;
  gitPath: string;
  lineNumber: number;
  contentsText?: string;
  revision?: string;
};

const zeroShaRe = /^0{40}$/;

function parsePorcelain(stdout: string): GitBlameLineResult {
  const lines = stdout.split(/\r?\n/);
  const header = lines[0]?.trim() ?? '';
  if (!header) {
    return { kind: 'unavailable', reason: 'error' };
  }

  const headerParts = header.split(/\s+/);
  const commit = headerParts[0];
  if (!commit) {
    return { kind: 'unavailable', reason: 'error' };
  }

  const parsedOriginalLineNumber = Number.parseInt(headerParts[1] ?? '', 10);
  const originalLineNumber = Number.isFinite(parsedOriginalLineNumber) && parsedOriginalLineNumber > 0
    ? parsedOriginalLineNumber
    : undefined;

  if (zeroShaRe.test(commit)) {
    return { kind: 'uncommitted' };
  }

  let author = '';
  let authorMail = '';
  let authorTimeUnix = 0;
  let summary = '';
  let gitPathAtCommit = '';

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    if (line[0] === '\t') {
      break;
    }
    if (line.startsWith('author ')) {
      author = line.slice('author '.length).trim();
      continue;
    }
    if (line.startsWith('author-mail ')) {
      authorMail = line.slice('author-mail '.length).trim().replace(/^<|>$/g, '');
      continue;
    }
    if (line.startsWith('author-time ')) {
      const parsed = Number.parseInt(line.slice('author-time '.length).trim(), 10);
      authorTimeUnix = Number.isFinite(parsed) ? parsed : 0;
      continue;
    }
    if (line.startsWith('summary ')) {
      summary = line.slice('summary '.length).trim();
      continue;
    }
    if (line.startsWith('filename ')) {
      gitPathAtCommit = line.slice('filename '.length);
      continue;
    }
  }

  return {
    kind: 'commit',
    commit,
    shortCommit: commit.slice(0, 8),
    originalLineNumber,
    gitPathAtCommit: gitPathAtCommit || undefined,
    author: author || 'Unknown',
    authorMail: authorMail || undefined,
    authorTimeUnix,
    summary: summary || '(no commit message)'
  };
}

function mapBlameFailure(error: unknown): GitBlameLineResult {
  if (isGitMissingError(error)) {
    return { kind: 'unavailable', reason: 'git-unavailable' };
  }

  if (!(error instanceof GitCliFailure)) {
    return { kind: 'unavailable', reason: 'error' };
  }

  const stderr = stderrText(error).toLowerCase();
  if (
    stderr.includes('no such path') ||
    stderr.includes('no such ref') ||
    stderr.includes('cannot stat path') ||
    stderr.includes('fatal: no such path')
  ) {
    return { kind: 'unavailable', reason: 'untracked' };
  }

  return { kind: 'unavailable', reason: 'error' };
}

export async function getGitBlameForLine(options: GetGitBlameForLineOptions): Promise<GitBlameLineResult> {
  const lineNumber = Math.max(1, Math.floor(options.lineNumber));
  const args = [
    'blame',
    '--line-porcelain',
    '-L',
    `${lineNumber},${lineNumber}`
  ];

  if (typeof options.contentsText === 'string') {
    args.push('--contents', '-');
  }

  if (typeof options.revision === 'string' && options.revision.trim()) {
    args.push(options.revision.trim());
  }

  args.push('--', options.gitPath);

  try {
    const result = await runGit(args, {
      cwd: options.repoRoot,
      stdin: options.contentsText,
      maxBytes: 256 * 1024
    });
    return parsePorcelain(result.stdout.toString('utf8'));
  } catch (error) {
    return mapBlameFailure(error);
  }
}
