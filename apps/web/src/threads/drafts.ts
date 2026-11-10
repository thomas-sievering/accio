import { useMemo, useSyncExternalStore } from 'react';
import { REACTION_KINDS, type Reaction } from '@accio/protocol';

/** GLOSSARY: Image attachment. A pasted image in the composer; it can be sent once uploaded. */
export type PendingImage = { key: string; name: string; mimeType: string; url: string; uploadId?: string };

/** What a composer holds before it sends. */
export type DraftContent = { text: string; pastes: string[]; reactions: Reaction[]; images: PendingImage[] };

type Update<T> = T | ((current: T) => T);

/**
 * GLOSSARY: Draft. Unsent composer content, kept per composer key outside any component, so it
 * survives moving to another thread and back. Text, Pasted text and Reactions are also saved in localStorage,
 * so a restart keeps them; images stay in memory for this session only.
 */
const contents = new Map<string, DraftContent>();
const listeners = new Set<() => void>();
const EMPTY: DraftContent = { text: '', pastes: [], reactions: [], images: [] };
/** The parts saved beside the text, each under its own key suffix. */
const SAVED_PARTS = ['pastes', 'reactions'] as const;
let scanned = false;
let version = 0;

function readSaved(key: string): DraftContent {
  const text = localStorage.getItem(key) ?? '';
  let pastes: string[] = [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${key}:pastes`) ?? '[]');
    if (Array.isArray(saved)) pastes = saved.filter((p): p is string => typeof p === 'string');
  } catch { /* An unreadable copy is no draft. */ }
  let reactions: Reaction[] = [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${key}:reactions`) ?? '[]');
    if (Array.isArray(saved)) reactions = saved.filter(isReaction);
  } catch { /* An unreadable copy is no draft. */ }
  return text || pastes.length || reactions.length ? { text, pastes, reactions, images: [] } : EMPTY;
}

function isReaction(value: unknown): value is Reaction {
  const r = value as Partial<Reaction> | null;
  return !!r && typeof r.quote === 'string' && (REACTION_KINDS as readonly unknown[]).includes(r.kind);
}

function contentOf(key: string): DraftContent {
  let content = contents.get(key);
  if (!content) { content = readSaved(key); contents.set(key, content); }
  return content;
}

/** Loads every saved composer once, so drafts from before a restart are listed too. */
function scan() {
  if (scanned) return;
  scanned = true;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.includes(':composer:')) continue;
    const part = SAVED_PARTS.find((name) => key.endsWith(`:${name}`));
    contentOf(part ? key.slice(0, -(part.length + 1)) : key);
  }
}

function change(key: string, next: DraftContent) {
  const before = contentOf(key);
  if (next.text !== before.text) {
    if (next.text) localStorage.setItem(key, next.text); else localStorage.removeItem(key);
  }
  for (const part of SAVED_PARTS) {
    if (next[part] === before[part]) continue;
    try { if (next[part].length) localStorage.setItem(`${key}:${part}`, JSON.stringify(next[part])); else localStorage.removeItem(`${key}:${part}`); }
    catch { /* Too large to keep across a restart; it still sends. */ }
  }
  contents.set(key, next);
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const apply = <T,>(update: Update<T>, current: T) => typeof update === 'function' ? (update as (c: T) => T)(current) : update;

/** Changes one part of a draft, whether or not its composer is open. */
export function editDraft<K extends keyof DraftContent>(key: string, part: K, update: Update<DraftContent[K]>) {
  const current = contentOf(key);
  change(key, { ...current, [part]: apply(update, current[part]) });
}

/** One composer's draft. The setters work after the composer has closed, as an upload finishing late does. */
export function useDraft(key: string) {
  const content = useSyncExternalStore(subscribe, () => contentOf(key));
  return useMemo(() => ({
    ...content,
    setText: (update: Update<string>) => editDraft(key, 'text', update),
    setPastes: (update: Update<string[]>) => editDraft(key, 'pastes', update),
    setReactions: (update: Update<Reaction[]>) => editDraft(key, 'reactions', update),
    setImages: (update: Update<PendingImage[]>) => editDraft(key, 'images', update),
  }), [key, content]);
}

/** Empties a draft, freeing its images' local copies. */
export function discardDraft(key: string) {
  for (const image of contentOf(key).images) URL.revokeObjectURL(image.url);
  change(key, EMPTY);
}

export function composerKey(hubId: string, draftId: string) {
  return `accio:${hubId}:composer:${draftId}`;
}

/** The composer of a new thread not yet started, in a checkout or (with a profile) in No project. */
export function newThreadDraftId(checkoutId: string, profileId?: string) {
  return `new:${checkoutId}:${profileId ?? ''}`;
}

/** A new thread with something in its composer: listed in the inbox until it is sent or emptied. */
export type NewThreadDraft = DraftContent & { key: string; checkoutId: string; profileId?: string };

function hasContent(c: DraftContent) {
  return !!c.text.trim() || c.pastes.length > 0 || c.reactions.length > 0 || c.images.length > 0;
}

let listed: { hubId: string; version: number; drafts: NewThreadDraft[] } | undefined;
export function draftsOf(hubId: string): NewThreadDraft[] {
  scan();
  if (listed?.hubId === hubId && listed.version === version) return listed.drafts;
  const prefix = composerKey(hubId, 'new:');
  const drafts: NewThreadDraft[] = [];
  for (const [key, content] of contents) {
    if (!key.startsWith(prefix) || !hasContent(content)) continue;
    const [checkoutId = '', profileId = ''] = key.slice(prefix.length).split(':');
    drafts.push({ ...content, key, checkoutId, profileId: profileId || undefined });
  }
  listed = { hubId, version, drafts };
  return drafts;
}

/** Every new-thread draft with content on this hub. */
export function useNewThreadDrafts(hubId: string): NewThreadDraft[] {
  return useSyncExternalStore(subscribe, () => draftsOf(hubId));
}
