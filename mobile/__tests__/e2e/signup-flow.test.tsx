/**
 * Sign up when the network or the API misbehaves (app/(auth)/signup.tsx): the
 * one retry after a refused connection (GUR-229), the busy button, and the
 * error text for answers that aren't a plain message. A component test despite
 * the folder: fetch is the mock from jest-setup.js, which also mocks
 * expo-secure-store and expo-router, so nothing leaves the test.
 *
 * The form's checks, a successful sign-up and a sign-up the API refuses are in
 * __tests__/integration/auth.test.tsx. This file used to repeat them against
 * the old screen (Alert dialogs, "Confirm Password", "Create Account"), and its
 * "real API" case never reached an API: it put back the same mocked fetch.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import SignupScreen from '../../app/(auth)/signup';

const fetchMock = jest.mocked(global.fetch);
const setItem = jest.mocked(SecureStore.setItemAsync);
const replace = jest.mocked(router.replace);

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** A failed answer. The screen reads the body with text(), then parses it. */
function failed(status: number, text: string): Response {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

/**
 * Let pending promises (the request, json(), SecureStore) settle until `done`.
 * RNTL's findBy and waitFor hang under fake timers on this screen, where the
 * wordmark's organism (GuruBlob) redraws on a requestAnimationFrame loop.
 */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !done(); i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function signUp(email = 'new@example.com', password = 'password123') {
  fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), password);
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
}

describe('Signup when the network or the API misbehaves', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries once after a refused connection, then creates the account', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(ok({ access_token: 'access-1', refresh_token: 'refresh-1' }));
    render(<SignupScreen />);

    signUp();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The retry waits 1.5 seconds. The async advance also runs the promise
    // callbacks around each timer, so the first failure is seen before it.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1500);
    });
    await settleUntil(() => screen.queryByText('Account created!') !== null);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Account created!')).toBeTruthy();
    expect(setItem).toHaveBeenCalledWith('access_token', 'access-1');
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(replace).toHaveBeenCalledWith('/(auth)/onboarding/industry');
  });

  it("says it couldn't reach Guru when the retry fails too", async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    render(<SignupScreen />);

    signUp();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1500);
    });
    await settleUntil(() => screen.queryByText(/Couldn't reach Guru/) !== null);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Couldn't reach Guru/)).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the button busy while the account is created', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    render(<SignupScreen />);

    signUp();
    expect(screen.getByRole('button', { name: 'Sign Up' }).props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });

    answer(ok({ access_token: 'access-1', refresh_token: 'refresh-1' }));
    await settleUntil(() => screen.queryByText('Account created!') !== null);

    expect(screen.getByRole('button', { name: 'Redirecting...' }).props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
  });

  it("joins a 422's validation messages into one line", async () => {
    const detail = [
      { type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address', input: 'x' },
      { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 8 characters' },
    ];
    fetchMock.mockResolvedValue(failed(422, JSON.stringify({ detail })));
    render(<SignupScreen />);

    signUp('x', 'password123');
    const message = 'value is not a valid email address. String should have at least 8 characters';
    await settleUntil(() => screen.queryByText(message) !== null);

    expect(screen.getByText(message)).toBeTruthy();
  });

  it("shows a general message when the error isn't JSON", async () => {
    fetchMock.mockResolvedValue(failed(502, '<html>Bad Gateway</html>'));
    render(<SignupScreen />);

    signUp();
    await settleUntil(() => screen.queryByText('Something went wrong. Please try again.') !== null);

    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
