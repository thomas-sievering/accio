import type { AccountView, SaveAccountParams } from '@accio/protocol';
import { UserError } from '../rpc/router.js';

/** GLOSSARY: Account. Reaches its provider only through its own hub proxy (ADR 0002). */
export type Account = {
  id: string;
  name: string;
  isJob: boolean;
  hubUrl: string;
  hubKey: string;
  roots: string[];
};

export function toView({ hubKey, ...rest }: Account): AccountView {
  return { ...rest, hasHubKey: hubKey.length > 0 };
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'account';
}

/** Two hub addresses that reach the same proxy compare equal. */
export function hubAddress(url: string): string {
  const u = new URL(url);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.hostname.toLowerCase()}:${port}${u.pathname.replace(/\/+$/, '')}`;
}

function validHubUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UserError('Hub URL must be a full address, such as https://hub.example.com');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UserError('Hub URL must use http or https');
  return raw.replace(/\/+$/, '');
}

/**
 * Applies a save request to the current accounts and returns the new list.
 * Enforces every account rule; throws UserError when one is broken.
 */
export function saveAccount(accounts: readonly Account[], req: SaveAccountParams): { accounts: Account[]; saved: Account } {
  const existing = req.id ? accounts.find((a) => a.id === req.id) : undefined;
  if (req.id && !existing) throw new UserError(`No account ${req.id}`);

  const hubKey = req.hubKey || existing?.hubKey || '';
  if (!hubKey) throw new UserError('Hub key is required');

  const saved: Account = {
    id: existing?.id ?? uniqueId(accounts, slugify(req.name)),
    name: req.name,
    isJob: req.isJob,
    hubUrl: validHubUrl(req.hubUrl),
    hubKey,
    roots: [...new Set(req.roots)],
  };

  const others = accounts.filter((a) => a.id !== saved.id);
  if (others.some((a) => a.name.toLowerCase() === saved.name.toLowerCase())) {
    throw new UserError(`An account named ${saved.name} already exists`);
  }
  // GLOSSARY: a job account's traffic never shares a proxy with any other account.
  const sharing = others.find((a) => hubAddress(a.hubUrl) === hubAddress(saved.hubUrl));
  if (sharing && (saved.isJob || sharing.isJob)) {
    const job = saved.isJob ? saved : sharing;
    throw new UserError(`${job.name} is a job account, so it needs a hub proxy of its own (${sharing.name} already uses this address)`);
  }

  const next = existing ? accounts.map((a) => (a.id === saved.id ? saved : a)) : [...accounts, saved];
  return { accounts: next, saved };
}

function uniqueId(accounts: readonly Account[], base: string): string {
  const taken = new Set(accounts.map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
