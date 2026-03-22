import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import LoginScreen from '../../app/(auth)/login';
import SignupScreen from '../../app/(auth)/signup';

// Mock fetch
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('Authentication Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('LoginScreen', () => {
    it('renders login form correctly', () => {
      render(<LoginScreen />);
      
      expect(screen.getByText('Welcome to Guru')).toBeTruthy();
      expect(screen.getByText('Expert-curated insights for professionals')).toBeTruthy();
      expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      expect(screen.getByPlaceholderText('Password')).toBeTruthy();
      expect(screen.getByText('Sign In')).toBeTruthy();
      expect(screen.getByText('Sign Up')).toBeTruthy();
    });

    it('shows error when fields are empty', async () => {
      render(<LoginScreen />);
      
      const signInButton = screen.getByText('Sign In');
      fireEvent.press(signInButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Please fill in all fields'
        );
      });
    });

    it('handles successful login', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      render(<LoginScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const signInButton = screen.getByText('Sign In');

      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.changeText(passwordInput, 'password123');
      fireEvent.press(signInButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/auth/login',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: 'test@example.com',
              password: 'password123',
            }),
          })
        );
      });

      await waitFor(() => {
        expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
          'access_token',
          'mock-access-token'
        );
        expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
          'refresh_token',
          'mock-refresh-token'
        );
      });
    });

    it('handles login failure', async () => {
      const mockResponse = {
        ok: false,
        json: jest.fn().mockResolvedValue({
          detail: 'Invalid credentials',
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      render(<LoginScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const signInButton = screen.getByText('Sign In');

      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.changeText(passwordInput, 'wrongpassword');
      fireEvent.press(signInButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Login Failed',
          'Invalid credentials'
        );
      });
    });

    it('handles network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      render(<LoginScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const signInButton = screen.getByText('Sign In');

      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.changeText(passwordInput, 'password123');
      fireEvent.press(signInButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Network error. Please try again.'
        );
      });
    });
  });

  describe('SignupScreen', () => {
    it('renders signup form correctly', () => {
      render(<SignupScreen />);
      
      expect(screen.getByText('Join Guru')).toBeTruthy();
      expect(screen.getByText('Get expert-curated insights tailored to your industry')).toBeTruthy();
      expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      expect(screen.getByPlaceholderText('Password')).toBeTruthy();
      expect(screen.getByPlaceholderText('Confirm Password')).toBeTruthy();
      expect(screen.getByText('Create Account')).toBeTruthy();
      expect(screen.getByText('Sign In')).toBeTruthy();
    });

    it('shows error when fields are empty', async () => {
      render(<SignupScreen />);
      
      const createAccountButton = screen.getByText('Create Account');
      fireEvent.press(createAccountButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Please fill in all fields'
        );
      });
    });

    it('shows error when passwords do not match', async () => {
      render(<SignupScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
      const createAccountButton = screen.getByText('Create Account');

      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.changeText(passwordInput, 'password123');
      fireEvent.changeText(confirmPasswordInput, 'differentpassword');
      fireEvent.press(createAccountButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Passwords do not match'
        );
      });
    });

    it('shows error when password is too short', async () => {
      render(<SignupScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
      const createAccountButton = screen.getByText('Create Account');

      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.changeText(passwordInput, '123');
      fireEvent.changeText(confirmPasswordInput, '123');
      fireEvent.press(createAccountButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Password must be at least 6 characters'
        );
      });
    });

    it('handles successful signup', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      render(<SignupScreen />);
      
      const emailInput = screen.getByPlaceholderText('Email');
      const passwordInput = screen.getByPlaceholderText('Password');
      const confirmPasswordInput = screen.getByPlaceholderText('Confirm Password');
      const createAccountButton = screen.getByText('Create Account');

      fireEvent.changeText(emailInput, 'newuser@example.com');
      fireEvent.changeText(passwordInput, 'password123');
      fireEvent.changeText(confirmPasswordInput, 'password123');
      fireEvent.press(createAccountButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/auth/signup',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: 'newuser@example.com',
              password: 'password123',
            }),
          })
        );
      });

      await waitFor(() => {
        expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
          'access_token',
          'mock-access-token'
        );
        expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
          'refresh_token',
          'mock-refresh-token'
        );
      });

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Success',
          'Account created successfully!',
          expect.any(Array)
        );
      });
    });

    it('handles signup failure', async () => {
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
      fireEvent.changeText(passwordInput, 'password123');
      fireEvent.changeText(confirmPasswordInput, 'password123');
      fireEvent.press(createAccountButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Signup Failed',
          'Email already exists'
        );
      });
    });
  });
});
