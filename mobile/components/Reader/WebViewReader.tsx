import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, Modal, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

import ArticleWebView, { WebViewMessage } from './ArticleWebView';
import GuruOverlayPanel from './GuruOverlayPanel';
import GuruFAB from './GuruFAB';
import WebViewToolbar from './WebViewToolbar';
import WebViewSelectionMenu, { SelectionData } from './WebViewSelectionMenu';
import AnnotationRail from './AnnotationRail';
import PeekCard from './PeekCard';
import { SocraticChat } from './SocraticChat';
import { getFilterColors, AnnotationColors } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Annotation {
  id: string;
  type: string;
  text: string;
  position_after_section: number;
  generated_by: string;
}

export interface OverlayArticleData {
  id: string;
  headline: string;
  author?: string;
  publishDate?: string;
  source: string;
  url: string;
  thumbnailUrl?: string;
  wordCount: number;
  isPaywalled: boolean;
  expertFlags: number;
  annotations: Annotation[];
  richContent?: {
    summary_whats_in?: string;
    summary_why_matters?: string;
    summary_between_lines?: string;
    spotlight_quotes?: string[];
    socratic_prompts?: string[];
  };
  relatedArticles: Array<{
    id: string;
    title: string;
    source: string;
    url?: string;
    thumbnail_url?: string;
    word_count?: number;
  }>;
  industry?: string;
  clusterTheme?: string;
  totalSections: number;
}

interface WebViewReaderProps {
  article: OverlayArticleData;
  highlightQuote?: string;
  onSave: (articleId: string) => Promise<void>;
  onUnsave: (articleId: string) => Promise<void>;
  onBack: () => void;
  onRelatedArticleClick: (articleId: string) => void;
  isSaved: boolean;
}

export interface Highlight {
  id: string;
  text: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WebViewReader({
  article,
  highlightQuote,
  onSave,
  onUnsave,
  onBack,
  onRelatedArticleClick,
  isSaved,
}: WebViewReaderProps) {
  const webViewRef = useRef<WebView>(null);
  const { colors } = useTheme();

  // -- State ----------------------------------------------------------------
  const [scrollProgress, setScrollProgress] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [selection, setSelection] = useState<SelectionData | null>(null);
  const [activePeekCard, setActivePeekCard] = useState<Annotation | null>(null);
  const [seenPeekCards, setSeenPeekCards] = useState<Set<string>>(new Set());
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showSocraticChat, setShowSocraticChat] = useState(false);
  const [socraticInitialQuestion, setSocraticInitialQuestion] = useState('');

  // -- Derived values -------------------------------------------------------
  const accentColor = useMemo(() => {
    if (!article.industry) return '#6366F1';
    const colors = getFilterColors(article.industry);
    return colors?.accent ?? '#6366F1';
  }, [article.industry]);

  // -- Peek card triggering based on scroll progress ------------------------
  useEffect(() => {
    if (overlayVisible || article.totalSections === 0) return;

    // Dismiss active peek card if user scrolls >15% away
    if (activePeekCard) {
      const activePos = activePeekCard.position_after_section / article.totalSections;
      if (Math.abs(scrollProgress - activePos) > 0.15) {
        setActivePeekCard(null);
      }
    }

    for (const ann of article.annotations) {
      if (seenPeekCards.has(ann.id)) continue;

      const threshold = ann.position_after_section / article.totalSections;
      // Show peek card when scroll crosses the annotation position
      if (scrollProgress >= threshold - 0.02 && scrollProgress <= threshold + 0.05) {
        setActivePeekCard(ann);
        setSeenPeekCards((prev) => new Set(prev).add(ann.id));
        break; // one at a time
      }
    }
  }, [scrollProgress, article.annotations, article.totalSections, overlayVisible, seenPeekCards, activePeekCard]);

  // -- WebView message handler ----------------------------------------------
  const handleWebViewMessage = useCallback((message: WebViewMessage) => {
    switch (message.type) {
      case 'SCROLL_PROGRESS':
        setScrollProgress(message.payload?.progress ?? 0);
        // Clear selection on scroll
        setSelection(null);
        break;

      case 'TEXT_SELECTED':
        setSelection({
          text: message.payload?.text ?? '',
          x: message.payload?.x ?? 0,
          y: message.payload?.y ?? 0,
        });
        break;

      case 'SELECTION_CLEARED':
        setSelection(null);
        break;

      case 'PAGE_LOADED':
        // On web, many publishers block iframes. Auto-open the overlay panel
        // after a short delay so users see the Guru content even if the article
        // doesn't render in the iframe.
        if (Platform.OS === 'web') {
          setTimeout(() => setOverlayVisible(true), 2000);
        }
        break;

      case 'PAGE_ERROR':
        // Could show an error banner
        break;
    }
  }, []);

  // -- Overlay toggle -------------------------------------------------------
  const toggleOverlay = useCallback(() => {
    setOverlayVisible((v) => !v);
    // Dismiss peek card when overlay opens
    setActivePeekCard(null);
  }, []);

  // -- Annotation dot tap ---------------------------------------------------
  const handleAnnotationDotTap = useCallback((annotation: Annotation) => {
    setActivePeekCard(annotation);
    setSeenPeekCards((prev) => new Set(prev).add(annotation.id));
    // Also scroll the article to the annotation's position
    if (article.totalSections > 0) {
      const ratio = annotation.position_after_section / article.totalSections;
      scrollWebViewToPosition(ratio);
    }
  }, [article.totalSections, scrollWebViewToPosition]);

  // -- Peek card interactions -----------------------------------------------
  const handlePeekCardTap = useCallback((_annotation: Annotation) => {
    setActivePeekCard(null);
    setOverlayVisible(true);
  }, []);

  const handlePeekCardDismiss = useCallback(() => {
    setActivePeekCard(null);
  }, []);

  // -- Selection menu actions -----------------------------------------------
  const handleHighlight = useCallback((text: string) => {
    const newHighlight: Highlight = {
      id: `hl_${Date.now()}`,
      text,
      createdAt: Date.now(),
    };
    setHighlights((prev) => [...prev, newHighlight]);
    setSelection(null);
  }, []);

  const handleNote = useCallback((text: string) => {
    // For now, treat as highlight; notes UI can be added later
    handleHighlight(text);
  }, [handleHighlight]);

  const handleAskGuru = useCallback((text: string) => {
    setSocraticInitialQuestion(`Tell me more about: "${text}"`);
    setShowSocraticChat(true);
    setSelection(null);
  }, []);

  // -- Socratic chat --------------------------------------------------------
  const openSocraticChat = useCallback((prompt?: string) => {
    setSocraticInitialQuestion(prompt ?? '');
    setShowSocraticChat(true);
  }, []);

  const closeSocraticChat = useCallback(() => {
    setShowSocraticChat(false);
    setSocraticInitialQuestion('');
  }, []);

  // -- Scroll WebView to annotation position --------------------------------
  const scrollWebViewToPosition = useCallback(
    (positionRatio: number) => {
      if (!webViewRef.current) return;
      const js = `
        (function() {
          var docHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          var target = docHeight * ${positionRatio};
          window.scrollTo({ top: target, behavior: 'smooth' });
          true;
        })();
      `;
      webViewRef.current.injectJavaScript(js);
    },
    [],
  );

  // -- Save/unsave wrappers -------------------------------------------------
  const handleSave = useCallback(() => {
    onSave(article.id);
  }, [onSave, article.id]);

  const handleUnsave = useCallback(() => {
    onUnsave(article.id);
  }, [onUnsave, article.id]);

  // -- Render ---------------------------------------------------------------
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* WebView takes full screen */}
      <ArticleWebView
        url={article.url}
        highlightQuote={highlightQuote}
        onMessage={handleWebViewMessage}
        ref={webViewRef}
      />

      {/* Toolbar overlaid on top */}
      <WebViewToolbar
        onBack={onBack}
        progress={scrollProgress}
        source={article.source}
        isSaved={isSaved}
        onSave={handleSave}
        onUnsave={handleUnsave}
      />

      {/* Annotation Rail on right edge */}
      <AnnotationRail
        annotations={article.annotations}
        totalSections={article.totalSections}
        scrollProgress={scrollProgress}
        onDotTap={handleAnnotationDotTap}
      />

      {/* Peek Card (conditionally visible) */}
      {activePeekCard && (
        <PeekCard
          annotation={activePeekCard}
          onTap={handlePeekCardTap}
          onDismiss={handlePeekCardDismiss}
        />
      )}

      {/* FAB to toggle overlay */}
      <GuruFAB
        annotationCount={article.annotations.length}
        onPress={toggleOverlay}
        visible={true}
      />

      {/* Overlay Panel */}
      <GuruOverlayPanel
        visible={overlayVisible}
        onClose={toggleOverlay}
        richContent={article.richContent}
        annotations={article.annotations}
        totalSections={article.totalSections}
        articleId={article.id}
        articleTitle={article.headline}
        highlights={highlights}
        relatedArticles={article.relatedArticles}
        onExploreWithGuru={openSocraticChat}
        onAnnotationPositionTap={scrollWebViewToPosition}
        onRelatedArticleClick={onRelatedArticleClick}
        accentColor={accentColor}
      />

      {/* Selection Menu (conditionally visible) */}
      {selection && (
        <WebViewSelectionMenu
          selection={selection}
          onHighlight={handleHighlight}
          onNote={handleNote}
          onAskGuru={handleAskGuru}
        />
      )}

      {/* Socratic Chat Modal */}
      <Modal
        visible={showSocraticChat}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSocraticChat}
      >
        <SocraticChat
          articleId={article.id}
          articleTitle={article.headline}
          articleSource={article.source}
          initialQuestion={socraticInitialQuestion}
          onClose={closeSocraticChat}
        />
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
