/**
 * E2E Test: Complete Auth Flow
 * Tests the entire user journey: signup -> login -> fetch storyboards
 * This test will identify exactly where the auth flow is breaking
 */

import { API_BASE_URL } from '../../constants/config';

describe('Complete Auth Flow E2E', () => {
  const testEmail = `e2e-test-${Date.now()}@example.com`;
  const testPassword = 'test123456';
  let accessToken: string;
  let userId: string;

  beforeAll(() => {
  });

  test('Step 1: Signup creates account and returns token', async () => {
    
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
      user_id: data.user_id,
      has_access_token: !!data.access_token,
      has_refresh_token: !!data.refresh_token,
    });

    expect(data.user_id).toBeDefined();
    expect(data.access_token).toBeDefined();
    expect(data.refresh_token).toBeDefined();

    accessToken = data.access_token;
    userId = data.user_id;

  });

  test('Step 2: Token can authenticate API calls', async () => {
    
    const response = await fetch(`${API_BASE_URL}/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    
    if (!response.ok) {
      const errorText = await response.text();
    }

    expect(response.status).toBe(200);
    
    const profile = await response.json();
      user_id: profile.user_id,
      core_industry: profile.core_industry,
    });

    expect(profile.user_id).toBe(userId);
  });

  test('Step 3: Can fetch catchup feed with token', async () => {
    
    const response = await fetch(`${API_BASE_URL}/catchup-feed?filter=core&limit=5&offset=0`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    
    if (!response.ok) {
      const errorText = await response.text();
      
      // Log detailed error info
        url: `${API_BASE_URL}/catchup-feed?filter=core&limit=5&offset=0`,
        token_preview: accessToken.substring(0, 20) + '...',
        user_id: userId,
      });
    }

    expect(response.status).toBe(200);
    
    const data = await response.json();
      storyboards_count: data.storyboards?.length || 0,
      total: data.total,
      filter: data.filter,
    });

    // Storyboards might be 0 initially (need to generate), that's OK
    expect(data.storyboards).toBeDefined();
    expect(Array.isArray(data.storyboards)).toBe(true);
  });

  test('Step 4: Login with same credentials returns valid token', async () => {
    
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    
    if (!response.ok) {
      const errorText = await response.text();
    }

    expect(response.status).toBe(200);
    
    const data = await response.json();
      user_id: data.user_id,
      has_access_token: !!data.access_token,
      token_matches_signup: data.access_token === accessToken,
    });

    expect(data.user_id).toBe(userId);
    expect(data.access_token).toBeDefined();

    // Update token for next test
    const newToken = data.access_token;

    // Test that new token works
    const meResponse = await fetch(`${API_BASE_URL}/me`, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
    });

    expect(meResponse.status).toBe(200);
  });

  test('Step 5: Complete flow simulation - signup, login, fetch stories', async () => {
    
    // Create a new user for clean test
    const newEmail = `e2e-complete-${Date.now()}@example.com`;
    
    // 1. Signup
    const signupRes = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, password: testPassword }),
    });
    expect(signupRes.status).toBe(200);
    const signupData = await signupRes.json();

    // 2. Login (simulating user closing browser and coming back)
    const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, password: testPassword }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();

    // 3. Fetch stories
    const storiesRes = await fetch(`${API_BASE_URL}/catchup-feed?filter=core&limit=5`, {
      headers: {
        'Authorization': `Bearer ${loginData.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    
    
    if (!storiesRes.ok) {
      const errorText = await storiesRes.text();
      
      // Additional debugging
        email: newEmail,
        user_id: loginData.user_id,
        token_preview: loginData.access_token.substring(0, 30),
        api_url: API_BASE_URL,
      });
    }

    expect(storiesRes.status).toBe(200);
    const storiesData = await storiesRes.json();
  });

  afterAll(() => {
  });
});
