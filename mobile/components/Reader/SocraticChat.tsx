import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Animated, Easing, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import Icon from '../ui/Icon';
import { OrganicBackground } from '../ui';
import { Triskelion } from '../Rings/Triskelion';
import { Spacing } from '@/constants/liquidGlass';

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
const renderMarkdown = (text: string, isUser: boolean) => {
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
          <Text style={[markdownStyles.listNumber, isUser && markdownStyles.userText]}>{numberedMatch[1]}.</Text>
          <Text style={[markdownStyles.listText, isUser && markdownStyles.userText]}>
            {renderInlineMarkdown(numberedMatch[2], isUser)}
          </Text>
        </View>
      );
      return;
    }

    // Bullet list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      elements.push(
        <View key={`line-${lineIdx}`} style={markdownStyles.listItem}>
          <Text style={[markdownStyles.bullet, isUser && markdownStyles.userText]}>•</Text>
          <Text style={[markdownStyles.listText, isUser && markdownStyles.userText]}>
            {renderInlineMarkdown(trimmed.substring(2), isUser)}
          </Text>
        </View>
      );
      return;
    }

    // Regular paragraph
    elements.push(
      <Text key={`line-${lineIdx}`} style={[markdownStyles.paragraph, isUser && markdownStyles.userText]}>
        {renderInlineMarkdown(trimmed, isUser)}
      </Text>
    );
  });

  return elements;
};

// Render inline markdown (bold)
const renderInlineMarkdown = (text: string, isUser: boolean): React.ReactNode[] => {
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
      <Text key={`bold-${idx}`} style={[markdownStyles.bold, isUser && markdownStyles.userBold]}>
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
    color: '#E2E8F0',
    marginBottom: Spacing.sm,
  },
  userText: {
    color: '#FFFFFF',
  },
  bold: {
    fontWeight: '700',
    color: '#38BDF8',
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
    color: '#38BDF8',
    fontWeight: '600',
    width: 24,
  },
  bullet: {
    fontSize: 16,
    lineHeight: 24,
    color: '#38BDF8',
    fontWeight: '600',
    width: 16,
  },
  listText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: '#E2E8F0',
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <OrganicBackground variant="catchup" />
      {/* Glass Header */}
      <View style={[
        styles.header,
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
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Triskelion size={20} progress={{ c: 1, d: 1, r: 1 }} mode="logo" />
          <Text style={styles.headerTitle}>Guru</Text>
        </View>

        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Icon name="close" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Glass Article Context Card */}
      {articleTitle && showArticleContext && (
        <TouchableOpacity
          style={[
            styles.articleContext,
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
          <View style={styles.articleContextAccentBar} />
          <View style={styles.articleContextContent}>
            <View style={styles.articleContextText}>
              <Text style={styles.articleContextLabel}>FROM ARTICLE</Text>
              <Text style={styles.articleContextTitle} numberOfLines={1}>
                {articleTitle}
              </Text>
              {articleSource && (
                <Text style={styles.articleContextSource}>{articleSource}</Text>
              )}
            </View>
          </View>
          {onViewStory && (
            <Text style={styles.articleContextAction}>View Story →</Text>
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
                message.role === 'user' ? styles.userBubble : styles.assistantBubble,
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
              {/* Assistant bubble: left accent bar + triskelion */}
              {message.role === 'assistant' && (
                <>
                  <View style={styles.assistantAccentBar} />
                  <View style={styles.assistantBubbleHeader}>
                    <Triskelion size={12} progress={{ c: 1, d: 1, r: 1 }} mode="logo" />
                  </View>
                </>
              )}

              <View style={[
                styles.messageContent,
                message.role === 'assistant' && { paddingLeft: 4 },
              ]}>
                {renderMarkdown(message.content, message.role === 'user')}
              </View>

              {/* Citations */}
              {message.citations && message.citations.length > 0 && (
                <View style={styles.citationsContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <Icon name="bookshelf" size={13} color="#38BDF8" />
                    <Text style={[styles.citationsLabel, { marginBottom: 0 }]}>Related Articles</Text>
                  </View>
                  {message.citations.map((citation, idx) => (
                    <Text key={idx} style={styles.citationText}>
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
          <View style={styles.promptsContainer}>
            <View style={styles.promptsHeader}>
              <Icon name="lightbulb-outline" size={16} color="#B45309" />
              <Text style={styles.promptsLabel}>Go deeper</Text>
            </View>
            {followUpPrompts.map((prompt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.promptButton,
                  idx === 0 && styles.promptButtonPrimary,
                  Platform.OS === 'web' && {
                    // @ts-ignore
                    transition: 'all 0.2s ease',
                  },
                ] as any}
                onPress={() => handlePromptClick(prompt)}
                activeOpacity={0.7}
              >
                <View style={styles.promptContent}>
                  <Text style={styles.promptArrow}>→</Text>
                  <Text style={[
                    styles.promptButtonText,
                    idx === 0 && styles.promptButtonTextPrimary,
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
              Platform.OS === 'web' && {
                // @ts-ignore
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              } as any,
            ]}
            placeholder="Share your thoughts or ask a question..."
            placeholderTextColor="#9CA3AF"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            editable={!isLoading}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
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
    backgroundColor: 'rgba(10, 14, 23, 0.92)',
  },
  // Glass Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'web' ? 12 : 50,
    backgroundColor: 'rgba(15, 20, 35, 0.65)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  backButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: 12,
    borderRadius: Spacing.sm,
  },
  backButtonText: {
    fontSize: 16,
    color: '#38BDF8',
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
    color: '#F1F5F9',
  },
  closeButton: {
    padding: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  articleContextAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#38BDF8',
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
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
  },
  articleContextTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F1F5F9',
    marginTop: 2,
  },
  articleContextSource: {
    fontSize: 12,
    color: '#94A3B8',
  },
  articleContextAction: {
    fontSize: 12,
    color: '#38BDF8',
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
    borderRadius: 20,
    padding: Spacing.md,
    flex: 1,
    overflow: 'hidden',
  },
  // User bubble: translucent teal/blue tint
  userBubble: {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.25)',
    borderBottomRightRadius: 6,
  },
  // Assistant bubble: neutral glass with left accent bar
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 6,
    position: 'relative',
  },
  assistantAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#6366F1',
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 6,
  },
  assistantBubbleHeader: {
    marginBottom: 6,
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
  assistantText: {
    color: '#E2E8F0',
  },
  citationsContainer: {
    marginTop: Spacing.md,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(56,189,248,0.15)',
  },
  citationsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38BDF8',
    marginBottom: Spacing.sm,
  },
  citationText: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 20,
    marginBottom: Spacing.xs,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(56,189,248,0.3)',
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
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
  },
  promptsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: Spacing.sm,
  },
  promptsLabel: {
    fontSize: 12,
    color: '#FBBF24',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  promptButton: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
  },
  promptButtonPrimary: {
    backgroundColor: '#FBBF24',
    borderColor: '#F59E0B',
  },
  promptContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  promptArrow: {
    fontSize: 16,
    color: '#B45309',
    fontWeight: '700',
  },
  promptButtonText: {
    flex: 1,
    fontSize: 14,
    color: '#FBBF24',
    fontWeight: '500',
    lineHeight: 20,
  },
  promptButtonTextPrimary: {
    color: '#78350F',
    fontWeight: '600',
  },
  // Glass Input Bar
  inputContainerOuter: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: Spacing.lg,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 16,
    color: '#F1F5F9',
    maxHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  // Glass circle send button
  sendButton: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: Spacing.xxl / 2,
    backgroundColor: 'rgba(56, 189, 248, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.4)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.08)',
    shadowOpacity: 0,
  },
  sendButtonText: {
    // kept for backward compat
  },
});
