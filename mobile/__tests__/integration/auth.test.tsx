/**
 * Sign in and sign up (app/(auth)/login.tsx and app/(auth)/signup.tsx): the
 * form's checks, the API call, where the tokens go and where the user lands.
 * fetch is the mock from jest-setup.js, which also mocks expo-secure-store and
 * expo-router, so nothing leaves the test.
 *
 * These tests used to expect Alert dialogs, a "Confirm Password" field, a
 * "Create Account" button, a 6-character password minimum and the API at
 * /auth/login. Today errors show inside the form card, the field is "Confirm
 * password", the button is "Sign Up", the minimum is 8 characters and the API
 * is under /api/v1.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { API_BASE_URL } from '../../constants/config';
import LoginScreen from '../../app/(auth)/login';
import SignupScreen from '../../app/(auth)/signup';

const fetchMock = jest.mocked(global.fetch);
const setItem = jest.mocked(SecureStore.setItemAsync);
const replace = jest.mocked(router.replace);
const push = jest.mocked(router.push);

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** A failed answer. The screens read the body with text(), then parse it. */
function failed(status: number, text: string): Response {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

const TOKENS = { access_token: 'access-1', refresh_token: 'refresh-1' };

/**
 * Let pending promises (the request, json(), SecureStore) settle until `done`.
 * For fake-timer tests: RNTL's findBy and waitFor hang under fake timers on
 * these screens, where the wordmark's organism (GuruBlob) redraws on a
 * requestAnimationFrame loop.
 */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !done(); i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});

describe('LoginScreen', () => {
  function signIn(email = 'reader@example.com', password = 'password123') {
    fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
    fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));
  }

  it('renders the sign-in form', () => {
    render(<LoginScreen />);

    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.getByText('Forgot Password?')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: "Don't have an account? Sign up" }));
    expect(push).toHaveBeenCalledWith('/(auth)/signup');
  });

  it('asks for both fields before calling the API', () => {
    render(<LoginScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Please fill in all fields')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the error when the user types', () => {
    render(<LoginScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'r');

    expect(screen.queryByText('Please fill in all fields')).toBeNull();
  });

  it('signs in, stores both tokens and opens the app', async () => {
    fetchMock.mockResolvedValue(ok(TOKENS));
    render(<LoginScreen />);

    signIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/(tabs)'));
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/login`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'reader@example.com', password: 'password123' }),
      }),
    );
    expect(setItem).toHaveBeenCalledWith('access_token', 'access-1');
    expect(setItem).toHaveBeenCalledWith('refresh_token', 'refresh-1');
  });

  it('shows the button as busy while signing in', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    render(<LoginScreen />);

    signIn();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign In' }).props.accessibilityState).toMatchObject({ busy: true }),
    );
    await act(async () => answer(ok(TOKENS)));
    expect(screen.getByRole('button', { name: 'Sign In' }).props.accessibilityState).toMatchObject({ busy: false });
  });

  it("shows the server's reason when sign-in fails", async () => {
    fetchMock.mockResolvedValue(failed(401, JSON.stringify({ detail: 'Incorrect email or password' })));
    render(<LoginScreen />);

    signIn('reader@example.com', 'wrong-password');

    expect(await screen.findByText('Incorrect email or password')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each<[number, string]>([
    [401, 'Invalid email or password'],
    [404, 'Account not found'],
    [503, 'Server error. Please try again.'],
  ])('explains a %p that came with no reason', async (status, message) => {
    fetchMock.mockResolvedValue(failed(status, 'Bad Gateway'));
    render(<LoginScreen />);

    signIn();

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says when it can't reach the server", async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    render(<LoginScreen />);

    signIn();

    expect(await screen.findByText('Unable to connect. Check your internet connection.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('SignupScreen', () => {
  function signUp(email: string, password: string, confirm = password) {
    fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
    fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), confirm);
    fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the sign-up form', () => {
    render(<SignupScreen />);

    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByPlaceholderText('Confirm password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeTruthy();

    fireEvent.press(screen.getByRole('link', { name: 'Already have an account? Sign in' }));
    expect(push).toHaveBeenCalledWith('/(auth)/login');
  });

  it.each<[string, string, string, string]>([
    ['empty fields', '', '', 'Please fill in all fields'],
    ['passwords that differ', 'password123', 'password124', 'Passwords do not match'],
    ['a password under 8 characters', '1234567', '1234567', 'Password must be at least 8 characters'],
  ])('stops %s before calling the API', (_case, password, confirm, message) => {
    render(<SignupScreen />);

    signUp(password ? 'new@example.com' : '', password, confirm);

    expect(screen.getByText(message)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the account, stores both tokens and opens onboarding after a moment', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(ok(TOKENS));
    render(<SignupScreen />);

    signUp('new@example.com', 'password123');
    await settleUntil(() => screen.queryByText('Account created!') !== null);

    expect(screen.getByText('Account created!')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/signup`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'password123' }),
      }),
    );
    expect(setItem).toHaveBeenCalledWith('access_token', 'access-1');
    expect(setItem).toHaveBeenCalledWith('refresh_token', 'refresh-1');
    expect(screen.getByRole('button', { name: 'Redirecting...' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(replace).toHaveBeenCalledWith('/(auth)/onboarding/industry');
  });

  it("shows the server's reason when sign-up fails, in the app's words", async () => {
    fetchMock.mockResolvedValue(failed(400, JSON.stringify({ detail: 'Email already registered' })));
    render(<SignupScreen />);

    signUp('taken@example.com', 'password123');

    expect(await screen.findByText('This email is already registered')).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
