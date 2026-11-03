import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider } from './app/connection';
import { App } from './app/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionProvider>
      <App />
    </ConnectionProvider>
  </StrictMode>,
);
