export type GitBaselinePayload = {
  available: boolean;
  repoRoot?: string;
  headOid?: string | null;
  tracked: boolean;
  gitPath?: string;
  baseText?: string | null;
  reason?: 'not-file' | 'git-unavailable' | 'not-repo' | 'too-large' | 'binary' | 'error';
  maxBytesExceeded?: boolean;
};

export type GitBaselineSnapshot = {
  payload: GitBaselinePayload;
};

export type GitBlameLineResult =
  | {
      kind: 'commit';
      commit: string;
      shortCommit: string;
      originalLineNumber?: number;
      gitPathAtCommit?: string;
      author: string;
      authorMail?: string;
      authorTimeUnix: number;
      summary: string;
    }
  | {
      kind: 'uncommitted';
    }
  | {
      kind: 'unavailable';
      reason: 'not-repo' | 'untracked' | 'git-unavailable' | 'error';
    };

export class GitCliFailure extends Error {
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly spawnErrorCode?: string;

  constructor(message: string, options: {
    code?: number | null;
    stdout?: Buffer;
    stderr?: Buffer;
    spawnErrorCode?: string;
  } = {}) {
    super(message);
    this.name = 'GitCliFailure';
    this.code = options.code ?? null;
    this.stdout = options.stdout ?? Buffer.alloc(0);
    this.stderr = options.stderr ?? Buffer.alloc(0);
    this.spawnErrorCode = options.spawnErrorCode;
  }
}
