import type { ThreadView } from '@accio/protocol';
import { useTooltip } from '../app/Tooltip';
import { useThreadAvailability } from './useThreadAvailability';

/** The thread header's title: clicking it opens the title editor the sidebar row uses. */
export function EditableTitle({ thread, onEdit }: { thread: ThreadView; onEdit: () => void }) {
  const { unavailable } = useThreadAvailability(thread);
  const tip = useTooltip(thread.title);
  return <><button {...tip.props} className="editable-thread-title" disabled={!!unavailable} title={unavailable ?? 'Rename thread'} aria-label={`Rename thread: ${thread.title}`} onClick={onEdit}>{thread.title}</button>{tip.tooltip}</>;
}
