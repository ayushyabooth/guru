import { Platform } from 'react-native';

/**
 * Open a URL in a new browser tab, reliably, from within a click handler.
 *
 * `window.open(url, '_blank')` is fragile when the same handler also performs an
 * SPA navigation (router.push): some browsers treat the combination as a
 * navigation-triggered popup and block it, so the source tab silently fails to
 * open (the user then has to hit a separate "Reopen" button). A synthetic
 * anchor click with target="_blank" is handled by the browser's native
 * link-opening path — which is always honored for a user-initiated click and is
 * not cancelled by a subsequent pushState — so it survives the navigation.
 *
 * Returns true if a tab was (attempted to be) opened. No-op off web.
 */
export function openExternalTab(url?: string | null): boolean {
  if (Platform.OS !== 'web' || !url) return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    // Last-ditch fallback.
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }
}
