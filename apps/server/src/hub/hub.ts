import type { HubInfo } from '@accio/protocol';
import type { Hub } from '@accio/hub';
import type { Router } from '../rpc/router.js';
import type { Profiles } from '../profiles/profiles.js';

const PING_TIMEOUT_MS = 2000;

/** GLOSSARY: Hub. What a client may see of it: where it is, whether it answers, and which profiles it holds an account for. */
export function registerHub(router: Router, { hub, url, profiles }: { hub: Hub; url: string; profiles: Profiles }) {
  router.on(
    'hub.get',
    async (): Promise<HubInfo> => ({
      runs: 'inThisServer',
      url,
      reachable: await answers(url),
      store: hub.storePath,
      profiles: profiles.all().map((p) => {
        const s = hub.summary(p.id);
        return { profileId: p.id, name: p.name, account: s.signedIn ? { email: s.email, organization: s.organization } : null };
      }),
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
