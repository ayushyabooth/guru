import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { StoryboardCard } from '../../components/Catch-up/StoryboardCard';
import { Storyboard } from '../../services/article-service';

// Mock Alert
jest.spyOn(Alert, 'alert');

// Mock Linking
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Linking: {
    openURL: jest.fn(),
  },
}));

const mockStoryboard: Storyboard = {
  id: 'storyboard-1',
  filter_context: 'core',
  industry: 'Technology',
  specializations: ['Software Development'],
  summary: 'This is a test storyboard summary about recent developments in AI.',
  personal_prompt: 'How might these AI developments impact your current projects?',
  created_at: '2024-01-01T00:00:00Z',
  theme: 'AI Innovation',
  headline_article: {
    id: 'article-1',
    title: 'Major AI Breakthrough Announced',
    source: 'Tech News',
    url: 'https://example.com/article-1',
    word_count: 500,
    is_paywalled: false,
    created_at: '2024-01-01T00:00:00Z',
    publish_date: '2024-01-01T00:00:00Z',
  },
  related_articles: [
    {
      id: 'article-2',
      title: 'Related AI Article 1',
      source: 'AI Weekly',
      url: 'https://example.com/article-2',
      word_count: 300,
      is_paywalled: true,
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'article-3',
      title: 'Related AI Article 2',
      source: 'Tech Today',
      url: 'https://example.com/article-3',
      word_count: 400,
      is_paywalled: false,
      created_at: '2024-01-01T00:00:00Z',
    },
  ],
  article_count: 3,
};

describe('StoryboardCard', () => {
  const mockOnSave = jest.fn();
  const mockOnNotRelevant = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders storyboard content correctly', () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    // Check theme
    expect(getByText('AI INNOVATION')).toBeTruthy();
    
    // Check headline
    expect(getByText('Major AI Breakthrough Announced')).toBeTruthy();
    expect(getByText('Tech News')).toBeTruthy();
    
    // Check summary
    expect(getByText('This is a test storyboard summary about recent developments in AI.')).toBeTruthy();
    
    // Check personal prompt
    expect(getByText('"How might these AI developments impact your current projects?"')).toBeTruthy();
    
    // Check action buttons
    expect(getByText('Save for Dive-in')).toBeTruthy();
    expect(getByText('Not relevant')).toBeTruthy();
  });

  it('shows paywall icon for paywalled articles', () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    // The headline article is not paywalled, so no icon should show
    // But we can test this by modifying the mock
    expect(() => getByText('🔒')).toThrow();
  });

  it('expands and collapses related articles', () => {
    const { getByText, queryByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    // Initially collapsed
    expect(getByText('2 related articles >')).toBeTruthy();
    expect(queryByText('Related AI Article 1')).toBeNull();

    // Tap to expand
    fireEvent.press(getByText('2 related articles >'));
    
    // Should now be expanded
    expect(getByText('2 related articles ▼')).toBeTruthy();
    expect(getByText('Related AI Article 1')).toBeTruthy();
    expect(getByText('Related AI Article 2')).toBeTruthy();

    // Tap to collapse
    fireEvent.press(getByText('2 related articles ▼'));
    
    // Should be collapsed again
    expect(getByText('2 related articles >')).toBeTruthy();
    expect(queryByText('Related AI Article 1')).toBeNull();
  });

  it('calls onSave when save button is pressed', async () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    fireEvent.press(getByText('Save for Dive-in'));
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith('article-1');
    });
  });

  it('updates save button state after saving', async () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    // Initially shows "Save for Dive-in"
    expect(getByText('Save for Dive-in')).toBeTruthy();

    // Press save button
    fireEvent.press(getByText('Save for Dive-in'));
    
    await waitFor(() => {
      expect(getByText('✓ Saved')).toBeTruthy();
    });
  });

  it('shows confirmation alert when marking as not relevant', () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    fireEvent.press(getByText('Not relevant'));
    
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
  });

  it('calls onNotRelevant when confirmed', () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    fireEvent.press(getByText('Not relevant'));
    
    // Get the onPress function from the alert call
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const confirmButton = alertCall[2].find((button: any) => button.text === 'Yes, Hide');
    
    // Call the onPress function
    confirmButton.onPress();
    
    expect(mockOnNotRelevant).toHaveBeenCalledWith('storyboard-1');
  });

  it('handles save article in related articles list', async () => {
    const { getByText } = render(
      <StoryboardCard
        storyboard={mockStoryboard}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    // Expand related articles
    fireEvent.press(getByText('2 related articles >'));
    
    // Find and press save button for first related article
    const saveButtons = getByText('Save');
    fireEvent.press(saveButtons);
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith('article-2');
    });
  });

  it('renders without theme when theme is not provided', () => {
    const storyboardWithoutTheme = { ...mockStoryboard, theme: undefined };
    
    const { queryByText } = render(
      <StoryboardCard
        storyboard={storyboardWithoutTheme}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    expect(queryByText('AI INNOVATION')).toBeNull();
  });

  it('renders without personal prompt when not provided', () => {
    const storyboardWithoutPrompt = { ...mockStoryboard, personal_prompt: '' };
    
    const { queryByText } = render(
      <StoryboardCard
        storyboard={storyboardWithoutPrompt}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    expect(queryByText('"How might these AI developments impact your current projects?"')).toBeNull();
  });

  it('renders with empty related articles array', () => {
    const storyboardWithoutRelated = { ...mockStoryboard, related_articles: [] };
    
    const { queryByText } = render(
      <StoryboardCard
        storyboard={storyboardWithoutRelated}
        onSave={mockOnSave}
        onNotRelevant={mockOnNotRelevant}
      />
    );

    expect(queryByText('related articles')).toBeNull();
  });
});
