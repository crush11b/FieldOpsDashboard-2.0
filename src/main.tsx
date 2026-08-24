import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { RootErrorBoundary } from './RootErrorBoundary.tsx';

// Register Service Worker for offline Toughbook field deployment
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[FieldOps PWA] Service Worker registered for offline field ops:', reg.scope);
    }).catch((err) => {
      console.warn('[FieldOps PWA] SW registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </RootErrorBoundary>,
);
