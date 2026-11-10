import { describe, expect, it } from 'vitest';
import { saveProfile, slugify, type Profile } from './profile.js';

const personal: Profile = { id: 'personal', name: 'Personal' };
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
  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('profile');
  });
});
