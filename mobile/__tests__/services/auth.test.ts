/**
 * The session tokens (utils/auth.ts): where they are kept, when the access
 * token is refreshed, and what happens when the session is dead (GUR-239,
 * GUR-240). The web app keeps them in localStorage and native in SecureStore;
 * jsdom has localStorage, so the native tests hide it. fetch is the mock from
 * jest-setup.js, so no request leaves the test.
 *
 * This suite used to mock @react-native-async-storage/async-storage and test
 * saveAuthToken, saveRefreshToken, clearAuth and isTokenExpired. The app
 * doesn't use AsyncStorage (it isn't a dependency), and those four functions
 * are now setAuthToken, setRefreshToken, removeAuthToken and the internal
 * expiry check inside getAuthToken.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';

type AuthModule = typeof import('../../utils/auth');
type SecureStoreModule = typeof import('expo-secure-store');
type RouterModule = typeof import('expo-router');

// jest-setup.js makes fetch a mock, and mocks expo-secure-store and expo-router.
const fetchMock = jest.mocked(global.fetch);

/** A fresh utils/auth (its redirect guard is module state) and the mocks it uses. */
function load() {
  let auth!: AuthModule;
  let secureStore!: SecureStoreModule;
  let expoRouter!: RouterModule;
  jest.isolateModules(() => {
    auth = require('../../utils/auth');
    secureStore = require('expo-secure-store');
    expoRouter = require('expo-router');
  });
  return {
    ...auth,
    store: {
      get: jest.mocked(secureStore.getItemAsync),
      set: jest.mocked(secureStore.setItemAsync),
      remove: jest.mocked(secureStore.deleteItemAsync),
    },
    routerReplace: jest.mocked(expoRouter.router.replace),
  };
}

/** A token whose payload expires `seconds` from now. Only the payload is read. */
function jwt(seconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** getAuthToken starts the redirect without waiting for it: let it finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// window.localStorage and window.location are configurable in jsdom, so a test
// can stand in a fake location (to see the redirect) or hide either one (native).
const realLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

function fakeLocation(pathname: string) {
  const replace = jest.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, replace } });
  return replace;
}

function hide(prop: 'localStorage' | 'location') {
  Object.defineProperty(window, prop, { configurable: true, get: () => undefined });
}

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'localStorage', realLocalStorage);
  Object.defineProperty(window, 'location', realLocation);
});

describe('on the web (localStorage)', () => {
  it('returns null when no one is signed in', async () => {
    const auth = load();

    expect(await auth.getAuthToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a stored token that is more than 15 minutes from expiry', async () => {
    const token = jwt(3600);
    localStorage.setItem('access_token', token);
    const auth = load();

    expect(await auth.getAuthToken()).toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a token that expires within 15 minutes and keeps the rotated refresh token', async () => {
    const fresh = jwt(3600);
    localStorage.setItem('access_token', jwt(600));
    localStorage.setItem('refresh_token', 'refresh 1/2');
    fetchMock.mockResolvedValue(reply(200, { access_token: fresh, refresh_token: 'refresh-2' }));
    const auth = load();

    expect(await auth.getAuthToken()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/auth/refresh?refresh_token=refresh%201%2F2`, {
      method: 'POST',
    });
    expect(localStorage.getItem('access_token')).toBe(fresh);
    expect(localStorage.getItem('refresh_token')).toBe('refresh-2');
  });

  it('keeps the refresh token when the API answers with an access token only', async () => {
    const fresh = jwt(3600);
    localStorage.setItem('access_token', jwt(60));
    localStorage.setItem('refresh_token', 'refresh-1');
    fetchMock.mockResolvedValue(reply(200, { access_token: fresh }));
    const auth = load();

    expect(await auth.getAuthToken()).toBe(fresh);
    expect(localStorage.getItem('refresh_token')).toBe('refresh-1');
  });

  it('signs out and sends the user to /login when the refresh fails, never returning the old token', async () => {
    const replace = fakeLocation('/catchup');
    localStorage.setItem('access_token', jwt(60));
    localStorage.setItem('refresh_token', 'refresh-1');
    localStorage.setItem('guru:ucache:profile', '{"data":{},"timestamp":1}');
    fetchMock.mockResolvedValue(reply(401, { detail: 'Invalid refresh token' }));
    const auth = load();

    expect(await auth.getAuthToken()).toBeNull();
    await settle();

    expect(replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('guru:ucache:profile')).toBeNull();
  });

  it('treats a token it cannot read as expired', async () => {
    const replace = fakeLocation('/');
    localStorage.setItem('access_token', 'not-a-jwt');
    const auth = load();

    expect(await auth.getAuthToken()).toBeNull();
    await settle();

    // No refresh token, so there is nothing to refresh with.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('stores tokens under access_token and refresh_token', async () => {
    const auth = load();

    await auth.setAuthToken('access-1');
    await auth.setRefreshToken('refresh-1');

    expect(localStorage.getItem('access_token')).toBe('access-1');
    expect(await auth.getRefreshToken()).toBe('refresh-1');
  });

  it("removes the tokens and the user's cached data, but keeps cached config", async () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');
    localStorage.setItem('guru:ucache:metrics:all', '{}');
    localStorage.setItem('guru:cfg:industries', '{}');
    const auth = load();

    await auth.removeAuthToken();

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('guru:ucache:metrics:all')).toBeNull();
    expect(localStorage.getItem('guru:cfg:industries')).toBe('{}');
  });
});

describe('redirectToLogin', () => {
  it.each(['/login', '/signup', '/(auth)/onboarding/industry'])('does nothing on %p', async (pathname) => {
    const replace = fakeLocation(pathname);
    localStorage.setItem('access_token', 'a');
    const auth = load();

    await auth.redirectToLogin();

    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('access_token')).toBe('a');
  });

  it('redirects once, until a new session is stored', async () => {
    const replace = fakeLocation('/catchup');
    const auth = load();

    await auth.redirectToLogin();
    await auth.redirectToLogin();
    expect(replace).toHaveBeenCalledTimes(1);

    await auth.setAuthToken(jwt(3600));
    await auth.redirectToLogin();
    expect(replace).toHaveBeenCalledTimes(2);
  });
});

describe('on native (SecureStore)', () => {
  beforeEach(() => hide('localStorage'));

  it('reads and writes both tokens in SecureStore', async () => {
    const token = jwt(3600);
    const auth = load();
    auth.store.get.mockImplementation(async (key) => (key === 'access_token' ? token : 'refresh-1'));

    expect(await auth.getAuthToken()).toBe(token);
    expect(await auth.getRefreshToken()).toBe('refresh-1');
    await auth.setAuthToken('access-2');
    await auth.setRefreshToken('refresh-2');

    expect(auth.store.get).toHaveBeenCalledWith('access_token');
    expect(auth.store.get).toHaveBeenCalledWith('refresh_token');
    expect(auth.store.set).toHaveBeenCalledWith('access_token', 'access-2');
    expect(auth.store.set).toHaveBeenCalledWith('refresh_token', 'refresh-2');
  });

  it('deletes both tokens on sign-out', async () => {
    const auth = load();

    await auth.removeAuthToken();

    expect(auth.store.remove).toHaveBeenCalledWith('access_token');
    expect(auth.store.remove).toHaveBeenCalledWith('refresh_token');
  });

  it('throws when SecureStore cannot store the token', async () => {
    const auth = load();
    auth.store.set.mockRejectedValue(new Error('keychain locked'));

    await expect(auth.setAuthToken('access-1')).rejects.toThrow('Failed to set auth token: no storage available');
    await expect(auth.setRefreshToken('refresh-1')).rejects.toThrow('Failed to set refresh token: no storage available');
  });

  it('redirects with the router when there is no window.location', async () => {
    hide('location');
    const auth = load();

    await auth.redirectToLogin();

    expect(auth.routerReplace).toHaveBeenCalledWith('/(auth)/login');
    expect(auth.store.remove).toHaveBeenCalledWith('access_token');
  });
});
