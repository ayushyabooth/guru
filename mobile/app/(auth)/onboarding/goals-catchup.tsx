import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { useOnboarding } from '@/store/user-context';
import Icon from '../../../components/ui/Icon';

export default function GoalsCatchupScreen() {
  const { state, setCatchupGoals, nextStep, previousStep, canProceed } = useOnboarding();
  
  const [selectedDailyGoal, setSelectedDailyGoal] = useState<number | null>(state.catchupDailyGoal);
  const [selectedDailyMax, setSelectedDailyMax] = useState<number | null>(state.catchupDailyMax);

  const dailyGoalOptions = [15, 20, 30, 45, 60];
  const dailyMaxOptions = [30, 45, 60, 90, 120];

  const handleDailyGoalSelect = (minutes: number) => {
    setSelectedDailyGoal(minutes);
    // Auto-adjust max if it's less than goal
    if (selectedDailyMax && selectedDailyMax < minutes) {
      const newMax = dailyMaxOptions.find(max => max > minutes) || dailyMaxOptions[dailyMaxOptions.length - 1];
      setSelectedDailyMax(newMax);
      setCatchupGoals(minutes, newMax);
    } else if (selectedDailyMax) {
      setCatchupGoals(minutes, selectedDailyMax);
    }
  };

  const handleDailyMaxSelect = (minutes: number) => {
    if (selectedDailyGoal && minutes >= selectedDailyGoal) {
      setSelectedDailyMax(minutes);
      setCatchupGoals(selectedDailyGoal, minutes);
    }
  };

  const handleContinue = () => {
    if (canProceed()) {
      nextStep();
      router.push('/(auth)/onboarding/goals-divein-recap');
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
            <View style={[styles.progressFill, { width: '83.3%' }]} />
          </View>
          <Text style={styles.progressText}>Step 5 of 6</Text>
        </View>
        
        <Text style={styles.title}>Set your daily catch-up goals</Text>
        <Text style={styles.subtitle}>
          How much time do you want to spend on daily insights?
        </Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Goal (Target)</Text>
          <Text style={styles.sectionDescription}>
            Your ideal daily reading time for staying informed
          </Text>
          <View style={styles.optionsGrid}>
            {dailyGoalOptions.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={[
                  styles.optionButton,
                  selectedDailyGoal === minutes && styles.optionButtonSelected
                ]}
                onPress={() => handleDailyGoalSelect(minutes)}
              >
                <Text style={[
                  styles.optionButtonText,
                  selectedDailyGoal === minutes && styles.optionButtonTextSelected
                ]}>
                  {minutes}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Maximum</Text>
          <Text style={styles.sectionDescription}>
            The most time you're willing to spend on busy days
          </Text>
          <View style={styles.optionsGrid}>
            {dailyMaxOptions.map((minutes) => {
              const isDisabled = selectedDailyGoal ? minutes < selectedDailyGoal : false;
              return (
                <TouchableOpacity
                  key={minutes}
                  style={[
                    styles.optionButton,
                    selectedDailyMax === minutes && styles.optionButtonSelected,
                    isDisabled && styles.optionButtonDisabled
                  ]}
                  onPress={() => handleDailyMaxSelect(minutes)}
                  disabled={isDisabled}
                >
                  <Text style={[
                    styles.optionButtonText,
                    selectedDailyMax === minutes && styles.optionButtonTextSelected,
                    isDisabled && styles.optionButtonTextDisabled
                  ]}>
                    {minutes}m
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoTitleRow}>
            <Icon name="lightbulb-outline" size={18} color="#E2E8F0" style={{ marginRight: 8 }} />
            <Text style={styles.infoTitle}>How this works:</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>
              We'll aim to give you content that fits your daily goal
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>
              On busy days, we'll never exceed your maximum
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>
              You can always adjust these settings later
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.continueButton,
            !canProceed() && styles.continueButtonDisabled
          ]}
          onPress={handleContinue}
          disabled={!canProceed()}
        >
          <Text style={[
            styles.continueButtonText,
            !canProceed() && styles.continueButtonTextDisabled
          ]}>
            Continue
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
    backgroundColor: '#007AFF',
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
    borderColor: '#007AFF',
  },
  optionButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    opacity: 0.5,
  },
  optionButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  optionButtonTextSelected: {
    color: '#007AFF',
  },
  optionButtonTextDisabled: {
    color: '#adb5bd',
  },
  infoSection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  infoBullet: {
    fontSize: 16,
    color: '#007AFF',
    marginRight: 12,
    marginTop: 2,
  },
  infoText: {
    fontSize: 16,
    color: '#94A3B8',
    lineHeight: 22,
    flex: 1,
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
  continueButton: {
    flex: 2,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  continueButtonText: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '600',
  },
  continueButtonTextDisabled: {
    color: '#adb5bd',
  },
});
