import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import CatchupScreen from '../../app/(tabs)/catchup';
import { CatchupService } from '../../services/article-service';
import * as TimeTracking from '../../hooks/useTimeTracking';

// Mock the services and hooks
jest.mock('../../services/article-service');
jest.mock('../../hooks/useTimeTracking');
jest.mock('../../utils/auth');

const mockCatchupService = CatchupService as jest.Mocked<typeof CatchupService>;
const mockUseTimeTracking = TimeTracking.useTimeTracking as jest.MockedFunction<typeof TimeTracking.useTimeTracking>;

// Mock data
const mockStoryboards = [
  {
    id: 'storyboard-1',
    filter_context: 'core',
    industry: 'Consumer',
    specializations: ['Food & Beverage'],
    summary: 'Latest trends in food and beverage industry',
    personal_prompt: 'How do these trends affect your business strategy?',
    created_at: '2024-01-01T00:00:00Z',
    theme: 'F&B Trends',
    headline_article: {
      id: 'article-1',
      title: 'Food Industry Innovation Report',
      source: 'Food Weekly',
      url: 'https://example.com/article-1',
      word_count: 800,
      is_paywalled: false,
      created_at: '2024-01-01T00:00:00Z',
      publish_date: '2024-01-01T00:00:00Z',
    },
    related_articles: [
      {
        id: 'article-2',
        title: 'Sustainable Packaging Solutions',
        source: 'Green Business',
        url: 'https://example.com/article-2',
        word_count: 600,
        is_paywalled: false,
        created_at: '2024-01-01T00:00:00Z',
      },
    ],
    article_count: 2,
  },
  {
    id: 'storyboard-2',
    filter_context: 'specialization:Food & Beverage',
    industry: 'Consumer',
    specializations: ['Food & Beverage'],
    summary: 'New regulations affecting food safety standards',
    personal_prompt: 'What compliance changes do you need to implement?',
    created_at: '2024-01-01T00:00:00Z',
    theme: 'Food Safety',
    headline_article: {
      id: 'article-3',
      title: 'FDA Announces New Food Safety Rules',
      source: 'Regulatory News',
      url: 'https://example.com/article-3',
      word_count: 1200,
      is_paywalled: true,
      created_at: '2024-01-01T00:00:00Z',
      publish_date: '2024-01-01T00:00:00Z',
    },
    related_articles: [],
    article_count: 1,
  },
];

describe('Catchup Flow Integration Tests', () => {
  const mockStartTracking = jest.fn();
  const mockStopTracking = jest.fn();
  const mockLogTime = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock time tracking hook
    mockUseTimeTracking.mockReturnValue({
      startTracking: mockStartTracking,
      stopTracking: mockStopTracking,
      logTime: mockLogTime,
    });

    // Mock successful API responses
    mockCatchupService.getCatchupFeed.mockResolvedValue({
      storyboards: mockStoryboards,
      total: 2,
      filter: 'core',
      limit: 5,
      offset: 0,
    });

    mockCatchupService.saveArticle.mockResolvedValue({
      message: 'Article saved successfully',
      is_saved: true,
    });

    mockCatchupService.markNotRelevant.mockResolvedValue({
      message: 'Storyboard marked as not relevant for this filter',
    });
  });

  describe('test_load_catchup_feed_for_filter', () => {
    it('loads catchup feed with core filter by default', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Check that the screen renders
      expect(getByText('Catch-up')).toBeTruthy();
      expect(getByText('Your curated daily insights')).toBeTruthy();

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
        expect(getByText('FDA Announces New Food Safety Rules')).toBeTruthy();
      });

      // Verify API was called with correct filter
      expect(mockCatchupService.getCatchupFeed).toHaveBeenCalledWith('core', 5, 0);
    });

    it('loads different content when filter changes', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Wait for initial load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Mock different response for specialization filter
      mockCatchupService.getCatchupFeed.mockResolvedValueOnce({
        storyboards: [mockStoryboards[1]], // Only the specialization storyboard
        total: 1,
        filter: 'specialization:Food & Beverage',
        limit: 5,
        offset: 0,
      });

      // Switch to Food & Beverage tab
      fireEvent.press(getByText('Food & Beverage'));

      // Wait for new content to load
      await waitFor(() => {
        expect(mockCatchupService.getCatchupFeed).toHaveBeenCalledWith(
          'specialization:Food & Beverage',
          5,
          0
        );
      });
    });
  });

  describe('test_tab_switch_changes_filter', () => {
    it('switches between different filter tabs', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Check initial tabs are rendered
      expect(getByText('Consumer')).toBeTruthy(); // Core industry
      expect(getByText('Food & Beverage')).toBeTruthy(); // Specialization
      expect(getByText('Technology')).toBeTruthy(); // Interest

      // Switch to Technology tab
      fireEvent.press(getByText('Technology'));

      await waitFor(() => {
        expect(mockCatchupService.getCatchupFeed).toHaveBeenCalledWith(
          'interest:Technology',
          5,
          0
        );
      });

      // Switch to Software Development tab
      fireEvent.press(getByText('Software Development'));

      await waitFor(() => {
        expect(mockCatchupService.getCatchupFeed).toHaveBeenCalledWith(
          'specialization:Software Development',
          5,
          0
        );
      });
    });

    it('maintains selected tab state', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Switch to Food & Beverage tab
      fireEvent.press(getByText('Food & Beverage'));

      // The tab should remain selected (this would be visually indicated by styling)
      // We can verify by checking that subsequent API calls use the correct filter
      await waitFor(() => {
        expect(mockCatchupService.getCatchupFeed).toHaveBeenLastCalledWith(
          'specialization:Food & Beverage',
          5,
          0
        );
      });
    });
  });

  describe('test_save_article', () => {
    it('saves headline article successfully', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Find and press save button
      const saveButton = getByText('Save for Dive-in');
      fireEvent.press(saveButton);

      // Verify API call
      await waitFor(() => {
        expect(mockCatchupService.saveArticle).toHaveBeenCalledWith('article-1');
      });

      // Check button state changes
      await waitFor(() => {
        expect(getByText('✓ Saved')).toBeTruthy();
      });
    });

    it('saves related article successfully', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Expand related articles
      fireEvent.press(getByText('1 related article >'));

      // Wait for expansion
      await waitFor(() => {
        expect(getByText('Sustainable Packaging Solutions')).toBeTruthy();
      });

      // Find and press save button for related article
      const relatedSaveButton = getByText('Save');
      fireEvent.press(relatedSaveButton);

      // Verify API call
      await waitFor(() => {
        expect(mockCatchupService.saveArticle).toHaveBeenCalledWith('article-2');
      });
    });

    it('handles save article error gracefully', async () => {
      // Mock API error
      mockCatchupService.saveArticle.mockRejectedValueOnce(
        new Error('Network error')
      );

      const { getByText } = render(<CatchupScreen />);

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Try to save article
      const saveButton = getByText('Save for Dive-in');
      fireEvent.press(saveButton);

      // Should show error alert
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Failed to save article. Please try again.'
        );
      });
    });
  });

  describe('test_mark_not_relevant', () => {
    it('marks storyboard as not relevant successfully', async () => {
      const { getByText } = render(<CatchupScreen />);

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Press not relevant button
      const notRelevantButton = getByText('Not relevant');
      fireEvent.press(notRelevantButton);

      // Confirm in alert
      expect(Alert.alert).toHaveBeenCalledWith(
        'Mark as Not Relevant',
        'This will hide this story from your feed. Are you sure?',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
          expect.objectContaining({ 
            text: 'Yes, Hide', 
            style: 'destructive',
            onPress: expect.any(Function)
          })
        ])
      );

      // Get the confirmation function and call it
      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const confirmButton = alertCall[2].find((button: any) => button.text === 'Yes, Hide');
      confirmButton.onPress();

      // Verify API call
      await waitFor(() => {
        expect(mockCatchupService.markNotRelevant).toHaveBeenCalledWith(
          'storyboard-1',
          'core'
        );
      });

      // Storyboard should be removed from view
      await waitFor(() => {
        expect(() => getByText('Food Industry Innovation Report')).toThrow();
      });
    });

    it('handles mark not relevant error gracefully', async () => {
      // Mock API error
      mockCatchupService.markNotRelevant.mockRejectedValueOnce(
        new Error('Network error')
      );

      const { getByText } = render(<CatchupScreen />);

      // Wait for storyboards to load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Press not relevant and confirm
      const notRelevantButton = getByText('Not relevant');
      fireEvent.press(notRelevantButton);

      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const confirmButton = alertCall[2].find((button: any) => button.text === 'Yes, Hide');
      confirmButton.onPress();

      // Error should be logged (we can't easily test console.error in this setup)
      await waitFor(() => {
        expect(mockCatchupService.markNotRelevant).toHaveBeenCalled();
      });
    });
  });

  describe('test_time_tracking_logs', () => {
    it('starts time tracking on mount', () => {
      render(<CatchupScreen />);

      expect(mockUseTimeTracking).toHaveBeenCalledWith('catchup');
      expect(mockStartTracking).toHaveBeenCalled();
    });

    it('uses time tracking hook with correct activity', () => {
      render(<CatchupScreen />);

      expect(mockUseTimeTracking).toHaveBeenCalledWith('catchup');
    });
  });

  describe('pagination and loading states', () => {
    it('shows loading state initially', () => {
      // Mock delayed response
      mockCatchupService.getCatchupFeed.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          storyboards: mockStoryboards,
          total: 2,
          filter: 'core',
          limit: 5,
          offset: 0,
        }), 100))
      );

      const { getByText } = render(<CatchupScreen />);

      expect(getByText('Loading your stories...')).toBeTruthy();
    });

    it('shows empty state when no storyboards', async () => {
      mockCatchupService.getCatchupFeed.mockResolvedValueOnce({
        storyboards: [],
        total: 0,
        filter: 'core',
        limit: 5,
        offset: 0,
      });

      const { getByText } = render(<CatchupScreen />);

      await waitFor(() => {
        expect(getByText('No stories available')).toBeTruthy();
        expect(getByText('Check back later for new content in this category')).toBeTruthy();
      });
    });

    it('loads more stories when load more button is pressed', async () => {
      // Mock initial response with hasMore = true
      mockCatchupService.getCatchupFeed
        .mockResolvedValueOnce({
          storyboards: [mockStoryboards[0]],
          total: 2,
          filter: 'core',
          limit: 1,
          offset: 0,
        })
        .mockResolvedValueOnce({
          storyboards: [mockStoryboards[1]],
          total: 2,
          filter: 'core',
          limit: 1,
          offset: 1,
        });

      const { getByText } = render(<CatchupScreen />);

      // Wait for initial load
      await waitFor(() => {
        expect(getByText('Food Industry Innovation Report')).toBeTruthy();
      });

      // Should show load more button
      const loadMoreButton = getByText('Load More Stories');
      fireEvent.press(loadMoreButton);

      // Should call API with offset
      await waitFor(() => {
        expect(mockCatchupService.getCatchupFeed).toHaveBeenCalledWith('core', 5, 5);
      });
    });
  });
});
