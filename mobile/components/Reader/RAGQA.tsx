import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { SocraticChat } from './SocraticChat';
import Icon from '../ui/Icon';
import { Spacing } from '@/constants/liquidGlass';

interface PreviousConversation {
  conversationId: string;
  exchangeType: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  lastUpdated: string;
}

const getTimeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
};

interface Citation {
  source: string;
  page?: string;
  link?: string;
}

interface QAPair {
  id: string;
  question: string;
  answer: string;
  citations: string[];
  saved?: boolean;
  isSocratic?: boolean;
  socraticBrief?: string;
  leadingQuestion?: string;
  showingBrief?: boolean;
}

interface SavedQAPair extends QAPair {
  articleId: string;
  timestamp: string;
}

interface RAGQAProps {
  articleId: string;
  articleTitle: string;
  articleContent?: string;
  suggestedQuestions: QAPair[];
}

export const RAGQA: React.FC<RAGQAProps> = ({
  articleId,
  articleTitle,
  articleContent = '',
  suggestedQuestions,
}) => {
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [savedQuestions, setSavedQuestions] = useState<Set<string>>(new Set());
  const [customQuestion, setCustomQuestion] = useState('');
  const [customQAs, setCustomQAs] = useState<QAPair[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [socraticQuestions, setSocraticQuestions] = useState<QAPair[]>([]);
  const [loadingSocratic, setLoadingSocratic] = useState(false);
  const [showSocraticChat, setShowSocraticChat] = useState(false);
  const [selectedSocraticQuestion, setSelectedSocraticQuestion] = useState<string>('');
  const [socraticNotes, setSocraticNotes] = useState<Record<string, string>>({});
  const [previousConversations, setPreviousConversations] = useState<PreviousConversation[]>([]);
  const [resumeConversationId, setResumeConversationId] = useState<string | undefined>(undefined);
  const [resumeMessages, setResumeMessages] = useState<{ role: 'user' | 'assistant'; content: string }[] | undefined>(undefined);

  // Load saved Q&As, Socratic notes, fetch Socratic questions, and previous conversations on mount
  useEffect(() => {
    loadSavedQAs();
    loadSocraticNotes();
    fetchSocraticQuestions();
    fetchPreviousConversations();
  }, [articleId]);

  const fetchPreviousConversations = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch(
        `${API_BASE_URL}/articles/${articleId}/qa?limit=50`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (response.ok) {
        const data = await response.json();
        // Group exchanges by conversation_id
        const grouped: Record<string, PreviousConversation> = {};
        for (const exchange of data.exchanges || []) {
          const convId = exchange.conversation_id || exchange.id;
          if (!grouped[convId]) {
            grouped[convId] = {
              conversationId: convId,
              exchangeType: exchange.exchange_type || 'direct',
              messages: [],
              lastUpdated: exchange.created_at,
            };
          }
          grouped[convId].messages.push(
            { role: 'user', content: exchange.question },
            { role: 'assistant', content: exchange.answer }
          );
          if (exchange.created_at > grouped[convId].lastUpdated) {
            grouped[convId].lastUpdated = exchange.created_at;
          }
        }
        // Sort by most recent first
        const conversations = Object.values(grouped).sort(
          (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
        );
        setPreviousConversations(conversations);
      }
    } catch (error) {
    }
  }, [articleId]);

  const loadSocraticNotes = () => {
    try {
      const saved = localStorage.getItem('guru_socratic_notes');
      if (saved) {
        const allNotes = JSON.parse(saved);
        const articleNotes = allNotes[articleId] || {};
        setSocraticNotes(articleNotes);
      }
    } catch (error) {
    }
  };

  const handleSaveNote = (questionId: string, note: string) => {
    try {
      const saved = localStorage.getItem('guru_socratic_notes');
      const allNotes = saved ? JSON.parse(saved) : {};
      
      if (!allNotes[articleId]) {
        allNotes[articleId] = {};
      }
      
      allNotes[articleId][questionId] = {
        note,
        timestamp: new Date().toISOString(),
        articleTitle: articleTitle,
      };
      
      localStorage.setItem('guru_socratic_notes', JSON.stringify(allNotes));
      setSocraticNotes(prev => ({ ...prev, [questionId]: note }));
      
    } catch (error) {
    }
  };

  const fetchSocraticQuestions = async () => {
    try {
      setLoadingSocratic(true);
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch(
        `${API_BASE_URL}/reader/articles/${articleId}/questions`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedQuestions: QAPair[] = (data.questions || []).map((q: any, idx: number) => ({
          id: `socratic-${idx}`,
          question: q.question,
          answer: '', // Will be generated on demand
          citations: [articleTitle],
          isSocratic: true,
          socraticBrief: generateSocraticBrief(q.question),
          leadingQuestion: generateLeadingQuestion(q.question),
          showingBrief: true,
        }));
        setSocraticQuestions(formattedQuestions);
      }
    } catch (error) {
    } finally {
      setLoadingSocratic(false);
    }
  };

  const generateSocraticBrief = (question: string): string => {
    // Generate a brief thought-provoking response
    const briefs: Record<string, string> = {
      'why': 'Consider the underlying forces and motivations at play.',
      'how': 'Think about the mechanisms and processes involved.',
      'what': 'Reflect on the key elements and their significance.',
      'when': 'Consider the timing and its strategic importance.',
      'who': 'Think about the stakeholders and their interests.',
    };
    
    const questionLower = question.toLowerCase();
    for (const [key, brief] of Object.entries(briefs)) {
      if (questionLower.startsWith(key)) {
        return brief;
      }
    }
    return 'Take a moment to reflect on this question and its implications.';
  };

  const generateLeadingQuestion = (question: string): string => {
    // Generate a follow-up question that leads to deeper inquiry
    const questionLower = question.toLowerCase();
    if (questionLower.includes('why')) {
      return 'What evidence in the article supports this reasoning?';
    } else if (questionLower.includes('how')) {
      return 'What are the practical implications for your work?';
    } else if (questionLower.includes('impact') || questionLower.includes('affect')) {
      return 'How might this change your approach or strategy?';
    }
    return 'What additional context from the article helps answer this?';
  };

  const loadSavedQAs = () => {
    try {
      const saved = localStorage.getItem('guru_divein_qa_pairs');
      if (saved) {
        const allSaved: SavedQAPair[] = JSON.parse(saved);
        const articleSaved = allSaved
          .filter(qa => qa.articleId === articleId && qa.saved)
          .map(qa => qa.id);
        setSavedQuestions(new Set(articleSaved));
      }
    } catch (error) {
    }
  };

  const handleQuestionClick = (questionId: string) => {
    const question = [...socraticQuestions, ...suggestedQuestions, ...customQAs].find(q => q.id === questionId);
    
    if (!question) return;

    // For Socratic questions, toggle between brief and full answer
    if (question.isSocratic && question.showingBrief) {
      // First click: show brief + leading question
      if (expandedQuestionId === questionId) {
        setExpandedQuestionId(null);
      } else {
        setExpandedQuestionId(questionId);
      }
    } else if (question.isSocratic && !question.showingBrief) {
      // Already showing full answer, just toggle
      if (expandedQuestionId === questionId) {
        setExpandedQuestionId(null);
      } else {
        setExpandedQuestionId(questionId);
      }
    } else {
      // Regular questions
      if (expandedQuestionId === questionId) {
        setExpandedQuestionId(null);
      } else {
        setExpandedQuestionId(questionId);
      }
    }
  };

  const handleExpandToFullAnswer = (questionId: string) => {
    // Open Socratic chat interface instead of showing static answer
    const question = socraticQuestions.find(q => q.id === questionId);
    if (!question) return;

    setResumeConversationId(undefined);
    setResumeMessages(undefined);
    setSelectedSocraticQuestion(question.question);
    setShowSocraticChat(true);
  };

  const handleResumeConversation = (conv: PreviousConversation) => {
    setResumeConversationId(conv.conversationId);
    setResumeMessages(conv.messages);
    setSelectedSocraticQuestion('');
    setShowSocraticChat(true);
  };

  const handleCloseSocraticChat = () => {
    setShowSocraticChat(false);
    setSelectedSocraticQuestion('');
    setResumeConversationId(undefined);
    setResumeMessages(undefined);
    // Refresh previous conversations after closing (new turns may have been added)
    fetchPreviousConversations();
  };

  const handleSaveQA = (qa: QAPair) => {
    try {
      const saved = localStorage.getItem('guru_divein_qa_pairs');
      const allSaved: SavedQAPair[] = saved ? JSON.parse(saved) : [];
      
      // Check if already saved
      const existingIndex = allSaved.findIndex(
        item => item.articleId === articleId && item.id === qa.id
      );

      if (existingIndex >= 0) {
        // Toggle saved state
        allSaved[existingIndex].saved = !allSaved[existingIndex].saved;
      } else {
        // Add new saved Q&A
        allSaved.push({
          ...qa,
          articleId,
          timestamp: new Date().toISOString(),
          saved: true,
        });
      }

      localStorage.setItem('guru_divein_qa_pairs', JSON.stringify(allSaved));
      
      // Update local state
      const newSaved = new Set(savedQuestions);
      if (newSaved.has(qa.id)) {
        newSaved.delete(qa.id);
      } else {
        newSaved.add(qa.id);
      }
      setSavedQuestions(newSaved);
      
    } catch (error) {
    }
  };

  // Enhanced RAG function that extracts relevant context from article
  const generateContextualAnswer = (question: string): { answer: string; citations: string[] } => {
    const questionLower = question.toLowerCase();
    
    // Extract relevant sections from article content
    const paragraphs = articleContent.split('\n\n').filter(p => p.trim().length > 50);
    
    // Advanced keyword matching - extract key terms from question
    const keywords = questionLower
      .replace(/[?.,!]/g, '')
      .split(' ')
      .filter(w => w.length > 3 && !['what', 'when', 'where', 'which', 'should', 'could', 'would', 'does', 'have', 'been', 'will', 'this', 'that', 'from', 'with', 'they', 'their'].includes(w));
    
    // Find most relevant paragraphs with scoring
    const scoredParagraphs = paragraphs.map(p => {
      const pLower = p.toLowerCase();
      const score = keywords.reduce((acc, keyword) => {
        const count = (pLower.match(new RegExp(keyword, 'g')) || []).length;
        return acc + count;
      }, 0);
      return { text: p, score };
    }).filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    
    // Extract direct quotes (sentences containing key terms)
    const getRelevantQuotes = (paragraphs: Array<{text: string, score: number}>, maxQuotes: number = 2) => {
      const quotes: string[] = [];
      for (const para of paragraphs) {
        const sentences = para.text.split(/[.!?]+/).filter(s => s.trim().length > 40);
        for (const sentence of sentences) {
          if (keywords.some(k => sentence.toLowerCase().includes(k)) && quotes.length < maxQuotes) {
            quotes.push(sentence.trim());
          }
        }
      }
      return quotes;
    };
    
    const relevantQuotes = getRelevantQuotes(scoredParagraphs);
    
    // Generate concise, specific answer
    let answer = '';
    let citations: string[] = [articleTitle];
    
    if (scoredParagraphs.length === 0) {
      answer = "I couldn't find specific information about this in the article. Try asking about topics covered in the article.";
      return { answer, citations };
    }
    
    // Build answer from most relevant content
    const topParagraph = scoredParagraphs[0].text;
    
    // Extract key points (sentences with numbers, specific claims, or strong statements)
    const keyPoints = topParagraph
      .split(/[.!?]+/)
      .filter(s => s.trim().length > 30)
      .filter(s => /\d+|will|should|must|key|important|significant|critical/.test(s.toLowerCase()))
      .slice(0, 3);
    
    if (relevantQuotes.length > 0) {
      answer = relevantQuotes.map(q => `"${q}"`).join('\n\n');
      if (keyPoints.length > 0 && !relevantQuotes.some(q => keyPoints[0].includes(q))) {
        answer += `\n\n${keyPoints[0]}.`;
      }
    } else if (keyPoints.length > 0) {
      answer = keyPoints.join('. ') + '.';
    } else {
      // Fallback to first 2 sentences of most relevant paragraph
      const sentences = topParagraph.split(/[.!?]+/).filter(s => s.trim().length > 30).slice(0, 2);
      answer = sentences.join('. ') + '.';
    }
    
    return { answer, citations };
  };

  const handleSubmitCustomQuestion = async () => {
    if (!customQuestion.trim()) return;

    setIsGenerating(true);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No auth token');
      }

      // Call backend API for context-aware answer using Claude
      const response = await fetch(`${API_BASE_URL}/qa/ask`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article_id: articleId,
          question: customQuestion,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get answer');
      }

      const data = await response.json();
      
      const customQA: QAPair = {
        id: `custom-${Date.now()}`,
        question: customQuestion,
        answer: data.answer,
        citations: data.citations || [articleTitle],
        saved: false,
      };

      setCustomQAs([...customQAs, customQA]);
      setExpandedQuestionId(customQA.id);
      setCustomQuestion('');
    } catch (error) {
      // Fallback to local RAG if API fails
      const { answer, citations } = generateContextualAnswer(customQuestion);
      
      const customQA: QAPair = {
        id: `custom-${Date.now()}`,
        question: customQuestion,
        answer,
        citations,
        saved: false,
      };

      setCustomQAs([...customQAs, customQA]);
      setExpandedQuestionId(customQA.id);
      setCustomQuestion('');
    } finally {
      setIsGenerating(false);
    }
  };

  const allQuestions = [...socraticQuestions, ...suggestedQuestions, ...customQAs];

  const renderCitations = (citations: string[]) => {
    return (
      <View style={styles.citationList}>
        <Text style={styles.citationListTitle}>Citations:</Text>
        {citations.map((citation, index) => (
          <View key={index} style={styles.citationItem}>
            <Text style={styles.citationBullet}>•</Text>
            <Text style={styles.citationText}>{citation}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderAnswer = (qa: QAPair) => {
    const isSaved = savedQuestions.has(qa.id);

    // For Socratic questions showing brief
    if (qa.isSocratic && qa.showingBrief) {
      const noteText = socraticNotes[qa.id] || '';
      
      return (
        <View style={styles.answerContainer}>
          <View style={styles.socraticBriefContainer}>
            <Icon name="thought-bubble-outline" size={20} color="#92400E" />
            <Text style={styles.socraticBriefText}>{qa.socraticBrief}</Text>
          </View>
          
          <View style={styles.leadingQuestionContainer}>
            <Text style={styles.leadingQuestionLabel}>Consider:</Text>
            <Text style={styles.leadingQuestionText}>{qa.leadingQuestion}</Text>
          </View>

          {/* Note-taking area */}
          <View style={styles.noteContainer}>
            <Text style={styles.noteLabel}>Your Reflection:</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Take notes on your thoughts... (saved for recap)"
              placeholderTextColor="#9CA3AF"
              value={noteText}
              onChangeText={(text) => handleSaveNote(qa.id, text)}
              multiline
              numberOfLines={3}
              accessibilityLabel="Reflection notes"
            />
            {noteText.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                <Icon name="check" size={12} color="#10B981" />
                <Text style={[styles.noteSavedIndicator, { marginTop: 0 }]}>Saved for recap</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.expandToFullButton}
            onPress={() => handleExpandToFullAnswer(qa.id)}
            accessibilityRole="button"
            accessibilityLabel="Get detailed answer from article"
          >
            <Text style={styles.expandToFullButtonText}>Find Answer in Article</Text>
            <Text style={styles.expandToFullArrow}>→</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Regular answer display (for Socratic after expansion or regular questions)
    return (
      <View style={styles.answerContainer}>
        <Text style={styles.answerText}>{qa.answer}</Text>
        
        {qa.citations && qa.citations.length > 0 && renderCitations(qa.citations)}

        <View style={styles.answerActions}>
          <TouchableOpacity
            style={[styles.saveButton, isSaved && styles.saveButtonActive]}
            onPress={() => handleSaveQA(qa)}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Q&A saved' : 'Save this Q&A'}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {isSaved && <Icon name="check" size={14} color="#fff" />}
              <Text style={[styles.saveButtonText, isSaved && styles.saveButtonTextActive]}>
                {isSaved ? 'Saved' : 'Save Q&A'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              // Copy to clipboard functionality
            }}
            accessibilityRole="button"
            accessibilityLabel="Copy Q&A"
          >
            <Text style={styles.actionButtonText}>Copy</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              // Share functionality
            }}
            accessibilityRole="button"
            accessibilityLabel="Share Q&A"
          >
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Questions & Answers</Text>
      <Text style={styles.sectionSubtitle}>
        Explore key insights from this article
      </Text>

      {/* Suggested Questions */}
      <View style={styles.questionsContainer}>
        <Text style={styles.suggestedTitle}>Suggested Questions</Text>
        
        {allQuestions.map((qa, index) => {
          const isExpanded = expandedQuestionId === qa.id;
          const isSuggested = index < suggestedQuestions.length;

          return (
            <View key={qa.id} style={styles.questionCard}>
              <TouchableOpacity
                style={styles.questionButton}
                onPress={() => handleQuestionClick(qa.id)}
                accessibilityRole="button"
                accessibilityLabel={`Question ${index + 1}: ${qa.question}`}
                accessibilityState={{ expanded: isExpanded }}
              >
                <View style={styles.questionHeader}>
                  {isSuggested && (
                    <View style={styles.questionNumber}>
                      <Text style={styles.questionNumberText}>{index + 1}</Text>
                    </View>
                  )}
                  <Text style={styles.questionText}>{qa.question}</Text>
                  <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
                </View>
              </TouchableOpacity>

              {isExpanded && renderAnswer(qa)}
            </View>
          );
        })}
      </View>

      {/* Custom Question Input */}
      <View style={styles.customQuestionSection}>
        <Text style={styles.customQuestionLabel}>
          Ask your own question about this article
        </Text>
        
        <View style={styles.customQuestionInput}>
          <TextInput
            style={styles.textInput}
            placeholder="What would you like to know?"
            placeholderTextColor="#999"
            value={customQuestion}
            onChangeText={setCustomQuestion}
            multiline
            numberOfLines={2}
            editable={!isGenerating}
            accessibilityLabel="Custom question input"
          />
          
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!customQuestion.trim() || isGenerating) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmitCustomQuestion}
            disabled={!customQuestion.trim() || isGenerating}
            accessibilityRole="button"
            accessibilityLabel="Submit question"
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>

        {isGenerating && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#38BDF8" />
            <Text style={styles.loadingText}>Generating answer...</Text>
          </View>
        )}
      </View>

      {/* Previous Conversations */}
      {previousConversations.length > 0 && (
        <View style={styles.previousConversationsSection}>
          <View style={styles.previousConversationsHeader}>
            <Icon name="message-text-outline" size={16} color="#38BDF8" />
            <Text style={styles.previousConversationsTitle}>Previous Conversations</Text>
          </View>
          {previousConversations.slice(0, 3).map((conv) => {
            const firstQuestion = conv.messages[0]?.content || 'Conversation';
            const turnCount = Math.floor(conv.messages.length / 2);
            const timeAgo = getTimeAgo(conv.lastUpdated);
            return (
              <TouchableOpacity
                key={conv.conversationId}
                style={styles.previousConvCard}
                onPress={() => handleResumeConversation(conv)}
                activeOpacity={0.7}
              >
                <View style={styles.previousConvContent}>
                  <Text style={styles.previousConvQuestion} numberOfLines={2}>
                    {firstQuestion}
                  </Text>
                  <View style={styles.previousConvMeta}>
                    <Text style={styles.previousConvTurns}>
                      {turnCount} {turnCount === 1 ? 'turn' : 'turns'}
                    </Text>
                    <Text style={styles.previousConvDot}>-</Text>
                    <Text style={styles.previousConvTime}>{timeAgo}</Text>
                  </View>
                </View>
                <Text style={styles.previousConvArrow}>→</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Socratic Chat Modal */}
      <Modal
        visible={showSocraticChat}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseSocraticChat}
      >
        <SocraticChat
          articleId={articleId}
          articleTitle={articleTitle}
          initialQuestion={selectedSocraticQuestion}
          onClose={handleCloseSocraticChat}
          existingConversationId={resumeConversationId}
          previousMessages={resumeMessages}
        />
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: Spacing.sm,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: '#94A3B8',
    marginBottom: Spacing.lg,
  },
  questionsContainer: {
    marginBottom: Spacing.xl,
  },
  suggestedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#38BDF8',
    marginBottom: Spacing.md,
  },
  questionCard: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  questionButton: {
    padding: Spacing.md,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  questionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionNumberText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  questionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    lineHeight: 22,
  },
  chevron: {
    fontSize: 14,
    color: '#94A3B8',
  },
  answerContainer: {
    padding: Spacing.md,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  answerText: {
    fontSize: 16,
    lineHeight: 26,
    color: '#E2E8F0',
    marginBottom: Spacing.md,
  },
  citationList: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    borderRadius: Spacing.sm,
    marginBottom: Spacing.md,
  },
  citationListTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: Spacing.sm,
  },
  citationItem: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  citationBullet: {
    fontSize: 12,
    color: '#64748B',
    marginRight: 6,
  },
  citationText: {
    flex: 1,
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  answerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  saveButtonActive: {
    backgroundColor: '#38BDF8',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  saveButtonTextActive: {
    color: '#fff',
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  customQuestionSection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 20,
    borderRadius: 12,
  },
  customQuestionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  customQuestionInput: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: Spacing.sm,
    padding: 12,
    fontSize: 16,
    lineHeight: 22,
    color: '#E2E8F0',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#38BDF8',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Spacing.sm,
    minHeight: 60,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  loadingText: {
    fontSize: 14,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  socraticBriefContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(146,64,14,0.15)',
    padding: Spacing.md,
    borderRadius: Spacing.sm,
    marginBottom: Spacing.md,
    gap: 12,
  },
  socraticBriefIcon: {
    // Kept for backward compat
  },
  socraticBriefText: {
    flex: 1,
    fontSize: 16,
    color: '#92400E',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  leadingQuestionContainer: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: Spacing.md,
    borderRadius: Spacing.sm,
    marginBottom: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
  },
  leadingQuestionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38BDF8',
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  leadingQuestionText: {
    fontSize: 16,
    color: '#E2E8F0',
    lineHeight: 22,
    fontWeight: '500',
  },
  expandToFullButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#38BDF8',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Spacing.sm,
    gap: Spacing.sm,
  },
  expandToFullButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  expandToFullArrow: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  noteContainer: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: Spacing.md,
    borderRadius: Spacing.sm,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  noteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: Spacing.sm,
  },
  noteInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    color: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  noteSavedIndicator: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  previousConversationsSection: {
    marginTop: Spacing.lg,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  previousConversationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 12,
  },
  previousConversationsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#38BDF8',
  },
  previousConvCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  previousConvContent: {
    flex: 1,
  },
  previousConvQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F1F5F9',
    lineHeight: 20,
    marginBottom: Spacing.xs,
  },
  previousConvMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previousConvTurns: {
    fontSize: 12,
    color: '#94A3B8',
  },
  previousConvDot: {
    fontSize: 12,
    color: '#64748B',
  },
  previousConvTime: {
    fontSize: 12,
    color: '#94A3B8',
  },
  previousConvArrow: {
    fontSize: 18,
    color: '#38BDF8',
    fontWeight: '600',
    marginLeft: 12,
  },
});
