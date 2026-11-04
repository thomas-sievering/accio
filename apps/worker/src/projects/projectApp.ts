import type { CommitView } from '@accio/protocol';

/** GLOSSARY: Project app. What this machine remembers about one project's app between restarts. */
export type AppRecord = {
  /** Start was pressed and Stop was not: a restarted worker starts it again. */
  wanted: boolean;
  autoUpdate: boolean;
  /** The commit the app's checkout runs; the one restored when an update fails. */
  commit?: CommitView;
  /** Commit and setup command that last set up successfully; a restart of the same commit skips setup. */
  setupKey?: string;
  port?: number;
  failedUpdate?: { commit: CommitView; message: string; at: string };
};

export const newRecord = (): AppRecord => ({ wanted: false, autoUpdate: true });

/** git log format for parseCommits: one commit per line, fields split by unit separators. */
export const COMMIT_FORMAT = '%H%x1f%s%x1f%an%x1f%aI';

export function parseCommits(output: string): CommitView[] {
  return output.split('\n').filter(Boolean).map((line) => {
    const [sha = '', subject = '', author = '', at = ''] = line.split('\x1f');
    return { sha, subject, author, at };
  });
}

/**
 * Which commit Start runs. Following the branch means its tip, unless that tip is the
 * update that just failed; otherwise the app keeps the commit it last ran.
 */
export function startTarget(record: AppRecord, tip: string | null): string | null {
  const sha = record.commit?.sha;
  if (!sha) return tip;
  if (!record.autoUpdate || !tip || tip === record.failedUpdate?.commit.sha) return sha;
  return tip;
}

/** Whether a fetched tip should update the running app by itself. */
export function shouldAutoUpdate(record: AppRecord, tip: string | null): boolean {
  const sha = record.commit?.sha;
  return record.wanted && record.autoUpdate && !!tip && !!sha && tip !== sha && tip !== record.failedUpdate?.commit.sha;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
/** Log text as the dashboard shows it: terminal colours removed, carriage-return progress collapsed. */
export function readableLog(text: string): string {
  return text.replace(ANSI, '').split('\n').map((line) => line.split('\r').filter(Boolean).at(-1) ?? '').join('\n');
}
