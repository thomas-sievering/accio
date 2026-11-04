import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider } from './app/connection';
import { App } from './app/App';
import './styles.css';

// Only the desktop app has native caption buttons to leave room for.
if (window.accioDesktop) document.documentElement.classList.add('desktop');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionProvider>
      <App />
    </ConnectionProvider>
  </StrictMode>,
);
