import { API_BASE_URL } from '../shared/constants';
import { getValidToken, setStoredToken } from '../shared/auth';
import type { ByUrlResponse, ExtensionMessage } from '../shared/types';

// Cache of known article URLs to avoid repeated API calls
const urlCache = new Map<string, { articleId: string; headline: string; source: string } | null>();

async function lookupArticleByUrl(url: string): Promise<ByUrlResponse | null> {
  // Check cache first
  const cached = urlCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const encodedUrl = encodeURIComponent(url);
    // URL lookup only returns metadata (article_id, headline, source) — no auth required
    const token = await getValidToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    console.log('[Guru] Checking URL:', url);
    const res = await fetch(`${API_BASE_URL}/reader/articles/by-url?url=${encodedUrl}`, { headers });

    if (res.status === 404) {
      urlCache.set(url, null);
      return null;
    }

    if (!res.ok) {
      console.warn('[Guru] URL lookup returned', res.status);
      return null;
    }

    const data: ByUrlResponse = await res.json();
    console.log('[Guru] Match found:', data.headline);
    urlCache.set(url, data);
    return data;
  } catch (e) {
    console.error('[Guru] URL lookup failed:', e);
    return null;
  }
}

// Handle messages from the web app (externally connectable)
chrome.runtime.onMessageExternal.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === 'ACTIVATE') {
      // Web app says "user clicked Dive In on this article"
      // Forward to content script on the tab that matches the URL
      chrome.tabs.query({ url: message.url + '*' }, (tabs) => {
        if (tabs.length > 0 && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ACTIVATE',
            articleId: message.articleId,
            url: message.url,
          });
        }
      });
      sendResponse({ ok: true });
    } else if (message.type === 'AUTH_TOKEN') {
      // Web app sharing its auth token
      setStoredToken(message.token).then(() => {
        sendResponse({ ok: true });
      });
      return true; // Keep channel open for async response
    }
  }
);

// Handle messages from content scripts
chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse) => {
    if (message.type === 'CHECK_URL') {
      lookupArticleByUrl(message.url).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.type === 'SYNC_TOKEN') {
      setStoredToken(message.token).then(() => {
        console.log('[Guru] Token synced from web app');
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === 'FETCH_OVERLAY') {
      // Content script can't fetch from localhost due to CORS/network restrictions
      // Background service worker has full network access
      (async () => {
        try {
          const token = await getValidToken();
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE_URL}/reader/articles/${message.articleId}/overlay`, { headers });
          if (!res.ok) {
            sendResponse({ error: `HTTP ${res.status}` });
            return;
          }
          const data = await res.json();
          sendResponse({ data });
        } catch (e: any) {
          sendResponse({ error: e.message || 'Fetch failed' });
        }
      })();
      return true;
    }

    if (message.type === 'FETCH_CHAT') {
      (async () => {
        try {
          const token = await getValidToken();
          console.log('[Guru] Chat request — token:', token ? 'present' : 'MISSING', 'article_id:', message.payload?.article_id);
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE_URL}/socratic/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify(message.payload),
          });
          console.log('[Guru] Chat response status:', res.status);
          if (!res.ok) {
            const errorBody = await res.text();
            console.error('[Guru] Chat error body:', errorBody);
            sendResponse({ error: `HTTP ${res.status}: ${errorBody}` });
            return;
          }
          const data = await res.json();
          sendResponse({ data });
        } catch (e: any) {
          console.error('[Guru] Chat fetch failed:', e);
          sendResponse({ error: e.message || 'Fetch failed' });
        }
      })();
      return true;
    }

    if (message.type === 'FETCH_CHAT_HISTORY') {
      (async () => {
        try {
          const token = await getValidToken();
          console.log('[Guru] Fetching chat history — token:', token ? 'present' : 'MISSING');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE_URL}/socratic/history/${message.articleId}`, { headers });
          console.log('[Guru] Chat history response:', res.status);
          if (!res.ok) {
            const body = await res.text();
            console.error('[Guru] Chat history error:', body);
            sendResponse({ data: { messages: [], conversation_id: '' } });
            return;
          }
          const data = await res.json();
          console.log('[Guru] Chat history loaded:', data.messages?.length, 'messages');
          sendResponse({ data });
        } catch (e) {
          console.error('[Guru] Chat history fetch failed:', e);
          sendResponse({ data: { messages: [], conversation_id: '' } });
        }
      })();
      return true;
    }

    if (message.type === 'FETCH_ANNOTATIONS') {
      (async () => {
        try {
          const token = await getValidToken();
          console.log('[Guru] Fetching annotations — token:', token ? 'present' : 'MISSING');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE_URL}/articles/${message.articleId}/annotations`, { headers });
          console.log('[Guru] Annotations response:', res.status);
          if (!res.ok) {
            const body = await res.text();
            console.error('[Guru] Annotations error:', body);
            sendResponse({ data: [] });
            return;
          }
          const data = await res.json();
          console.log('[Guru] Annotations loaded:', data?.length, 'items');
          sendResponse({ data });
        } catch (e) {
          console.error('[Guru] Annotations fetch failed:', e);
          sendResponse({ data: [] });
        }
      })();
      return true;
    }

    if (message.type === 'CREATE_ANNOTATION') {
      (async () => {
        try {
          const token = await getValidToken();
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE_URL}/articles/${message.articleId}/annotations`, {
            method: 'POST',
            headers,
            body: JSON.stringify(message.payload),
          });
          if (!res.ok) {
            sendResponse({ error: `HTTP ${res.status}` });
            return;
          }
          const data = await res.json();
          sendResponse({ data });
        } catch (e: any) {
          sendResponse({ error: e.message || 'Annotation save failed' });
        }
      })();
      return true;
    }
  }
);

// Listen for tab URL changes to detect article navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Skip internal/extension URLs
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    // Check if this URL is a known article
    lookupArticleByUrl(tab.url).then((result) => {
      if (result) {
        chrome.tabs.sendMessage(tabId, {
          type: 'ACTIVATE',
          articleId: result.article_id,
          url: tab.url,
        });
      }
    });
  }
});

// Clear URL cache periodically (every 30 minutes)
setInterval(() => urlCache.clear(), 30 * 60 * 1000);
