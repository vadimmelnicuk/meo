import { spawn } from 'node:child_process';
import { GitCliFailure } from './types';

type RunGitOptions = {
  cwd: string;
  stdin?: string;
  maxBytes?: number;
};

type RunGitResult = {
  stdout: Buffer;
  stderr: Buffer;
};

const defaultMaxBytes = 2 * 1024 * 1024;

export async function runGit(args: string[], options: RunGitOptions): Promise<RunGitResult> {
  const maxBytes = options.maxBytes ?? defaultMaxBytes;

  return new Promise<RunGitResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let killedForLimit = false;
    let settled = false;

    const fail = (error: GitCliFailure) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const succeed = (result: RunGitResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.on('error', (error) => {
      fail(new GitCliFailure(`Failed to spawn git: ${error.message}`, {
        spawnErrorCode: (error as NodeJS.ErrnoException).code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks)
      }));
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stdoutSize += buffer.length;
      if (stdoutSize > maxBytes) {
        killedForLimit = true;
        child.kill();
        return;
      }
      stdoutChunks.push(buffer);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stderrSize += buffer.length;
      if (stderrSize <= maxBytes) {
        stderrChunks.push(buffer);
      }
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      if (killedForLimit) {
        fail(new GitCliFailure('Git output exceeded byte limit', {
          code,
          stdout,
          stderr
        }));
        return;
      }
      if (code !== 0) {
        fail(new GitCliFailure(`git ${args.join(' ')} failed`, {
          code,
          stdout,
          stderr
        }));
        return;
      }
      succeed({ stdout, stderr });
    });

    if (typeof options.stdin === 'string') {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export function isGitMissingError(error: unknown): boolean {
  if (!(error instanceof GitCliFailure)) {
    return false;
  }
  return error.spawnErrorCode === 'ENOENT';
}

export function stderrText(error: unknown): string {
  if (!(error instanceof GitCliFailure)) {
    return '';
  }
  return error.stderr.toString('utf8').trim();
}

