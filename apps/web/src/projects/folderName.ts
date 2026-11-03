/** The last part of a path: what a checkout is called in the UI. */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
