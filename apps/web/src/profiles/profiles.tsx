import { createContext, useContext, type ReactNode } from 'react';
import type { AccountView, ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';
import { hueOf } from '../app/hue';
import { Layers } from '../app/icons';

/** 'all' or a profile id. The sidebar shows only what belongs to it. */
export type ProfileFilter = 'all' | (string & {});

type ProfilesState = {
  profiles: ProfileView[] | undefined;
  accounts: AccountView[] | undefined;
  filter: ProfileFilter;
  setFilter: (f: ProfileFilter) => void;
};

const Ctx = createContext<ProfilesState | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const profiles = useLive(() => client.call('profiles.list', {}), 'profiles.changed');
  const accounts = useLive(() => client.call('accounts.list', {}), 'accounts.changed');
  const [stored, setFilter] = useLocalState<ProfileFilter>('accio.profileFilter', 'all');
  // A deleted profile falls back to showing everything.
  const filter = stored !== 'all' && profiles && !profiles.some((a) => a.id === stored) ? 'all' : stored;
  return <Ctx.Provider value={{ profiles, accounts, filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfilesState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useProfiles outside ProfilesProvider');
  return s;
}

/** The account Claude Code uses for this profile. */
export function claudeAccount(profile: ProfileView) {
  return profile.providers.find((p) => p.id === 'anthropic')?.accounts[0] ?? null;
}

export function ProfileTile({ profile, size = 'sm' }: { profile?: ProfileView; size?: 'sm' | 'md' }) {
  if (!profile) {
    // Flat line mark: "all" has no colour of its own, so it gets no tile.
    return (
      <span className={`tile-all tile-${size}`}>
        <Layers />
      </span>
    );
  }
  return (
    <span className={`tile tile-${size}`} style={{ '--hue': hueOf(profile.id) } as React.CSSProperties}>
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
