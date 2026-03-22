import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import SignupScreen from '../../app/(auth)/signup';

// Mock fetch
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Mock router
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: mockReplace,
  },
  Link: ({ children, href, asChild }: any) => {
    if (asChild) {
      return React.cloneElement(children, {
        onPress: () => mockReplace(href),
      });
    }
    return children;
  },
}));

describe('Signup E2E Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockReplace.mockClear();
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('successfully creates account and redirects to onboarding', async () => {
    // Mock successful API response
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({
        user_id: '3074ba22-c292-41e9-bbab-aade3932867b',
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      }),
    };
    mockFetch.mockResolvedValue(mockResponse as any);

    render(<SignupScreen />);

    // Fill in the form
    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'test.e2e@example.com');
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'testpass123');

    // Tap create account button
    fireEvent.press(createAccountButton);

    // Wait for API call
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/auth/signup',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'test.e2e@example.com',
            password: 'testpass123',
          }),
        })
      );
    });

    // Verify tokens are stored
    await waitFor(() => {
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'access_token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'refresh_token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      );
    });

    // Verify navigation to onboarding
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/onboarding/industry');
    });
  });

  it('handles API errors gracefully', async () => {
    // Mock API error response
    const mockResponse = {
      ok: false,
      json: jest.fn().mockResolvedValue({
        detail: 'Email already exists',
      }),
    };
    mockFetch.mockResolvedValue(mockResponse as any);

    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'existing@example.com');
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'testpass123');

    fireEvent.press(createAccountButton);

    await waitFor(() => {
      expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
        'Signup Failed',
        'Email already exists'
      );
    });

    // Should not navigate on error
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('handles network errors gracefully', async () => {
    // Mock network error
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'test@example.com');
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'testpass123');

    fireEvent.press(createAccountButton);

    await waitFor(() => {
      expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Network error. Please try again.'
      );
    });
  });

  it('validates form fields before submission', async () => {
    render(<SignupScreen />);

    const createAccountButton = screen.getByText('Create Account');

    // Try to submit empty form
    fireEvent.press(createAccountButton);

    await waitFor(() => {
      expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Please fill in all fields'
      );
    });

    // Should not make API call
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validates password confirmation', async () => {
    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'test@example.com');
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'differentpass');

    fireEvent.press(createAccountButton);

    await waitFor(() => {
      expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Passwords do not match'
      );
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validates password length', async () => {
    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'test@example.com');
    fireEvent.changeText(passwordInput, '12345'); // Less than 6 characters
    fireEvent.changeText(confirmPasswordInput, '12345');

    fireEvent.press(createAccountButton);

    await waitFor(() => {
      expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Password must be at least 6 characters'
      );
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows loading state during signup', async () => {
    // Mock slow API response
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({
        user_id: 'test-id',
        access_token: 'test-token',
        refresh_token: 'test-refresh',
      }),
    };
    
    let resolvePromise: (value: any) => void;
    const slowPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    
    mockFetch.mockReturnValue(slowPromise as any);

    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    fireEvent.changeText(emailInput, 'test@example.com');
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'testpass123');

    fireEvent.press(createAccountButton);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText('Creating Account...')).toBeTruthy();
    });

    // Resolve the promise
    resolvePromise!(mockResponse);

    // Should return to normal state
    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeTruthy();
    });
  });
});

// Integration test with real API
describe('Signup Integration Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('real API signup flow works end-to-end', async () => {
    // Use real fetch for integration test
    const originalFetch = global.fetch;
    global.fetch = originalFetch;

    render(<SignupScreen />);

    const emailInput = screen.getByPlaceholderText('Email');
    const passwordInput = screen.getByPlaceholderText('Password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
    const createAccountButton = screen.getByText('Create Account');

    // Use unique email for each test run
    const testEmail = `test.integration.${Date.now()}@example.com`;
    
    fireEvent.changeText(emailInput, testEmail);
    fireEvent.changeText(passwordInput, 'testpass123');
    fireEvent.changeText(confirmPasswordInput, 'testpass123');

    fireEvent.press(createAccountButton);

    // Wait for successful completion
    await waitFor(() => {
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'access_token',
        expect.stringMatching(/^eyJ/) // JWT token pattern
      );
    }, { timeout: 10000 });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/onboarding/industry');
    });
  }, 15000); // 15 second timeout for real API
});
