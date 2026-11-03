import { useRef } from 'react';
import { Check, Users, UpDown } from '../app/icons';
import { AccountTile, useAccounts } from './accounts';

/** Top of the sidebar: which account's work is shown (like botbot's workspace menu). */
export function AccountSwitcher({ onManage }: { onManage: () => void }) {
  const { accounts = [], filter, setFilter } = useAccounts();
  const menu = useRef<HTMLDivElement>(null);
  const current = accounts.find((a) => a.id === filter);

  const pick = (f: string) => {
    setFilter(f);
    menu.current?.hidePopover();
  };

  return (
    <>
      <button className="switcher" popoverTarget="account-menu" title="Switch account">
        <AccountTile account={current} />
        <span className="switcher-name">{current?.name ?? 'All accounts'}</span>
        <span className="switcher-updown">
          <UpDown />
        </span>
      </button>
      <div className="menu" id="account-menu" popover="auto" ref={menu} role="menu">
        <button className="menu-item" role="menuitem" onClick={() => pick('all')}>
          <AccountTile size="md" />
          <span className="menu-text">
            <b>All accounts</b>
          </span>
          {filter === 'all' && <Check />}
        </button>
        {accounts.map((a) => (
          <button key={a.id} className="menu-item" role="menuitem" onClick={() => pick(a.id)}>
            <AccountTile account={a} size="md" />
            <span className="menu-text">
              <b>{a.name}</b>
              <small className={a.signIn ? undefined : 'warn'}>
                {a.isJob ? 'Job account' : 'Personal'}
                {a.signIn ? '' : ' · not signed in'}
              </small>
            </span>
            {filter === a.id && <Check />}
          </button>
        ))}
        <hr />
        <button
          className="menu-item"
          role="menuitem"
          onClick={() => {
            menu.current?.hidePopover();
            onManage();
          }}
        >
          <span className="menu-icon">
            <Users />
          </span>
          <span className="menu-text">Manage accounts…</span>
        </button>
      </div>
    </>
  );
}
