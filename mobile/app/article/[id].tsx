import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebViewReader, { OverlayArticleData } from '../../components/Reader/WebViewReader';
import { RelatedArticle } from '../../components/Reader/RelatedArticles';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { CatchupService } from '../../services/article-service';
import { useTimeTracking } from '../../hooks/useTimeTracking';
import DarkThemeColors from '../../constants/darkTheme';
import { DarkGlassMaterials, GlassMaterials, Spacing, Typography, BorderRadius, RingColors, getDarkBackdropBlur } from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

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

// Chrome extension ID for web app -> extension messaging
const EXTENSION_ID = ''; // Set after publishing or during dev

const ACCENT = RingColors.divein.primary; // #EC4899

export default function ArticleDetailScreen() {
  const { id, highlightQuote, source } = useLocalSearchParams();
  const router = useRouter();
  const { isDark, colors: themeColors } = useTheme();

  // Theme-aware color aliases — keep DarkThemeColors for dark mode, use themeColors in light
  const TC = isDark ? DarkThemeColors : {
    ...DarkThemeColors,
    background: themeColors.background,
    backgroundSecondary: themeColors.backgroundSecondary,
    textPrimary: themeColors.textPrimary,
    textSecondary: themeColors.textSecondary,
    textTertiary: themeColors.textTertiary,
    glassBorder: themeColors.glassBorder,
    glass: themeColors.glass,
    glassLight: themeColors.glassLight,
    success: themeColors.success,
    error: themeColors.error,
    warning: themeColors.warning,
  };

  // Theme-aware glass materials
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;
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

  // Track reading time -- attributes to correct ring (catchup/divein)
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
      <View style={[styles.loadingContainer, { backgroundColor: TC.background }]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={[styles.loadingText, { color: TC.textSecondary }]}>Loading article...</Text>
      </View>
    );
  }

  // Error state
  if (error || !overlayArticle) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: TC.background }]}>
        <Text style={[styles.errorText, { color: TC.error }]}>{error || 'Article not found'}</Text>
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
  const TAB_ICONS = ['file-text', 'lightbulb', 'note', 'chat-circle'];

  // Theme-aware inline styles for the web reading state
  const headerBg = isDark ? 'rgba(15, 20, 35, 0.75)' : 'rgba(255,255,255,0.85)';
  const headerBorderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
  const tabBarBg = isDark ? 'rgba(15, 20, 35, 0.65)' : 'rgba(255,255,255,0.88)';
  const tabBarBorderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
  const actionsBg = isDark ? 'rgba(15, 20, 35, 0.75)' : 'rgba(255,255,255,0.88)';
  const actionsBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const notesBg = isDark ? TC.recapGlow : 'rgba(251,146,60,0.08)';
  const guruBubbleBg = isDark ? TC.glassLight : 'rgba(255,255,255,0.88)';

  return (
    <View style={[styles.webReadingContainer, { backgroundColor: TC.background }]}>
      {/* Glass Navigation Bar */}
      <View style={[styles.webHeader, isDark ? getDarkBackdropBlur(28) : {}, { backgroundColor: headerBg, borderBottomColor: headerBorderColor }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={[styles.webBackText, { color: ACCENT }]}>← {sourceTab === 'catchup' ? 'Catch-up' : 'Dive-in'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: TC.textPrimary }]} numberOfLines={1}>{overlayArticle.source}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Article opened banner */}
      <View style={[styles.webArticleBanner, { backgroundColor: isDark ? `${ACCENT}15` : 'rgba(56,189,248,0.08)', borderColor: isDark ? `${ACCENT}25` : 'rgba(56,189,248,0.15)' }]}>
        <Text style={[styles.webBannerText, { color: TC.textSecondary }]}>
          The article has opened in a new tab. Read it there, then come back here for Guru insights, notes, and Q&A.
        </Text>
        <TouchableOpacity
          style={[styles.webBannerBtn, { backgroundColor: ACCENT }]}
          onPress={() => window.open(overlayArticle.url, '_blank')}
        >
          <Text style={styles.webBannerBtnText}>Reopen Article Tab</Text>
        </TouchableOpacity>
      </View>

      {/* Reading state indicator */}
      <View style={[styles.webReadingState, { backgroundColor: TC.backgroundSecondary, borderBottomColor: TC.glassBorder }]}>
        <Text style={[styles.webReadingTitle, { color: TC.textPrimary }]} numberOfLines={2}>
          {overlayArticle.headline}
        </Text>
        <Text style={[styles.webReadingMeta, { color: TC.textTertiary }]}>
          {overlayArticle.source}  {formatTime(readingTime)}
        </Text>
      </View>

      {/* Glass Tab Bar */}
      <View style={[styles.webTabBar, { backgroundColor: tabBarBg, borderBottomColor: tabBarBorderColor }]}>
        {TAB_NAMES.map((name, i) => (
          <TouchableOpacity
            key={name}
            style={[styles.webTab, activeTab === i && [styles.webTabActive, { backgroundColor: `${ACCENT}22`, borderColor: `${ACCENT}44` }]]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.webTabText, { color: TC.textTertiary }, activeTab === i && { color: ACCENT }]}>
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
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentDot, { backgroundColor: RingColors.catchup.primary }]} />
                  <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>What's in the article</Text>
                </View>
                <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{rc.summary_whats_in}</Text>
              </View>
            )}
            {rc.summary_why_matters && (
              <View style={styles.webSection}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentDot, { backgroundColor: RingColors.divein.primary }]} />
                  <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Why it matters</Text>
                </View>
                <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{rc.summary_why_matters}</Text>
              </View>
            )}
            {rc.summary_between_lines && (
              <View style={styles.webSection}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentDot, { backgroundColor: RingColors.recap.primary }]} />
                  <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Between the lines</Text>
                </View>
                <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{rc.summary_between_lines}</Text>
              </View>
            )}
            {rc.spotlight_quotes && rc.spotlight_quotes.length > 0 && (
              <View style={styles.webSection}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentDot, { backgroundColor: TC.warning }]} />
                  <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Spotlight Quotes</Text>
                </View>
                {rc.spotlight_quotes.map((q, i) => (
                  <View key={i} style={[styles.webQuoteCard, GM.cardLight, { borderLeftWidth: 3, borderLeftColor: ACCENT }]}>
                    <Text style={[styles.webQuoteText, { color: TC.textSecondary }]}>{q}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {activeTab === 1 && overlayArticle.annotations.length > 0 && (
          <>
            {overlayArticle.annotations.map((ann) => (
              <View key={ann.id} style={[styles.webAnnotationCard, GM.cardLight, { borderLeftColor: TC.success }]}>
                <Text style={[styles.webAnnotationType, { color: TC.success }]}>{ann.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
                <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{ann.text}</Text>
              </View>
            ))}
          </>
        )}

        {activeTab === 2 && (
          <View style={{ padding: Spacing.md }}>
            <TextInput
              style={{ ...GM.input, padding: Spacing.md, minHeight: 100, fontSize: 16, color: TC.textPrimary, textAlignVertical: 'top' }}
              placeholder="Add a note about this article..."
              placeholderTextColor={TC.textSecondary}
              multiline
              numberOfLines={4}
              value={noteInput}
              onChangeText={setNoteInput}
            />
            <TouchableOpacity
              style={{ backgroundColor: noteInput.trim() ? ACCENT : TC.textSecondary, borderRadius: BorderRadius.md, padding: 14, marginTop: Spacing.md, alignItems: 'center' }}
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
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Your Notes</Text>
                {savedNotes.map((n, i) => (
                  <View key={i} style={{ backgroundColor: notesBg, borderLeftWidth: 3, borderLeftColor: TC.warning, padding: Spacing.md, borderRadius: BorderRadius.sm, marginTop: Spacing.sm }}>
                    <Text style={{ color: TC.textPrimary, fontSize: 14 }}>{n.text}</Text>
                    <Text style={{ color: TC.textSecondary, fontSize: 12, marginTop: Spacing.xs }}>{n.time}</Text>
                  </View>
                ))}
              </View>
            )}
            {overlayArticle.annotations.length > 0 && (
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Highlights</Text>
                {overlayArticle.annotations.map((ann) => (
                  <View key={ann.id} style={[styles.webAnnotationCard, GM.cardLight, { borderLeftColor: TC.success }]}>
                    <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{ann.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === 3 && (
          <View style={{ padding: Spacing.md }}>
            {guruMessages.map((msg, i) => (
              <View key={i} style={{ marginBottom: Spacing.md, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <View style={{ backgroundColor: msg.role === 'user' ? ACCENT : guruBubbleBg, borderRadius: BorderRadius.lg, padding: 14, maxWidth: '85%' }}>
                  <Text style={{ color: msg.role === 'user' ? '#FFF' : TC.textPrimary, fontSize: 14, lineHeight: 20 }}>{msg.text}</Text>
                </View>
              </View>
            ))}
            {guruLoading && (
              <View style={{ marginBottom: Spacing.md }}>
                <View style={{ backgroundColor: guruBubbleBg, borderRadius: BorderRadius.lg, padding: 14, maxWidth: '85%' }}>
                  <Text style={{ color: TC.textSecondary, fontSize: 14 }}>Guru is thinking...</Text>
                </View>
              </View>
            )}
            {rc?.socratic_prompts && rc.socratic_prompts.length > 0 && guruMessages.length === 0 && (
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Think about it</Text>
                {rc.socratic_prompts.map((p, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.webPromptCard, { backgroundColor: isDark ? `${ACCENT}15` : 'rgba(99,102,241,0.05)', borderColor: isDark ? `${ACCENT}25` : 'rgba(99,102,241,0.15)' }]}
                    onPress={() => { setGuruInput(p); }}
                  >
                    <Text style={[styles.webPromptText, { color: isDark ? ACCENT : '#6366F1' }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TextInput
                style={{ flex: 1, ...GM.input, padding: 14, fontSize: 16, color: TC.textPrimary }}
                placeholder="Ask Guru about this article..."
                placeholderTextColor={TC.textSecondary}
                value={guruInput}
                onChangeText={setGuruInput}
                onSubmitEditing={sendGuruMessage}
              />
              <TouchableOpacity
                style={{ backgroundColor: guruInput.trim() ? ACCENT : TC.textSecondary, borderRadius: BorderRadius.md, padding: 14, justifyContent: 'center' }}
                onPress={sendGuruMessage}
                disabled={!guruInput.trim() || guruLoading}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>Ask</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating Glass Action Bar */}
      <View style={[styles.webActions, { backgroundColor: actionsBg, borderColor: actionsBorderColor }]}>
        <TouchableOpacity
          style={[styles.webActionBtn, GM.button]}
          onPress={() => window.open(overlayArticle.url, '_blank')}
        >
          <Text style={[styles.webActionBtnText, { color: TC.textSecondary }]}>Open Article ↗</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.webActionBtn, { backgroundColor: isDark ? ACCENT : 'rgba(56,189,248,0.15)', borderColor: isDark ? ACCENT : 'rgba(56,189,248,0.40)', borderWidth: 1 }]}
          onPress={handleBackToFeed}
        >
          <Text style={[styles.webActionBtnText, { color: isDark ? '#fff' : RingColors.catchup.primary, fontWeight: '700' }]}>✓ Done Reading</Text>
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
  },
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyLarge,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  errorText: {
    ...Typography.bodyLarge,
    textAlign: 'center',
  },
  // Web reading state styles — theme-aware (colors applied inline)
  webReadingContainer: {
    flex: 1,
  },
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 48,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.md,
  },
  webBackText: {
    ...Typography.bodyLarge,
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    ...Typography.labelLarge,
    textAlign: 'center',
  },
  webReadingState: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  webReadingTitle: {
    ...Typography.headlineSmall,
    marginBottom: 6,
  },
  webReadingMeta: {
    ...Typography.bodySmall,
  },
  webTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  webTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: BorderRadius.pill,
  },
  webTabActive: {
    borderWidth: 1,
  },
  webTabText: {
    ...Typography.labelSmall,
    fontWeight: '600',
  },
  webTabTextActive: {},
  webContent: {
    flex: 1,
  },
  webContentInner: {
    padding: 20,
    paddingBottom: 120,
  },
  webSection: {
    marginBottom: 20,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  accentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  webSectionTitle: {
    ...Typography.headlineSmall,
    fontSize: 16,
    marginBottom: 0,
  },
  webSectionText: {
    ...Typography.bodyMedium,
    lineHeight: 22,
  },
  webQuoteCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  webQuoteText: {
    ...Typography.bodySmall,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  webAnnotationCard: {
    padding: 14,
    borderLeftWidth: 3,
    marginBottom: Spacing.md,
  },
  webAnnotationType: {
    ...Typography.labelSmall,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  webEmptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  webEmptyText: {
    ...Typography.bodyLarge,
    marginBottom: Spacing.sm,
  },
  webEmptySubtext: {
    ...Typography.bodySmall,
    textAlign: 'center',
    lineHeight: 20,
  },
  webPromptCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  webPromptText: {
    ...Typography.bodySmall,
  },
  webActions: {
    position: 'absolute',
    bottom: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
  },
  webActionBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  webActionBtnPrimary: {},
  webActionBtnText: {
    ...Typography.labelLarge,
  },
  webActionBtnTextPrimary: {
    color: '#fff',
  },
  webArticleBanner: {
    margin: Spacing.md,
    padding: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: 10,
  },
  webBannerText: {
    ...Typography.bodySmall,
    lineHeight: 18,
  },
  webBannerBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.sm,
  },
  webBannerBtnText: {
    ...Typography.labelSmall,
    fontWeight: '600',
    color: '#fff',
  },
});
