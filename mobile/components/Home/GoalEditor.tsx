/**
 * GoalEditor - Slider-based goal adjustment component
 *
 * Features:
 * - Liquid glass aesthetic
 * - Custom slider UI for selecting daily goals
 * - Encourages higher Dive-in time investment
 * - Saves to backend via PUT /me endpoint
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Dimensions,
  PanResponder,
} from 'react-native';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import Icon from '../ui/Icon';

const { width } = Dimensions.get('window');

interface GoalEditorProps {
  onClose: () => void;
  onSave: () => void;
  currentGoals: {
    catchupDailyGoal: number;
    diveinDailyGoal: number;
  };
}

// Custom slider component
interface CustomSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  onChange: (value: number) => void;
}

function CustomSlider({ value, min, max, step, color, onChange }: CustomSliderProps) {
  const sliderWidth = width - 80;
  const percentage = (value - min) / (max - min);
  const thumbPosition = percentage * sliderWidth;

  const handleTap = (event: any) => {
    const locationX = event.nativeEvent.locationX;
    const percentage = Math.max(0, Math.min(1, locationX / sliderWidth));
    const rawValue = min + percentage * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    onChange(Math.max(min, Math.min(max, steppedValue)));
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: handleTap,
    onPanResponderMove: handleTap,
  });

  return (
    <View style={styles.sliderContainer} {...panResponder.panHandlers}>
      {/* Track background */}
      <View style={styles.sliderTrack}>
        {/* Filled track */}
        <View
          style={[
            styles.sliderFilled,
            {
              width: `${percentage * 100}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>

      {/* Thumb */}
      <View
        style={[
          styles.sliderThumb,
          {
            left: thumbPosition - 14,
            backgroundColor: color,
          },
        ]}
      >
        <Text style={styles.thumbText}>{value}</Text>
      </View>

      {/* Min/Max labels */}
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>{min}m</Text>
        <Text style={styles.sliderLabel}>{max}m</Text>
      </View>
    </View>
  );
}

export default function GoalEditor({ onClose, onSave, currentGoals }: GoalEditorProps) {
  const [catchupGoal, setCatchupGoal] = useState(currentGoals.catchupDailyGoal || 20);
  const [diveinGoal, setDiveinGoal] = useState(currentGoals.diveinDailyGoal || 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${API_BASE_URL}/me`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          catchup_daily_goal_minutes: catchupGoal,
          catchup_daily_max_minutes: Math.max(catchupGoal + 15, 45), // Auto-set max
          divein_weekly_goal_minutes: diveinGoal * 7, // Convert daily to weekly for backend
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to save goals');
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save goals');
    } finally {
      setSaving(false);
    }
  };

  // Calculate encouragement message for dive-in
  const getDiveinEncouragement = () => {
    if (diveinGoal >= 45) {
      return "Deep diver! You'll gain expert-level insights.";
    } else if (diveinGoal >= 30) {
      return 'Great choice for building real expertise.';
    } else {
      return 'Consider more time for deeper understanding.';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Adjust Goals</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Catch-up Goal */}
        <View style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <View style={[styles.goalIndicator, { backgroundColor: '#38BDF8' }]} />
            <View style={styles.goalTitleContainer}>
              <Text style={styles.goalTitle}>Daily Catch-up</Text>
              <Text style={styles.goalSubtitle}>Quick insights to stay informed</Text>
            </View>
            <View style={styles.goalValueContainer}>
              <Text style={[styles.goalValue, { color: '#38BDF8' }]}>{catchupGoal}m</Text>
              <Text style={styles.goalUnit}>per day</Text>
            </View>
          </View>

          <CustomSlider
            value={catchupGoal}
            min={10}
            max={45}
            step={5}
            color="#38BDF8"
            onChange={setCatchupGoal}
          />

          <View style={styles.presetButtons}>
            {[10, 15, 20, 30, 45].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.presetButton,
                  catchupGoal === val && styles.presetButtonActive,
                  catchupGoal === val && { backgroundColor: 'rgba(56, 189, 248, 0.15)' },
                ]}
                onPress={() => setCatchupGoal(val)}
              >
                <Text
                  style={[
                    styles.presetButtonText,
                    catchupGoal === val && { color: '#38BDF8' },
                  ]}
                >
                  {val}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Dive-in Goal */}
        <View style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <View style={[styles.goalIndicator, { backgroundColor: '#EC4899' }]} />
            <View style={styles.goalTitleContainer}>
              <Text style={styles.goalTitle}>Daily Dive-in</Text>
              <Text style={styles.goalSubtitle}>Deep reading for expertise</Text>
            </View>
            <View style={styles.goalValueContainer}>
              <Text style={[styles.goalValue, { color: '#EC4899' }]}>{diveinGoal}m</Text>
              <Text style={styles.goalUnit}>per day</Text>
            </View>
          </View>

          <CustomSlider
            value={diveinGoal}
            min={15}
            max={60}
            step={5}
            color="#EC4899"
            onChange={setDiveinGoal}
          />

          <View style={styles.presetButtons}>
            {[15, 20, 30, 45, 60].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.presetButton,
                  diveinGoal === val && styles.presetButtonActive,
                  diveinGoal === val && { backgroundColor: 'rgba(8, 145, 178, 0.15)' },
                ]}
                onPress={() => setDiveinGoal(val)}
              >
                <Text
                  style={[
                    styles.presetButtonText,
                    diveinGoal === val && { color: '#EC4899' },
                  ]}
                >
                  {val}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Encouragement message */}
          <View style={styles.encouragementContainer}>
            <Icon name="lightbulb-outline" size={16} color="#EC4899" style={styles.encouragementIcon} />
            <Text style={styles.encouragementText}>{getDiveinEncouragement()}</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Daily Investment</Text>
          <Text style={styles.summaryTotal}>{catchupGoal + diveinGoal} minutes</Text>
          <Text style={styles.summaryBreakdown}>
            {catchupGoal}m catch-up + {diveinGoal}m dive-in
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(15,20,35,0.55)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 16,
    color: '#64748B',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
  },
  saveButton: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 70,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
  },
  goalCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  goalIndicator: {
    width: 4,
    height: 44,
    borderRadius: 2,
    marginRight: 12,
  },
  goalTitleContainer: {
    flex: 1,
  },
  goalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 2,
  },
  goalSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  goalValueContainer: {
    alignItems: 'flex-end',
  },
  goalValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  goalUnit: {
    fontSize: 12,
    color: '#94A3B8',
  },
  sliderContainer: {
    height: 60,
    marginBottom: 16,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  sliderFilled: {
    height: '100%',
    borderRadius: 4,
  },
  sliderThumb: {
    position: 'absolute',
    top: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  thumbText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  presetButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  presetButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  presetButtonActive: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  encouragementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(8, 145, 178, 0.08)',
    borderRadius: 10,
  },
  encouragementIcon: {
    marginRight: 8,
  },
  encouragementText: {
    fontSize: 12,
    color: '#EC4899',
    fontWeight: '500',
    flex: 1,
  },
  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  summaryTitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 4,
  },
  summaryTotal: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 4,
  },
  summaryBreakdown: {
    fontSize: 12,
    color: '#94A3B8',
  },
});
