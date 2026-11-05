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

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

/** The family handle and the versioned one: "Claude Opus 5.5" → opus, opus-5.5. */
function handlesOf(name: string): { family: string; versioned: string } {
  const pretty = prettyModelName(name);
  const family = slug(pretty.name);
  return { family, versioned: pretty.version ? `${family}-${slug(pretty.version)}` : family };
}

type Mentionable = { name: string; older?: true };

/**
 * GLOSSARY: Model mention. The handle you type after @ to name a model, such as
 * `@opus` or `@sol`: its family, since only the newest of each family is offered.
 * When two offered models share a family, both carry their version, such as `@opus-5.5`.
 */
export function modelHandles<T extends Mentionable>(models: T[]): { model: T; handle: string }[] {
  const offered = models.filter((m) => !m.older);
  const families = new Map<string, number>();
  for (const m of offered) { const { family } = handlesOf(m.name); families.set(family, (families.get(family) ?? 0) + 1); }
  return offered.map((model) => {
    const { family, versioned } = handlesOf(model.name);
    return { model, handle: families.get(family)! > 1 ? versioned : family };
  });
}

/** The model a handle names, with or without its leading @; the versioned handle always works too. */
export function findMentionedModel<T extends Mentionable>(models: T[], handle: string): T | undefined {
  const wanted = handle.replace(/^@/, '').toLowerCase();
  return modelHandles(models).find((h) => h.handle === wanted)?.model
    ?? models.filter((m) => !m.older).find((m) => handlesOf(m.name).versioned === wanted);
}

/** `@handle` at the start or after whitespace; a sentence's closing full stop is not part of it. */
export const MENTION = /(?<=^|\s)@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi;

/**
 * GLOSSARY: Machine mention. The handle you type after @ to name a machine, such as
 * `@laptop`: its name in lowercase words joined by dashes. Two machines sharing one
 * both add the start of their id, such as `@laptop-3f2a`.
 */
export function machineHandles<T extends { id: string; name: string }>(machines: T[]): { machine: T; handle: string }[] {
  const counts = new Map<string, number>();
  const base = (m: T) => m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'machine';
  for (const m of machines) counts.set(base(m), (counts.get(base(m)) ?? 0) + 1);
  return machines.map((machine) => ({ machine, handle: counts.get(base(machine))! > 1 ? `${base(machine)}-${machine.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)}` : base(machine) }));
}

/** The machine a handle names, with or without its leading @. */
export function findMentionedMachine<T extends { id: string; name: string }>(machines: T[], handle: string): T | undefined {
  const wanted = handle.replace(/^@/, '').toLowerCase();
  return machineHandles(machines).find((h) => h.handle === wanted)?.machine;
}

export type MentionPart<M, C> = { text: string } | { text: string; model: M } | { text: string; machine: C };

/** The text split into plain runs and the mentions of offered models and known machines in it; a model's handle wins. */
export function splitMentions<M extends Mentionable, C extends { id: string; name: string } = never>(text: string, models: M[], machines: C[] = []): MentionPart<M, C>[] {
  const parts: MentionPart<M, C>[] = [];
  let at = 0;
  for (const match of text.matchAll(MENTION)) {
    const model = findMentionedModel(models, match[1]!);
    const machine = model ? undefined : findMentionedMachine(machines, match[1]!);
    if (!model && !machine) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push(model ? { text: match[0], model } : { text: match[0], machine: machine! });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
