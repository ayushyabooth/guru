import { render, h } from 'preact';
import { Z_INDEX } from '../shared/constants';
import { isActivated, isLoading, overlayData, scrollProgress, error, chatMessages, conversationId, highlights } from './state';
import { fetchOverlayData, fetchChatHistory, fetchAnnotations } from './api-client';
import App from './components/App';
import { repaintStoredHighlights } from './components/SelectionMenu';

let shadowRoot: ShadowRoot | null = null;
let hostElement: HTMLDivElement | null = null;

function createShadowHost(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  hostElement = document.createElement('div');
  hostElement.id = 'guru-overlay-root';
  hostElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: ${Z_INDEX};
    pointer-events: none;
  `;

  shadowRoot = hostElement.attachShadow({ mode: 'closed' });

  // Inject base styles into shadow DOM
  const style = document.createElement('style');
  style.textContent = getBaseStyles();
  shadowRoot.appendChild(style);

  document.body.appendChild(hostElement);
  return shadowRoot;
}

function setupScrollTracking() {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        const maxScroll = scrollHeight - clientHeight;
        scrollProgress.value = maxScroll > 0 ? scrollTop / maxScroll : 0;
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

async function activate(articleId: string) {
  if (isActivated.value) return;

  console.log('[Guru] Starting activation for:', articleId);

  // Create Shadow DOM and mount Preact app first
  const root = createShadowHost();
  setupScrollTracking();
  const appContainer = document.createElement('div');
  appContainer.id = 'guru-app';
  root.appendChild(appContainer);
  render(h(App, {}), appContainer);
  console.log('[Guru] Preact app mounted in Shadow DOM');

  // Now set signals — Preact will re-render reactively
  isActivated.value = true;
  isLoading.value = true;
  error.value = null;

  try {
    console.log('[Guru] Fetching overlay data...');
    const data = await fetchOverlayData(articleId);
    console.log('[Guru] Overlay data received:', data.headline, '- annotations:', data.annotations?.length);
    overlayData.value = data;

    // Load chat history and user annotations from backend
    // These feed into Recap for weekly synthesis
    try {
      console.log('[Guru] Loading chat history and annotations for:', articleId);
      const [chatHistory, userAnnotations] = await Promise.all([
        fetchChatHistory(articleId),
        fetchAnnotations(articleId),
      ]);
      console.log('[Guru] Chat history:', chatHistory?.messages?.length || 0, 'messages. Annotations:', userAnnotations?.length || 0);
      if (chatHistory?.messages?.length > 0) {
        chatMessages.value = chatHistory.messages;
        conversationId.value = chatHistory.conversation_id || null;
      }
      if (userAnnotations?.length > 0) {
        highlights.value = userAnnotations.map((a: any) => ({
          id: a.id,
          text: a.highlighted_text,
          note: a.note_text || undefined,
          timestamp: new Date(a.created_at).toLocaleTimeString(),
        }));
        // Re-paint on-page <mark> highlights so they survive reloads (they were
        // only applied at selection time before). Defer a frame so the article
        // DOM is settled before we walk it.
        const texts = userAnnotations.map((a: any) => a.highlighted_text);
        requestAnimationFrame(() => repaintStoredHighlights(texts));
      }
    } catch (e) {
      console.error('[Guru] Could not load history:', e);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load overlay data';
    console.error('[Guru] Failed to activate:', e);
  } finally {
    isLoading.value = false;
  }
}

console.log('[Guru] Content script loaded on:', window.location.href);

// Auto-sync auth token from web app's localStorage when on the web app origin
// This enables zero-friction auth: user logs into web app, extension picks up the token
const isGuruWebApp = (window.location.hostname === 'localhost' && window.location.port === '8081') ||
  window.location.hostname === 'dist-guru8.vercel.app' ||
  window.location.hostname.endsWith('.vercel.app');
if (isGuruWebApp) {
  try {
    const webAppToken = localStorage.getItem('access_token') || localStorage.getItem('guru_access_token');
    if (webAppToken) {
      chrome.runtime.sendMessage({ type: 'SYNC_TOKEN', token: webAppToken });
      console.log('[Guru] Synced auth token from web app');
    }
  } catch (e) {
    console.log('[Guru] Could not read web app token:', e);
  }
}

// Listen for activation messages from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Guru] Received message:', message.type);
  if (message.type === 'ACTIVATE' && message.articleId) {
    console.log('[Guru] Activating for article:', message.articleId);
    activate(message.articleId);
    sendResponse({ ok: true });
  }
});

// On load, ask background to check if current URL is a known article
console.log('[Guru] Sending CHECK_URL to background...');
chrome.runtime.sendMessage(
  { type: 'CHECK_URL', url: window.location.href },
  (response) => {
    if (chrome.runtime.lastError) {
      console.log('[Guru] CHECK_URL error:', chrome.runtime.lastError.message);
      return;
    }
    console.log('[Guru] CHECK_URL response:', response);
    if (response?.article_id) {
      console.log('[Guru] Auto-activating for:', response.article_id);
      activate(response.article_id);
    }
  }
);

function getBaseStyles(): string {
  return `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    #guru-app {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1E293B;
      -webkit-font-smoothing: antialiased;
    }

    .guru-interactive {
      pointer-events: auto;
    }

    button {
      cursor: pointer;
      border: none;
      background: none;
      font: inherit;
      color: inherit;
    }

    button:focus-visible {
      outline: 2px solid #6366F1;
      outline-offset: 2px;
    }

    .guru-fab {
      position: fixed;
      bottom: 32px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      /* Liquid glass: translucent dark glass + blur + gradient border + glow,
         so the Guru triskelion mark reads as the brand on a glassy surface. */
      background: linear-gradient(145deg, rgba(30,38,60,0.74) 0%, rgba(15,20,35,0.64) 100%);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(10,14,23,0.45), 0 0 18px rgba(99,102,241,0.26), inset 0 1px 0 rgba(255,255,255,0.25);
      transition: transform 0.2s, box-shadow 0.2s, bottom 0.3s;
      pointer-events: auto;
      z-index: 10;
    }

    .guru-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 10px 28px rgba(10,14,23,0.5), 0 0 28px rgba(99,102,241,0.42), inset 0 1px 0 rgba(255,255,255,0.3);
    }

    .guru-fab-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #EF4444;
      color: white;
      font-size: 11px;
      font-weight: 700;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    .guru-rail {
      position: fixed;
      right: 4px;
      top: 80px;
      bottom: 100px;
      width: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: auto;
    }

    .guru-rail-dot {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .guru-rail-dot:hover {
      transform: scale(1.5);
    }

    .guru-scroll-indicator {
      position: absolute;
      width: 12px;
      height: 3px;
      background: rgba(99, 102, 241, 0.6);
      border-radius: 2px;
      transition: top 0.1s linear;
    }

    @keyframes guru-panel-slide-up {
      from {
        transform: translateY(100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .guru-panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      /* CX fix: constrain to a centered column so the sheet doesn't stretch the
         full desktop width (tabs + content were spreading edge-to-edge). */
      max-width: 760px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-top: 1px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.08);
      border-radius: 16px 16px 0 0;
      pointer-events: auto;
      transition: height 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: guru-panel-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .guru-panel-handle {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 8px 16px 4px;
      cursor: grab;
      position: relative;
    }

    .guru-panel-handle-bar {
      width: 36px;
      height: 4px;
      background: #CBD5E1;
      border-radius: 2px;
    }

    .guru-panel-close {
      position: absolute;
      right: 12px;
      top: 6px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #94A3B8;
      background: #F1F5F9;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
      pointer-events: auto;
    }

    .guru-panel-close:hover {
      background: #E2E8F0;
      color: #475569;
    }

    .guru-panel-tabs {
      display: flex;
      border-bottom: 1px solid #E2E8F0;
      padding: 0 16px;
    }

    .guru-panel-tab {
      flex: 1;
      padding: 10px 0;
      font-size: 13px;
      font-weight: 500;
      color: #94A3B8;
      text-align: center;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
    }

    .guru-panel-tab.active {
      color: #6366F1;
      border-bottom-color: #6366F1;
    }

    .guru-panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .guru-section {
      margin-bottom: 16px;
    }

    .guru-section-title {
      font-size: 14px;
      font-weight: 600;
      color: #1E293B;
      margin-bottom: 8px;
    }

    .guru-section-text {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
    }

    .guru-peek-card {
      position: fixed;
      right: 24px;
      max-width: 360px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(16px);
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      pointer-events: auto;
      cursor: pointer;
      transform: translateX(80px);
      opacity: 0;
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                  opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .guru-peek-card.visible {
      transform: translateX(0);
      opacity: 1;
    }

    .guru-peek-card-type {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .guru-peek-card-text {
      font-size: 13px;
      color: #475569;
      line-height: 1.5;
    }

    .guru-chat {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .guru-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .guru-chat-message {
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      max-width: 85%;
    }

    .guru-chat-message.user {
      background: #6366F1;
      color: white;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }

    .guru-chat-message.assistant {
      background: #F1F5F9;
      color: #1E293B;
      border-bottom-left-radius: 4px;
    }

    /* Formatted Guru responses (markdown → HTML) */
    .guru-md .guru-md-p { margin: 0 0 6px 0; line-height: 1.5; }
    .guru-md .guru-md-p:last-child { margin-bottom: 0; }
    .guru-md .guru-md-h { font-weight: 700; margin: 4px 0; line-height: 1.45; }
    .guru-md .guru-md-li { margin: 0 0 4px 2px; line-height: 1.5; }
    .guru-md strong { font-weight: 700; }
    .guru-md code { font-family: ui-monospace, monospace; background: rgba(15,23,42,0.06); padding: 0 4px; border-radius: 4px; font-size: 0.92em; }

    .guru-chat-input-row {
      display: flex;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid #E2E8F0;
    }

    .guru-chat-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      font-size: 14px;
      outline: none;
      pointer-events: auto;
    }

    .guru-chat-input:focus {
      border-color: #6366F1;
    }

    .guru-chat-send {
      padding: 10px 16px;
      background: #6366F1;
      color: white;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      pointer-events: auto;
    }

    .guru-chat-send:disabled {
      opacity: 0.5;
    }

    .guru-follow-up {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .guru-follow-up-chip {
      padding: 6px 12px;
      background: #EEF2FF;
      color: #6366F1;
      border-radius: 16px;
      font-size: 12px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s;
    }

    .guru-follow-up-chip:hover {
      background: #E0E7FF;
    }

    .guru-quotes-scroll {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .guru-quote-card {
      flex-shrink: 0;
      width: 200px;
      padding: 12px;
      background: #F8FAFC;
      border-radius: 8px;
      border-left: 3px solid #6366F1;
      font-size: 13px;
      font-style: italic;
      color: #475569;
      line-height: 1.4;
    }

    .guru-socratic-prompt {
      padding: 10px 14px;
      background: #FEF3C7;
      border-radius: 8px;
      font-size: 13px;
      color: #92400E;
      margin-bottom: 8px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s;
    }

    .guru-socratic-prompt:hover {
      background: #FDE68A;
    }

    .guru-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #94A3B8;
      font-size: 14px;
    }

    .guru-related-count {
      float: right;
      font-size: 12px;
      font-weight: 400;
      color: #94A3B8;
    }

    .guru-related-scroll {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .guru-related-card {
      flex-shrink: 0;
      width: 160px;
      border-radius: 8px;
      overflow: hidden;
      background: #F8FAFC;
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.2s;
    }

    .guru-related-card:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .guru-related-thumb {
      width: 100%;
      height: 90px;
      object-fit: cover;
      display: block;
    }

    .guru-related-title {
      padding: 8px 10px 4px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      color: #1E293B;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .guru-related-meta {
      padding: 0 10px 8px;
      font-size: 11px;
      color: #94A3B8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .guru-selection-menu {
      position: fixed;
      background: #1F2937;
      border-radius: 10px;
      display: flex;
      align-items: center;
      padding: 4px 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      z-index: 20;
      pointer-events: auto;
      gap: 2px;
    }

    .guru-sel-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 8px;
      border-radius: 6px;
      color: #E2E8F0;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      transition: background 0.15s;
    }

    .guru-sel-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .guru-sel-divider {
      width: 1px;
      height: 20px;
      background: rgba(255, 255, 255, 0.15);
      flex-shrink: 0;
    }

    .guru-note-input {
      flex: 1;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.1);
      color: #E2E8F0;
      font-size: 13px;
      outline: none;
      pointer-events: auto;
    }

    .guru-note-input::placeholder {
      color: #94A3B8;
    }

    .guru-note-save {
      padding: 6px 12px;
      background: #6366F1;
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      pointer-events: auto;
    }
  `;
}
