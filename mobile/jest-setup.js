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

// Two native modules that react-native's own jest setup (0.81) doesn't mock:
// DevMenu, and SettingsManager (read by Settings on iOS, the platform jest-expo
// tests as). Reading DevMenu or Settings, or spreading the whole module the way
// `{ ...jest.requireActual('react-native') }` does, used to throw
// "TurboModuleRegistry.getEnforcing(...): 'DevMenu' could not be found" and
// fail every suite that imported react-native.
jest.mock('react-native/src/private/devsupport/devmenu/specs/NativeDevMenu', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
    reload: jest.fn(),
    setProfilingEnabled: jest.fn(),
    setHotLoadingEnabled: jest.fn(),
  },
}));
jest.mock('react-native/src/private/specs_DEPRECATED/modules/NativeSettingsManager', () => ({
  __esModule: true,
  default: {
    getConstants: () => ({ settings: {} }),
    setValues: jest.fn(),
    deleteValues: jest.fn(),
  },
}));

// The real react-native with Alert.alert mocked. react-native's index exports
// each API through a lazy getter, so copy the getters instead of spreading
// them: a spread loads every API (and its native module) in every suite.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const mocked = Object.defineProperties({}, Object.getOwnPropertyDescriptors(RN));
  Object.defineProperty(mocked, 'Alert', {
    value: { alert: jest.fn() },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return mocked;
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
