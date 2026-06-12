import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, LayoutAnimation, Platform, UIManager } from 'react-native';
import Icon from '../ui/Icon';
import GuruBlob from '../ui/GuruBlob';
import GlassSection from '../ui/GlassSection';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { useTheme } from '../../contexts/ThemeContext';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SocraticPromptsSectionProps {
  prompts: string[];
  isDark?: boolean;
  onQuestionTap?: (question: string, index: number) => void;
  articleId?: string;
  /** Header-chevron deep link: open the article reader at the reflect surface */
  onHeaderNavigate?: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** The annotation's highlighted_text is the reflection question, truncated.
 *  Must be identical for POST and the GET-match on restore. */
const questionAnchor = (q: string): string =>
  q.length > 120 ? `${q.slice(0, 119)}…` : q;

// ── localStorage instant-restore fallback (API is the source of truth) ──────
const LS_KEY = 'guru_socratic_notes';

const readLocalNotes = (articleId: string): Record<string, { note: string }> => {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return all[articleId] || {};
  } catch {
    return {};
  }
};

const writeLocalNote = (articleId: string, index: number, note: string, question: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (!all[articleId]) all[articleId] = {};
    all[articleId][`prompt-${index}`] = {
      note,
      question,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* best-effort */
  }
};

export const SocraticPromptsSection: React.FC<SocraticPromptsSectionProps> = ({
  prompts,
  isDark: isDarkProp,
  onQuestionTap,
  articleId,
  onHeaderNavigate
}) => {
  const { isDark: isDarkTheme } = useTheme();
  const isDark = isDarkProp ?? isDarkTheme;

  const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({});

  // Restore notes when the article changes: localStorage seeds text instantly,
  // then the annotations API (source of truth) seeds text + Saved state.
  useEffect(() => {
    setNotes({});
    setSaveStatus({});
    if (!articleId || !prompts || prompts.length === 0) return;

    // 1) Instant fallback from localStorage (text only — unknown server state).
    const local = readLocalNotes(articleId);
    const seeded: Record<number, string> = {};
    prompts.slice(0, 3).forEach((_, i) => {
      const entry = local[`prompt-${i}`];
      if (entry?.note) seeded[i] = entry.note;
    });
    if (Object.keys(seeded).length > 0) setNotes(prev => ({ ...seeded, ...prev }));

    // 2) Source of truth: persisted annotations for this article.
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/articles/${articleId}/annotations`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!Array.isArray(data) || cancelled) return;
        const restoredNotes: Record<number, string> = {};
        const restoredStatus: Record<number, SaveStatus> = {};
        prompts.slice(0, 3).forEach((prompt, i) => {
          const anchor = questionAnchor(prompt);
          // Latest matching annotation wins (a re-save creates a new one).
          const match = [...data].reverse().find(
            (a: any) => a?.highlighted_text === anchor && a?.note_text
          );
          if (match) {
            restoredNotes[i] = match.note_text;
            restoredStatus[i] = 'saved';
          }
        });
        if (cancelled) return;
        if (Object.keys(restoredNotes).length > 0) {
          setNotes(prev => ({ ...prev, ...restoredNotes }));
          setSaveStatus(prev => ({ ...prev, ...restoredStatus }));
        }
      } catch {
        /* restore is best-effort; localStorage seed already applied */
      }
    })();
    return () => { cancelled = true; };
  }, [articleId, prompts]);

  const handleQuestionTap = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expandedQuestionIndex === index) {
      setExpandedQuestionIndex(null);
    } else {
      setExpandedQuestionIndex(index);
    }
  };

  const handleExploreWithGuru = (question: string, index: number) => {
    if (onQuestionTap) {
      onQuestionTap(question, index);
    }
  };

  const handleNoteChange = (index: number, text: string) => {
    setNotes(prev => ({ ...prev, [index]: text }));
    // Typing after a save (or a failure) re-arms the Save button.
    setSaveStatus(prev =>
      prev[index] === 'saved' || prev[index] === 'error'
        ? { ...prev, [index]: 'idle' }
        : prev
    );
    if (articleId) writeLocalNote(articleId, index, text, prompts[index]);
  };

  // Explicit Save → POST a real annotation (same shape as the agent's add_note),
  // so the note lands in the article's Notes tab and feeds the weekly recap.
  const handleSaveNote = useCallback(async (index: number) => {
    const text = (notes[index] || '').trim();
    if (!text || !articleId) return;
    const status = saveStatus[index];
    if (status === 'saving' || status === 'saved') return;
    setSaveStatus(prev => ({ ...prev, [index]: 'saving' }));
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('no auth token');
      const res = await fetch(`${API_BASE_URL}/articles/${articleId}/annotations`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          highlighted_text: questionAnchor(prompts[index]),
          note_text: text,
          color: 'gold',
          start_offset: 0,
          end_offset: 0,
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setSaveStatus(prev => ({ ...prev, [index]: 'saved' }));
    } catch {
      // Keep the text; offer retry.
      setSaveStatus(prev => ({ ...prev, [index]: 'error' }));
    }
  }, [notes, saveStatus, articleId, prompts]);

  if (!prompts || prompts.length === 0) return null;

  // ── Liquid-glass styles (EDL): semi-transparent fills + web backdrop blur ──
  const webBlur = Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } as any)
    : {};

  const primaryBtnGlass = {
    backgroundColor: 'rgba(99,102,241,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.35)',
    ...webBlur,
  };
  const primaryTextColor = isDark ? '#A5B4FC' : '#6366F1';

  const secondaryBtnGlass = {
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
    ...webBlur,
  };
  const savedBtnGlass = {
    backgroundColor: 'rgba(16,185,129,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
    ...webBlur,
  };
  const errorBtnGlass = {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    ...webBlur,
  };

  const glassInput = {
    backgroundColor: 'transparent',
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    color: isDark ? '#E2E8F0' : '#1E293B',
    ...webBlur,
  };

  const labelColor = isDark ? '#F1F5F9' : '#1E293B';

  return (
    <GlassSection
      title="Questions to reflect on"
      icon={<Icon name="lightbulb-outline" size={16} color="#0EA5E9" />}
      accentColor="#38BDF8"
      defaultExpanded={false}
      style={styles.outerSection}
      onNavigate={onHeaderNavigate}
    >
      <View style={styles.promptsList}>
        {prompts.slice(0, 3).map((prompt, index) => {
          const isQuestionExpanded = expandedQuestionIndex === index;
          const noteText = notes[index] || '';
          const status: SaveStatus = saveStatus[index] || 'idle';
          const canSave =
            noteText.trim().length > 0 && (status === 'idle' || status === 'error');

          const saveLabel =
            status === 'saving' ? 'Saving…'
            : status === 'saved' ? 'Saved ✓'
            : status === 'error' ? "Couldn't save — tap to retry"
            : 'Save';

          return (
            <View key={index} style={[styles.promptCard, isQuestionExpanded && styles.promptCardExpanded]}>
              {/* Question Header - Tappable */}
              <TouchableOpacity
                onPress={() => handleQuestionTap(index)}
                activeOpacity={0.7}
                style={styles.promptHeader}
              >
                <Text
                  style={[styles.promptText, !isDark && { color: '#1E293B' }]}
                  numberOfLines={isQuestionExpanded ? undefined : 3}
                >
                  {prompt}
                </Text>
                <Text style={styles.exploreIcon}>{isQuestionExpanded ? '▲' : '▶'}</Text>
              </TouchableOpacity>

              {/* Inline Q&A Flow */}
              {isQuestionExpanded && (
                <View style={styles.inlineQAContainer}>
                  <View style={styles.reflectionCard}>
                    <Text style={[styles.reflectionLabel, { color: labelColor }]}>What comes to mind?</Text>
                    <TextInput
                      style={[styles.reflectionInput, glassInput]}
                      placeholder="Jot your thoughts here..."
                      placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                      value={noteText}
                      onChangeText={(text) => handleNoteChange(index, text)}
                      multiline
                      numberOfLines={3}
                    />
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        style={[
                          styles.saveBtn,
                          status === 'saved' ? savedBtnGlass
                            : status === 'error' ? errorBtnGlass
                            : secondaryBtnGlass,
                          !canSave && status !== 'saved' && status !== 'saving' && { opacity: 0.6 },
                        ]}
                        onPress={() => handleSaveNote(index)}
                        disabled={!canSave}
                        accessibilityRole="button"
                        accessibilityLabel={saveLabel}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {status === 'saved' && <Icon name="check" size={14} color="#34D399" />}
                          <Text
                            style={[
                              styles.saveBtnText,
                              { color: isDark ? '#94A3B8' : '#64748B' },
                              status === 'saved' && { color: '#34D399' },
                              status === 'error' && { color: '#F87171' },
                            ]}
                          >
                            {saveLabel}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.guruBtn, primaryBtnGlass]}
                        onPress={() => handleExploreWithGuru(prompt, index)}
                      >
                        <GuruBlob size={18} tight />
                        <Text style={[styles.guruBtnText, { color: primaryTextColor }]}>Explore with Guru</Text>
                        <Text style={[styles.guruArrow, { color: primaryTextColor }]}>→</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Text style={styles.hintText}>Tap a question to reflect and take notes</Text>
    </GlassSection>
  );
};

const styles = StyleSheet.create({
  outerSection: {
    marginHorizontal: 8,
  },
  promptsList: {
    gap: 12,
  },
  promptCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  promptCardExpanded: {
    borderColor: '#38BDF8',
    borderWidth: 1.5,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
  },
  promptText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: '#E2E8F0',
    marginRight: 12,
    fontWeight: '400',
  },
  exploreIcon: {
    fontSize: 14,
    color: '#38BDF8',
  },
  hintText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  inlineQAContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  reflectionCard: {
    backgroundColor: 'transparent',
  },
  reflectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  reflectionInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  guruBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    gap: 8,
  },
  guruBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  guruArrow: {
    fontSize: 14,
    opacity: 0.8,
  },
});
