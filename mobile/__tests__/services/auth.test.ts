import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAuthToken,
  saveAuthToken,
  clearAuth,
  isTokenExpired,
  getRefreshToken,
  saveRefreshToken,
} from '../../utils/auth';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
}));

describe('Auth Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuthToken', () => {
    it('returns token from storage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('test-token');

      const token = await getAuthToken();

      expect(AsyncStorage.getItem).toHaveBeenCalledWith('authToken');
      expect(token).toBe('test-token');
    });

    it('returns null when no token exists', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      const token = await getAuthToken();

      expect(token).toBeNull();
    });
  });

  describe('saveAuthToken', () => {
    it('saves token to storage', async () => {
      await saveAuthToken('new-token');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith('authToken', 'new-token');
    });
  });

  describe('clearAuth', () => {
    it('removes auth tokens from storage', async () => {
      await clearAuth();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['authToken', 'refreshToken']);
    });
  });

  describe('isTokenExpired', () => {
    it('returns true for expired token', () => {
      // Token with exp in the past (Jan 1, 2020)
      const expiredPayload = btoa(JSON.stringify({ exp: 1577836800 }));
      const expiredToken = `header.${expiredPayload}.signature`;

      expect(isTokenExpired(expiredToken)).toBe(true);
    });

    it('returns false for valid token', () => {
      // Token with exp in the far future (Jan 1, 2030)
      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const validPayload = btoa(JSON.stringify({ exp: futureExp }));
      const validToken = `header.${validPayload}.signature`;

      expect(isTokenExpired(validToken)).toBe(false);
    });

    it('returns true for invalid token format', () => {
      expect(isTokenExpired('invalid-token')).toBe(true);
      expect(isTokenExpired('')).toBe(true);
    });
  });

  describe('getRefreshToken', () => {
    it('returns refresh token from storage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('refresh-token');

      const token = await getRefreshToken();

      expect(AsyncStorage.getItem).toHaveBeenCalledWith('refreshToken');
      expect(token).toBe('refresh-token');
    });
  });

  describe('saveRefreshToken', () => {
    it('saves refresh token to storage', async () => {
      await saveRefreshToken('new-refresh-token');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh-token');
    });
  });
});
