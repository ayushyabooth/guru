import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { UnifiedTabBar, FilterTabBar, TabItem } from '../../components/shared/UnifiedTabBar';

describe('UnifiedTabBar', () => {
  const mockTabs: TabItem[] = [
    { id: '1', label: 'Core', type: 'core', value: 'core' },
    { id: '2', label: 'Tech', type: 'specialization', value: 'technology' },
    { id: '3', label: 'AI', type: 'interest', value: 'ai' },
  ];

  it('renders all tabs correctly', () => {
    render(
      <UnifiedTabBar
        tabs={mockTabs}
        activeTabId="1"
        onTabPress={jest.fn()}
      />
    );

    expect(screen.getByText('Core')).toBeTruthy();
    expect(screen.getByText('Tech')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
  });

  it('calls onTabPress when tab is pressed', () => {
    const mockOnTabPress = jest.fn();
    render(
      <UnifiedTabBar
        tabs={mockTabs}
        activeTabId="1"
        onTabPress={mockOnTabPress}
      />
    );

    fireEvent.press(screen.getByText('Tech'));
    expect(mockOnTabPress).toHaveBeenCalledWith('2', 'technology');
  });

  it('shows icons in rich variant', () => {
    render(
      <UnifiedTabBar
        tabs={mockTabs}
        activeTabId="1"
        onTabPress={jest.fn()}
        showIcons={true}
        variant="rich"
      />
    );

    // Icons are emoji strings - check they're rendered
    expect(screen.getByText('🎯')).toBeTruthy(); // core
    expect(screen.getByText('⭐')).toBeTruthy(); // specialization
    expect(screen.getByText('💡')).toBeTruthy(); // interest
  });

  it('does not show icons in minimal variant', () => {
    const { queryByText } = render(
      <UnifiedTabBar
        tabs={mockTabs}
        activeTabId="1"
        onTabPress={jest.fn()}
        showIcons={false}
        variant="minimal"
      />
    );

    expect(queryByText('🎯')).toBeNull();
    expect(queryByText('⭐')).toBeNull();
    expect(queryByText('💡')).toBeNull();
  });

  it('handles empty tabs array', () => {
    const { container } = render(
      <UnifiedTabBar
        tabs={[]}
        activeTabId=""
        onTabPress={jest.fn()}
      />
    );

    // Should render without crashing
    expect(container).toBeTruthy();
  });
});

describe('FilterTabBar', () => {
  const mockTabs = [
    { label: 'All', context: 'all' },
    { label: 'Consumer', context: 'consumer' },
    { label: 'Technology', context: 'technology' },
  ];

  it('renders all filter tabs', () => {
    render(
      <FilterTabBar
        tabs={mockTabs}
        selectedContext="all"
        onContextChange={jest.fn()}
      />
    );

    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Consumer')).toBeTruthy();
    expect(screen.getByText('Technology')).toBeTruthy();
  });

  it('calls onContextChange when tab is pressed', () => {
    const mockOnContextChange = jest.fn();
    render(
      <FilterTabBar
        tabs={mockTabs}
        selectedContext="all"
        onContextChange={mockOnContextChange}
      />
    );

    fireEvent.press(screen.getByText('Consumer'));
    expect(mockOnContextChange).toHaveBeenCalledWith('consumer');
  });

  it('highlights selected context', () => {
    const { getByText } = render(
      <FilterTabBar
        tabs={mockTabs}
        selectedContext="consumer"
        onContextChange={jest.fn()}
      />
    );

    // The Consumer tab should be active (styled differently)
    const consumerTab = getByText('Consumer');
    expect(consumerTab).toBeTruthy();
  });
});
