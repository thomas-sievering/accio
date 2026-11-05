import { IMAGE_ATTACHMENT_BYTES, IMAGE_ATTACHMENT_MAX_EDGE, IMAGE_TYPES } from '@accio/protocol';

/** The images a paste carries, in order. Text and other files are left to the textarea. */
export function pastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.items].flatMap((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

/** The size to draw an image at: its own, or shrunk so its longer side is `maxEdge`. */
export function fittedSize(width: number, height: number, maxEdge = IMAGE_ATTACHMENT_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const QUALITIES = [0.92, 0.85, 0.78, 0.68];

/**
 * GLOSSARY: Image attachment. A pasted image as it can be sent: one of the four types
 * every harness reads, at most 2000px on its longer side and under the size Claude accepts.
 * An image that already fits is sent as pasted, so a GIF keeps its animation.
 */
export async function prepareImage(file: File): Promise<Blob> {
  const known = (IMAGE_TYPES as readonly string[]).includes(file.type);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be read. Paste a PNG, JPEG, GIF or WebP image.'); });
  try {
    const size = fittedSize(bitmap.width, bitmap.height);
    if (known && file.size <= IMAGE_ATTACHMENT_BYTES && size.width === bitmap.width) return file;
    let scale = 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(size.width * scale));
      canvas.height = Math.max(1, Math.round(size.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // Screenshots stay sharp as PNG; anything that is still too large becomes JPEG.
      if (file.type === 'image/png' || !known) {
        const png = await encode(canvas, 'image/png');
        if (png.size <= IMAGE_ATTACHMENT_BYTES) return png;
      }
      for (const quality of QUALITIES) {
        const jpeg = await encode(canvas, 'image/jpeg', quality);
        if (jpeg.size <= IMAGE_ATTACHMENT_BYTES) return jpeg;
      }
      scale *= 0.7;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('This image is too large to send.');
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This image could not be prepared.')), type, quality));
}

export async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
