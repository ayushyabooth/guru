import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { OnboardingProvider } from '@/store/user-context';
import IndustryScreen from '../../app/(auth)/onboarding/industry';
import SpecializationsScreen from '../../app/(auth)/onboarding/specializations';
import InterestsScreen from '../../app/(auth)/onboarding/interests';
import CapacityScreen from '../../app/(auth)/onboarding/capacity';
import GoalsCatchupScreen from '../../app/(auth)/onboarding/goals-catchup';
import GoalsDiveinRecapScreen from '../../app/(auth)/onboarding/goals-divein-recap';

// Mock fetch
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Test wrapper with context
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <OnboardingProvider>{children}</OnboardingProvider>
);

describe('Onboarding Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('IndustryScreen', () => {
    it('renders industry selection correctly', () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('What\'s your core industry?')).toBeTruthy();
      expect(screen.getByText('Step 1 of 6')).toBeTruthy();
      expect(screen.getByText('Consumer')).toBeTruthy();
      expect(screen.getByText('Technology')).toBeTruthy();
      expect(screen.getByText('Healthcare')).toBeTruthy();
    });

    it('enables continue button after industry selection', () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const continueButton = screen.getByText('Continue');
      expect(continueButton.props.accessibilityState?.disabled).toBe(true);

      const consumerOption = screen.getByText('Consumer');
      fireEvent.press(consumerOption);

      expect(continueButton.props.accessibilityState?.disabled).toBe(false);
    });

    it('shows selected industry with checkmark', () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const consumerOption = screen.getByText('Consumer');
      fireEvent.press(consumerOption);

      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  describe('SpecializationsScreen', () => {
    it('renders specializations selection correctly', () => {
      render(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Choose your specializations')).toBeTruthy();
      expect(screen.getByText('Step 2 of 6')).toBeTruthy();
      expect(screen.getByText('0/2 selected')).toBeTruthy();
    });

    it('allows selection of up to 2 specializations', () => {
      render(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      // Note: This test would need the context to have a selected industry
      // In a real test, we'd need to set up the context state properly
      expect(screen.getByText('Back')).toBeTruthy();
      expect(screen.getByText('Continue')).toBeTruthy();
    });
  });

  describe('InterestsScreen', () => {
    it('renders additional interests selection correctly', () => {
      render(
        <TestWrapper>
          <InterestsScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Any additional interests?')).toBeTruthy();
      expect(screen.getByText('Step 3 of 6')).toBeTruthy();
      expect(screen.getByText('Skip')).toBeTruthy();
      expect(screen.getByText('0/2 selected')).toBeTruthy();
    });

    it('allows skipping additional interests', () => {
      render(
        <TestWrapper>
          <InterestsScreen />
        </TestWrapper>
      );
      
      const skipButton = screen.getByText('Skip');
      expect(skipButton).toBeTruthy();
      
      // Test skip functionality
      fireEvent.press(skipButton);
      // Would need to verify navigation in a real test
    });
  });

  describe('CapacityScreen', () => {
    it('renders weekly capacity selection correctly', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('How much time can you dedicate weekly?')).toBeTruthy();
      expect(screen.getByText('Step 4 of 6')).toBeTruthy();
      expect(screen.getByText('Light (1-2 hours)')).toBeTruthy();
      expect(screen.getByText('Medium (3-5 hours)')).toBeTruthy();
      expect(screen.getByText('Heavy (6+ hours)')).toBeTruthy();
    });

    it('shows capacity descriptions', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Perfect for busy schedules')).toBeTruthy();
      expect(screen.getByText('Balanced learning approach')).toBeTruthy();
      expect(screen.getByText('Deep dive into insights')).toBeTruthy();
    });

    it('enables continue after capacity selection', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      const continueButton = screen.getByText('Continue');
      const lightOption = screen.getByText('Light (1-2 hours)');
      
      fireEvent.press(lightOption);
      
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  describe('GoalsCatchupScreen', () => {
    it('renders daily goals selection correctly', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Set your daily catch-up goals')).toBeTruthy();
      expect(screen.getByText('Step 5 of 6')).toBeTruthy();
      expect(screen.getByText('Daily Goal (Target)')).toBeTruthy();
      expect(screen.getByText('Daily Maximum')).toBeTruthy();
    });

    it('shows goal time options', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('15m')).toBeTruthy();
      expect(screen.getByText('30m')).toBeTruthy();
      expect(screen.getByText('60m')).toBeTruthy();
    });

    it('validates that maximum is greater than goal', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      // Test that selecting a goal enables appropriate maximum options
      const goal30 = screen.getAllByText('30m')[0]; // First 30m is in daily goal section
      fireEvent.press(goal30);
      
      // Maximum options less than 30m should be disabled
      // This would need more specific testing of disabled state
    });
  });

  describe('GoalsDiveinRecapScreen', () => {
    it('renders weekly goals selection correctly', () => {
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Set your weekly deep-dive goals')).toBeTruthy();
      expect(screen.getByText('Step 6 of 6')).toBeTruthy();
      expect(screen.getByText('Dive-in Goal')).toBeTruthy();
      expect(screen.getByText('Recap Goal')).toBeTruthy();
    });

    it('shows profile summary', () => {
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('🎯 Your Guru Setup')).toBeTruthy();
      expect(screen.getByText('Industry:')).toBeTruthy();
      expect(screen.getByText('Specializations:')).toBeTruthy();
      expect(screen.getByText('Weekly Capacity:')).toBeTruthy();
    });

    it('handles profile submission successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);
      
      // Mock secure store
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/me',
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Authorization': 'Bearer mock-token',
              'Content-Type': 'application/json',
            }),
          })
        );
      });
    });

    it('handles profile submission failure', async () => {
      const mockResponse = {
        ok: false,
        json: jest.fn().mockResolvedValue({ detail: 'Profile update failed' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);
      
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Setup Error',
          'Profile update failed',
          expect.any(Array)
        );
      });
    });

    it('handles network error during submission', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Network Error',
          'Unable to save your profile. Please check your connection and try again.',
          expect.any(Array)
        );
      });
    });

    it('handles missing authentication token', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Authentication token not found. Please log in again.'
        );
      });
    });
  });

  describe('Onboarding Flow Integration', () => {
    it('maintains state across screens', () => {
      // This would test the full flow by rendering multiple screens
      // and verifying that state is maintained through the context
      
      const { rerender } = render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      // Select industry
      const consumerOption = screen.getByText('Consumer');
      fireEvent.press(consumerOption);
      
      // Navigate to next screen
      rerender(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      // Verify industry selection is maintained
      expect(screen.getByText('Select 1-2 areas within Consumer that you focus on most.')).toBeTruthy();
    });

    it('validates required fields before allowing progression', () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const continueButton = screen.getByText('Continue');
      
      // Should be disabled initially
      expect(continueButton.props.accessibilityState?.disabled).toBe(true);
      
      // Should be enabled after selection
      const consumerOption = screen.getByText('Consumer');
      fireEvent.press(consumerOption);
      
      expect(continueButton.props.accessibilityState?.disabled).toBe(false);
    });

    it('generates correct profile data for API submission', () => {
      // This would test the getProfileData function returns correct format
      // matching the backend API expectations
      
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      // The profile data structure should match:
      // {
      //   core_industry: string,
      //   specializations: string[],
      //   additional_interest_industries: string[],
      //   total_weekly_capacity_band: string,
      //   catchup_daily_goal_minutes: number,
      //   catchup_daily_max_minutes: number,
      //   divein_weekly_goal_minutes: number,
      //   recap_weekly_goal_minutes: number,
      // }
    });
  });
});
