/// <reference types="vite/client" />

interface Window {
  /** Present only inside the desktop app (apps/desktop/preload.cjs). */
  accioDesktop?: {
    /** Origin of the local server started by this desktop instance. */
    serverOrigin?: string;
    pickFolder(): Promise<string | null>;
    openFolder(path: string): Promise<void>;
  };
}
