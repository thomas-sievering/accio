import { join } from 'node:path';
import { harnessProvider, type ProviderId } from '@accio/protocol';
import { configFolderOf, type HubAccess } from '../profiles/claudeConfigFolder.js';

/**
 * Variables that could carry another login, another provider or another config
 * into a thread. They are dropped before the profile's own values are set, so a
 * thread can only ever reach its profile's hub proxy or Sorting Hat house (ADR 0018).
 */
const INHERITED_BLOCKLIST = [
  /^ACCIO_SECRET_/,
  /^ACCIO_TOOL_TOKEN$/,
  /^ANTHROPIC_/,
  /^CLAUDE_CODE_USE_/, // Bedrock, Vertex, Foundry
  /^CLAUDE_CODE_OAUTH/,
  /^CLAUDE_CODE_ENTRYPOINT$/,
  /^CLAUDE_CODE_SSE_PORT$/,
  /^CLAUDE_AGENT_SDK/,
  /^CLAUDECODE$/,
  /^CLAUDE_CONFIG_DIR$/,
  /^AWS_BEARER_TOKEN_BEDROCK$/,
  /^ELECTRON_RUN_AS_NODE$/,
  /^CODEX_/,
  /^OPENAI_/,
  /^CHATGPT_/,
  /^ACCIO_OPENAI_/,
  /^ACCIO_PI_/,
  /^PI_CODING_AGENT/, // another Pi's folders, or the marker of a Pi this worker runs inside
  /^PI_(SESSION|PROVIDER|MODEL|REASONING)/,
];

/** Shared by harnesses and app previews: inherited coding-account credentials stay out. */
export function cleanExecutionEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (INHERITED_BLOCKLIST.some((re) => re.test(key.toUpperCase()))) continue;
    env[key] = value;
  }
  return env;
}

export function harnessEnv(base: NodeJS.ProcessEnv, access: HubAccess, configDir: string): Record<string, string> {
  const env = cleanExecutionEnv(base);
  env.CLAUDE_CONFIG_DIR = configDir;
  env.ANTHROPIC_BASE_URL = access.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = access.accessKey;
  // The client sees a proxy key rather than the subscription OAuth login that
  // would normally select one-hour caching automatically. Helpers keep their defaults.
  env.CLAUDE_CODE_PROMPT_CACHE_TTL ??= '1h';
  return env;
}

/** The provider whose account a harness's turns spend. */
export function providerOf(harnessId: string): ProviderId {
  return harnessProvider(harnessId);
}

const codexHomeOf = (home: string, profileId: string) => join(home, 'profiles', profileId, 'codex');
/** ADR 0026. Pi's own folder for a profile: its sessions, the bridge's state and the Claude config its Claude Code uses. */
const piHomeOf = (home: string, profileId: string) => join(home, 'profiles', profileId, 'pi');
/**
 * The Claude config Pi's Claude Code reads. It is its own, with no settings, because the bridge
 * loads Claude Code's user settings, whose env would outrank the turn's own Sorting Hat key.
 */
const piClaudeConfigOf = (home: string, profileId: string) => join(piHomeOf(home, profileId), 'claude');

function piEnv(env: Record<string, string>, home: string, profileId: string) {
  env.ACCIO_PI_HOME = piHomeOf(home, profileId);
  env.CLAUDE_CONFIG_DIR = piClaudeConfigOf(home, profileId);
  env.PI_OFFLINE = '1';
  env.PI_SKIP_VERSION_CHECK = '1';
  env.PI_TELEMETRY = '0';
  return env;
}

/** GLOSSARY: Harness skill. Where a profile's harness keeps its own files, to ask it about its skills; no hub access. */
export function harnessHomeEnv(home: string, profileId: string, harnessId: string): Record<string, string> {
  const env = cleanExecutionEnv(process.env);
  if (harnessId === 'codex') env.CODEX_HOME = codexHomeOf(home, profileId);
  else if (harnessId === 'pi') piEnv(env, home, profileId);
  else env.CLAUDE_CONFIG_DIR = configFolderOf(home, profileId);
  return env;
}

/** A turn's environment: only its profile's hub access for the provider its harness uses. */
export function turnEnv(home: string, profileId: string, harnessId: string, access: HubAccess): Record<string, string> {
  const env = harnessEnv(process.env, access, configFolderOf(home, profileId));
  if (harnessId === 'pi') return piEnv(env, home, profileId);
  if (harnessId !== 'codex') return env;
  delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL; delete env.CLAUDE_CONFIG_DIR;
  env.CODEX_HOME = codexHomeOf(home, profileId);
  env.ACCIO_OPENAI_URL = `${access.baseUrl}/openai`;
  env.ACCIO_OPENAI_KEY = access.accessKey;
  return env;
}
