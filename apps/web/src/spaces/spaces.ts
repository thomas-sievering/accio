import { useMemo } from 'react';
import type { Space } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';

/** GLOSSARY: Space. The hub's spaces, kept current from `spaces.changed`. */
export function useSpaces() {
  const client = useClient();
  const spaces = useLive(() => client.call('spaces.list', {}), 'spaces.changed');
  return useMemo(() => ({
    spaces,
    /** The space a project key is in, if any; a project is in at most one. */
    spaceOf: (projectKey: string): Space | undefined => spaces?.find((s) => s.projectKeys.includes(projectKey)),
  }), [spaces]);
}
