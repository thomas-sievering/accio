import { describe, expect, it } from 'vitest';
import { assertAccountInOneProfile, saveProfile, slugify, toView, type Profile, type SignIn } from './profile.js';

const personal: Profile = { id: 'personal', name: 'Personal', roots: [] };
const hrc: Profile = { id: 'hrc', name: 'HRC', roots: [] };
const signedInAs =
  (logins: Record<string, string>) =>
  (id: string): SignIn => ({ signedIn: id in logins, email: null, organization: null, claudeAccountId: logins[id] ?? null });

describe('saveProfile', () => {
  it('creates a profile with a slug id and keeps it on edit', () => {
    const { saved } = saveProfile([], { name: 'HRC Work', roots: ['S:\\hrc', 'S:\\hrc'] });
    expect(saved).toEqual({ id: 'hrc-work', name: 'HRC Work', roots: ['S:\\hrc'] });
    const edited = saveProfile([saved], { id: 'hrc-work', name: 'HRC', roots: [] }).saved;
    expect(edited.id).toBe('hrc-work');
  });

  it('refuses duplicate names and suffixes clashing ids', () => {
    expect(() => saveProfile([personal], { name: 'personal', roots: [] })).toThrow(/already exists/);
    expect(saveProfile([personal], { name: 'Personal!', roots: [] }).saved.id).toBe('personal-2');
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
  it('shows who is signed in, and nothing else of the login', () => {
    const view = toView(hrc, { signedIn: true, email: 'me@hrc.example', organization: 'HRC', claudeAccountId: 'x' });
    expect(view).toEqual({ ...hrc, signIn: { email: 'me@hrc.example', organization: 'HRC' } });
    expect(toView(hrc, signedInAs({})('hrc')).signIn).toBeNull();
  });

  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('profile');
  });
});
