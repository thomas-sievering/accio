import { describe, expect, it } from 'vitest';
import { hubAddress, saveAccount, slugify, toView, type Account } from './account.js';

const personal: Account = { id: 'personal', name: 'Personal', isJob: false, hubUrl: 'https://hub.example.com', hubKey: 'k1', roots: [] };

describe('saveAccount', () => {
  it('creates an account with a slug id', () => {
    const { saved, accounts } = saveAccount([], { name: 'HRC Work', isJob: true, hubUrl: 'https://hub.example.com:8318/', hubKey: 'k' });
    expect(saved.id).toBe('hrc-work');
    expect(saved.hubUrl).toBe('https://hub.example.com:8318');
    expect(accounts).toHaveLength(1);
  });

  it('keeps the stored hub key when an edit leaves it empty', () => {
    const { saved } = saveAccount([personal], { id: 'personal', name: 'Private', isJob: false, hubUrl: personal.hubUrl, hubKey: '' });
    expect(saved).toMatchObject({ id: 'personal', name: 'Private', hubKey: 'k1' });
  });

  it('requires a hub key for a new account', () => {
    expect(() => saveAccount([], { name: 'A', isJob: false, hubUrl: 'https://x.test' })).toThrow(/Hub key/);
  });

  it('rejects a hub URL that is not http(s)', () => {
    expect(() => saveAccount([], { name: 'A', isJob: false, hubUrl: 'hub.local', hubKey: 'k' })).toThrow(/full address/);
    expect(() => saveAccount([], { name: 'A', isJob: false, hubUrl: 'ftp://hub', hubKey: 'k' })).toThrow(/http/);
  });

  it('refuses a job account on a proxy another account already uses', () => {
    expect(() => saveAccount([personal], { name: 'HRC', isJob: true, hubUrl: 'https://HUB.example.com:443/', hubKey: 'k2' })).toThrow(
      /job account/,
    );
  });

  it('refuses any account on a job account’s proxy', () => {
    const hrc: Account = { id: 'hrc', name: 'HRC', isJob: true, hubUrl: 'https://hub.example.com:8318', hubKey: 'k', roots: [] };
    expect(() => saveAccount([hrc], { name: 'Me', isJob: false, hubUrl: 'https://hub.example.com:8318', hubKey: 'x' })).toThrow(
      /HRC is a job account/,
    );
  });

  it('lets two personal accounts share a proxy', () => {
    const { accounts } = saveAccount([personal], { name: 'Side', isJob: false, hubUrl: personal.hubUrl, hubKey: 'k' });
    expect(accounts).toHaveLength(2);
  });

  it('refuses duplicate names and suffixes clashing ids', () => {
    expect(() => saveAccount([personal], { name: 'personal', isJob: false, hubUrl: 'https://o.test', hubKey: 'k' })).toThrow(
      /already exists/,
    );
    const { saved } = saveAccount([personal], { name: 'Personal!', isJob: false, hubUrl: 'https://o.test', hubKey: 'k' });
    expect(saved.id).toBe('personal-2');
  });
});

describe('account helpers', () => {
  it('never exposes the hub key in the client view', () => {
    expect(toView(personal)).toEqual({
      id: 'personal',
      name: 'Personal',
      isJob: false,
      hubUrl: personal.hubUrl,
      hasHubKey: true,
      roots: [],
    });
  });

  it('compares hub addresses with default ports and case folded', () => {
    expect(hubAddress('https://Hub.example.com/')).toBe(hubAddress('https://hub.example.com:443'));
    expect(hubAddress('https://hub.example.com:8318')).not.toBe(hubAddress('https://hub.example.com'));
  });

  it('slugifies names', () => {
    expect(slugify('  Über Work ')).toBe('uber-work');
    expect(slugify('!!!')).toBe('account');
  });
});
