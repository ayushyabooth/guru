import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, LayoutAnimation, Platform, UIManager } from 'react-native';
import Icon from '../ui/Icon';
import GuruRings from '../ui/GuruRings';
import GlassSection from '../ui/GlassSection';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SocraticPromptsSectionProps {
  prompts: string[];
  isDark?: boolean;
  onQuestionTap?: (question: string, index: number) => void;
  articleId?: string;
}

export const SocraticPromptsSection: React.FC<SocraticPromptsSectionProps> = ({
  prompts,
  isDark = false,
  onQuestionTap,
  articleId
}) => {
  const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  if (!prompts || prompts.length === 0) return null;

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

  const handleSaveNote = (index: number, text: string) => {
    setNotes(prev => ({ ...prev, [index]: text }));
    try {
      const saved = localStorage.getItem('guru_socratic_notes') || '{}';
      const allNotes = JSON.parse(saved);
      if (!allNotes[articleId || '']) {
        allNotes[articleId || ''] = {};
      }
      allNotes[articleId || ''][`prompt-${index}`] = {
        note: text,
        question: prompts[index],
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem('guru_socratic_notes', JSON.stringify(allNotes));
    } catch (error) {
    }
  };

  return (
    <GlassSection
      title="Questions to reflect on"
      icon={<Icon name="lightbulb-outline" size={16} color="#0EA5E9" />}
      accentColor="#38BDF8"
      defaultExpanded={false}
      style={styles.outerSection}
    >
      <View style={styles.promptsList}>
        {prompts.slice(0, 3).map((prompt, index) => {
          const isQuestionExpanded = expandedQuestionIndex === index;
          const noteText = notes[index] || '';
          const isSaved = noteText.length > 0;

          return (
            <View key={index} style={[styles.promptCard, isQuestionExpanded && styles.promptCardExpanded]}>
              {/* Question Header - Tappable */}
              <TouchableOpacity
                onPress={() => handleQuestionTap(index)}
                activeOpacity={0.7}
                style={styles.promptHeader}
              >
                <Text
                  style={styles.promptText}
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
                    <Text style={styles.reflectionLabel}>What comes to mind?</Text>
                    <TextInput
                      style={styles.reflectionInput}
                      placeholder="Jot your thoughts here..."
                      placeholderTextColor="#6B7280"
                      value={noteText}
                      onChangeText={(text) => handleSaveNote(index, text)}
                      multiline
                      numberOfLines={3}
                    />
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        style={[styles.saveBtn, isSaved && styles.saveBtnActive]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {isSaved && <Icon name="check" size={14} color="#059669" />}
                          <Text style={[styles.saveBtnText, isSaved && styles.saveBtnTextActive]}>
                            {isSaved ? 'Saved' : 'Save'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.guruBtn}
                        onPress={() => handleExploreWithGuru(prompt, index)}
                      >
                        <GuruRings size="logo" dimensions={18} />
                        <Text style={styles.guruBtnText}>Explore with Guru</Text>
                        <Text style={styles.guruArrow}>→</Text>
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
    fontSize: 15,
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  reflectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  reflectionInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 16,
    color: '#E2E8F0',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnActive: {
    backgroundColor: 'rgba(16,185,129,0.15)',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  saveBtnTextActive: {
    color: '#059669',
  },
  guruBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
    gap: 8,
  },
  guruIconContainer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guruIconText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
  },
  guruBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  guruArrow: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.8,
  },
});
