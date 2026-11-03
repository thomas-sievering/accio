import { createContext, useContext } from 'react';

/** A request to show one transcript item: each fold holding it opens while it is pending. */
export type Reveal = { itemId: string; request: number };
export const RevealContext = createContext<Reveal | undefined>(undefined);
export const useReveal = () => useContext(RevealContext);
