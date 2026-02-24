import * as path from 'node:path';
import { runGit, isGitMissingError } from './cli';
import type { GitBaselinePayload } from './types';
import { GitCliFailure } from './types';

export const gitBaselineMaxBytes = 1024 * 1024;

function toRepoRelativeGitPath(filePath: string, repoRoot: string): string | null {
  const relativeFs = path.relative(repoRoot, filePath);
  if (!relativeFs || relativeFs.startsWith('..') || path.isAbsolute(relativeFs)) {
    return null;
  }
  return relativeFs.split(path.sep).join('/');
}

async function resolveRepoRoot(filePath: string): Promise<string | null> {
  const cwd = path.dirname(filePath);
  const result = await runGit(['rev-parse', '--show-toplevel'], { cwd });
  const repoRoot = result.stdout.toString('utf8').trim();
  return repoRoot || null;
}

async function resolveHeadOid(repoRoot: string): Promise<string | null> {
  try {
    const result = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot });
    const oid = result.stdout.toString('utf8').trim();
    return oid || null;
  } catch (error) {
    if (error instanceof GitCliFailure) {
      return null;
    }
    throw error;
  }
}

async function isTracked(repoRoot: string, gitPath: string): Promise<boolean> {
  try {
    await runGit(['ls-files', '--error-unmatch', '--', gitPath], { cwd: repoRoot, maxBytes: 64 * 1024 });
    return true;
  } catch (error) {
    if (error instanceof GitCliFailure) {
      return false;
    }
    throw error;
  }
}

function hasNulByte(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function mapBaselineOuterError(error: unknown): GitBaselinePayload {
  if (isGitMissingError(error)) {
    return {
      available: false,
      tracked: false,
      reason: 'git-unavailable'
    };
  }
  if (error instanceof GitCliFailure) {
    return {
      available: false,
      tracked: false,
      reason: 'not-repo'
    };
  }
  return {
    available: false,
    tracked: false,
    reason: 'error'
  };
}

export async function getGitBaselineMetadataForFile(filePath: string): Promise<GitBaselinePayload> {
  if (!path.isAbsolute(filePath)) {
    return {
      available: false,
      tracked: false,
      reason: 'not-file'
    };
  }

  try {
    const repoRoot = await resolveRepoRoot(filePath);
    if (!repoRoot) {
      return {
        available: false,
        tracked: false,
        reason: 'not-repo'
      };
    }

    const gitPath = toRepoRelativeGitPath(filePath, repoRoot);
    if (!gitPath) {
      return {
        available: false,
        tracked: false,
        reason: 'not-repo'
      };
    }

    const [tracked, headOid] = await Promise.all([
      isTracked(repoRoot, gitPath),
      resolveHeadOid(repoRoot)
    ]);

    return {
      available: true,
      repoRoot,
      headOid,
      tracked,
      gitPath,
      baseText: null
    };
  } catch (error) {
    return mapBaselineOuterError(error);
  }
}

export async function hydrateGitBaselineText(payload: GitBaselinePayload): Promise<GitBaselinePayload> {
  if (!payload.available || !payload.repoRoot || !payload.gitPath) {
    return payload;
  }

  if (!payload.tracked || !payload.headOid) {
    return {
      ...payload,
      baseText: null
    };
  }

  if (typeof payload.baseText === 'string') {
    return payload;
  }

  let baselineResult;
  try {
    baselineResult = await runGit(['cat-file', '-p', `HEAD:${payload.gitPath}`], {
      cwd: payload.repoRoot,
      maxBytes: gitBaselineMaxBytes + 1
    });
  } catch (error) {
    if (error instanceof GitCliFailure) {
      if (error.message.includes('byte limit')) {
        return {
          ...payload,
          baseText: null,
          reason: 'too-large',
          maxBytesExceeded: true
        };
      }
      return {
        ...payload,
        baseText: null,
        reason: 'error'
      };
    }
    throw error;
  }

  const baselineBytes = baselineResult.stdout;
  if (baselineBytes.length > gitBaselineMaxBytes) {
    return {
      ...payload,
      baseText: null,
      reason: 'too-large',
      maxBytesExceeded: true
    };
  }

  if (hasNulByte(baselineBytes)) {
    return {
      ...payload,
      baseText: null,
      reason: 'binary'
    };
  }

  return {
    ...payload,
    baseText: baselineBytes.toString('utf8')
  };
}

export async function getGitBaselinePayloadForFile(filePath: string): Promise<GitBaselinePayload> {
  const metadata = await getGitBaselineMetadataForFile(filePath);
  try {
    return await hydrateGitBaselineText(metadata);
  } catch (error) {
    if (isGitMissingError(error)) {
      return {
        available: false,
        tracked: false,
        reason: 'git-unavailable'
      };
    }
    if (error instanceof GitCliFailure) {
      return {
        ...metadata,
        baseText: null,
        reason: metadata.available ? 'error' : 'not-repo'
      };
    }
    return {
      ...metadata,
      baseText: null,
      reason: metadata.available ? 'error' : (metadata.reason ?? 'error')
    };
  }
}
