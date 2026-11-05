import { useEffect, useState } from 'react';
import type { ThreadAsset } from '@accio/protocol';
import { useClient } from '../app/connection';
import { assetUrl } from './assetUrl';
import { ImageViewer } from './ImageViewer';
import { releaseSentImage, sentImage } from './sentImages';
import { useSavedAsset } from './useSavedAsset';

/** GLOSSARY: Image attachment. The images sent with a message, as thumbnails that open full size. */
export function MessageImages({ threadId, images }: { threadId: string; images: ThreadAsset[] }) {
  return <div className="msg-images">{images.map((image, index) => <MessageImage key={image.id} threadId={threadId} image={image} index={index} />)}</div>;
}

function MessageImage({ threadId, image, index }: { threadId: string; image: ThreadAsset; index: number }) {
  const client = useClient();
  const saved = useSavedAsset(threadId, image.id);
  const { url } = saved;
  const [viewing, setViewing] = useState(false);
  // A thread started here shows what was pasted until its own copy is ready to paint.
  const [preview, setPreview] = useState(() => sentImage(client, threadId, index));
  const [ready, setReady] = useState(!preview);
  useEffect(() => {
    if (!url || ready) return;
    let active = true;
    const next = new Image();
    next.src = url;
    void next.decode().then(() => {
      if (!active) return;
      setReady(true);
      setPreview(undefined);
      releaseSentImage(client, threadId, index);
    }, () => { if (active) saved.failed(); });
    return () => { active = false; };
  }, [client, url, ready, threadId, index, saved.failed]);

  const open = async (download: boolean) => {
    const link = document.createElement('a');
    link.href = (await assetUrl(client, threadId, image.id, download)).url;
    if (download) link.download = image.name;
    else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.click();
  };

  if (saved.error) return <span className="msg-image-missing" role="alert">{image.name}: {saved.error} <button onClick={saved.retry}>Retry</button></span>;
  const shown = ready ? url : preview;
  if (!shown) return <span className="msg-image" style={{ width: 56, height: 56 }} />;
  return <>
    <button className="msg-image" aria-label={`Expand image: ${image.name}`} disabled={!url} onClick={() => setViewing(true)}>
      <img src={shown} alt={image.name} decoding="async" onLoad={saved.loaded} onError={ready ? saved.failed : undefined} />
    </button>
    {viewing && url && <ImageViewer source={url} label={image.name} onClose={() => setViewing(false)}
      onOpen={() => void open(false)} onDownload={() => void open(true)} onError={saved.failed} />}
  </>;
}
