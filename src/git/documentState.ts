import { createHash } from 'node:crypto';
import { getGitBaselineMetadataForFile, hydrateGitBaselineText } from './baseline';
import type { GitBaselinePayload } from './types';

type ResolveBaselineOptions = {
  includeText?: boolean;
  force?: boolean;
};

export function hashGitBaselinePayload(payload: GitBaselinePayload): string {
  const hash = createHash('sha1');
  hash.update(JSON.stringify({
    available: payload.available,
    repoRoot: payload.repoRoot ?? null,
    headOid: payload.headOid ?? null,
    tracked: payload.tracked,
    gitPath: payload.gitPath ?? null,
    reason: payload.reason ?? null,
    maxBytesExceeded: Boolean(payload.maxBytesExceeded)
  }));
  hash.update('\n');
  hash.update(payload.baseText ?? '');
  return hash.digest('hex');
}

function canHydrateBaselineText(payload: GitBaselinePayload | null): payload is GitBaselinePayload {
  if (!payload) {
    return false;
  }
  return payload.available === true && typeof payload.repoRoot === 'string' && typeof payload.gitPath === 'string';
}

function baselineDoesNotNeedTextLookup(payload: GitBaselinePayload): boolean {
  return !payload.available || !payload.tracked || !payload.headOid || !payload.repoRoot || !payload.gitPath;
}

export class GitDocumentState {
  private metadataCache: GitBaselinePayload | null = null;
  private withTextCache: GitBaselinePayload | null = null;
  private metadataPromise: Promise<GitBaselinePayload> | null = null;
  private withTextPromise: Promise<GitBaselinePayload> | null = null;
  private lastSentBaselineHash = '';

  constructor(private readonly filePath: string) {}

  getRepoRoot(): string | null {
    return this.withTextCache?.repoRoot ?? this.metadataCache?.repoRoot ?? null;
  }

  getLastSentBaselineHash(): string {
    return this.lastSentBaselineHash;
  }

  setLastSentBaselineHash(hash: string): void {
    this.lastSentBaselineHash = hash;
  }

  async resolveBaseline(options: ResolveBaselineOptions = {}): Promise<GitBaselinePayload> {
    const includeText = options.includeText === true;
    const force = options.force === true;
    if (includeText) {
      return this.resolveBaselineWithText(force);
    }
    return this.resolveBaselineMetadata(force);
  }

  noteBaselinePayload(payload: GitBaselinePayload): void {
    this.metadataCache = payload;
    this.withTextCache = payload;
  }

  invalidate(): void {
    this.metadataCache = null;
    this.withTextCache = null;
  }

  private async resolveBaselineMetadata(force: boolean): Promise<GitBaselinePayload> {
    if (!force) {
      if (this.metadataCache) {
        return this.metadataCache;
      }
      if (this.withTextCache) {
        return this.withTextCache;
      }
      if (this.metadataPromise) {
        return this.metadataPromise;
      }
    }

    const promise = getGitBaselineMetadataForFile(this.filePath)
      .then((payload) => {
        this.metadataCache = payload;
        if (baselineDoesNotNeedTextLookup(payload)) {
          this.withTextCache = payload;
        }
        return payload;
      })
      .finally(() => {
        if (this.metadataPromise === promise) {
          this.metadataPromise = null;
        }
      });

    this.metadataPromise = promise;
    if (force) {
      this.withTextCache = null;
      this.withTextPromise = null;
    }
    return promise;
  }

  private async resolveBaselineWithText(force: boolean): Promise<GitBaselinePayload> {
    if (!force) {
      if (this.withTextCache) {
        return this.withTextCache;
      }
      if (this.withTextPromise) {
        return this.withTextPromise;
      }
    }

    const promise = (async () => {
      const metadata = await this.resolveBaselineMetadata(force);
      if (!canHydrateBaselineText(metadata) || baselineDoesNotNeedTextLookup(metadata)) {
        this.withTextCache = metadata;
        return metadata;
      }
      const payload = await hydrateGitBaselineText(metadata);
      this.metadataCache = payload;
      this.withTextCache = payload;
      return payload;
    })().finally(() => {
      if (this.withTextPromise === promise) {
        this.withTextPromise = null;
      }
    });

    this.withTextPromise = promise;
    return promise;
  }
}
