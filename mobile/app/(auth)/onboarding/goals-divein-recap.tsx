import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useOnboarding } from '@/store/user-context';
import * as SecureStore from 'expo-secure-store';
import Icon from '../../../components/ui/Icon';

export default function GoalsDiveinRecapScreen() {
  const { state, setWeeklyGoals, previousStep, completeOnboarding, canProceed, getProfileData } = useOnboarding();
  
  const [selectedDiveinGoal, setSelectedDiveinGoal] = useState<number | null>(state.diveinWeeklyGoal);
  const [selectedRecapGoal, setSelectedRecapGoal] = useState<number | null>(state.recapWeeklyGoal);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const diveinGoalOptions = [60, 90, 120, 180, 240]; // Weekly minutes
  const recapGoalOptions = [30, 45, 60, 90, 120]; // Weekly minutes

  const handleDiveinGoalSelect = (minutes: number) => {
    setSelectedDiveinGoal(minutes);
    if (selectedRecapGoal) {
      setWeeklyGoals(minutes, selectedRecapGoal);
    }
  };

  const handleRecapGoalSelect = (minutes: number) => {
    setSelectedRecapGoal(minutes);
    if (selectedDiveinGoal) {
      setWeeklyGoals(selectedDiveinGoal, minutes);
    }
  };

  const handleSubmit = async () => {
    if (!canProceed()) return;

    setIsSubmitting(true);
    try {
      // Get token with web fallback
      let token;
      try {
        token = await SecureStore.getItemAsync('access_token');
      } catch (error) {
        token = localStorage.getItem('access_token');
      }
      
      if (!token) {
        Alert.alert('Error', 'Authentication token not found. Please log in again.');
        router.replace('/(auth)/login');
        return;
      }

      const profileData = getProfileData();
      
      const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'}/me`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profileData),
      });

      if (response.ok) {
        completeOnboarding();
        
        // Verify token is still stored before navigating
        let verifyToken;
        try {
          verifyToken = await SecureStore.getItemAsync('access_token');
        } catch (e) {
          verifyToken = localStorage.getItem('access_token');
        }
        
        // Navigate directly to home screen without alert delay
        router.replace('/(tabs)');
      } else {
        const errorData = await response.json();
        Alert.alert(
          'Setup Error',
          errorData.detail || 'Failed to save your profile. Please try again.',
          [
            { text: 'Retry', onPress: () => setIsSubmitting(false) },
            { text: 'Cancel', style: 'cancel', onPress: () => setIsSubmitting(false) }
          ]
        );
      }
    } catch (error) {
      Alert.alert(
        'Network Error',
        'Unable to save your profile. Please check your connection and try again.',
        [
          { text: 'Retry', onPress: () => setIsSubmitting(false) },
          { text: 'Cancel', style: 'cancel', onPress: () => setIsSubmitting(false) }
        ]
      );
    }
  };

  const handleBack = () => {
    previousStep();
    router.back();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '100%' }]} />
          </View>
          <Text style={styles.progressText}>Step 6 of 6</Text>
        </View>
        
        <Text style={styles.title}>Set your weekly deep-dive goals</Text>
        <Text style={styles.subtitle}>
          How much time for focused learning and reflection?
        </Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dive-in Goal</Text>
          <Text style={styles.sectionDescription}>
            Weekly time for deep, focused reading sessions
          </Text>
          <View style={styles.optionsGrid}>
            {diveinGoalOptions.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={[
                  styles.optionButton,
                  selectedDiveinGoal === minutes && styles.optionButtonSelected
                ]}
                onPress={() => handleDiveinGoalSelect(minutes)}
              >
                <Text style={[
                  styles.optionButtonText,
                  selectedDiveinGoal === minutes && styles.optionButtonTextSelected
                ]}>
                  {minutes}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recap Goal</Text>
          <Text style={styles.sectionDescription}>
            Weekly time for reviewing and reflecting on insights
          </Text>
          <View style={styles.optionsGrid}>
            {recapGoalOptions.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={[
                  styles.optionButton,
                  selectedRecapGoal === minutes && styles.optionButtonSelected
                ]}
                onPress={() => handleRecapGoalSelect(minutes)}
              >
                <Text style={[
                  styles.optionButtonText,
                  selectedRecapGoal === minutes && styles.optionButtonTextSelected
                ]}>
                  {minutes}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.summarySection}>
          <View style={styles.summaryTitleRow}>
            <Icon name="target" size={18} color="#E2E8F0" style={{ marginRight: 8 }} />
            <Text style={styles.summaryTitle}>Your Guru Setup</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Industry:</Text>
            <Text style={styles.summaryValue}>{state.coreIndustry}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Specializations:</Text>
            <Text style={styles.summaryValue}>{state.specializations.join(', ')}</Text>
          </View>
          {state.additionalInterests.length > 0 && (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Additional Interests:</Text>
              <Text style={styles.summaryValue}>{state.additionalInterests.join(', ')}</Text>
            </View>
          )}
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Weekly Capacity:</Text>
            <Text style={styles.summaryValue}>{state.weeklyCapacity}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Daily Catch-up:</Text>
            <Text style={styles.summaryValue}>{state.catchupDailyGoal}m goal, {state.catchupDailyMax}m max</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          disabled={isSubmitting}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!canProceed() || isSubmitting) && styles.submitButtonDisabled
          ]}
          onPress={handleSubmit}
          disabled={!canProceed() || isSubmitting}
        >
          <Text style={[
            styles.submitButtonText,
            (!canProceed() || isSubmitting) && styles.submitButtonTextDisabled
          ]}>
            {isSubmitting ? 'Setting up...' : 'Complete Setup'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  progressContainer: {
    marginBottom: 30,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#E2E8F0',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 16,
    color: '#94A3B8',
    marginBottom: 20,
    lineHeight: 22,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  optionButton: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 80,
    alignItems: 'center',
  },
  optionButtonSelected: {
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderColor: '#6366F1',
  },
  optionButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  optionButtonTextSelected: {
    color: '#6366F1',
  },
  summarySection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  summaryItem: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#94A3B8',
    width: 140,
  },
  summaryValue: {
    fontSize: 16,
    color: '#E2E8F0',
    flex: 1,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    paddingBottom: 30,
    gap: 12,
    backgroundColor: 'rgba(15, 20, 35, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  backButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  backButtonText: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '600',
  },
  submitButton: {
    flex: 2,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  submitButtonText: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '600',
  },
  submitButtonTextDisabled: {
    color: '#64748B',
  },
});
