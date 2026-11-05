/**
 * GLOSSARY: Image attachment. The local copies of the images a new thread started with.
 * They show in its first message until the thread's own copies have loaded, so sending
 * never waits on the server to show what was just pasted. Each is freed once replaced.
 */
const previews = new Map<string, string[]>();

export function keepSentImages(threadId: string, urls: string[]) {
  if (urls.length) previews.set(threadId, urls);
}

/** The local copy of the `index`th image the thread started with, if still held. */
export function sentImage(threadId: string, index: number): string | undefined {
  return previews.get(threadId)?.[index];
}

/** The thread's own copy of this image now shows; its local copy is no longer needed. */
export function releaseSentImage(threadId: string, index: number) {
  const urls = previews.get(threadId);
  const url = urls?.[index];
  if (!urls || !url) return;
  URL.revokeObjectURL(url);
  urls[index] = '';
  if (urls.every((u) => !u)) previews.delete(threadId);
}
