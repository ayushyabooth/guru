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

    // The icons were emoji; they are Phosphor icons now (components/ui/Icon).
    expect(screen.getByTestId(/^phosphor-react-native-target-/)).toBeTruthy(); // core
    expect(screen.getByTestId(/^phosphor-react-native-star-/)).toBeTruthy(); // specialization
    expect(screen.getByTestId(/^phosphor-react-native-lightbulb-/)).toBeTruthy(); // interest
  });

  it('does not show icons in minimal variant', () => {
    render(
      <UnifiedTabBar
        tabs={mockTabs}
        activeTabId="1"
        onTabPress={jest.fn()}
        showIcons={false}
        variant="minimal"
      />
    );

    expect(screen.queryAllByTestId(/^phosphor-react-native-/)).toHaveLength(0);
  });

  it('handles empty tabs array', () => {
    render(
      <UnifiedTabBar
        tabs={[]}
        activeTabId=""
        onTabPress={jest.fn()}
      />
    );

    // Renders the empty tab list without crashing.
    expect(screen.getByLabelText('Content filters')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

// FilterTabBar is now a wrapper over FilterPills (GUR-132), which draws each
// label twice: a dim layer that is always visible and an active layer that
// fades in. So these tests find a pill by its tab role and name, not its text.
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

    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'All',
      'Consumer',
      'Technology',
    ]);
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

    fireEvent.press(screen.getByRole('tab', { name: 'Consumer' }));
    expect(mockOnContextChange).toHaveBeenCalledWith('consumer');
  });

  it('highlights selected context', () => {
    render(
      <FilterTabBar
        tabs={mockTabs}
        selectedContext="consumer"
        onContextChange={jest.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: 'Consumer' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'All' }).props.accessibilityState).toEqual({ selected: false });
  });
});
