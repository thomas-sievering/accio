import { useEffect, useState } from 'react';
import { PairedClients } from '../machine/PairedClients';
import { MoveOnSetting } from '../threads/SendingSettings';
import { SettingRow, SettingsSection } from './Settings';
import { Sheet } from './Sheet';

type Theme = 'dark' | 'light';
const themeKey = 'accio.browser-theme';

export function useBrowserTheme(browser?: boolean) {
  const [theme, setTheme] = useState<Theme>(() => browser && localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark');
  useEffect(() => {
    if (!browser) return;
    localStorage.setItem(themeKey, theme);
    document.documentElement.dataset.browserTheme = theme;
    return () => { delete document.documentElement.dataset.browserTheme; };
  }, [browser, theme]);
  return { theme, setTheme };
}

export function ThisBrowser({ theme, setTheme, onClose }: { theme: Theme; setTheme: (theme: Theme) => void; onClose: () => void }) {
  return <Sheet title="This browser" onClose={onClose}>
    <div className="sheet-body">
      <SettingsSection>
        <SettingRow title="Theme">
          <select className="browser-theme" aria-label="Theme" value={theme} onChange={(event) => setTheme(event.target.value === 'light' ? 'light' : 'dark')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </SettingRow>
        <MoveOnSetting />
      </SettingsSection>
      <PairedClients />
    </div>
  </Sheet>;
}
