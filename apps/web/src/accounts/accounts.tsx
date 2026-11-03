import { createContext, useContext, type ReactNode } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';
import { Layers } from '../app/icons';

/** 'all' or an account id. The sidebar shows only what belongs to it. */
export type AccountFilter = 'all' | (string & {});

type AccountsState = {
  accounts: AccountView[] | undefined;
  filter: AccountFilter;
  setFilter: (f: AccountFilter) => void;
};

const Ctx = createContext<AccountsState | null>(null);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const accounts = useLive(() => client.call('accounts.list', {}), 'accounts.changed');
  const [stored, setFilter] = useLocalState<AccountFilter>('accio.accountFilter', 'all');
  // A deleted account falls back to showing everything.
  const filter = stored !== 'all' && accounts && !accounts.some((a) => a.id === stored) ? 'all' : stored;
  return <Ctx.Provider value={{ accounts, filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useAccounts(): AccountsState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAccounts outside AccountsProvider');
  return s;
}

/** A stable hue per account, so each one is recognisable at a glance. */
export function accountHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function AccountTile({ account, size = 'sm' }: { account?: AccountView; size?: 'xs' | 'sm' | 'md' }) {
  if (!account) {
    // Flat line mark: "all" has no colour of its own, so it gets no tile.
    return (
      <span className={`tile-all tile-${size}`}>
        <Layers />
      </span>
    );
  }
  return (
    <span className={`tile tile-${size}`} style={{ '--hue': accountHue(account.id) } as React.CSSProperties}>
      {account.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
