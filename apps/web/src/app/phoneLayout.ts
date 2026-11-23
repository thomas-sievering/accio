import { createContext, useContext, useSyncExternalStore } from 'react';

const PHONE_WIDTH = '(max-width: 600px)';

function subscribe(notify: () => void) {
  const query = matchMedia(PHONE_WIDTH);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

export function usePhoneLayout() {
  return useSyncExternalStore(subscribe, () => matchMedia(PHONE_WIDTH).matches);
}

export const PhoneMachine = createContext<string | undefined>(undefined);
export const usePhoneMachine = () => useContext(PhoneMachine);
