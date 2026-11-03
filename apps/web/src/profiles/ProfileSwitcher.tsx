import { useRef } from 'react';
import { Check, Users, UpDown } from '../app/icons';
import { ProfileTile, useProfiles } from './profiles';

/** Top of the sidebar: which profile's work is shown (like botbot's workspace menu). */
export function ProfileSwitcher({ onManage }: { onManage: () => void }) {
  const { profiles = [], filter, setFilter } = useProfiles();
  const menu = useRef<HTMLDivElement>(null);
  const current = profiles.find((a) => a.id === filter);

  const pick = (f: string) => {
    setFilter(f);
    menu.current?.hidePopover();
  };

  return (
    <>
      <button className="switcher" popoverTarget="profile-menu" title="Switch profile">
        <ProfileTile profile={current} />
        <span className="switcher-name">{current?.name ?? 'All profiles'}</span>
        <span className="switcher-updown">
          <UpDown />
        </span>
      </button>
      <div className="menu" id="profile-menu" popover="auto" ref={menu} role="menu">
        <button className="menu-item" role="menuitem" onClick={() => pick('all')}>
          <ProfileTile size="md" />
          <span className="menu-text">
            <b>All profiles</b>
          </span>
          {filter === 'all' && <Check />}
        </button>
        {profiles.map((a) => (
          <button key={a.id} className="menu-item" role="menuitem" onClick={() => pick(a.id)}>
            <ProfileTile profile={a} size="md" />
            <span className="menu-text">
              <b>{a.name}</b>
              <small className={a.account ? undefined : 'warn'}>
                {a.account ? (a.account.email ?? 'Signed in') : 'Not signed in'}
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
          <span className="menu-text">Manage profiles</span>
        </button>
      </div>
    </>
  );
}
