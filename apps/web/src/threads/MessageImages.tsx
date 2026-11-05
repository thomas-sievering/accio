import { useEffect, useState } from 'react';
import type { ThreadAsset } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { assetUrl } from './assetUrl';
import { ImageViewer } from './ImageViewer';
import { releaseSentImage, sentImage } from './sentImages';

/** GLOSSARY: Image attachment. The images sent with a message, as thumbnails that open full size. */
export function MessageImages({ threadId, images }: { threadId: string; images: ThreadAsset[] }) {
  return <div className="msg-images">{images.map((image, index) => <MessageImage key={image.id} threadId={threadId} image={image} index={index} />)}</div>;
}

function MessageImage({ threadId, image, index }: { threadId: string; image: ThreadAsset; index: number }) {
  const client = useClient();
  const connection = useConnectionStatus();
  const [url, setUrl] = useState<string>();
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  // A thread started here shows what was pasted until its own copy is ready to paint.
  const [preview, setPreview] = useState(() => sentImage(threadId, index));
  const [ready, setReady] = useState(!preview);
  useEffect(() => {
    if (!url || ready) return;
    let active = true;
    const next = new Image();
    next.src = url;
    void next.decode().catch(() => {}).then(() => {
      if (!active) return;
      setReady(true);
      setPreview(undefined);
      releaseSentImage(threadId, index);
    });
    return () => { active = false; };
  }, [url, ready, threadId, index]);

  useEffect(() => {
    if (connection !== 'open') return;
    let active = true;
    void assetUrl(client, threadId, image.id, false, version > 0).then((result) => { if (active) { setUrl(result.url); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [client, threadId, image.id, version, connection]);

  // An expired grant fails to load; renew it once before giving up.
  const renew = () => { if (version < 1) setVersion((n) => n + 1); else setFailed(true); };
  const open = async (download: boolean) => {
    const link = document.createElement('a');
    link.href = (await assetUrl(client, threadId, image.id, download)).url;
    if (download) link.download = image.name;
    else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.click();
  };

  if (failed) return <span className="msg-image-missing">{image.name}</span>;
  const shown = ready ? url : preview;
  if (!shown) return <span className="msg-image" style={{ width: 56, height: 56 }} />;
  return <>
    <button className="msg-image" aria-label={`Expand image: ${image.name}`} disabled={!url} onClick={() => setViewing(true)}>
      <img src={shown} alt={image.name} decoding="async" onError={ready ? renew : undefined} />
    </button>
    {viewing && url && <ImageViewer source={url} label={image.name} onClose={() => setViewing(false)}
      onOpen={() => void open(false)} onDownload={() => void open(true)} onError={renew} />}
  </>;
}
