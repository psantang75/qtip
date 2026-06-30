import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Self-heal stale-deploy chunk errors: when a lazy-loaded build chunk can no
// longer be fetched (its hashed filename was replaced by a newer deploy), Vite
// fires `vite:preloadError`. Reload once to pull the current index.html + chunks.
// The 10s throttle prevents a reload loop during a genuine asset outage.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'qtip:lastChunkReload'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(KEY, String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
