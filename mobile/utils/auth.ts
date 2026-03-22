import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../constants/config';

// Decode JWT without verification (for checking expiry only)
function decodeJWT(token: string): { exp?: number } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Check if token is expired or will expire soon (within 15 minutes)
function isTokenExpiringSoon(token: string): boolean {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) return true;

  const expiryTime = decoded.exp * 1000; // Convert to milliseconds
  const now = Date.now();
  const fifteenMinutes = 15 * 60 * 1000;

  return expiryTime - now < fifteenMinutes;
}

// Refresh token by getting a new one from the backend
async function refreshAuthToken(currentToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.access_token) {
        await setAuthToken(data.access_token);
        return data.access_token;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getAuthToken(): Promise<string | null> {
  let token: string | null = null;

  // On web, use localStorage directly (SecureStore doesn't work properly on web)
  if (typeof window !== 'undefined' && window.localStorage) {
    token = localStorage.getItem('access_token');
  } else {
    // On native, use SecureStore
    try {
      token = await SecureStore.getItemAsync('access_token');
    } catch {
      // SecureStore not available
    }
  }

  if (!token) {
    return null;
  }

  // Check if token is expiring soon and refresh if needed
  if (isTokenExpiringSoon(token)) {
    const newToken = await refreshAuthToken(token);
    return newToken || token; // Return new token or fall back to old one
  }

  return token;
}

export async function setAuthToken(token: string): Promise<void> {
  try {
    // Try SecureStore first
    await SecureStore.setItemAsync('access_token', token);
  } catch {
    // Fallback to localStorage for web
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('access_token', token);
    } else {
      throw new Error('Failed to set auth token: no storage available');
    }
  }
}

export async function removeAuthToken(): Promise<void> {
  try {
    // Try SecureStore first
    await SecureStore.deleteItemAsync('access_token');
  } catch {
    // Fallback to localStorage for web
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('access_token');
    }
  }
}
