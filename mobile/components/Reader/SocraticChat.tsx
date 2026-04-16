import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Animated, Easing, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import Icon from '../ui/Icon';
import { OrganicBackground } from '../ui';
import { Triskelion } from '../Rings/Triskelion';
import { Spacing } from '@/constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
}

interface SocraticChatProps {
  articleId: string;
  articleTitle?: string;
  articleSource?: string;
  initialQuestion: string;
  onClose: () => void;
  onBack?: () => void;  // Go back to previous screen (reflection modal)
  onViewStory?: () => void;  // Jump to story/storyboard
  existingConversationId?: string;  // Resume a previous conversation
  previousMessages?: ChatMessage[];  // Pre-loaded messages from history
}

// Simple markdown renderer for bold and lists
const renderMarkdown = (text: string, isUser: boolean, textColor: string, accentColor: string) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();

    // Skip empty lines but add spacing
    if (!trimmed) {
      elements.push(<View key={`space-${lineIdx}`} style={{ height: 8 }} />);
      return;
    }

    // Numbered list item
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      elements.push(
        <View key={`line-${lineIdx}`} style={markdownStyles.listItem}>
          <Text style={[markdownStyles.listNumber, { color: isUser ? '#FFFFFF' : accentColor }]}>{numberedMatch[1]}.</Text>
          <Text style={[markdownStyles.listText, { color: textColor }]}>
            {renderInlineMarkdown(numberedMatch[2], isUser, textColor, accentColor)}
          </Text>
        </View>
      );
      return;
    }

    // Bullet list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      elements.push(
        <View key={`line-${lineIdx}`} style={markdownStyles.listItem}>
          <Text style={[markdownStyles.bullet, { color: isUser ? '#FFFFFF' : accentColor }]}>•</Text>
          <Text style={[markdownStyles.listText, { color: textColor }]}>
            {renderInlineMarkdown(trimmed.substring(2), isUser, textColor, accentColor)}
          </Text>
        </View>
      );
      return;
    }

    // Regular paragraph
    elements.push(
      <Text key={`line-${lineIdx}`} style={[markdownStyles.paragraph, { color: textColor }]}>
        {renderInlineMarkdown(trimmed, isUser, textColor, accentColor)}
      </Text>
    );
  });

  return elements;
};

// Render inline markdown (bold)
const renderInlineMarkdown = (text: string, isUser: boolean, textColor: string, accentColor: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // Add bold text
    parts.push(
      <Text key={`bold-${idx}`} style={[markdownStyles.bold, { color: isUser ? '#FFFFFF' : accentColor, fontWeight: '700' }]}>
        {match[1]}
      </Text>
    );
    lastIndex = regex.lastIndex;
    idx++;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
};

const markdownStyles = StyleSheet.create({
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: Spacing.sm,
  },
  userText: {
    color: '#FFFFFF',
  },
  bold: {
    fontWeight: '700',
  },
  userBold: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 6,
    paddingLeft: Spacing.xs,
  },
  listNumber: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    width: 24,
  },
  bullet: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    width: 16,
  },
  listText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
});

// Breathing animation for loading triskelion
function BreathingTriskelion() {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View style={{ opacity: anim }}>
      <Triskelion size={24} progress={{ c: 1, d: 1, r: 1 }} mode="logo" />
    </Animated.View>
  );
}

// Generate a UUID v4 (simplified for cross-platform)
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const SocraticChat: React.FC<SocraticChatProps> = ({
  articleId,
  articleTitle,
  articleSource,
  initialQuestion,
  onClose,
  onBack,
  onViewStory,
  existingConversationId,
  previousMessages,
}) => {
  const { isDark, colors: themeColors } = useTheme();

  // Theme tokens for Guru Chat
  // Light: indigo (#6366F1) accent; Dark: sky blue (#38BDF8) accent
  const CHAT_ACCENT = isDark ? '#38BDF8' : '#6366F1';
  const containerBg = isDark ? 'rgba(10, 14, 23, 0.92)' : 'transparent';
  const headerBg = isDark ? 'rgba(15, 20, 35, 0.65)' : 'rgba(255,255,255,0.80)';
  const headerBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const backBtnColor = isDark ? '#38BDF8' : '#6366F1';
  const headerTitleColor = isDark ? '#F1F5F9' : themeColors.textPrimary;
  const contextChipBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)';
  const contextChipBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.20)';
  const contextLabelColor = isDark ? '#64748B' : '#94A3B8';
  const contextTitleColor = isDark ? '#F1F5F9' : '#475569';
  const userBubbleBg = isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(99,102,241,0.90)';
  const userBubbleBorder = isDark ? 'rgba(125, 211, 252, 0.25)' : 'rgba(99,102,241,0.40)';
  const userTextColor = '#FFFFFF';
  const assistantBubbleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.90)';
  const assistantBubbleBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.15)';
  const assistantAccentBarColor = isDark ? '#6366F1' : '#6366F1';
  const assistantTextColor = isDark ? '#E2E8F0' : '#334155';
  const guruLabelColor = '#6366F1';
  const inputOuterBg = isDark ? 'rgba(15,20,35,0.55)' : 'rgba(255,255,255,0.90)';
  const inputOuterBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.20)';
  const inputFieldBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.95)';
  const inputFieldBorderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(99,102,241,0.20)';
  const inputTextColor = isDark ? '#F1F5F9' : themeColors.textPrimary;
  const inputPlaceholderColor = isDark ? '#9CA3AF' : '#94A3B8';
  const sendBtnBg = isDark ? 'rgba(56, 189, 248, 0.85)' : '#6366F1';
  const sendBtnBorder = isDark ? 'rgba(125, 211, 252, 0.4)' : 'rgba(99,102,241,0.40)';
  const sendBtnDisabledBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const followUpBg = isDark ? 'rgba(251,191,36,0.08)' : 'rgba(0,0,0,0.04)';
  const followUpBorderColor = isDark ? 'rgba(251,191,36,0.2)' : 'rgba(0,0,0,0.10)';
  const followUpTextColor = isDark ? '#FBBF24' : '#6366F1';
  const followUpPromptBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.05)';
  const followUpPromptBorder = isDark ? 'rgba(251,191,36,0.2)' : 'rgba(99,102,241,0.15)';

  const [messages, setMessages] = useState<ChatMessage[]>(previousMessages || []);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [followUpPrompts, setFollowUpPrompts] = useState<string[]>([]);
  const [showArticleContext, setShowArticleContext] = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);
  const conversationIdRef = useRef<string>(existingConversationId || generateUUID());

  useEffect(() => {
    // Only send initial question if we're not resuming a previous conversation
    if (!previousMessages || previousMessages.length === 0) {
      sendMessage(initialQuestion);
    }
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Add user message to chat
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
    };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No auth token');
      }

      // Build conversation history (exclude the current message we just added)
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(`${API_BASE_URL}/socratic/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article_id: articleId,
          question: text,
          conversation_history: conversationHistory,
          conversation_id: conversationIdRef.current,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();

      // Update conversation_id from backend (in case it was generated server-side)
      if (data.conversation_id) {
        conversationIdRef.current = data.conversation_id;
      }

      // Add assistant message to chat
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.response,
        citations: data.related_article_citations || [],
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Update follow-up prompts
      if (data.follow_up_prompts && data.follow_up_prompts.length > 0) {
        setFollowUpPrompts(data.follow_up_prompts);
      }
    } catch (error) {
      // Add error message
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = () => {
    sendMessage(inputText);
  };

  const handlePromptClick = (prompt: string) => {
    sendMessage(prompt);
    setFollowUpPrompts([]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: containerBg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <OrganicBackground variant="catchup" />
      {/* Glass Header */}
      <View style={[
        styles.header,
        { backgroundColor: headerBg, borderBottomColor: headerBorderColor },
        Platform.OS === 'web' && {
          // @ts-ignore
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        } as any,
      ]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack || onClose}
        >
          <Text style={[styles.backButtonText, { color: backBtnColor }]}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Triskelion size={20} progress={{ c: 1, d: 1, r: 1 }} mode="logo" />
          <Text style={[styles.headerTitle, { color: headerTitleColor }]}>Guru</Text>
        </View>

        <TouchableOpacity style={[styles.closeButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} onPress={onClose}>
          <Icon name="close" size={18} color={isDark ? '#94A3B8' : themeColors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Glass Article Context Card */}
      {articleTitle && showArticleContext && (
        <TouchableOpacity
          style={[
            styles.articleContext,
            { backgroundColor: contextChipBg, borderColor: contextChipBorderColor },
            Platform.OS === 'web' && {
              // @ts-ignore
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            } as any,
          ]}
          onPress={onViewStory}
          activeOpacity={0.8}
        >
          {/* Left accent bar */}
          <View style={[styles.articleContextAccentBar, { backgroundColor: CHAT_ACCENT }]} />
          <View style={styles.articleContextContent}>
            <View style={styles.articleContextText}>
              <Text style={[styles.articleContextLabel, { color: contextLabelColor }]}>FROM ARTICLE:</Text>
              <Text style={[styles.articleContextTitle, { color: contextTitleColor }]} numberOfLines={1}>
                {articleTitle}
              </Text>
              {articleSource && (
                <Text style={[styles.articleContextSource, { color: isDark ? '#94A3B8' : themeColors.textTertiary }]}>{articleSource}</Text>
              )}
            </View>
          </View>
          {onViewStory && (
            <Text style={[styles.articleContextAction, { color: CHAT_ACCENT }]}>View Story →</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
      >
        {messages.map((message, index) => (
          <View
            key={index}
            style={[
              styles.messageWrapper,
              message.role === 'user' ? styles.userMessageWrapper : styles.assistantMessageWrapper,
            ]}
          >
            <View
              style={[
                styles.messageBubble,
                message.role === 'user'
                  ? { backgroundColor: userBubbleBg, borderColor: userBubbleBorder, borderBottomRightRadius: 6 }
                  : { backgroundColor: assistantBubbleBg, borderColor: assistantBubbleBorder, borderBottomLeftRadius: 6 },
                { borderWidth: 1, borderRadius: 20 },
                Platform.OS === 'web' && message.role === 'user' && {
                  // @ts-ignore
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                } as any,
                Platform.OS === 'web' && message.role === 'assistant' && {
                  // @ts-ignore
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                } as any,
              ] as any}
            >
              {/* Assistant bubble: left accent bar + Guru label */}
              {message.role === 'assistant' && (
                <>
                  <View style={[styles.assistantAccentBar, { backgroundColor: assistantAccentBarColor }]} />
                  <View style={styles.assistantBubbleHeader}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: guruLabelColor, textTransform: 'uppercase', letterSpacing: 0.5 }}>Guru</Text>
                  </View>
                </>
              )}

              <View style={[
                styles.messageContent,
                message.role === 'assistant' && { paddingLeft: 4 },
              ]}>
                {renderMarkdown(
                  message.content,
                  message.role === 'user',
                  message.role === 'user' ? userTextColor : assistantTextColor,
                  CHAT_ACCENT,
                )}
              </View>

              {/* Citations */}
              {message.citations && message.citations.length > 0 && (
                <View style={[styles.citationsContainer, { borderTopColor: `${CHAT_ACCENT}26` }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <Icon name="bookshelf" size={13} color={CHAT_ACCENT} />
                    <Text style={[styles.citationsLabel, { marginBottom: 0, color: CHAT_ACCENT }]}>Related Articles</Text>
                  </View>
                  {message.citations.map((citation, idx) => (
                    <Text key={idx} style={[styles.citationText, { color: isDark ? '#94A3B8' : themeColors.textTertiary, borderLeftColor: `${CHAT_ACCENT}4D` }]}>
                      {citation}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        ))}

        {/* Loading indicator — animated breathing triskelion */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <BreathingTriskelion />
          </View>
        )}

        {/* Follow-up prompts - Dynamic Socratic questions */}
        {!isLoading && followUpPrompts.length > 0 && (
          <View style={[styles.promptsContainer, { backgroundColor: followUpBg, borderColor: followUpBorderColor }]}>
            <View style={styles.promptsHeader}>
              <Icon name="lightbulb-outline" size={16} color={followUpTextColor} />
              <Text style={[styles.promptsLabel, { color: followUpTextColor }]}>Go deeper</Text>
            </View>
            {followUpPrompts.map((prompt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.promptButton,
                  { backgroundColor: followUpPromptBg, borderColor: followUpPromptBorder },
                  idx === 0 && { backgroundColor: isDark ? '#FBBF24' : CHAT_ACCENT, borderColor: isDark ? '#F59E0B' : CHAT_ACCENT },
                  Platform.OS === 'web' && {
                    // @ts-ignore
                    transition: 'all 0.2s ease',
                  },
                ] as any}
                onPress={() => handlePromptClick(prompt)}
                activeOpacity={0.7}
              >
                <View style={styles.promptContent}>
                  <Text style={[styles.promptArrow, { color: idx === 0 ? '#FFFFFF' : followUpTextColor }]}>→</Text>
                  <Text style={[
                    styles.promptButtonText,
                    { color: idx === 0 ? '#FFFFFF' : followUpTextColor },
                  ]}>{prompt}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Glass Input Bar */}
      <View style={[
        styles.inputContainerOuter,
        { backgroundColor: inputOuterBg, borderTopColor: inputOuterBorderColor, borderTopWidth: isDark ? 1 : 1.5 },
        Platform.OS === 'web' && {
          // @ts-ignore
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        } as any,
      ]}>
        <View style={styles.inputContainer}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: inputFieldBg, borderColor: inputFieldBorderColor, color: inputTextColor },
              Platform.OS === 'web' && {
                // @ts-ignore
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              } as any,
            ]}
            placeholder="Ask about this article..."
            placeholderTextColor={inputPlaceholderColor}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            editable={!isLoading}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: sendBtnBg, borderColor: sendBtnBorder },
              (!inputText.trim() || isLoading) && { backgroundColor: sendBtnDisabledBg, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', shadowOpacity: 0 },
            ]}
            onPress={handleSubmit}
            disabled={!inputText.trim() || isLoading}
          >
            <Icon name="send" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Glass Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'web' ? 12 : 50,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: 12,
    borderRadius: Spacing.sm,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    padding: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  // Glass Article context card
  articleContext: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.md,
    marginTop: 12,
    padding: 12,
    paddingLeft: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  articleContextAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  articleContextContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  articleContextText: {
    flex: 1,
  },
  articleContextLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
  },
  articleContextTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  articleContextSource: {
    fontSize: 12,
  },
  articleContextAction: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Messages area
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 20,
    paddingBottom: Spacing.lg,
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  messageWrapper: {
    marginBottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  userMessageWrapper: {
    alignSelf: 'flex-end',
    maxWidth: '75%',
    flexDirection: 'row-reverse',
  },
  assistantMessageWrapper: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  messageBubble: {
    borderRadius: 16,
    padding: Spacing.md,
    flex: 1,
    overflow: 'hidden',
  },
  // Bubble shape variants (overridden inline with theme colors)
  userBubble: {},
  assistantBubble: {
    position: 'relative',
  },
  assistantAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 6,
  },
  assistantBubbleHeader: {
    marginBottom: 6,
    paddingLeft: 4,
  },
  messageContent: {
    // Container for rendered markdown
  },
  messageText: {
    fontSize: 16,
    lineHeight: Spacing.lg,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {},
  citationsContainer: {
    marginTop: Spacing.md,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  citationsLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  citationText: {
    fontSize: 12,
    lineHeight: 20,
    marginBottom: Spacing.xs,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 2,
  },
  // Loading: breathing triskelion
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: Spacing.md,
    paddingLeft: 16,
    gap: 12,
  },
  promptsContainer: {
    marginTop: Spacing.md,
    marginRight: Spacing.md,
    borderRadius: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
  },
  promptsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: Spacing.sm,
  },
  promptsLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  promptButton: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  promptButtonPrimary: {},
  promptContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  promptArrow: {
    fontSize: 16,
    fontWeight: '700',
  },
  promptButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  promptButtonTextPrimary: {
    fontWeight: '600',
  },
  // Glass Input Bar
  inputContainerOuter: {},
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    paddingBottom: Platform.OS === 'web' ? Spacing.md : Spacing.xl,
    gap: 12,
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  input: {
    flex: 1,
    borderRadius: Spacing.lg,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 120,
    borderWidth: 1,
  },
  // Glass circle send button
  sendButton: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: Spacing.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: {},
  sendButtonText: {
    // kept for backward compat
  },
});
