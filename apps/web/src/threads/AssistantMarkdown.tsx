import { createContext, useContext, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isLocalFileSource, isRemoteMedia, mediaMimeType, type MediaBinding } from '@accio/protocol';
import { FileLink } from './FileLink';
import { InlineMedia } from './InlineMedia';
import { markdownUrl } from './markdownUrl';

const MediaContext = createContext<{ threadId: string; media?: MediaBinding[]; preparing: boolean }>({ threadId: '', preparing: false });

/** Keep renderer identities stable: streaming another token must not remount a playing video. */
const components: Components = {
  img: function MarkdownMedia({ src, alt }) {
    const { threadId, media, preparing } = useContext(MediaContext);
    const source = typeof src === 'string' ? src : '';
    const binding = media?.find((entry) => entry.source === source);
    const snapshot = isLocalFileSource(source) || source.startsWith('data:');
    if (binding?.asset) return <InlineMedia key={`${threadId}:${binding.asset.id}`} threadId={threadId} asset={binding.asset} label={alt} />;
    if (isRemoteMedia(source)) return <InlineMedia key={source} threadId={threadId} source={source} mimeType={mediaMimeType(source) ?? 'image/unknown'} label={alt} />;
    return <span className="media-placeholder" role="status">
      <span>{alt || 'Media'}</span>
      <small>{binding?.error ?? (snapshot ? (preparing && media === undefined ? 'Preparing saved media…' : 'Saved media is unavailable.') : 'This media source is not supported.')}</small>
    </span>;
  },
  a: function MarkdownLink({ href, children, title, node }) {
    const { threadId } = useContext(MediaContext);
    // A linked image still has its own expand/actions buttons; do not nest those inside another control.
    if (node?.children.some((child) => child.type === 'element' && child.tagName === 'img')) {
      return <span>{children}{href && (isLocalFileSource(href)
        ? <FileLink threadId={threadId} path={href} title={title}>Open linked file</FileLink>
        : <a href={href} title={title} target="_blank" rel="noopener noreferrer">Open link</a>)}</span>;
    }
    if (href && isLocalFileSource(href)) return <FileLink threadId={threadId} path={href} title={title}>{children}</FileLink>;
    if (!href) return <span title="This link is not supported.">{children}</span>;
    return <a href={href} title={title} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>;
  },
};

export function AssistantMarkdown({ threadId, text, media, preparing = false }: { threadId: string; text: string; media?: MediaBinding[]; preparing?: boolean }): ReactNode {
  return <MediaContext.Provider value={{ threadId, media, preparing }}>
    <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={markdownUrl}>{text}</Markdown>
  </MediaContext.Provider>;
}
