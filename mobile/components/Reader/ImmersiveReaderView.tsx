import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, Animated, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import Icon from '../ui/Icon';

export interface ArticleData {
  id: string;
  headline: string;
  author?: string;
  publishDate: string;
  source: string;
  expertFlags?: number;
  isSaved: boolean;
  fullText: string;
  url?: string;
}

interface RelatedArticle {
  id: string;
  title: string;
  source: string;
  url?: string;
  context: string;
  similarity_score: number;
  teaser?: string;
}

interface SocraticQuestion {
  question: string;
  context: string;
  position: string;
}

interface ImmersiveReaderViewProps {
  article: ArticleData;
  onSave: (articleId: string) => Promise<void>;
  onUnsave: (articleId: string) => Promise<void>;
  onBack: () => void;
  onRelatedArticleClick?: (articleId: string) => void;
}

export const ImmersiveReaderView: React.FC<ImmersiveReaderViewProps> = ({
  article,
  onSave,
  onUnsave,
  onBack,
  onRelatedArticleClick,
}) => {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(article.isSaved);
  const [timeSpent, setTimeSpent] = useState(0);
  const [relatedArticles, setRelatedArticles] = useState<RelatedArticle[]>([]);
  const [socraticQuestions, setSocraticQuestions] = useState<SocraticQuestion[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<SocraticQuestion | null>(null);
  const [selectedRelated, setSelectedRelated] = useState<RelatedArticle | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchRelatedArticles();
    fetchSocraticQuestions();
    
    // Start timer
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setTimeSpent(elapsed);
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [article.id]);

  const fetchRelatedArticles = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `${API_BASE_URL}/reader/articles/${article.id}/related?limit=4`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setRelatedArticles(data.related_articles || []);
      }
    } catch (error) {
    }
  };

  const fetchSocraticQuestions = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `${API_BASE_URL}/reader/articles/${article.id}/questions`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setSocraticQuestions(data.questions || []);
      }
    } catch (error) {
    }
  };

  const handleSaveToggle = async () => {
    try {
      if (isSaved) {
        await onUnsave(article.id);
        setIsSaved(false);
      } else {
        await onSave(article.id);
        setIsSaved(true);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update save status. Please try again.');
    }
  };

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const progress = contentOffset.y / (contentSize.height - layoutMeasurement.height);
    setScrollProgress(Math.min(Math.max(progress, 0), 1));
  };

  const openQuestionModal = (question: SocraticQuestion) => {
    setSelectedQuestion(question);
    setShowQuestionModal(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const closeQuestionModal = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowQuestionModal(false);
      setSelectedQuestion(null);
    });
  };

  const openRelatedModal = (related: RelatedArticle) => {
    setSelectedRelated(related);
    setShowRelatedModal(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const closeRelatedModal = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowRelatedModal(false);
      setSelectedRelated(null);
    });
  };

  const handleRelatedArticleNavigate = (articleId: string) => {
    closeRelatedModal();
    if (onRelatedArticleClick) {
      onRelatedArticleClick(articleId);
    } else {
      router.push(`/article/${articleId}`);
    }
  };

  const getQuestionsByPosition = (position: string) => {
    return socraticQuestions.filter(q => q.position === position);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          <Text style={styles.timeText}>{formatTime(timeSpent)}</Text>
          <TouchableOpacity
            style={[styles.saveButton, isSaved && styles.saveButtonActive]}
            onPress={handleSaveToggle}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {isSaved && <Icon name="check" size={14} color="#FFFFFF" />}
              <Text style={[styles.saveButtonText, isSaved && styles.saveButtonTextActive]}>
                {isSaved ? 'Saved' : 'Save'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Reading Progress Bar */}
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBar, { width: `${scrollProgress * 100}%` }]} />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.contentContainer}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Article Metadata */}
        <View style={styles.metadata}>
          <Text style={styles.source}>{article.source}</Text>
          <Text style={styles.date}>
            {new Date(article.publishDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>

        <Text style={styles.headline}>{article.headline}</Text>

        {/* Intro Socratic Questions */}
        {getQuestionsByPosition('intro').map((q, idx) => (
          <TouchableOpacity
            key={`intro-${idx}`}
            style={styles.inlineQuestionCard}
            onPress={() => openQuestionModal(q)}
          >
            <View style={styles.questionIcon}>
              <Icon name="thought-bubble-outline" size={18} color="#F59E0B" />
            </View>
            <Text style={styles.inlineQuestionText}>{q.question}</Text>
            <Text style={styles.questionArrow}>→</Text>
          </TouchableOpacity>
        ))}

        {/* Embedded Web Article or Full Text */}
        {article.url && !article.fullText ? (
          <View style={styles.webViewContainer}>
            <WebView
              source={{ uri: article.url }}
              style={styles.webView}
              startInLoadingState={true}
              scalesPageToFit={true}
            />
          </View>
        ) : (
          <View style={styles.articleTextContainer}>
            {(article.fullText || '').split('\n\n').filter(p => p.trim().length > 0).map((paragraph, index) => {
              const trimmed = paragraph.trim();
              const headerMatch = trimmed.match(/^#{1,6}\s+(.*)/);
              if (headerMatch) {
                return (
                  <Text key={`heading-${index}`} style={styles.sectionHeading}>
                    {headerMatch[1]}
                  </Text>
                );
              }
              if (/^(\d+\.\s|- )/.test(trimmed)) {
                const lines = trimmed.split('\n').filter(l => l.trim());
                return (
                  <View key={`list-${index}`}>
                    {lines.map((item, i) => {
                      const bulletMatch = item.match(/^- (.+)/);
                      const numMatch = item.match(/^(\d+)\.\s+(.+)/);
                      if (bulletMatch) {
                        return (
                          <View key={`li-${index}-${i}`} style={styles.listItem}>
                            <Text style={styles.listBullet}>{'\u2022'}</Text>
                            <Text style={styles.listItemText}>{bulletMatch[1]}</Text>
                          </View>
                        );
                      } else if (numMatch) {
                        return (
                          <View key={`li-${index}-${i}`} style={styles.listItem}>
                            <Text style={styles.listNumber}>{numMatch[1]}.</Text>
                            <Text style={styles.listItemText}>{numMatch[2]}</Text>
                          </View>
                        );
                      }
                      return (
                        <Text key={`li-${index}-${i}`} style={styles.articleText}>
                          {item}
                        </Text>
                      );
                    })}
                  </View>
                );
              }
              return (
                <Text key={`para-${index}`} style={styles.articleText}>
                  {trimmed}
                </Text>
              );
            })}
          </View>
        )}

        {/* Middle Socratic Questions */}
        {getQuestionsByPosition('middle').map((q, idx) => (
          <TouchableOpacity
            key={`middle-${idx}`}
            style={styles.inlineQuestionCard}
            onPress={() => openQuestionModal(q)}
          >
            <View style={styles.questionIcon}>
              <Icon name="help-circle-outline" size={18} color="#F59E0B" />
            </View>
            <Text style={styles.inlineQuestionText}>{q.question}</Text>
            <Text style={styles.questionArrow}>→</Text>
          </TouchableOpacity>
        ))}

        {/* Related Articles Section */}
        {relatedArticles.length > 0 && (
          <View style={styles.relatedSection}>
            <Text style={styles.relatedTitle}>Related Reading</Text>
            <Text style={styles.relatedSubtitle}>
              Semantically connected articles from your feed
            </Text>
            {relatedArticles.map((related, idx) => (
              <TouchableOpacity
                key={related.id}
                style={styles.relatedCard}
                onPress={() => openRelatedModal(related)}
              >
                <View style={styles.relatedHeader}>
                  <View style={styles.contextBadge}>
                    <Text style={styles.contextBadgeText}>{related.context}</Text>
                  </View>
                  <Text style={styles.similarityScore}>
                    {Math.round(related.similarity_score * 100)}% match
                  </Text>
                </View>
                <Text style={styles.relatedHeadline}>{related.title}</Text>
                <Text style={styles.relatedSource}>{related.source}</Text>
                {related.teaser && (
                  <Text style={styles.relatedTeaser}>{related.teaser}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Conclusion Socratic Questions */}
        {getQuestionsByPosition('conclusion').map((q, idx) => (
          <TouchableOpacity
            key={`conclusion-${idx}`}
            style={styles.inlineQuestionCard}
            onPress={() => openQuestionModal(q)}
          >
            <View style={styles.questionIcon}>
              <Icon name="auto-awesome" size={18} color="#F59E0B" library="mi" />
            </View>
            <Text style={styles.inlineQuestionText}>{q.question}</Text>
            <Text style={styles.questionArrow}>→</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Socratic Question Modal */}
      <Modal
        visible={showQuestionModal}
        transparent={true}
        animationType="none"
        onRequestClose={closeQuestionModal}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeQuestionModal}
          />
          <Animated.View
            style={[
              styles.modalContent,
              {
                transform: [
                  {
                    translateY: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [50, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reflect & Connect</Text>
              <TouchableOpacity onPress={closeQuestionModal}>
                <Icon name="close" size={24} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
            
            {selectedQuestion && (
              <View style={styles.modalBody}>
                <Text style={styles.questionModalText}>{selectedQuestion.question}</Text>
                <View style={styles.contextTag}>
                  <Text style={styles.contextTagText}>{selectedQuestion.context}</Text>
                </View>
                <Text style={styles.questionHint}>
                  Take a moment to consider how this applies to your work and experience.
                </Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Related Article Modal */}
      <Modal
        visible={showRelatedModal}
        transparent={true}
        animationType="none"
        onRequestClose={closeRelatedModal}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeRelatedModal}
          />
          <Animated.View
            style={[
              styles.modalContent,
              {
                transform: [
                  {
                    translateY: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [50, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Continue Reading</Text>
              <TouchableOpacity onPress={closeRelatedModal}>
                <Icon name="close" size={24} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
            
            {selectedRelated && (
              <View style={styles.modalBody}>
                <View style={styles.relatedModalHeader}>
                  <View style={styles.contextBadge}>
                    <Text style={styles.contextBadgeText}>{selectedRelated.context}</Text>
                  </View>
                  <Text style={styles.similarityScore}>
                    {Math.round(selectedRelated.similarity_score * 100)}% related
                  </Text>
                </View>
                <Text style={styles.relatedModalHeadline}>{selectedRelated.title}</Text>
                <Text style={styles.relatedModalSource}>{selectedRelated.source}</Text>
                {selectedRelated.teaser && (
                  <Text style={styles.relatedModalTeaser}>{selectedRelated.teaser}</Text>
                )}
                <TouchableOpacity
                  style={styles.readArticleButton}
                  onPress={() => handleRelatedArticleNavigate(selectedRelated.id)}
                >
                  <Text style={styles.readArticleButtonText}>Read Article</Text>
                  <Text style={styles.readArticleArrow}>→</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(15,20,35,0.55)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: '#32b0c6',
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  timeText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#32b0c6',
  },
  saveButtonActive: {
    backgroundColor: '#32b0c6',
  },
  saveButtonText: {
    fontSize: 14,
    color: '#32b0c6',
    fontWeight: '600',
  },
  saveButtonTextActive: {
    color: '#FFFFFF',
  },
  progressBarContainer: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#32b0c6',
  },
  scrollContainer: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  source: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '600',
  },
  date: {
    fontSize: 14,
    color: '#64748B',
  },
  headline: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F1F5F9',
    lineHeight: 36,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  inlineQuestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 8,
    gap: 12,
  },
  questionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,20,35,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionIconText: {
    // Kept for backward compat
  },
  inlineQuestionText: {
    flex: 1,
    fontSize: 15,
    color: '#F59E0B',
    fontWeight: '600',
    lineHeight: 22,
  },
  questionArrow: {
    fontSize: 18,
    color: '#F59E0B',
  },
  webViewContainer: {
    height: 600,
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(15,20,35,0.55)',
  },
  webView: {
    flex: 1,
  },
  articleTextContainer: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeading: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700' as const,
    color: '#F1F5F9',
    marginTop: 16,
    marginBottom: 12,
  },
  articleText: {
    fontSize: 17,
    lineHeight: 28,
    color: '#E2E8F0',
    marginBottom: 16,
  },
  listItem: {
    flexDirection: 'row' as const,
    paddingLeft: 8,
    marginBottom: 6,
  },
  listBullet: {
    fontSize: 17,
    lineHeight: 28,
    color: '#94A3B8',
    width: 20,
  },
  listNumber: {
    fontSize: 17,
    lineHeight: 28,
    color: '#94A3B8',
    fontWeight: '600' as const,
    width: 28,
  },
  listItemText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 28,
    color: '#E2E8F0',
  },
  relatedSection: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginTop: 24,
  },
  relatedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 8,
  },
  relatedSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 20,
  },
  relatedCard: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  relatedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  contextBadge: {
    backgroundColor: 'rgba(50, 176, 198, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  contextBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#32b0c6',
    textTransform: 'uppercase',
  },
  similarityScore: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
  },
  relatedHeadline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F1F5F9',
    lineHeight: 22,
    marginBottom: 8,
  },
  relatedSource: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 8,
  },
  relatedTeaser: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  modalClose: {
    // Kept for backward compat
  },
  modalBody: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  questionModalText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
    lineHeight: 26,
    marginBottom: 16,
  },
  contextTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 16,
  },
  contextTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F59E0B',
  },
  questionHint: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  relatedModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  relatedModalHeadline: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 28,
    marginBottom: 12,
  },
  relatedModalSource: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 12,
  },
  relatedModalTeaser: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 24,
  },
  readArticleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#32b0c6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  readArticleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  readArticleArrow: {
    fontSize: 18,
    color: '#FFFFFF',
  },
});
