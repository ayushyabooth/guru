import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Spacing, Typography, BorderRadius, RingColors, DarkGlassMaterials, GlassMaterials, getBackdropBlur } from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from '../ui/Icon';
import GlassButton from '../ui/GlassButton';
import GuruBlob from '../ui/GuruBlob';
import { cleanGuruResponse } from '../ui/GuruFormattedText';
import { SocraticResponse, KeyInsight } from '../../services/recap-service';

interface SocraticStageProps {
  onSendMessage: (message: string) => Promise<SocraticResponse>;
  onComplete: () => void;
  initialExchanges?: Array<{ role: string; content: string }>;
}

interface ChatBubble {
  role: 'assistant' | 'user';
  content: string;
  insightCaptured?: KeyInsight | null;
}

// Parse [[Article: "title" | id:UUID]] tags from response text
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

export default function SocraticStage({ onSendMessage, onComplete, initialExchanges }: SocraticStageProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;
  const [messages, setMessages] = useState<ChatBubble[]>(
    // Restored exchanges can carry the model's raw JSON wrapper — clean on seed.
    (initialExchanges || []).map(e => ({
      role: e.role as 'assistant' | 'user',
      content: e.role === 'assistant' ? cleanGuruResponse(e.content) : e.content,
    }))
  );
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConcluded, setIsConcluded] = useState(false);
  const [insightCount, setInsightCount] = useState(0);
  const [showInsightToast, setShowInsightToast] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const hasAutoSent = useRef(false);

  // Auto-send opening message to get a provocative question from Guru
  useEffect(() => {
    if (hasAutoSent.current) return;
    if (messages.length > 0) return; // Already has exchanges (resumed session)
    hasAutoSent.current = true;

    (async () => {
      setIsLoading(true);
      try {
        const response = await onSendMessage('__open__');
        setMessages([{
          role: 'assistant',
          content: cleanGuruResponse(response.response),
          insightCaptured: response.insight_extracted,
        }]);
      } catch {
        setMessages([{
          role: 'assistant',
          content: "Let's explore what you've learned this week. What stood out to you most from your reading?",
        }]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;
    const userMsg = inputText.trim();
    setInputText('');

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const response = await onSendMessage(userMsg);

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: cleanGuruResponse(response.response),
        insightCaptured: response.insight_extracted,
      }]);

      if (response.insight_extracted) {
        setInsightCount(prev => prev + 1);
        setShowInsightToast(true);
        setTimeout(() => setShowInsightToast(false), 2500);
      }

      if (response.is_concluded) {
        setIsConcluded(true);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'I had trouble processing that. Could you try rephrasing?',
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  // GUR-212: let the user advance to Commitment after a couple of genuine
  // exchanges even if the backend never sets is_concluded — otherwise the
  // Socratic stage can get stuck in an endless loop at 75% with no way out.
  const userExchangeCount = messages.filter((m) => m.role === 'user').length;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Insight toast */}
      {showInsightToast && (
        <View style={styles.insightToast}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="star-four-points" size={14} color="#fff" />
            <Text style={styles.insightToastText}>Insight captured</Text>
          </View>
        </View>
      )}

      {/* Chat messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg, idx) => {
          const { parts } = msg.role === 'assistant' ? parseArticleRefs(msg.content) : { parts: [msg.content] };

          return (
            <View key={idx} style={[
              styles.bubble,
              msg.role === 'assistant' ? [GM.card, styles.assistantBubble] : styles.userBubble,
            ]}>
              <Text style={[
                styles.bubbleText,
                { color: colors.textPrimary },
              ]}>
                {parts.map((part, pIdx) => {
                  if (typeof part === 'string') {
                    return part;
                  }
                  // Render article reference as inline text (tappable chips below)
                  return (
                    <Text key={`ref-${pIdx}`} style={styles.articleRefInline}>
                      {part.title}
                    </Text>
                  );
                })}
              </Text>

              {/* Render article chips below the message */}
              {msg.role === 'assistant' && parts.some(p => typeof p !== 'string') && (
                <View style={styles.articleChipsContainer}>
                  {parts.filter(p => typeof p !== 'string').map((ref: any, rIdx) => (
                    <TouchableOpacity
                      key={`chip-${rIdx}`}
                      style={styles.articleChip}
                      onPress={() => router.push(`/article/${ref.id}?source=recap`)}
                      activeOpacity={0.7}
                    >
                      <Icon name="file-document-outline" size={12} color="#FB923C" />
                      <Text style={styles.articleChipText} numberOfLines={1}>{ref.title}</Text>
                      <Text style={styles.articleChipArrow}>→</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {msg.insightCaptured && (
                <View style={styles.insightIndicator}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon name="star-four-points" size={12} color={RingColors.recap.primary} />
                    <Text style={styles.insightIndicatorText}>Insight captured</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {isLoading && (
          <View style={[styles.bubble, GM.card, styles.assistantBubble, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <GuruBlob size={20} state="thinking" tight />
            <Text style={[styles.loadingText, { color: colors.textTertiary }]}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input area or completion */}
      {isConcluded ? (
        <View style={[styles.concludedArea, { backgroundColor: GM.card.backgroundColor }]}>
          <Text style={[styles.concludedText, { color: colors.textSecondary }]}>
            {insightCount > 0 ? `${insightCount} insight${insightCount > 1 ? 's' : ''} captured during this dialogue` : 'Dialogue complete'}
          </Text>
          <GlassButton
            title="Continue →"
            onPress={onComplete}
            accentColor="#FB923C"
            size="lg"
          />
        </View>
      ) : (
        <View style={[styles.composer, { backgroundColor: GM.card.backgroundColor }]}>
          {/* GUR-212: manual advance to Commitment once there are >=2 user
              exchanges, so the journey is never stuck if is_concluded never fires. */}
          {userExchangeCount >= 2 && (
            <View style={styles.advanceRow}>
              <GlassButton
                title="Continue to Commitment →"
                onPress={onComplete}
                accentColor="#FB923C"
                size="md"
              />
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={[GM.input, styles.chatInput, { color: colors.textPrimary }]}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Share your thoughts..."
              placeholderTextColor={colors.textTertiary}
              multiline
              editable={!isLoading}
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || isLoading}
            >
              <Text style={styles.sendButtonText}>↑</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  insightToast: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 100,
    backgroundColor: 'rgba(251, 146, 60, 0.9)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
  },
  insightToastText: {
    ...Typography.labelSmall,
    color: '#fff',
    fontWeight: '700',
  },
  chatArea: { flex: 1 },
  chatContent: {
    padding: Spacing.lg,
    paddingBottom: 20,
    gap: Spacing.lg,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...getBackdropBlur(12),
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.lg,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(20, 184, 166, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(20, 184, 166, 0.25)',
    ...getBackdropBlur(12),
  },
  bubbleText: {
    ...Typography.bodyMedium,
    lineHeight: 22,
  },
  // bubble text color now applied inline via `colors.textPrimary`
  loadingText: {
    ...Typography.bodyMedium,
    fontStyle: 'italic',
  },
  insightIndicator: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251, 146, 60, 0.2)',
  },
  insightIndicatorText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingBottom: 100,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    ...getBackdropBlur(20),
    gap: Spacing.sm,
  },
  // GUR-212: composer wraps an optional "Continue to Commitment" advance row
  // above the reply input row.
  composer: {
    paddingBottom: 100,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    ...getBackdropBlur(20),
  },
  advanceRow: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  chatInput: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.bodyMedium,
    maxHeight: 100,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: BorderRadius.lg,
    ...getBackdropBlur(12),
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: RingColors.recap.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  concludedArea: {
    alignItems: 'center',
    padding: Spacing.lg,
    paddingBottom: 100,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    ...getBackdropBlur(20),
  },
  concludedText: {
    ...Typography.bodyMedium,
    marginBottom: Spacing.md,
  },
  // Article reference styles
  articleRefInline: {
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  articleChipsContainer: {
    marginTop: Spacing.sm,
    gap: 6,
  },
  articleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 146, 60, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
    gap: 6,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(8px)',
        cursor: 'pointer',
      } as any,
      default: {},
    }),
  },
  articleChipText: {
    flex: 1,
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
    fontWeight: '500',
  },
  articleChipArrow: {
    fontSize: 14,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
});
