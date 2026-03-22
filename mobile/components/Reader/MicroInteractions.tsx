import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import Icon from '../ui/Icon';

interface EarlierArticle {
  id: string;
  headline: string;
  source: string;
  readingTime: number;
}

interface PauseAndRelateResponse {
  suggestedArticleId: string;
  response: 'yes' | 'no' | 'not_sure';
}

interface MicroPromptResponse {
  textResponse?: string;
  emojiResponse?: string;
}

export interface InteractionData {
  articleId: string;
  interactions: {
    pauseAndRelate?: PauseAndRelateResponse[];
    microPrompt?: MicroPromptResponse;
  };
}

interface MicroInteractionsProps {
  articleId: string;
  articleTopic: string;
  wordCount: number;
  earlierArticles: EarlierArticle[];
  onComplete: () => void;
}

export const MicroInteractions: React.FC<MicroInteractionsProps> = ({
  articleId,
  articleTopic,
  wordCount,
  earlierArticles,
  onComplete,
}) => {
  // State for Pause-and-Relate
  const [showPauseAndRelate, setShowPauseAndRelate] = useState(false);
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);
  const [pauseAndRelateResponses, setPauseAndRelateResponses] = useState<PauseAndRelateResponse[]>([]);
  
  // State for Micro-Prompt
  const [showMicroPrompt, setShowMicroPrompt] = useState(false);
  const [microPromptText, setMicroPromptText] = useState('');
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);

  // Mock suggestions (2 earlier articles)
  const suggestions = earlierArticles.slice(0, 2);

  useEffect(() => {
    // Determine what to show
    const shouldShowPauseAndRelate = earlierArticles.length > 0;
    const shouldShowMicroPrompt = wordCount > 1500;

    setShowPauseAndRelate(shouldShowPauseAndRelate);
    setShowMicroPrompt(shouldShowMicroPrompt);

    // If neither applies, complete immediately
    if (!shouldShowPauseAndRelate && !shouldShowMicroPrompt) {
      onComplete();
    }
  }, [earlierArticles.length, wordCount]);

  const handlePauseAndRelateResponse = (response: 'yes' | 'no' | 'not_sure') => {
    const currentSuggestion = suggestions[currentSuggestionIndex];
    
    // Store response
    const newResponse: PauseAndRelateResponse = {
      suggestedArticleId: currentSuggestion.id,
      response,
    };
    
    const updatedResponses = [...pauseAndRelateResponses, newResponse];
    setPauseAndRelateResponses(updatedResponses);

    // Move to next suggestion or complete Pause-and-Relate
    if (currentSuggestionIndex < suggestions.length - 1) {
      setCurrentSuggestionIndex(currentSuggestionIndex + 1);
    } else {
      // Save Pause-and-Relate data
      saveInteractionData({ pauseAndRelate: updatedResponses });
      
      // Move to Micro-Prompt or complete
      if (showMicroPrompt) {
        setShowPauseAndRelate(false);
      } else {
        onComplete();
      }
    }
  };

  const handleSkipPauseAndRelate = () => {
    // Save any responses collected so far
    if (pauseAndRelateResponses.length > 0) {
      saveInteractionData({ pauseAndRelate: pauseAndRelateResponses });
    }
    
    // Move to Micro-Prompt or complete
    if (showMicroPrompt) {
      setShowPauseAndRelate(false);
    } else {
      onComplete();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    // Toggle emoji selection
    if (selectedEmojis.includes(emoji)) {
      setSelectedEmojis(selectedEmojis.filter(e => e !== emoji));
    } else {
      setSelectedEmojis([...selectedEmojis, emoji]);
    }
    
    // Auto-save emoji response
    const emojiResponse = selectedEmojis.includes(emoji)
      ? selectedEmojis.filter(e => e !== emoji).join('')
      : [...selectedEmojis, emoji].join('');
    
    saveInteractionData({
      pauseAndRelate: pauseAndRelateResponses.length > 0 ? pauseAndRelateResponses : undefined,
      microPrompt: {
        textResponse: microPromptText || undefined,
        emojiResponse: emojiResponse || undefined,
      },
    });
  };

  const handleMicroPromptSubmit = () => {
    // Save Micro-Prompt data
    saveInteractionData({
      pauseAndRelate: pauseAndRelateResponses.length > 0 ? pauseAndRelateResponses : undefined,
      microPrompt: {
        textResponse: microPromptText || undefined,
        emojiResponse: selectedEmojis.join('') || undefined,
      },
    });
    
    onComplete();
  };

  const handleSkipMicroPrompt = () => {
    // Save text if any was entered
    if (microPromptText || selectedEmojis.length > 0) {
      saveInteractionData({
        pauseAndRelate: pauseAndRelateResponses.length > 0 ? pauseAndRelateResponses : undefined,
        microPrompt: {
          textResponse: microPromptText || undefined,
          emojiResponse: selectedEmojis.join('') || undefined,
        },
      });
    }
    
    onComplete();
  };

  const saveInteractionData = (interactions: Partial<InteractionData['interactions']>) => {
    try {
      const existingData = localStorage.getItem('guru_divein_interactions');
      const allInteractions: InteractionData[] = existingData ? JSON.parse(existingData) : [];
      
      // Find existing entry for this article or create new one
      const existingIndex = allInteractions.findIndex(item => item.articleId === articleId);
      
      if (existingIndex >= 0) {
        // Update existing entry
        allInteractions[existingIndex].interactions = {
          ...allInteractions[existingIndex].interactions,
          ...interactions,
        };
      } else {
        // Create new entry
        allInteractions.push({
          articleId,
          interactions: interactions as InteractionData['interactions'],
        });
      }
      
      localStorage.setItem('guru_divein_interactions', JSON.stringify(allInteractions));
    } catch (error) {
    }
  };

  const emojis = [
    { emoji: 'thought-bubble-outline', label: 'Thoughtful' },
    { emoji: 'chart-bar', label: 'Data-driven' },
    { emoji: 'lightbulb-outline', label: 'Insightful' },
    { emoji: 'emoticon-excited-outline', label: 'Surprising' },
  ];

  // Don't render if both are hidden
  if (!showPauseAndRelate && !showMicroPrompt) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Pause-and-Relate Section */}
      {showPauseAndRelate && suggestions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pause & Relate</Text>
          <Text style={styles.prompt}>
            You've read about {articleTopic}. Which earlier article connects?
          </Text>

          {/* Current suggestion */}
          <View style={styles.suggestionCard}>
            <Text style={styles.suggestionHeadline}>
              {suggestions[currentSuggestionIndex].headline}
            </Text>
            <View style={styles.suggestionMeta}>
              <Text style={styles.suggestionSource}>
                {suggestions[currentSuggestionIndex].source}
              </Text>
              <Text style={styles.suggestionDivider}>•</Text>
              <Text style={styles.suggestionTime}>
                {suggestions[currentSuggestionIndex].readingTime} min read
              </Text>
            </View>

            {/* Response buttons */}
            <View style={styles.responseButtons}>
              <TouchableOpacity
                style={[styles.responseButton, styles.noButton]}
                onPress={() => handlePauseAndRelateResponse('no')}
                accessibilityRole="button"
                accessibilityLabel="No connection"
              >
                <Text style={styles.responseButtonText}>← No</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.responseButton, styles.yesButton]}
                onPress={() => handlePauseAndRelateResponse('yes')}
                accessibilityRole="button"
                accessibilityLabel="Yes, connected"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={14} color="#fff" />
                  <Text style={styles.responseButtonText}>Yes</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.responseButton, styles.notSureButton]}
                onPress={() => handlePauseAndRelateResponse('not_sure')}
                accessibilityRole="button"
                accessibilityLabel="Not sure"
              >
                <Text style={styles.responseButtonText}>? Not Sure</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Progress indicator */}
          <Text style={styles.progressText}>
            {currentSuggestionIndex + 1} of {suggestions.length}
          </Text>

          {/* Skip button */}
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkipPauseAndRelate}
            accessibilityRole="button"
            accessibilityLabel="Skip reflection"
          >
            <Text style={styles.skipButtonText}>Skip reflection? →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Micro-Prompt Section */}
      {showMicroPrompt && !showPauseAndRelate && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Reflection</Text>
          <Text style={styles.prompt}>
            In one sentence: How does this change your view on {articleTopic}?
          </Text>

          {/* Text input */}
          <TextInput
            style={styles.textInput}
            placeholder="Type your reflection (1-3 sentences)..."
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={3}
            value={microPromptText}
            onChangeText={setMicroPromptText}
            accessibilityLabel="Reflection text input"
          />

          {/* Emoji selection */}
          <View style={styles.emojiSection}>
            <Text style={styles.emojiLabel}>Or capture with an emoji:</Text>
            <View style={styles.emojiButtons}>
              {emojis.map(({ emoji, label }) => (
                <TouchableOpacity
                  key={emoji}
                  style={[
                    styles.emojiButton,
                    selectedEmojis.includes(emoji) && styles.emojiButtonSelected,
                  ]}
                  onPress={() => handleEmojiSelect(emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} emoji`}
                  accessibilityState={{ selected: selectedEmojis.includes(emoji) }}
                >
                  <Icon name={emoji} size={32} color={selectedEmojis.includes(emoji) ? '#32b0c6' : '#666'} />
                  <Text style={styles.emojiLabelText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkipMicroPrompt}
              accessibilityRole="button"
              accessibilityLabel="Skip reflection"
            >
              <Text style={styles.skipButtonText}>Skip →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitButton,
                (!microPromptText && selectedEmojis.length === 0) && styles.submitButtonDisabled,
              ]}
              onPress={handleMicroPromptSubmit}
              disabled={!microPromptText && selectedEmojis.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Continue"
            >
              <Text style={styles.submitButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#32b0c6',
    marginBottom: 12,
  },
  prompt: {
    fontSize: 16,
    lineHeight: 24,
    color: '#E2E8F0',
    marginBottom: 20,
  },
  suggestionCard: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  suggestionHeadline: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 8,
    lineHeight: 22,
  },
  suggestionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  suggestionSource: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  suggestionDivider: {
    fontSize: 13,
    color: '#ccc',
    marginHorizontal: 6,
  },
  suggestionTime: {
    fontSize: 13,
    color: '#64748B',
  },
  responseButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  responseButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  noButton: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  yesButton: {
    backgroundColor: '#32b0c6',
  },
  notSureButton: {
    backgroundColor: '#ffc107',
  },
  responseButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  progressText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipButtonText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    lineHeight: 24,
    color: '#E2E8F0',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  emojiSection: {
    marginBottom: 20,
  },
  emojiLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 12,
  },
  emojiButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  emojiButton: {
    flex: 1,
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.06)',
    minHeight: 80,
    justifyContent: 'center',
  },
  emojiButtonSelected: {
    borderColor: '#32b0c6',
    backgroundColor: '#e7f6f8',
  },
  emojiText: {
    fontSize: 32,
    marginBottom: 4,
  },
  emojiLabelText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  submitButton: {
    backgroundColor: '#32b0c6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minHeight: 48,
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
});
