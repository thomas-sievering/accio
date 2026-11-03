import { describe, expect, it } from 'vitest';
import { assertAccountInOneProfile, saveProfile, slugify, toView, type Profile, type AccountSummary } from './profile.js';

const personal: Profile = { id: 'personal', name: 'Personal' };
const hrc: Profile = { id: 'hrc', name: 'HRC' };
const signedInAs =
  (logins: Record<string, string>) =>
  (id: string): AccountSummary => ({ signedIn: id in logins, email: null, organization: null, claudeAccountId: logins[id] ?? null });

describe('saveProfile', () => {
  it('creates a profile with a slug id and keeps it on edit', () => {
    const { saved } = saveProfile([], { name: 'HRC Work' });
    expect(saved).toEqual({ id: 'hrc-work', name: 'HRC Work' });
    const edited = saveProfile([saved], { id: 'hrc-work', name: 'HRC' }).saved;
    expect(edited.id).toBe('hrc-work');
  });

  it('refuses duplicate names and suffixes clashing ids', () => {
    expect(() => saveProfile([personal], { name: 'personal' })).toThrow(/already exists/);
    expect(saveProfile([personal], { name: 'Personal!' }).saved.id).toBe('personal-2');
  });
});

describe('assertAccountInOneProfile', () => {
  it('refuses a Claude account another profile already uses', () => {
    expect(() => assertAccountInOneProfile([personal, hrc], signedInAs({ personal: 'me' }), 'hrc', 'me')).toThrow(
      /Personal already uses this Claude account/,
    );
    expect(() => assertAccountInOneProfile([personal, hrc], signedInAs({ hrc: 'work' }), 'personal', 'work')).toThrow(
      /HRC already uses this Claude account/,
    );
  });

  it('lets a profile sign in to the same account again, and profiles use different accounts', () => {
    expect(() => assertAccountInOneProfile([hrc], signedInAs({ hrc: 'work' }), 'hrc', 'work')).not.toThrow();
    expect(() => assertAccountInOneProfile([personal, hrc], signedInAs({ personal: 'me' }), 'hrc', 'work')).not.toThrow();
  });
});

describe('profile helpers', () => {
  it('shows the profile as providers and their accounts, with who is signed in and nothing else of the login', () => {
    const view = toView(hrc, { signedIn: true, email: 'me@hrc.example', organization: 'HRC', claudeAccountId: 'x' });
    expect(view).toEqual({
      ...hrc,
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          accountName: 'Claude account',
          available: true,
          accounts: [{ email: 'me@hrc.example', organization: 'HRC' }],
        },
        { id: 'openai', name: 'OpenAI', accountName: 'ChatGPT account', available: false, accounts: [] },
      ],
    });
    expect(toView(hrc, signedInAs({})('hrc')).providers[0]?.accounts).toEqual([]);
  });

  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('profile');
  });
});
