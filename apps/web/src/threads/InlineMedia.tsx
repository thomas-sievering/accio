import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { mediaKind, type ThreadAsset } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { assetUrl } from './assetUrl';
import { ImageViewer } from './ImageViewer';

type Props = { threadId: string; asset?: ThreadAsset; source?: string; mimeType?: string; label?: string };
type Playback = { time: number; playing: boolean; volume: number; muted: boolean; rate: number };

/** One renderer for saved tool media and Markdown embeds. Only spans appear inside Markdown paragraphs. */
export function InlineMedia({ threadId, asset, source, mimeType, label }: Props) {
  const client = useClient();
  const connection = useConnectionStatus();
  const kind = mediaKind(asset?.mimeType ?? mimeType ?? '');
  const name = label || asset?.name || (kind ? `${kind[0]!.toUpperCase()}${kind.slice(1)}` : 'Attachment');
  const [resolved, setResolved] = useState<string>();
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [viewer, setViewer] = useState(false);
  const [near, setNear] = useState(kind === 'image');
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const playback = useRef<Playback | undefined>(undefined);
  const failedOnce = useRef(false);
  const resolvedVersion = useRef(-1);
  const description = useId();

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '320px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!asset || !near || connection !== 'open' || resolvedVersion.current === version) return;
    let active = true;
    setPending(true);
    // Keep the current source during reconnects and grant renewal: no blank player or remount.
    void assetUrl(client, threadId, asset.id, false, version > 0).then((result) => {
      if (active) { resolvedVersion.current = version; setResolved(result.url); setError(undefined); }
    }, (cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [client, threadId, asset?.id, near, version, connection]);

  const url = asset ? resolved : source;
  const rememberPlayback = useCallback(() => {
    const el = player.current;
    if (el) playback.current = { time: el.currentTime, playing: !el.paused, volume: el.volume, muted: el.muted, rate: el.playbackRate };
  }, []);
  const retry = useCallback(() => {
    rememberPlayback();
    setError(undefined);
    setImageLoaded(false);
    if (asset) setVersion((n) => n + 1);
    else {
      const el = player.current;
      if (el) el.load();
      else if (image.current && source) image.current.src = source;
    }
  }, [asset, source, rememberPlayback]);
  const failed = useCallback(() => {
    // An expired range grant may fail on a later seek; renew once and restore the playback position.
    if (asset && !failedOnce.current) { failedOnce.current = true; retry(); }
    else setError('Media could not be loaded or this format is not supported. You can download the file.');
  }, [asset, retry]);
  const loaded = useCallback(() => {
    const el = player.current;
    const saved = playback.current;
    if (el && saved) {
      el.currentTime = saved.time;
      el.volume = saved.volume;
      el.muted = saved.muted;
      el.playbackRate = saved.rate;
      if (saved.playing) void el.play().catch(() => {});
      playback.current = undefined;
    }
  }, []);
  const healthy = useCallback(() => { failedOnce.current = false; }, []);

  const action = async (download: boolean) => {
    setActionError(undefined);
    try {
      const target = asset ? (await assetUrl(client, threadId, asset.id, download)).url : source;
      if (!target) return;
      const link = document.createElement('a');
      link.href = target;
      if (download) link.download = asset?.name ?? '';
      else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      link.click();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <span className={`inline-media ${kind ?? 'file'}`} ref={holder}>
    {kind === 'image' && url && <button className="media-image-open" aria-label={`Expand image: ${name}`} onClick={() => setViewer(true)}>
      <img ref={image} src={url} alt={name} loading="lazy" decoding="async" onError={failed} onLoad={() => { setImageLoaded(true); healthy(); }} />
    </button>}
    {kind === 'video' && <video
      ref={(el) => { player.current = el; }} src={near ? url : undefined} controls preload="metadata" playsInline
      aria-label={name} aria-describedby={description} onError={failed} onLoadedMetadata={loaded} onCanPlay={healthy}
    >Your browser cannot play this video. Download the file to open it.</video>}
    {kind === 'audio' && <audio
      ref={(el) => { player.current = el; }} src={near ? url : undefined} controls preload="metadata"
      aria-label={name} aria-describedby={description} onError={failed} onLoadedMetadata={loaded} onCanPlay={healthy}
    >Your browser cannot play this audio. Download the file to open it.</audio>}
    {kind === 'image' && url && !imageLoaded && !error && <span className="media-loading" role="status">Loading image…</span>}
    {(kind === 'image' && !url || !kind) && <span className="media-placeholder" role="status">{name}{pending && <small>Loading saved media…</small>}</span>}
    <span className="media-caption" id={description}>
      <span className="media-name" title={name}>{name}</span>
      {asset && <span className="media-size">{formatSize(asset.sizeBytes)}</span>}
      <span className="media-actions">
        <button onClick={() => void action(false)}>Open</button>
        <button onClick={() => void action(true)}>Download</button>
      </span>
    </span>
    {error && <span className="media-error" role="alert">{error} <button onClick={() => { failedOnce.current = false; retry(); }}>Retry</button></span>}
    {actionError && <span className="media-error" role="alert">{actionError}</span>}
    {viewer && url && <ImageViewer source={url} label={name} onClose={() => setViewer(false)} onDownload={() => void action(true)} onOpen={() => void action(false)} onError={failed} />}
  </span>;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
