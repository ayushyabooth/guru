import React, { useCallback, useRef, useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebViewMessageType =
  | 'TEXT_SELECTED'
  | 'SELECTION_CLEARED'
  | 'SCROLL_PROGRESS'
  | 'PAGE_LOADED'
  | 'PAGE_ERROR';

export interface WebViewMessage {
  type: WebViewMessageType;
  payload?: any;
}

interface TextSelectedPayload {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScrollProgressPayload {
  progress: number;
  scrollTop: number;
  docHeight: number;
}

interface PageLoadedPayload {
  title: string;
  wordCount: number;
  url: string;
}

export interface ArticleWebViewProps {
  url: string;
  onMessage?: (message: WebViewMessage) => void;
  onScroll?: (progress: number) => void;
  onLoadComplete?: () => void;
  onError?: (error: string) => void;
  highlightQuote?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOBILE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ---------------------------------------------------------------------------
// Injected JS – runs inside the WebView
// ---------------------------------------------------------------------------

const INJECTED_JS = `
(function() {
  // --- Text selection ---
  var lastSelection = '';

  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';

    if (text && text !== lastSelection) {
      lastSelection = text;
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'TEXT_SELECTED',
        payload: {
          text: text,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      }));
    } else if (!text && lastSelection) {
      lastSelection = '';
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'SELECTION_CLEARED'
      }));
    }
  });

  // --- Scroll progress (throttled via rAF) ---
  var scrollTicking = false;

  window.addEventListener('scroll', function() {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(function() {
        var scrollTop = window.scrollY || document.documentElement.scrollTop;
        var docHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ) - window.innerHeight;
        var progress = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SCROLL_PROGRESS',
          payload: { progress: progress, scrollTop: scrollTop, docHeight: docHeight }
        }));
        scrollTicking = false;
      });
    }
  }, { passive: true });

  // --- Page loaded ---
  window.addEventListener('load', function() {
    var bodyText = document.body.innerText || '';
    var wordCount = bodyText.split(/\\s+/).filter(Boolean).length;

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'PAGE_LOADED',
      payload: {
        title: document.title,
        wordCount: wordCount,
        url: window.location.href
      }
    }));
  });

  true; // required by react-native-webview
})();
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Web (iframe) implementation
// ---------------------------------------------------------------------------

function WebIframeView({ url, onMessage, onScroll, onLoadComplete, onError, highlightQuote }: ArticleWebViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [iframeBlocked, setIframeBlocked] = useState(false);

  useEffect(() => {
    function handleWindowMessage(event: MessageEvent) {
      try {
        const message: WebViewMessage = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!message.type) return;
        onMessage?.(message);
        if (message.type === 'SCROLL_PROGRESS') {
          onScroll?.((message.payload as ScrollProgressPayload).progress);
        } else if (message.type === 'PAGE_LOADED') {
          onLoadComplete?.();
        }
      } catch {
        // Ignore non-JSON messages
      }
    }
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onMessage, onScroll, onLoadComplete]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    // Detect X-Frame-Options blocking: iframe loads but content is inaccessible.
    // After a short delay, check if the iframe body is empty (blocked by CORS).
    setTimeout(() => {
      try {
        const doc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
        // If we can't access the document or it has no body content, it's likely blocked
        if (!doc || !doc.body || doc.body.innerHTML.length < 50) {
          setIframeBlocked(true);
        }
      } catch {
        // Cross-origin access denied = iframe is loading content (good) or blocked
        // Can't distinguish, so check if the iframe appears blank after 2s
        setTimeout(() => setIframeBlocked(true), 1500);
      }
    }, 500);
    onLoadComplete?.();
    onMessage?.({ type: 'PAGE_LOADED', payload: { title: '', wordCount: 0, url } });
  }, [onLoadComplete, onMessage, url]);

  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef}
        src={url}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: 'none',
          backgroundColor: '#fff',
          display: iframeBlocked ? 'none' : 'block',
        } as any}
        onLoad={handleIframeLoad}
        onError={() => { setIframeBlocked(true); onError?.('Failed to load article'); }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        title="Article"
      />
      {iframeBlocked && (
        <View style={styles.blockedContainer}>
          <View style={styles.blockedCard}>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1E293B', textAlign: 'center' as const, marginBottom: 8 }}>
              This article can't be displayed inline
            </div>
            <div style={{ fontSize: 14, color: '#64748B', textAlign: 'center' as const, lineHeight: '20px', marginBottom: 20 }}>
              {domain} doesn't allow embedding. Tap below to read the original article, or use the Guru panel for summaries and insights.
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 15, fontWeight: 600, color: '#6366F1', textDecoration: 'none', padding: '10px 20px' }}
            >
              Read on {domain} ↗
            </a>
          </View>
        </View>
      )}
      {loading && !iframeBlocked && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Native (react-native-webview) implementation
// ---------------------------------------------------------------------------

function NativeWebViewImpl(
  { url, onMessage, onScroll, onLoadComplete, onError, highlightQuote }: ArticleWebViewProps,
  ref: React.Ref<WebView>,
) {
  const [loading, setLoading] = useState(true);
  const internalRef = useRef<WebView>(null);
  const webViewRef = (ref as React.RefObject<WebView>) ?? internalRef;

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message: WebViewMessage = JSON.parse(event.nativeEvent.data);
        onMessage?.(message);

        switch (message.type) {
          case 'SCROLL_PROGRESS':
            onScroll?.((message.payload as ScrollProgressPayload).progress);
            break;
          case 'PAGE_LOADED':
            onLoadComplete?.();
            if (highlightQuote && webViewRef.current) {
              const escaped = highlightQuote
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\n/g, ' ');
              webViewRef.current.injectJavaScript(`window.find('${escaped}'); true;`);
            }
            break;
          case 'PAGE_ERROR':
            onError?.(message.payload?.message ?? 'Unknown page error');
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [onMessage, onScroll, onLoadComplete, onError, highlightQuote, webViewRef],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        userAgent={MOBILE_SAFARI_UA}
        injectedJavaScript={INJECTED_JS}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        onMessage={handleMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          const { description } = syntheticEvent.nativeEvent;
          onError?.(description ?? 'WebView load error');
        }}
        onHttpError={(syntheticEvent) => {
          const { statusCode, url: errorUrl } = syntheticEvent.nativeEvent;
          onError?.(`HTTP ${statusCode} for ${errorUrl}`);
        }}
      />
      {loading && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      )}
    </View>
  );
}

const NativeWebView = React.forwardRef<WebView, ArticleWebViewProps>(NativeWebViewImpl);

// ---------------------------------------------------------------------------
// Platform-adaptive export
// ---------------------------------------------------------------------------

const ArticleWebView = React.forwardRef<any, ArticleWebViewProps>(
  (props, ref) => {
    if (Platform.OS === 'web') {
      return <WebIframeView {...props} />;
    }
    return <NativeWebView {...props} ref={ref} />;
  },
);

ArticleWebView.displayName = 'ArticleWebView';
export default ArticleWebView;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  blockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F8FAFC',
  },
  blockedCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  blockedTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1E293B',
    textAlign: 'center',
    marginBottom: 8,
  },
  blockedSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  openLink: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6366F1',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
});
