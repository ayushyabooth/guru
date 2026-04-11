import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, TouchableOpacity, ScrollView, TextInput } from 'react-native';
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

  // Notes state (web fallback)
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savedNotes, setSavedNotes] = useState<{text: string; time: string}[]>([]);

  // Ask Guru state (web fallback)
  const [guruInput, setGuruInput] = useState('');
  const [guruLoading, setGuruLoading] = useState(false);
  const [guruMessages, setGuruMessages] = useState<{role: 'user'|'guru'; text: string}[]>([]);
  const [guruConversationId, setGuruConversationId] = useState<string | null>(null);

  const sendGuruMessage = async () => {
    if (!guruInput.trim() || guruLoading) return;
    const question = guruInput.trim();
    setGuruMessages(prev => [...prev, { role: 'user', text: question }]);
    setGuruInput('');
    setGuruLoading(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/socratic/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_id: articleId,
          question,
          conversation_history: guruMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
          conversation_id: guruConversationId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGuruMessages(prev => [...prev, { role: 'guru', text: data.response }]);
        if (data.conversation_id) setGuruConversationId(data.conversation_id);
      } else {
        setGuruMessages(prev => [...prev, { role: 'guru', text: 'Sorry, I had trouble answering that. Please try again.' }]);
      }
    } catch (e) {
      setGuruMessages(prev => [...prev, { role: 'guru', text: 'Network error. Please check your connection.' }]);
    } finally { setGuruLoading(false); }
  };

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
        <ActivityIndicator size="large" color="#38BDF8" />
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
                <Text style={styles.webAnnotationType}>{ann.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
                <Text style={styles.webSectionText}>{ann.text}</Text>
              </View>
            ))}
          </>
        )}

        {activeTab === 2 && (
          <View style={{ padding: 16 }}>
            <TextInput
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 16, minHeight: 100, fontSize: 16, color: '#F1F5F9', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', textAlignVertical: 'top' }}
              placeholder="Add a note about this article..."
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={4}
              value={noteInput}
              onChangeText={setNoteInput}
            />
            <TouchableOpacity
              style={{ backgroundColor: noteInput.trim() ? '#6366F1' : '#94A3B8', borderRadius: 12, padding: 14, marginTop: 12, alignItems: 'center' }}
              onPress={async () => {
                if (!noteInput.trim() || savingNote) return;
                setSavingNote(true);
                try {
                  const token = await getAuthToken();
                  const res = await fetch(`${API_BASE_URL}/articles/${articleId}/annotations`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ highlighted_text: 'Note', note_text: noteInput, color: 'gold', start_offset: 0, end_offset: 0 }),
                  });
                  if (res.ok) {
                    setSavedNotes(prev => [...prev, { text: noteInput, time: new Date().toLocaleTimeString() }]);
                    setNoteInput('');
                  }
                } catch (e) { console.error('Failed to save note:', e); }
                finally { setSavingNote(false); }
              }}
              disabled={!noteInput.trim() || savingNote}
            >
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 16 }}>{savingNote ? 'Saving...' : 'Save Note'}</Text>
            </TouchableOpacity>
            {savedNotes.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.webSectionTitle}>Your Notes</Text>
                {savedNotes.map((n, i) => (
                  <View key={i} style={{ backgroundColor: 'rgba(251,146,60,0.08)', borderLeftWidth: 3, borderLeftColor: '#F59E0B', padding: 12, borderRadius: 8, marginTop: 8 }}>
                    <Text style={{ color: '#F1F5F9', fontSize: 14 }}>{n.text}</Text>
                    <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>{n.time}</Text>
                  </View>
                ))}
              </View>
            )}
            {overlayArticle.annotations.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.webSectionTitle}>Highlights</Text>
                {overlayArticle.annotations.map((ann) => (
                  <View key={ann.id} style={styles.webAnnotationCard}>
                    <Text style={styles.webSectionText}>{ann.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === 3 && (
          <View style={{ padding: 16 }}>
            {guruMessages.map((msg, i) => (
              <View key={i} style={{ marginBottom: 12, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <View style={{ backgroundColor: msg.role === 'user' ? '#6366F1' : 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 14, maxWidth: '85%' }}>
                  <Text style={{ color: msg.role === 'user' ? '#FFF' : '#F1F5F9', fontSize: 14, lineHeight: 20 }}>{msg.text}</Text>
                </View>
              </View>
            ))}
            {guruLoading && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 14, maxWidth: '85%' }}>
                  <Text style={{ color: '#94A3B8', fontSize: 14 }}>Guru is thinking...</Text>
                </View>
              </View>
            )}
            {rc?.socratic_prompts && rc.socratic_prompts.length > 0 && guruMessages.length === 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.webSectionTitle}>Think about it</Text>
                {rc.socratic_prompts.map((p, i) => (
                  <TouchableOpacity key={i} style={styles.webPromptCard} onPress={() => { setGuruInput(p); }}>
                    <Text style={styles.webPromptText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, fontSize: 16, color: '#F1F5F9', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
                placeholder="Ask Guru about this article..."
                placeholderTextColor="#94A3B8"
                value={guruInput}
                onChangeText={setGuruInput}
                onSubmitEditing={sendGuruMessage}
              />
              <TouchableOpacity
                style={{ backgroundColor: guruInput.trim() ? '#6366F1' : '#94A3B8', borderRadius: 12, padding: 14, justifyContent: 'center' }}
                onPress={sendGuruMessage}
                disabled={!guruInput.trim() || guruLoading}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>Ask</Text>
              </TouchableOpacity>
            </View>
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
  // Web reading state styles — dark theme to match rest of app
  webReadingContainer: {
    flex: 1,
    backgroundColor: '#0A0E17',
  },
  webHeader: {
    padding: 16,
    paddingTop: 48,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  webBackText: {
    fontSize: 16,
    color: '#6366F1',
    fontWeight: '500',
  },
  webReadingState: {
    padding: 20,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  webReadingIcon: {
    fontSize: 20,
    marginBottom: 8,
  },
  webReadingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 6,
  },
  webReadingMeta: {
    fontSize: 12,
    color: '#64748B',
  },
  webTabBar: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
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
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
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
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 8,
  },
  webSectionText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#94A3B8',
  },
  webQuoteCard: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
    marginBottom: 8,
  },
  webQuoteText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#94A3B8',
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
    fontSize: 16,
    color: '#64748B',
    marginBottom: 8,
  },
  webEmptySubtext: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  webPromptCard: {
    padding: 12,
    backgroundColor: 'rgba(251,146,60,0.1)',
    borderRadius: 8,
    marginBottom: 8,
  },
  webPromptText: {
    fontSize: 12,
    color: '#FB923C',
  },
  webActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  webActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  webActionBtnPrimary: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  webActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  webActionBtnTextPrimary: {
    color: '#fff',
  },
  webArticleBanner: {
    margin: 16,
    padding: 14,
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
    gap: 10,
  },
  webBannerText: {
    fontSize: 12,
    color: '#818CF8',
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
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
});
