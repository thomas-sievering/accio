import { RELAY_THREAD_METHODS, type MethodName, type ThreadView } from '@accio/protocol';
import { useConnectionStatus } from '../app/connection';

const relayed = new Set<MethodName>(RELAY_THREAD_METHODS);
export const remoteImagesReason = 'Sending images to another machine is not supported yet.';

/** Availability follows the owning machine and the relay's authoritative method list. */
export function useThreadAvailability(thread?: Pick<ThreadView, 'machine'>) {
  const connection = useConnectionStatus();
  const machine = thread?.machine;
  const unavailable = connection !== 'open' ? 'Reconnect to use thread actions.'
    : machine && !machine.online ? `${machine.name} is offline.` : undefined;
  const reason = (method: MethodName) => unavailable ?? (machine && !relayed.has(method)
    ? 'This action is only available on the thread’s machine.' : undefined);
  return { unavailable, reason, imagesUnavailable: unavailable ?? (machine ? remoteImagesReason : undefined) };
}
