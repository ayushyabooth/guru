import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../ui/Icon';
import { Spacing, Typography, BorderRadius, RingColors, DarkGlassMaterials, getBackdropBlur } from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import { GuidedQuestion } from '../../services/recap-service';

interface QuestionsStageProps {
  questions: GuidedQuestion[];
  responses: Record<string, string>;
  onAnswer: (questionIndex: number, response: string) => Promise<{
    followup_text?: string;
    referenced_articles?: string[];
  } | void>;
  onComplete: () => void;
  onSkipToSocratic?: () => void;
}

interface Message {
  role: 'system' | 'user';
  text: string;
}

interface QuestionThread {
  question: GuidedQuestion;
  messages: Message[];
  answered: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  retrieval: '#38BDF8',
  pattern_spotting: '#EC4899',
  reflection: '#FB923C',
  surprise: '#EC4899',
};

const TYPE_LABELS: Record<string, string> = {
  retrieval: 'Retrieval',
  pattern_spotting: 'Pattern Spotting',
  reflection: 'Reflection',
  surprise: 'Surprise',
};

// Parse [[Article: "title" | id:UUID]] references in text
const parseArticleRefs = (text: string): { parts: (string | { title: string; id: string })[] } => {
  const regex = /\[\[Article:\s*"([^"]+)"\s*\|\s*id:([a-f0-9-]+)\]\]/gi;
  const parts: (string | { title: string; id: string })[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push({ title: match[1], id: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return { parts: parts.length > 0 ? parts : [text] };
};

export default function QuestionsStage({
  questions,
  responses,
  onAnswer,
  onComplete,
  onSkipToSocratic,
}: QuestionsStageProps) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  // Initialize threads from questions
  const [threads, setThreads] = useState<QuestionThread[]>(() =>
    questions.map((q, idx) => ({
      question: q,
      messages: [{ role: 'system' as const, text: q.text }],
      answered: !!responses[String(idx)],
    }))
  );
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.max(0, questions.findIndex((_, idx) => !responses[String(idx)]))
  );
  const [inputText, setInputText] = useState('');
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasAnsweredAny = threads.some(t => t.answered);

  const currentThread = threads[currentIndex];
  if (!currentThread) return null;

  const currentQuestion = currentThread.question;
  const isChipFormat = currentQuestion.response_format === 'tappable_chips';
  const hasInput = isChipFormat ? !!selectedChip : inputText.trim().length > 0;
  const typeColor = TYPE_COLORS[currentQuestion.type] || RingColors.recap.primary;

  useEffect(() => {
    // Scroll to bottom when messages change
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [currentThread.messages.length]);

  const handleSubmit = async () => {
    const answer = isChipFormat ? (selectedChip || '') : inputText.trim();
    if (!answer) return;

    // Add user message to thread
    setThreads(prev => {
      const updated = [...prev];
      updated[currentIndex] = {
        ...updated[currentIndex],
        messages: [...updated[currentIndex].messages, { role: 'user', text: answer }],
        answered: true,
      };
      return updated;
    });
    setInputText('');
    setSelectedChip(null);
    setIsLoading(true);

    try {
      // Submit answer and get follow-up
      const result = await onAnswer(currentIndex, answer);

      if (result && result.followup_text) {
        // Add follow-up as system message
        setThreads(prev => {
          const updated = [...prev];
          updated[currentIndex] = {
            ...updated[currentIndex],
            messages: [
              ...updated[currentIndex].messages,
              { role: 'system', text: result.followup_text! },
            ],
          };
          return updated;
        });
      }
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      setInputText('');
      setSelectedChip(null);
    }
  };

  const handleArticleTap = (id: string) => {
    router.push(`/article/${id}?source=recap` as any);
  };

  // Render a message bubble with article reference parsing
  const renderMessage = (msg: Message, idx: number) => {
    const isUser = msg.role === 'user';
    const { parts } = !isUser ? parseArticleRefs(msg.text) : { parts: [msg.text] };

    return (
      <View key={idx} style={[styles.bubble, isUser ? styles.userBubble : styles.systemBubble]}>
        <Text style={[styles.bubbleText, isUser ? styles.userBubbleText : styles.systemBubbleText]}>
          {parts.map((part, pIdx) =>
            typeof part === 'string' ? (
              <Text key={pIdx}>{part}</Text>
            ) : (
              <Text
                key={pIdx}
                style={styles.articleRef}
                onPress={() => handleArticleTap(part.id)}
              >
                {part.title}
              </Text>
            )
          )}
        </Text>
        {/* Article chips below system messages */}
        {!isUser && (() => {
          const articleParts = parts.filter((p): p is { title: string; id: string } => typeof p !== 'string');
          if (articleParts.length === 0) return null;
          return (
            <View style={styles.articleChips}>
              {articleParts.map((ref, rIdx) => (
                <TouchableOpacity
                  key={rIdx}
                  style={styles.articleChip}
                  onPress={() => handleArticleTap(ref.id)}
                >
                  <Icon name="file-document-outline" size={12} color={RingColors.recap.primary} />
                  <Text style={styles.articleChipText} numberOfLines={1}>{ref.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Header with progress */}
      <View style={styles.header}>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            Question {currentIndex + 1} of {questions.length}
          </Text>
          <View style={styles.progressDots}>
            {questions.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.dot,
                  threads[idx]?.answered && styles.dotCompleted,
                  idx === currentIndex && styles.dotCurrent,
                ]}
              />
            ))}
          </View>
        </View>

        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: typeColor + '20', borderColor: typeColor + '40' }]}>
          <Text style={[styles.typeBadgeText, { color: typeColor }]}>
            {TYPE_LABELS[currentQuestion.type] || currentQuestion.type}
          </Text>
        </View>
      </View>

      {/* Message thread */}
      <ScrollView
        ref={scrollRef}
        style={styles.threadScroll}
        contentContainerStyle={styles.threadContent}
        showsVerticalScrollIndicator={false}
      >
        {currentThread.messages.map((msg, idx) => renderMessage(msg, idx))}

        {isLoading && (
          <View style={[styles.bubble, styles.systemBubble]}>
            <ActivityIndicator size="small" color={RingColors.recap.primary} />
            <Text style={styles.loadingText}>Reflecting...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input area */}
      <View style={styles.inputArea}>
        {isChipFormat && currentQuestion.chips && !currentThread.answered ? (
          <View style={styles.chipsContainer}>
            {currentQuestion.chips.map((chip, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.chip, selectedChip === chip && styles.chipSelected]}
                onPress={() => setSelectedChip(chip)}
              >
                <Text style={[styles.chipText, selectedChip === chip && styles.chipTextSelected]}>
                  {chip}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={currentThread.answered ? 'Reply to follow-up...' : 'Share your thoughts...'}
              placeholderTextColor={DarkThemeColors.textTertiary}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !hasInput && styles.sendButtonDisabled]}
              onPress={handleSubmit}
              disabled={!hasInput || isLoading}
            >
              <Icon name="send" size={18} color={hasInput ? '#fff' : 'rgba(255,255,255,0.3)'} />
            </TouchableOpacity>
          </View>
        )}

        {/* Chip submit button */}
        {isChipFormat && selectedChip && !currentThread.answered && (
          <TouchableOpacity style={styles.chipSubmitButton} onPress={handleSubmit} disabled={isLoading}>
            <Text style={styles.chipSubmitText}>Submit</Text>
          </TouchableOpacity>
        )}

        {/* Navigation buttons */}
        <View style={styles.navRow}>
          {currentIndex < questions.length - 1 && currentThread.answered && (
            <TouchableOpacity style={styles.nextButton} onPress={handleNextQuestion}>
              <Text style={styles.nextButtonText}>Next Question</Text>
              <Icon name="chevron-right" size={16} color={RingColors.recap.primary} />
            </TouchableOpacity>
          )}
          {hasAnsweredAny && onSkipToSocratic && (
            <TouchableOpacity style={styles.socraticButton} onPress={onSkipToSocratic}>
              <Text style={styles.socraticButtonText}>Continue to Socratic</Text>
              <Icon name="chevron-right" size={16} color="#fff" />
            </TouchableOpacity>
          )}
          {currentIndex === questions.length - 1 && currentThread.answered && !onSkipToSocratic && (
            <TouchableOpacity style={styles.socraticButton} onPress={onComplete}>
              <Text style={styles.socraticButtonText}>Continue</Text>
              <Icon name="chevron-right" size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  progressText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
  },
  dotCompleted: {
    backgroundColor: RingColors.recap.primary,
  },
  dotCurrent: {
    backgroundColor: RingColors.recap.primary,
    width: 20,
    borderRadius: 4,
  },
  typeBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
  },
  typeBadgeText: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  threadScroll: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  threadContent: {
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  systemBubble: {
    alignSelf: 'flex-start',
    backgroundColor: DarkGlassMaterials.cardHeavy.backgroundColor,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  bubbleText: {
    ...Typography.bodyMedium,
    lineHeight: 22,
  },
  systemBubbleText: {
    color: DarkThemeColors.textPrimary,
  },
  userBubbleText: {
    color: DarkThemeColors.textPrimary,
  },
  articleRef: {
    color: RingColors.recap.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  articleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  articleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.25)',
  },
  articleChipText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
    maxWidth: 180,
  },
  loadingText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
    marginLeft: Spacing.sm,
  },
  inputArea: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    ...DarkGlassMaterials.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxHeight: 100,
    fontSize: 16,
    color: DarkThemeColors.textPrimary,
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: RingColors.recap.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  chip: {
    backgroundColor: DarkGlassMaterials.button.backgroundColor,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: DarkGlassMaterials.button.borderColor,
  },
  chipSelected: {
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    borderColor: RingColors.recap.primary,
  },
  chipText: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textPrimary,
  },
  chipTextSelected: {
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  chipSubmitButton: {
    alignSelf: 'center',
    backgroundColor: RingColors.recap.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    marginTop: Spacing.sm,
  },
  chipSubmitText: {
    ...Typography.labelMedium,
    color: '#fff',
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.4)',
  },
  nextButtonText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  socraticButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: RingColors.recap.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
  },
  socraticButtonText: {
    ...Typography.labelMedium,
    color: '#fff',
    fontWeight: '700',
  },
});
