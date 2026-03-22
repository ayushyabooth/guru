import 'react-native-gesture-handler/jestSetup';

// Mock expo-router
jest.mock('expo-router', () => ({
  Link: ({ children, href, asChild, ...props }) => {
    const React = require('react');
    if (asChild) {
      return React.cloneElement(children, { ...props, href });
    }
    return React.createElement('a', { ...props, href }, children);
  },
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  },
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  Stack: {
    Screen: ({ children, ...props }) => {
      const React = require('react');
      return React.createElement('div', props, children);
    },
  },
  Tabs: {
    Screen: ({ children, ...props }) => {
      const React = require('react');
      return React.createElement('div', props, children);
    },
  },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve('mock-token')),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock react-native components
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Alert: {
      alert: jest.fn(),
    },
  };
});

// Silence the warning: Animated: `useNativeDriver` is not supported
// jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

// Mock fetch
global.fetch = jest.fn();

// Setup console to show warnings and errors during tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
