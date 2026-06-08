import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { EXTENSION_PRESENCE_ATTR, EXTENSION_READY_EVENT } from '../constants/extension';

export type ExtensionStatus = 'checking' | 'installed' | 'not-installed' | 'n/a';

/** Chromium-based browser (Chrome/Edge/Brave/Opera) — the only place the
 *  extension can run. Excludes Firefox/Safari. */
export function isChromiumBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Chrome|Chromium|Edg|OPR/.test(ua) && !/Firefox/.test(ua);
}

function markerPresent(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.documentElement?.dataset?.[EXTENSION_PRESENCE_ATTR];
}

/**
 * Detect whether the Guru Chrome extension is installed (GUR-227). The
 * extension stamps `data-guru-extension` on <html> and fires a ready event on
 * every page; since its content script injects at document_idle, we poll
 * briefly before concluding it's absent. Returns 'n/a' off web.
 */
export function useExtensionInstalled(): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>(
    Platform.OS === 'web' ? 'checking' : 'n/a',
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let settled = false;
    const finish = (s: ExtensionStatus) => {
      if (!settled) { settled = true; setStatus(s); }
    };

    if (markerPresent()) { finish('installed'); return; }

    const onReady = () => finish('installed');
    window.addEventListener(EXTENSION_READY_EVENT, onReady as EventListener);

    let tries = 0;
    const iv = setInterval(() => {
      if (markerPresent()) { clearInterval(iv); finish('installed'); }
      else if (++tries >= 8) { clearInterval(iv); finish('not-installed'); } // ~3.2s grace
    }, 400);

    return () => {
      window.removeEventListener(EXTENSION_READY_EVENT, onReady as EventListener);
      clearInterval(iv);
    };
  }, []);

  return status;
}
