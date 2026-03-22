import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import HomeScreen from '../../app/(tabs)/index';

// Mock the metric service
jest.mock('../../services/metric-service', () => ({
  metricService: {
    getMetricsWithFallback: jest.fn(),
  },
}));

const mockMetricService = require('../../services/metric-service').metricService;

const mockMetricsResponse = {
  metrics: {
    catchup: {
      dailyProgress: 20,
      dailyGoal: 30,
      weeklyTotal: 100,
    },
    divein: {
      weeklyProgress: 60,
      weeklyGoal: 120,
    },
    recap: {
      status: 'in_progress',
      weeklyProgress: 25,
      weeklyGoal: 60,
    },
    lastUpdated: '2024-01-04T20:00:00Z',
  },
  profile: {
    coreIndustry: 'Technology',
    specializations: ['Software', 'AI/ML'],
    additionalInterests: ['Consumer', 'Healthcare'],
  },
};

describe('Home Screen Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricService.getMetricsWithFallback.mockResolvedValue(mockMetricsResponse);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');
  });

  it('renders home screen with loading state initially', async () => {
    // Mock a delayed response
    mockMetricService.getMetricsWithFallback.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(mockMetricsResponse), 100))
    );

    render(<HomeScreen />);
    
    expect(screen.getByText('Loading your progress...')).toBeTruthy();
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });
  });

  it('displays metrics data correctly after loading', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });

    // Check rings display
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('20m')).toBeTruthy();
    expect(screen.getByText('of 30m')).toBeTruthy();

    // Check stats section
    expect(screen.getByText('This Week')).toBeTruthy();
    expect(screen.getByText('100m')).toBeTruthy();
    expect(screen.getByText('Catch-up Time')).toBeTruthy();
    expect(screen.getByText('60m')).toBeTruthy();
    expect(screen.getByText('Dive-in Time')).toBeTruthy();
    expect(screen.getByText('⏳')).toBeTruthy();
    expect(screen.getByText('Recap Status')).toBeTruthy();
  });

  it('displays filter tabs based on user profile', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Content Filters')).toBeTruthy();
    });

    // Check core industry tab
    expect(screen.getByText('Technology')).toBeTruthy();
    
    // Check specialization tabs
    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.getByText('AI/ML')).toBeTruthy();
    
    // Check additional interest tabs
    expect(screen.getByText('Consumer')).toBeTruthy();
    expect(screen.getByText('Healthcare')).toBeTruthy();
  });

  it('handles filter tab selection', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Software')).toBeTruthy();
    });

    const softwareTab = screen.getByText('Software');
    fireEvent.press(softwareTab);
    
    // The tab should be selected (visual feedback would be tested in component tests)
    // Here we're just testing that the press event doesn't crash
    expect(softwareTab).toBeTruthy();
  });

  it('handles pull-to-refresh', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });

    // Reset the mock call count
    mockMetricService.getMetricsWithFallback.mockClear();
    
    // Find the ScrollView and trigger refresh
    const scrollView = screen.getByTestId('home-scroll-view') || screen.root;
    
    // Simulate pull to refresh
    fireEvent(scrollView, 'refresh');
    
    await waitFor(() => {
      expect(mockMetricService.getMetricsWithFallback).toHaveBeenCalledTimes(1);
    });
  });

  it('handles API errors gracefully', async () => {
    mockMetricService.getMetricsWithFallback.mockRejectedValue(
      new Error('Network error')
    );

    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('displays last updated timestamp', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText(/Last updated:/)).toBeTruthy();
    });
  });

  it('handles ring press navigation', async () => {
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Catch-up')).toBeTruthy();
    });

    // Find and press the catchup stat card
    const catchupCard = screen.getByText('Catch-up').parent?.parent;
    if (catchupCard) {
      fireEvent.press(catchupCard);
      // Navigation would be tested with navigation mocks in a real app
    }
  });

  it('handles different recap statuses correctly', async () => {
    const completedResponse = {
      ...mockMetricsResponse,
      metrics: {
        ...mockMetricsResponse.metrics,
        recap: {
          status: 'completed',
          weeklyProgress: 60,
          weeklyGoal: 60,
        },
      },
    };

    mockMetricService.getMetricsWithFallback.mockResolvedValue(completedResponse);
    
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  it('handles empty or missing profile data', async () => {
    const emptyProfileResponse = {
      ...mockMetricsResponse,
      profile: {
        coreIndustry: 'Technology',
        specializations: [],
        additionalInterests: [],
      },
    };

    mockMetricService.getMetricsWithFallback.mockResolvedValue(emptyProfileResponse);
    
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });

    // Should still show core industry
    expect(screen.getByText('Technology')).toBeTruthy();
  });

  it('polls for updates every 30 seconds', async () => {
    jest.useFakeTimers();
    
    render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });

    // Clear initial call
    mockMetricService.getMetricsWithFallback.mockClear();
    
    // Fast forward 30 seconds
    jest.advanceTimersByTime(30000);
    
    await waitFor(() => {
      expect(mockMetricService.getMetricsWithFallback).toHaveBeenCalledTimes(1);
    });
    
    jest.useRealTimers();
  });

  it('stops polling when component unmounts', async () => {
    jest.useFakeTimers();
    
    const { unmount } = render(<HomeScreen />);
    
    await waitFor(() => {
      expect(screen.getByText('Your Progress')).toBeTruthy();
    });

    // Clear initial call
    mockMetricService.getMetricsWithFallback.mockClear();
    
    // Unmount component
    unmount();
    
    // Fast forward 30 seconds
    jest.advanceTimersByTime(30000);
    
    // Should not have been called after unmount
    expect(mockMetricService.getMetricsWithFallback).not.toHaveBeenCalled();
    
    jest.useRealTimers();
  });
});
