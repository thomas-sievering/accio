/**
 * A model's name split for display: the family word, and its version shown muted.
 * The provider logo already names the brand, so "Claude " and "GPT-" are dropped:
 * "Claude Opus 5.5" → Opus · 5.5, "GPT-6.1-Sol" → Sol · 6.1.
 */
export function prettyModelName(name: string): { name: string; version?: string } {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  const at = parts.findIndex((p) => /^v?\d+(\.\d+)*$/i.test(p));
  if (at < 0) return { name: capitalize(name.trim().replace(/^Claude\s+(?!Code\b)/i, '')) };
  const rest = parts.filter((_, i) => i !== at);
  // The brand goes only when another word is left to name the model.
  const named = rest.length > 1 && /^(claude|gpt)$/i.test(rest[0]!) ? rest.slice(1) : rest;
  return { name: named.map(capitalize).join(' '), version: parts[at]!.replace(/^v/i, '') };
}

function capitalize(word: string) {
  return word.replace(/^./, (c) => c.toUpperCase());
}
