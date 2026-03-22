import { API_BASE_URL } from './constants';

const TOKEN_KEY = 'guru_access_token';
const REFRESH_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

function decodeTokenPayload(token: string): { exp: number } | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function isTokenExpiringSoon(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload?.exp) return true;
  const expiresAt = payload.exp * 1000;
  return Date.now() > expiresAt - REFRESH_THRESHOLD_MS;
}

export async function getStoredToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

export async function setStoredToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function removeStoredToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

async function refreshToken(currentToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const newToken = data.access_token;
    if (newToken) {
      await setStoredToken(newToken);
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getValidToken(): Promise<string | null> {
  let token = await getStoredToken();
  if (!token) return null;

  if (isTokenExpiringSoon(token)) {
    const refreshed = await refreshToken(token);
    if (refreshed) return refreshed;
    // If refresh failed but token isn't expired yet, use it
    const payload = decodeTokenPayload(token);
    if (payload && payload.exp * 1000 > Date.now()) return token;
    return null;
  }

  return token;
}

export async function login(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.access_token;
    if (token) {
      await setStoredToken(token);
      return token;
    }
    return null;
  } catch {
    return null;
  }
}
