// components/theme-toggle.tsx
// Light/dark switch. The chosen theme lives on <html data-theme> (applied
// pre-paint by the inline script in app/layout.tsx) and is remembered in
// localStorage.

'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

export const THEME_STORAGE_KEY = 'priceaura-theme'
const THEME_CHANGE_EVENT = 'priceaura:theme-change'

export function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'dark')

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // private mode — theme still applies for this page view
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  )
}
