import { describe, expect, it } from 'vitest';
import { saveProfile, slugify, toView, type Profile } from './profile.js';

const personal: Profile = { id: 'personal', name: 'Personal' };
const hrc: Profile = { id: 'hrc', name: 'HRC' };
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

describe('profile helpers', () => {
  it('shows the profile as providers and their accounts, with who is signed in and nothing else of the login', () => {
    const account = { id: 'team', name: 'Team account 1', providerId: 'anthropic' as const, signedIn: true, email: 'me@hrc.example', organization: 'HRC' };
    const view = toView(hrc, account);
    expect(view).toEqual({
      ...hrc,
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          accountName: 'Claude account',
          available: true,
          accounts: [account],
        },
        { id: 'openai', name: 'OpenAI', accountName: 'ChatGPT account', available: false, accounts: [] },
      ],
    });
    expect(toView(hrc, null).providers[0]?.accounts).toEqual([]);
  });

  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('profile');
  });
});
