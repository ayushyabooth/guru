import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, TouchableOpacity, ScrollView, TextInput, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebViewReader, { OverlayArticleData } from '../../components/Reader/WebViewReader';
import { RelatedArticle } from '../../components/Reader/RelatedArticles';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { openExternalTab } from '../../utils/openExternalTab';
import { CatchupService } from '../../services/article-service';
import { useTimeTracking } from '../../hooks/useTimeTracking';
import DarkThemeColors from '../../constants/darkTheme';
import {
  DarkGlassMaterials,
  GlassMaterials,
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getDarkBackdropBlur,
  getBackdropBlur,
  getGlassStyle,
  GlassTier,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from '../../components/ui/Icon';

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

// ─── Glass style helpers (Figma EDL v2 — 5 tiers) ───────────────────────────

/** Return a glass style object for a given tier, merging backdrop blur on web.
 *  Pure function — not a hook; call with isDark from the component. */
const BLUR_AMT: Record<GlassTier, number> = {
  ultraThin: 12, thin: 16, regular: 24, thick: 40, chrome: 56,
};
function buildGlass(tier: GlassTier, isDark: boolean) {
  const mode = isDark ? 'dark' : 'light';
  const style = getGlassStyle(tier, mode);
  const blurAmt = BLUR_AMT[tier];
  const blurStyle = isDark ? getDarkBackdropBlur(blurAmt) : getBackdropBlur(blurAmt);
  return { ...style, ...blurStyle };
}

export default function ArticleDetailScreen() {
  const { id, highlightQuote, source } = useLocalSearchParams();
  const router = useRouter();
  const { isDark, colors: themeColors } = useTheme();

  // Theme-aware color aliases
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

  // Theme-aware glass materials (legacy — for quote/annotation cards)
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;

  // Figma EDL v2 glass styles — computed once from isDark
  const chromeGlass  = buildGlass('chrome',  isDark);
  const thickGlass   = buildGlass('thick',   isDark);
  const thinGlass    = buildGlass('thin',    isDark);
  const regularGlass = buildGlass('regular', isDark);

  const [overlayArticle, setOverlayArticle] = useState<OverlayArticleData | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readingHistory, setReadingHistoryState] = useState<string[]>(getReadingHistory());
  const [readingTime, setReadingTime] = useState(0);
  const [activeTab, setActiveTab] = useState(0);

  // Tab-change parallax animation
  const tabAnim = useRef(new Animated.Value(0)).current;
  const prevTab = useRef(0);

  const handleTabChange = useCallback((i: number) => {
    if (i === activeTab) return;
    const direction = i > prevTab.current ? 1 : -1;
    tabAnim.setValue(direction * 20);
    prevTab.current = i;
    setActiveTab(i);
    Animated.spring(tabAnim, { toValue: 0, useNativeDriver: true, stiffness: 300, damping: 30 }).start();
  }, [activeTab, tabAnim]);

  // Notes state
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savedNotes, setSavedNotes] = useState<{text: string; time: string}[]>([]);

  // Ask Guru state — shared between persistent bar + tab 3 history
  const [guruInput, setGuruInput] = useState('');
  const [guruLoading, setGuruLoading] = useState(false);
  const [guruMessages, setGuruMessages] = useState<{role: 'user'|'guru'; text: string}[]>([]);
  const [guruConversationId, setGuruConversationId] = useState<string | null>(null);
  const guruInputRef = useRef<TextInput>(null);

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
    } finally {
      setGuruLoading(false);
    }
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

  const articleId = typeof id === 'string' ? id : undefined;
  const { logTime } = useTimeTracking(sourceTab || 'divein', {
    interval: 60000,
    contextId: articleId,
    activityType: 'article',
  });

  // GUR-205: restore prior Ask Guru Q&A for this article when the reader opens.
  // Best-effort + only seeds when the chat is empty, so it never clobbers a
  // fresh in-session conversation or the send logic.
  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/socratic/history/${articleId}`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.messages) || data.messages.length === 0) return;
        const restored = data.messages
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
          .map((m: any) => ({ role: (m.role === 'user' ? 'user' : 'guru') as 'user' | 'guru', text: m.content }));
        setGuruMessages(prev => (prev.length === 0 ? restored : prev));
        if (data.conversation_id) setGuruConversationId(prev => prev || data.conversation_id);
      } catch { /* history is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [articleId]);

  // Reading timer for web reading state
  useEffect(() => {
    if (Platform.OS !== 'web' || !overlayArticle) return;
    const interval = setInterval(() => {
      setReadingTime(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [overlayArticle]);

  // Signal Chrome extension when article data is ready
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
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Please log in to view articles');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/reader/articles/${id}/overlay`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
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
        setError(`Failed to load article (${response.status})`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError("Couldn't load — tap to retry");
      } else {
        setError('Failed to load article');
      }
    } finally {
      clearTimeout(timeoutId);
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
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: ACCENT }]}
          onPress={fetchOverlayArticle}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={handleBack}>
          <Text style={[styles.backLinkText, { color: TC.textSecondary }]}>← Go back</Text>
        </TouchableOpacity>
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
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const rc = overlayArticle.richContent;
  const TAB_NAMES = ['Summary', 'Insights', 'Notes', 'Ask Guru'];

  const guruBubbleBg = isDark ? TC.glassLight : 'rgba(255,255,255,0.88)';
  const notesBg = isDark ? TC.recapGlow : 'rgba(251,146,60,0.08)';

  return (
    <View style={[styles.webReadingContainer, { backgroundColor: TC.background }]}>

      {/* ── Chrome Tier: Glass Navigation Bar ─────────────────────────── */}
      <View style={[
        styles.webHeader,
        chromeGlass,
        { borderBottomWidth: 1, borderRadius: 0, borderBottomColor: TC.glassBorder },
      ]}>
        {/* Back: ‹ chevron + label — 44×44 touch target per spec */}
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${sourceTab === 'catchup' ? 'Catch-up' : 'Dive-in'}`}
        >
          <Text style={[styles.backChevron, { color: TC.textPrimary }]}>‹</Text>
          <Text style={[styles.backLabel, { color: TC.textSecondary }]}>
            {sourceTab === 'catchup' ? 'Catch-up' : 'Dive-in'}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: TC.textPrimary }]} numberOfLines={1}>
          {overlayArticle.source}
        </Text>
        <View style={{ width: 80 }} />
      </View>

      {/* ── Thin Tier: Article-opened reading banner ───────────────────── */}
      <View style={[
        styles.webArticleBanner,
        thinGlass,
        { borderRadius: BorderRadius.md, borderColor: TC.glassBorder },
      ]}>
        <Text style={[styles.webBannerText, { color: TC.textSecondary }]}>
          The article has opened in a new tab. Read it there, then come back here for Guru insights, notes, and Q&A.
        </Text>
        <TouchableOpacity
          style={[styles.webBannerBtn, { backgroundColor: ACCENT }]}
          onPress={() => openExternalTab(overlayArticle.url)}
        >
          <Text style={styles.webBannerBtnText}>Reopen Article Tab</Text>
        </TouchableOpacity>
      </View>

      {/* ── Thick Tier: Reading state indicator ───────────────────────── */}
      <View style={[
        styles.webReadingState,
        thickGlass,
        { borderRadius: 0, borderColor: TC.glassBorder, borderBottomWidth: 1 },
      ]}>
        <Text style={[styles.webReadingTitle, { color: TC.textPrimary }]} numberOfLines={2}>
          {overlayArticle.headline}
        </Text>
        <Text style={[styles.webReadingMeta, { color: TC.textTertiary }]}>
          {overlayArticle.source}{'  '}{formatTime(readingTime)}
        </Text>
      </View>

      {/* ── Regular Tier: Glass Tab Bar (Topic-1 Z-parallax on switch) ── */}
      <View style={[
        styles.webTabBar,
        regularGlass,
        { borderRadius: 0, borderBottomWidth: 1, borderColor: TC.glassBorder },
      ]}>
        {TAB_NAMES.map((name, i) => (
          <TouchableOpacity
            key={name}
            style={[
              styles.webTab,
              activeTab === i && [
                styles.webTabActive,
                { backgroundColor: `${ACCENT}22`, borderColor: `${ACCENT}55` },
              ],
            ]}
            onPress={() => {
              handleTabChange(i);
              // If user taps Ask Guru tab, focus the persistent input bar
              if (i === 3) {
                setTimeout(() => guruInputRef.current?.focus(), 300);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === i }}
          >
            <Text style={[
              styles.webTabText,
              { color: TC.textTertiary },
              activeTab === i && { color: ACCENT, fontWeight: '700' },
            ]}>
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tab Content (parallax-animated) ───────────────────────────── */}
      <Animated.ScrollView
        style={[styles.webContent, { transform: [{ translateX: tabAnim }] }]}
        contentContainerStyle={styles.webContentInner}
      >
        {/* Tab 0 — Summary */}
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
                {rc.spotlight_quotes.map((q: string, i: number) => (
                  <View key={i} style={[styles.webQuoteCard, GM.cardLight, { borderLeftWidth: 3, borderLeftColor: ACCENT }]}>
                    <Text style={[styles.webQuoteText, { color: TC.textSecondary }]}>{q}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Tab 1 — Insights */}
        {activeTab === 1 && overlayArticle.annotations.length > 0 && (
          <>
            {overlayArticle.annotations.map((ann) => (
              <View key={ann.id} style={[styles.webAnnotationCard, GM.cardLight, { borderLeftColor: TC.success }]}>
                <Text style={[styles.webAnnotationType, { color: TC.success }]}>
                  {ann.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </Text>
                <Text style={[styles.webSectionText, { color: TC.textSecondary }]}>{ann.text}</Text>
              </View>
            ))}
          </>
        )}
        {activeTab === 1 && overlayArticle.annotations.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: TC.textTertiary }]}>No insights available yet.</Text>
          </View>
        )}

        {/* Tab 2 — Notes */}
        {activeTab === 2 && (
          <View>
            <TextInput
              style={[
                styles.noteInput,
                thickGlass,
                { color: TC.textPrimary },
              ]}
              placeholder="Add a note about this article..."
              placeholderTextColor={TC.textTertiary}
              multiline
              numberOfLines={4}
              value={noteInput}
              onChangeText={setNoteInput}
            />
            <TouchableOpacity
              style={[
                styles.saveNoteBtn,
                { backgroundColor: noteInput.trim() ? ACCENT : TC.textTertiary },
              ]}
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
                } catch (e) {
                  console.error('Failed to save note:', e);
                } finally {
                  setSavingNote(false);
                }
              }}
              disabled={!noteInput.trim() || savingNote}
            >
              <Text style={styles.saveNoteBtnText}>{savingNote ? 'Saving...' : 'Save Note'}</Text>
            </TouchableOpacity>
            {savedNotes.length > 0 && (
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={[styles.webSectionTitle, { color: TC.textPrimary }]}>Your Notes</Text>
                {savedNotes.map((n, i) => (
                  <View key={i} style={{ backgroundColor: notesBg, borderLeftWidth: 3, borderLeftColor: TC.warning, padding: Spacing.md, borderRadius: BorderRadius.sm, marginTop: Spacing.sm }}>
                    <Text style={{ color: TC.textPrimary, fontSize: 14 }}>{n.text}</Text>
                    <Text style={{ color: TC.textTertiary, fontSize: 12, marginTop: Spacing.xs }}>{n.time}</Text>
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

        {/* Tab 3 — Ask Guru: conversation history */}
        {activeTab === 3 && (
          <View>
            {guruMessages.length === 0 && !guruLoading && (
              <>
                <Text style={[styles.webSectionTitle, { color: TC.textPrimary, marginBottom: Spacing.md }]}>
                  Think about it
                </Text>
                {rc?.socratic_prompts && rc.socratic_prompts.map((p: string, i: number) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.webPromptCard,
                      {
                        backgroundColor: isDark ? `${ACCENT}15` : 'rgba(99,102,241,0.05)',
                        borderColor: isDark ? `${ACCENT}25` : 'rgba(99,102,241,0.15)',
                        borderWidth: 1,
                      },
                    ]}
                    onPress={() => {
                      setGuruInput(p);
                      guruInputRef.current?.focus();
                    }}
                  >
                    <Text style={[styles.webPromptText, { color: isDark ? ACCENT : '#6366F1' }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
                {(!rc?.socratic_prompts || rc.socratic_prompts.length === 0) && (
                  <View style={styles.emptyState}>
                    <Text style={[styles.emptyStateText, { color: TC.textTertiary }]}>
                      Use the Ask Guru bar below to start a conversation about this article.
                    </Text>
                  </View>
                )}
              </>
            )}
            {guruMessages.map((msg, i) => (
              <View key={i} style={[styles.messageBubbleRow, { justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }]}>
                <View style={[
                  styles.messageBubble,
                  {
                    backgroundColor: msg.role === 'user' ? ACCENT : guruBubbleBg,
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  },
                ]}>
                  <Text style={{ color: msg.role === 'user' ? '#FFF' : TC.textPrimary, fontSize: 14, lineHeight: 20 }}>
                    {msg.text}
                  </Text>
                </View>
              </View>
            ))}
            {guruLoading && (
              <View style={[styles.messageBubbleRow, { justifyContent: 'flex-start' }]}>
                <View style={[styles.messageBubble, { backgroundColor: guruBubbleBg }]}>
                  <Text style={{ color: TC.textTertiary, fontSize: 14 }}>Guru is thinking…</Text>
                </View>
              </View>
            )}
          </View>
        )}
      </Animated.ScrollView>

      {/* ── Chrome Tier: Persistent Ask Guru Input Bar ─────────────────
           Visible across ALL tabs per GUR-87 spec.
           "Chrome tier (tab bar, nav) — pinned" — Figma EDL v2 77:3         */}
      <View style={[
        styles.askGuruBar,
        chromeGlass,
        { borderTopWidth: 1, borderRadius: 0, borderColor: TC.glassBorder },
      ]}>
        <View style={styles.askGuruInner}>
          <TextInput
            ref={guruInputRef}
            style={[
              styles.askGuruInput,
              thinGlass,
              { color: TC.textPrimary, borderColor: TC.glassBorder },
            ]}
            placeholder="Ask Guru about this article…"
            placeholderTextColor={TC.textTertiary}
            value={guruInput}
            onChangeText={setGuruInput}
            onSubmitEditing={sendGuruMessage}
            returnKeyType="send"
            onFocus={() => {
              // Switch to Ask Guru tab when input is focused from another tab
              if (activeTab !== 3) handleTabChange(3);
            }}
          />
          <TouchableOpacity
            style={[
              styles.askGuruSendBtn,
              { backgroundColor: guruInput.trim() && !guruLoading ? ACCENT : TC.textTertiary },
            ]}
            onPress={sendGuruMessage}
            disabled={!guruInput.trim() || guruLoading}
            accessibilityRole="button"
            accessibilityLabel="Send message to Guru"
          >
            <Icon name="arrow-up" size={18} color="#FFFFFF" weight="bold" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Chrome Tier: Floating Action Bar ──────────────────────────── */}
      <View style={[
        styles.webActions,
        chromeGlass,
        { borderTopWidth: 1, borderRadius: 0, borderColor: TC.glassBorder },
      ]}>
        {/* Open Article — neutral glass + open-in-new icon per GUR-147 */}
        <TouchableOpacity
          style={[
            styles.webActionBtn,
            styles.webActionBtnRow,
            { borderColor: TC.glassBorder, borderWidth: 1, borderRadius: BorderRadius.lg },
          ]}
          onPress={() => openExternalTab(overlayArticle.url)}
        >
          <Icon name="open-in-new" size={14} color={TC.textSecondary} />
          <Text style={[styles.webActionBtnText, { color: TC.textSecondary }]}>Open Article</Text>
        </TouchableOpacity>
        {/* Done Reading — indigo glass + check-circle icon per GUR-147 */}
        <TouchableOpacity
          style={[
            styles.webActionBtn,
            styles.webActionBtnRow,
            {
              backgroundColor: isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.22)',
              borderColor: isDark ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.40)',
              borderWidth: 1.5,
              borderRadius: BorderRadius.lg,
            },
          ]}
          onPress={handleBackToFeed}
        >
          <Icon name="check-circle" size={14} color={isDark ? '#fff' : '#6366F1'} weight="bold" />
          <Text style={[styles.webActionBtnText, { color: isDark ? '#fff' : '#6366F1', fontWeight: '700' }]}>
            Done Reading
          </Text>
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
  retryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
  },
  retryButtonText: {
    ...Typography.labelMedium,
    color: '#fff',
    fontWeight: '600',
  },
  backLink: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backLinkText: {
    ...Typography.labelMedium,
  },

  // ── Web reading state layout ─────────────────────────────────────────────
  webReadingContainer: {
    flex: 1,
    display: 'flex' as any,
    flexDirection: 'column',
  },

  // Chrome-tier nav bar (pinned top)
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 48,
    paddingBottom: Spacing.sm,
  },

  // Back button: ‹ chevron + label — minimum 44×44 touch target
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
    paddingRight: Spacing.md,
    gap: 2,
  },
  backChevron: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 34,
    marginTop: -2,
  },
  backLabel: {
    ...Typography.labelMedium,
    fontWeight: '500',
  },

  headerTitle: {
    flex: 1,
    ...Typography.labelLarge,
    textAlign: 'center',
  },

  // Thin-tier banner
  webArticleBanner: {
    margin: Spacing.md,
    padding: 14,
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

  // Thick-tier reading state header
  webReadingState: {
    padding: Spacing.lg,
  },
  webReadingTitle: {
    ...Typography.headlineSmall,
    marginBottom: 6,
  },
  webReadingMeta: {
    ...Typography.bodySmall,
  },

  // Regular-tier tab bar
  webTabBar: {
    flexDirection: 'row',
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

  // Scrollable tab content
  webContent: {
    flex: 1,
  },
  webContentInner: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  webSection: {
    marginBottom: Spacing.lg,
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
  webPromptCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  webPromptText: {
    ...Typography.bodySmall,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  emptyStateText: {
    ...Typography.bodyMedium,
    textAlign: 'center',
  },

  // Notes
  noteInput: {
    padding: Spacing.md,
    minHeight: 100,
    fontSize: 16,
    textAlignVertical: 'top',
    marginBottom: Spacing.sm,
  },
  saveNoteBtn: {
    borderRadius: BorderRadius.md,
    padding: 14,
    alignItems: 'center',
  },
  saveNoteBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },

  // Ask Guru chat bubbles
  messageBubbleRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  messageBubble: {
    borderRadius: BorderRadius.lg,
    padding: 14,
    maxWidth: '85%',
  },

  // ── Persistent Ask Guru bar (Chrome tier, pinned above actions) ──────────
  askGuruBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  askGuruInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  askGuruInput: {
    flex: 1,
    padding: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
  },
  askGuruSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  askGuruSendBtnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },

  // ── Chrome-tier action bar (Done Reading / Open Article) ─────────────────
  webActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  webActionBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  webActionBtnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  webActionBtnText: {
    ...Typography.labelLarge,
  },
});
