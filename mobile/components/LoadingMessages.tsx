import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

const WITTY_MESSAGES = [
  "Reading the tea leaves of your interests...",
  "Teaching AI about your taste in news...",
  "Organizing your personalized library...",
  "Painting your story canvas...",
  "Analyzing the zeitgeist just for you...",
  "Curating your perfect reading list...",
  "Sprinkling some algorithmic magic...",
  "Rehearsing your daily briefing...",
  "Setting up your information circus...",
  "Directing your news premiere...",
  "Composing your content symphony...",
  "Cooking up some fresh insights...",
  "Rolling the dice on trending topics...",
  "Piecing together your story puzzle...",
  "Juggling articles like a pro...",
  "Mixing the perfect content cocktail...",
  "Hunting down the best stories...",
  "Calibrating your relevance radar...",
  "Surfing the information waves...",
  "Building your content rollercoaster...",
  "Training the story-telling monkeys...",
  "Auditioning articles for your feed...",
  "Editing your personalized newsreel...",
  "Sketching your information landscape...",
  "Fine-tuning your interest antenna...",
];

interface LoadingMessagesProps {
  isLoading: boolean;
  customMessage?: string;
}

export const LoadingMessages: React.FC<LoadingMessagesProps> = ({ 
  isLoading, 
  customMessage 
}) => {
  const [currentMessage, setCurrentMessage] = useState(0);
  const [fadeAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        // Change message
        setCurrentMessage((prev) => (prev + 1) % WITTY_MESSAGES.length);
        
        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, 3000); // Change message every 3 seconds

    return () => clearInterval(interval);
  }, [isLoading, fadeAnim]);

  if (!isLoading) return null;

  const displayMessage = customMessage || WITTY_MESSAGES[currentMessage];

  return (
    <View style={styles.container}>
      <View style={styles.spinnerContainer}>
        <View style={styles.spinner} />
      </View>
      <Animated.View style={{ opacity: fadeAnim }}>
        <Text style={styles.message}>{displayMessage}</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  spinnerContainer: {
    marginBottom: 20,
  },
  spinner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 4,
    borderColor: '#32B0C6',
    borderTopColor: 'transparent',
  },
  message: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    fontStyle: 'italic',
    maxWidth: 300,
  },
});
