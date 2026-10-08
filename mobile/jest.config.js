module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.js'],
  testMatch: [
    '**/__tests__/**/*.(js|jsx|ts|tsx)',
    '**/*.(test|spec).(js|jsx|ts|tsx)'
  ],
  // Files under __tests__/e2e that `npx jest` leaves out. They need a running
  // app or a live API, which a unit run (and CI) doesn't have:
  // - *.spec.ts are Playwright specs that drive the web app on localhost:8081.
  //   Playwright refuses to run inside jest.
  // - complete-auth-flow.test.ts and signup-diagnostic.test.js call a live API
  //   and sign up new accounts on it. Under jest, fetch is a mock.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/e2e/[^/]*\\.spec\\.ts$',
    '<rootDir>/__tests__/e2e/complete-auth-flow\\.test\\.ts$',
    '<rootDir>/__tests__/e2e/signup-diagnostic\\.test\\.js$',
  ],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  }
};
