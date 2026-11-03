import { createContext, useContext, type ReactNode } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';
import { Layers } from '../app/icons';

/** 'all' or a profile id. The sidebar shows only what belongs to it. */
export type ProfileFilter = 'all' | (string & {});

type ProfilesState = {
  profiles: ProfileView[] | undefined;
  filter: ProfileFilter;
  setFilter: (f: ProfileFilter) => void;
};

const Ctx = createContext<ProfilesState | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const profiles = useLive(() => client.call('profiles.list', {}), 'profiles.changed');
  const [stored, setFilter] = useLocalState<ProfileFilter>('accio.profileFilter', 'all');
  // A deleted profile falls back to showing everything.
  const filter = stored !== 'all' && profiles && !profiles.some((a) => a.id === stored) ? 'all' : stored;
  return <Ctx.Provider value={{ profiles, filter, setFilter }}>{children}</Ctx.Provider>;
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

/** A stable hue per profile, so each one is recognisable at a glance. */
export function profileHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function ProfileTile({ profile, size = 'sm' }: { profile?: ProfileView; size?: 'xs' | 'sm' | 'md' }) {
  if (!profile) {
    // Flat line mark: "all" has no colour of its own, so it gets no tile.
    return (
      <span className={`tile-all tile-${size}`}>
        <Layers />
      </span>
    );
  }
  return (
    <span className={`tile tile-${size}`} style={{ '--hue': profileHue(profile.id) } as React.CSSProperties}>
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
