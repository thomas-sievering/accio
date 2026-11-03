import type { HubInfo } from '@accio/protocol';
import type { Hub, SharedSettings } from '@accio/hub';
import type { Router } from '../rpc/router.js';

const PING_TIMEOUT_MS = 2000;

/** GLOSSARY: Hub. What a client may see of it: where it is, whether it answers, and where it keeps things. */
export function registerHub(router: Router, { hub, settings, url }: { hub: Hub; settings: SharedSettings; url: string }) {
  router.on(
    'hub.get',
    async (): Promise<HubInfo> => ({
      runs: 'inThisServer',
      url,
      reachable: await answers(url),
      store: hub.storePath,
      settingsStore: settings.storePath,
    }),
  );
}

/** Any HTTP answer counts: without a key the hub replies 401, which still proves it is up. */
async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}
