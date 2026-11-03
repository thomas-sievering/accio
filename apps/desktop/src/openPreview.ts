/** Renderer requests may open only a local HTTP preview from this desktop's own app. */
export function previewUrl(sender: string | undefined, serverOrigin: string | undefined, input: unknown): string {
  if (!sender || !serverOrigin || new URL(sender).origin !== serverOrigin) throw new Error('Only this desktop app can open a local preview.');
  if (typeof input !== 'string') throw new Error('Invalid preview URL');
  const url = new URL(input);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new Error('Only local HTTP previews can be opened.');
  return url.href;
}
