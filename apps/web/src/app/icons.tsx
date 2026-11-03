const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const UpDown = () => (
  <svg {...base}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </svg>
);
export const Check = () => (
  <svg {...base}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const Plus = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Close = () => (
  <svg {...base}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const Users = () => (
  <svg {...base}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
export const Layers = () => (
  <svg {...base}>
    <path d="m12 2 10 5-10 5L2 7z" />
    <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
  </svg>
);
export const More = () => (
  <svg {...base}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
);
export const FolderPlus = () => (
  <svg {...base}>
    <path d="M12 10v6M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);
export const Chevron = () => (
  <svg {...base}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
export const ArrowUp = () => (
  <svg {...base} strokeWidth={2.4}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const StopSquare = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
