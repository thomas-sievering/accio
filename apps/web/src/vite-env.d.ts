/// <reference types="vite/client" />

interface Window {
  /** Present only inside the desktop app (apps/desktop/preload.cjs). */
  accioDesktop?: {
    pickFolder(): Promise<string | null>;
  };
}
