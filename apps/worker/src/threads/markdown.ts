import { fromMarkdown } from 'mdast-util-from-markdown';
import { isLocalFileSource, isRemoteMedia, normalizeMarkdownSource } from '@accio/protocol';

type Node = { type: string; url?: string; identifier?: string; children?: Node[] };

/** Parse destinations as Markdown, excluding fenced/inline code and resolving reference links. */
export function markdownReferences(text: string): { media: string[]; files: string[] } {
  const tree = fromMarkdown(text) as Node;
  const definitions = new Map<string, string>();
  const walk = (node: Node, visit: (node: Node) => void) => {
    visit(node);
    node.children?.forEach((child) => walk(child, visit));
  };
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });
  const media = new Set<string>();
  const files = new Set<string>();
  walk(tree, (node) => {
    const destination = node.url ?? (node.identifier ? definitions.get(node.identifier) : undefined);
    if (!destination) return;
    const source = normalizeMarkdownSource(destination);
    if ((node.type === 'image' || node.type === 'imageReference') && !isRemoteMedia(source)) media.add(source);
    if ((node.type === 'link' || node.type === 'linkReference') && isLocalFileSource(source)) files.add(source);
  });
  return { media: [...media], files: [...files] };
}
