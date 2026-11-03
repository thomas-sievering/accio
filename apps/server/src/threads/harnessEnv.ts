import type { HubAccess } from '../profiles/claudeConfigFolder.js';

/**
 * Variables that could carry another login, another provider or another config
 * into a thread. They are dropped before the profile's own values are set, so a
 * thread can only ever reach its profile's hub proxy (ADR 0002, ADR 0007).
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
  return env;
}
