import { useEffect, useRef } from 'react';
import type { PanelTab } from './SidePanel';
import type { SettingsRoute } from './Settings';

/**
 * Requests between panes that don't share a parent worth threading props
 * through, such as the side panel asking the open thread to do something.
 * Each is a request: nothing happens when no pane is listening.
 */
export type AppEvents = {
  /** Put text into the composer of a thread (its id) or of the open draft ('draft'). */
  'composer.insert': { target: string; text: string };
  /** Scroll a thread's transcript to an item, opening any fold it sits in. */
  'transcript.reveal': { threadId: string; itemId: string };
  /** Open settings at a section, such as one MCP server from the side panel. */
  'settings.open': SettingsRoute;
  /** Open a project's settings, such as from the thread header's project name. */
  'project.open': { id: string };
  /** Open a project's dashboard, such as from the thread header's project name. */
  'project.dashboard': { id: string };
  /** A thread was snoozed until a time (ISO); the sidebar says so briefly. */
  'thread.snoozed': { threadId: string; until: string; untilOnline?: string };
  /** Open the side panel at a tab, such as Delivery after pressing Ship. */
  'panel.show': PanelTab;
};

const prefix = 'accio:';

export function emitAppEvent<K extends keyof AppEvents>(name: K, detail: AppEvents[K]) {
  window.dispatchEvent(new CustomEvent(prefix + name, { detail }));
}

export function useAppEvent<K extends keyof AppEvents>(name: K, handler: (detail: AppEvents[K]) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: Event) => latest.current((event as CustomEvent<AppEvents[K]>).detail);
    window.addEventListener(prefix + name, listener);
    return () => window.removeEventListener(prefix + name, listener);
  }, [name]);
}
