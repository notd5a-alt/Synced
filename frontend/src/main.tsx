import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// Diagnostic error collection — read by Tauri's health check to display on black-screen failures
declare global {
  interface Window { __syncedDiagErrors?: string[] }
}
window.__syncedDiagErrors = [];

// Global error handler — catches errors that happen before or outside React
// (e.g. WASM load failures, import errors, GPU-related crashes).
window.addEventListener('error', (e) => {
  window.__syncedDiagErrors?.push(e.message || String(e));
  const root = document.getElementById('root');
  if (root && root.children.length === 0) {
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-family:monospace;gap:16px;padding:24px;text-align:center">
        <h1 style="font-size:2rem;margin:0">STARTUP ERROR</h1>
        <p style="color:rgba(255,255,255,0.5);font-size:0.875rem;max-width:600px;word-break:break-word">${e.message || 'An unexpected error occurred during startup.'}</p>
        <button onclick="location.reload()" style="padding:8px 24px;border:1px solid #fff;background:transparent;color:#fff;cursor:pointer;font-family:monospace;font-size:0.875rem;text-transform:uppercase;letter-spacing:0.05em">[ RELOAD ]</button>
      </div>
    `;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  window.__syncedDiagErrors?.push('Promise: ' + msg);
  console.error('Unhandled promise rejection:', e.reason);
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
