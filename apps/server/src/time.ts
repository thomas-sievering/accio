/** The current instant as stored in threads, transcripts and statuses. */
export function now(): string {
  return new Date().toISOString();
}
