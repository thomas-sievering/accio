import { describe, expect, it } from 'vitest';
import { assertLoginKeptApart, saveAccount, slugify, toView, type Account, type SignIn } from './account.js';

const personal: Account = { id: 'personal', name: 'Personal', isJob: false, roots: [] };
const hrc: Account = { id: 'hrc', name: 'HRC', isJob: true, roots: [] };
const signedInAs =
  (logins: Record<string, string>) =>
  (id: string): SignIn => ({ signedIn: id in logins, email: null, organization: null, claudeAccountId: logins[id] ?? null });

describe('saveAccount', () => {
  it('creates an account with a slug id and keeps it on edit', () => {
    const { saved } = saveAccount([], { name: 'HRC Work', isJob: true, roots: ['S:\\hrc', 'S:\\hrc'] });
    expect(saved).toEqual({ id: 'hrc-work', name: 'HRC Work', isJob: true, roots: ['S:\\hrc'] });
    const edited = saveAccount([saved], { id: 'hrc-work', name: 'HRC', isJob: true, roots: [] }).saved;
    expect(edited.id).toBe('hrc-work');
  });

  it('refuses duplicate names and suffixes clashing ids', () => {
    expect(() => saveAccount([personal], { name: 'personal', isJob: false, roots: [] })).toThrow(/already exists/);
    expect(saveAccount([personal], { name: 'Personal!', isJob: false, roots: [] }).saved.id).toBe('personal-2');
  });
});

describe('assertLoginKeptApart', () => {
  it('refuses a job account on a Claude login another account already uses', () => {
    expect(() => assertLoginKeptApart([personal, hrc], signedInAs({ personal: 'me' }), 'hrc', 'me')).toThrow(
      /Personal is already signed in with this Claude login, and HRC is a job account/,
    );
  });

  it('refuses any account on a job account’s login', () => {
    expect(() => assertLoginKeptApart([personal, hrc], signedInAs({ hrc: 'work' }), 'personal', 'work')).toThrow(/HRC is a job account/);
  });

  it('lets personal accounts share a login, and re-signing the same account in', () => {
    const side: Account = { id: 'side', name: 'Side', isJob: false, roots: [] };
    expect(() => assertLoginKeptApart([personal, side], signedInAs({ personal: 'me' }), 'side', 'me')).not.toThrow();
    expect(() => assertLoginKeptApart([hrc], signedInAs({ hrc: 'work' }), 'hrc', 'work')).not.toThrow();
  });
});

describe('account helpers', () => {
  it('shows who is signed in, and nothing else of the login', () => {
    const view = toView(hrc, { signedIn: true, email: 'me@hrc.example', organization: 'HRC', claudeAccountId: 'x' });
    expect(view).toEqual({ ...hrc, signIn: { email: 'me@hrc.example', organization: 'HRC' } });
    expect(toView(hrc, signedInAs({})('hrc')).signIn).toBeNull();
  });

  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('account');
  });
});
