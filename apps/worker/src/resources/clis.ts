import { RESOURCE_LEVELS, narrowestLevel, type LevelContext, type ResourceLevel, type ToolEntry, type ToolStatus } from '@accio/protocol';

// GLOSSARY: CLI. Which CLIs a thread gets, and what its turn is told about them (ADR 0021).

export type ThreadCli = { tool: ToolEntry; level: ResourceLevel; overriddenBy?: { tool: ToolEntry; level: ResourceLevel } };

/**
 * The CLIs on for a thread, one per executable: the narrowest level wins, and at one level the
 * lowest id, so every machine picks the same. Overridden ones stay in the list, marked.
 */
export function threadClis(tools: ToolEntry[], at: LevelContext): ThreadCli[] {
  const on = tools.flatMap(tool => { const level = narrowestLevel(tool.scope, at); return level ? [{ tool, level }] : []; });
  on.sort((a, b) => RESOURCE_LEVELS.indexOf(a.level) - RESOURCE_LEVELS.indexOf(b.level) || a.tool.id.localeCompare(b.tool.id));
  const winners = new Map<string, ThreadCli>();
  return on.map(cli => {
    const winner = winners.get(cli.tool.executable);
    if (winner) return { ...cli, overriddenBy: { tool: winner.tool, level: winner.level } };
    winners.set(cli.tool.executable, cli);
    return cli;
  });
}

/** Your own description, else the one the installed package declares. */
export function cliDescription(tool: ToolEntry, status?: ToolStatus) {
  return tool.description?.trim() || status?.description?.trim() || '';
}

const short = (text: string, max = 300) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function unavailable(status?: ToolStatus) {
  if (!status || status.status === 'pending' || status.status === 'installing') return 'being installed on this machine; it is available from a later turn.';
  const why = `its check failed: ${short(status.detail ?? 'unknown error')}`;
  if (status.repairThreadId) return `${why}. A repair thread is fixing it.`;
  return status.repairError ? `${why}. No repair thread could start: ${short(status.repairError, 200)}` : `${why}.`;
}

/** The turn's section about CLIs, or '' when the thread has none. */
export function cliInstructions(clis: { tool: ToolEntry; status?: ToolStatus }[]): string {
  const ready = clis.filter(c => c.status?.status === 'ready');
  const missing = clis.filter(c => c.status?.status !== 'ready');
  const lines: string[] = [];
  if (ready.length) {
    lines.push('CLIs installed for this turn, on the PATH:');
    for (const { tool, status } of ready) {
      const description = cliDescription(tool, status);
      lines.push(`- ${tool.executable}${tool.name !== tool.executable ? ` (${tool.name})` : ''}${description ? `: ${short(description)}` : ''}`);
    }
    lines.push('Run `<cli> --help` before using one of them for the first time.');
  }
  if (missing.length) {
    lines.push('CLIs this thread has that are not available on this machine right now:');
    for (const { tool, status } of missing) lines.push(`- ${tool.executable}: ${unavailable(status)}`);
  }
  return lines.join('\n');
}
