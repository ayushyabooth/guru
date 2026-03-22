import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebViewReader, { OverlayArticleData } from '../../components/Reader/WebViewReader';
import { RelatedArticle } from '../../components/Reader/RelatedArticles';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { CatchupService } from '../../services/article-service';
import { useTimeTracking } from '../../hooks/useTimeTracking';

// Reading history stack stored in sessionStorage
const getReadingHistory = (): string[] => {
  try {
    const history = sessionStorage.getItem('guru_reading_history');
    return history ? JSON.parse(history) : [];
  } catch {
    return [];
  }
};

const setReadingHistory = (history: string[]) => {
  try {
    sessionStorage.setItem('guru_reading_history', JSON.stringify(history));
  } catch {}
};

const getCurrentContext = (): string => {
  try {
    return sessionStorage.getItem('guru_current_context') || 'finance';
  } catch {
    return 'finance';
  }
};

const setCurrentContext = (context: string) => {
  try {
    sessionStorage.setItem('guru_current_context', context);
  } catch {}
};

const getSourceTab = (): string => {
  try {
    return sessionStorage.getItem('guru_article_source') || 'divein';
  } catch {
    return 'divein';
  }
};

const setSourceTabStorage = (source: string) => {
  try {
    sessionStorage.setItem('guru_article_source', source);
  } catch {}
};

// Chrome extension ID for web app → extension messaging
const EXTENSION_ID = ''; // Set after publishing or during dev

export default function ArticleDetailScreen() {
  const { id, highlightQuote, source } = useLocalSearchParams();
  const router = useRouter();
  const [overlayArticle, setOverlayArticle] = useState<OverlayArticleData | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readingHistory, setReadingHistoryState] = useState<string[]>(getReadingHistory());
  const [readingTime, setReadingTime] = useState(0);
  const [activeTab, setActiveTab] = useState(0);

  // Track which feed tab opened this article
  const [sourceTab] = useState<string>(() => {
    const s = typeof source === 'string' ? source : '';
    if (s === 'catchup' || s === 'divein') {
      setSourceTabStorage(s);
      return s;
    }
    return getSourceTab();
  });

  // Track reading time — attributes to correct ring (catchup/divein)
  const articleId = typeof id === 'string' ? id : undefined;
  const { logTime } = useTimeTracking(sourceTab || 'divein', {
    interval: 60000,
    contextId: articleId,
    activityType: 'article',
  });

  // Reading timer for web reading state
  useEffect(() => {
    if (Platform.OS !== 'web' || !overlayArticle) return;
    const interval = setInterval(() => {
      setReadingTime(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [overlayArticle]);

  // Signal Chrome extension when article data is ready (if installed)
  useEffect(() => {
    if (Platform.OS === 'web' && overlayArticle?.url) {
      try {
        if (EXTENSION_ID && (window as any).chrome?.runtime?.sendMessage) {
          (window as any).chrome.runtime.sendMessage(EXTENSION_ID, {
            type: 'ACTIVATE',
            articleId: overlayArticle.id,
            url: overlayArticle.url,
          });
        }
      } catch {}
    }
  }, [overlayArticle]);

  useEffect(() => {
    if (id) fetchOverlayArticle();
  }, [id]);

  const fetchOverlayArticle = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Please log in to view articles');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/reader/articles/${id}/overlay`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOverlayArticle({
          id: data.id || String(id),
          headline: data.headline || 'Untitled Article',
          author: data.author,
          publishDate: data.publish_date,
          source: data.source || 'Unknown Source',
          url: data.url,
          thumbnailUrl: data.thumbnail_url,
          wordCount: data.word_count || 0,
          isPaywalled: data.is_paywalled || false,
          expertFlags: data.expert_flags || 0,
          annotations: data.annotations || [],
          richContent: data.rich_content || undefined,
          relatedArticles: data.related_articles || [],
          industry: data.industry,
          clusterTheme: data.cluster_theme,
          totalSections: data.total_sections || 0,
        });
        setIsSaved(false);
      } else {
        setError(`Failed to load article: ${response.status}`);
      }
    } catch (err) {
      setError('Failed to load article');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (artId: string) => {
    await CatchupService.saveArticle(artId);
  };

  const handleUnsave = async (artId: string) => {
    await CatchupService.unsaveArticle(artId);
  };

  const handleRelatedArticleClick = (relatedArticle: RelatedArticle | string) => {
    const newHistory = [...readingHistory, String(id)];
    setReadingHistory(newHistory);
    setReadingHistoryState(newHistory);
    const relatedId = typeof relatedArticle === 'string' ? relatedArticle : relatedArticle.id;
    if (typeof relatedArticle !== 'string' && relatedArticle.context) {
      setCurrentContext(relatedArticle.context);
    }
    router.push(`/article/${relatedId}`);
  };

  const handleBack = () => {
    if (readingHistory.length > 0) {
      const newHistory = [...readingHistory];
      const previousArticleId = newHistory.pop();
      setReadingHistory(newHistory);
      setReadingHistoryState(newHistory);
      if (previousArticleId) {
        router.push(`/article/${previousArticleId}`);
        return;
      }
    }
    const feedPath = sourceTab === 'catchup' ? '/catchup' : '/divein';
    router.replace(feedPath);
  };

  const handleBackToFeed = () => {
    setReadingHistory([]);
    setReadingHistoryState([]);
    const feedPath = sourceTab === 'catchup' ? '/catchup' : '/divein';
    router.replace(feedPath);
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#32b0c6" />
        <Text style={styles.loadingText}>Loading article...</Text>
      </View>
    );
  }

  // Error state
  if (error || !overlayArticle) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Article not found'}</Text>
      </View>
    );
  }

  // --- Native: WebView + Overlay Reader ---
  if (Platform.OS !== 'web') {
    return (
      <WebViewReader
        article={overlayArticle}
        highlightQuote={typeof highlightQuote === 'string' ? highlightQuote : undefined}
        onSave={handleSave}
        onUnsave={handleUnsave}
        onBack={handleBack}
        onRelatedArticleClick={(artId: string) => handleRelatedArticleClick(artId)}
        isSaved={isSaved}
      />
    );
  }

  // --- Web: Reading State Page ---
  // Article is open in a new tab. This page shows timer + Guru content.
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const rc = overlayArticle.richContent;
  const TAB_NAMES = ['Summary', 'Insights', 'Notes', 'Ask Guru'];

  return (
    <View style={styles.webReadingContainer}>
      {/* Header */}
      <View style={styles.webHeader}>
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.webBackText}>← Back to Feed</Text>
        </TouchableOpacity>
      </View>

      {/* Article opened banner */}
      <View style={styles.webArticleBanner}>
        <Text style={styles.webBannerText}>
          The article has opened in a new tab. Read it there, then come back here for Guru insights, notes, and Q&A.
        </Text>
        <TouchableOpacity
          style={styles.webBannerBtn}
          onPress={() => window.open(overlayArticle.url, '_blank')}
        >
          <Text style={styles.webBannerBtnText}>Reopen Article Tab ↗</Text>
        </TouchableOpacity>
      </View>

      {/* Reading state indicator */}
      <View style={styles.webReadingState}>
        <Text style={styles.webReadingIcon}>📖</Text>
        <Text style={styles.webReadingTitle} numberOfLines={2}>
          {overlayArticle.headline}
        </Text>
        <Text style={styles.webReadingMeta}>
          {overlayArticle.source}  •  ⏱ {formatTime(readingTime)}
        </Text>
      </View>

      {/* Tab bar */}
      <View style={styles.webTabBar}>
        {TAB_NAMES.map((name, i) => (
          <TouchableOpacity
            key={name}
            style={[styles.webTab, activeTab === i && styles.webTabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.webTabText, activeTab === i && styles.webTabTextActive]}>
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView style={styles.webContent} contentContainerStyle={styles.webContentInner}>
        {activeTab === 0 && rc && (
          <>
            {rc.summary_whats_in && (
              <View style={styles.webSection}>
                <Text style={styles.webSectionTitle}>What's in the article</Text>
                <Text style={styles.webSectionText}>{rc.summary_whats_in}</Text>
              </View>
            )}
            {rc.summary_why_matters && (
              <View style={styles.webSection}>
                <Text style={styles.webSectionTitle}>Why it matters</Text>
                <Text style={styles.webSectionText}>{rc.summary_why_matters}</Text>
              </View>
            )}
            {rc.summary_between_lines && (
              <View style={styles.webSection}>
                <Text style={styles.webSectionTitle}>Between the lines</Text>
                <Text style={styles.webSectionText}>{rc.summary_between_lines}</Text>
              </View>
            )}
            {rc.spotlight_quotes && rc.spotlight_quotes.length > 0 && (
              <View style={styles.webSection}>
                <Text style={styles.webSectionTitle}>Spotlight Quotes</Text>
                {rc.spotlight_quotes.map((q, i) => (
                  <View key={i} style={styles.webQuoteCard}>
                    <Text style={styles.webQuoteText}>{q}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {activeTab === 1 && overlayArticle.annotations.length > 0 && (
          <>
            {overlayArticle.annotations.map((ann) => (
              <View key={ann.id} style={styles.webAnnotationCard}>
                <Text style={styles.webAnnotationType}>{ann.type}</Text>
                <Text style={styles.webSectionText}>{ann.text}</Text>
              </View>
            ))}
          </>
        )}

        {activeTab === 2 && (
          <View style={styles.webEmptyState}>
            <Text style={styles.webEmptyText}>No notes yet.</Text>
            <Text style={styles.webEmptySubtext}>
              Install the Guru Chrome extension to highlight text and take notes directly on articles.
            </Text>
          </View>
        )}

        {activeTab === 3 && (
          <View style={styles.webEmptyState}>
            <Text style={styles.webEmptyText}>Ask Guru is available with the Chrome extension.</Text>
            <Text style={styles.webEmptySubtext}>
              The extension lets you ask questions about this article directly on the page.
            </Text>
            {rc?.socratic_prompts && rc.socratic_prompts.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.webSectionTitle}>Think about it</Text>
                {rc.socratic_prompts.map((p, i) => (
                  <View key={i} style={styles.webPromptCard}>
                    <Text style={styles.webPromptText}>{p}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.webActions}>
        <TouchableOpacity
          style={styles.webActionBtn}
          onPress={() => window.open(overlayArticle.url, '_blank')}
        >
          <Text style={styles.webActionBtnText}>Open Article Tab ↗</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.webActionBtn, styles.webActionBtnPrimary]}
          onPress={handleBackToFeed}
        >
          <Text style={[styles.webActionBtnText, styles.webActionBtnTextPrimary]}>Done Reading</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0E17',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#94A3B8',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0A0E17',
  },
  errorText: {
    fontSize: 16,
    color: '#ff6b6b',
    textAlign: 'center',
  },
  // Web reading state styles
  webReadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  webHeader: {
    padding: 16,
    paddingTop: 48,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  webBackText: {
    fontSize: 15,
    color: '#6366F1',
    fontWeight: '500',
  },
  webReadingState: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  webReadingIcon: {
    fontSize: 20,
    marginBottom: 8,
  },
  webReadingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 6,
  },
  webReadingMeta: {
    fontSize: 13,
    color: '#64748B',
  },
  webTabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 16,
  },
  webTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  webTabActive: {
    borderBottomColor: '#6366F1',
  },
  webTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94A3B8',
  },
  webTabTextActive: {
    color: '#6366F1',
  },
  webContent: {
    flex: 1,
  },
  webContentInner: {
    padding: 20,
  },
  webSection: {
    marginBottom: 20,
  },
  webSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
  },
  webSectionText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  webQuoteCard: {
    padding: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
    marginBottom: 8,
  },
  webQuoteText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#475569',
    lineHeight: 20,
  },
  webAnnotationCard: {
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
    marginBottom: 12,
  },
  webAnnotationType: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#10B981',
    marginBottom: 4,
  },
  webEmptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  webEmptyText: {
    fontSize: 15,
    color: '#64748B',
    marginBottom: 8,
  },
  webEmptySubtext: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  webPromptCard: {
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    marginBottom: 8,
  },
  webPromptText: {
    fontSize: 13,
    color: '#92400E',
  },
  webActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  webActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  webActionBtnPrimary: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  webActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  webActionBtnTextPrimary: {
    color: '#fff',
  },
  webArticleBanner: {
    margin: 16,
    padding: 14,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    gap: 10,
  },
  webBannerText: {
    fontSize: 13,
    color: '#4338CA',
    lineHeight: 18,
  },
  webBannerBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#6366F1',
    borderRadius: 8,
  },
  webBannerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
