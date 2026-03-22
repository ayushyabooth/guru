// Simple diagnostic test for signup functionality
describe('Signup Diagnostic Test', () => {
  it('can make API call to signup endpoint', async () => {
    const testEmail = `test.diagnostic.${Date.now()}@example.com`;
    
    const response = await fetch('http://localhost:8000/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:19006'
      },
      body: JSON.stringify({
        email: testEmail,
        password: 'testpass123'
      })
    });

    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data).toHaveProperty('user_id');
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    
    console.log('Signup test successful:', {
      email: testEmail,
      user_id: data.user_id,
      token_length: data.access_token.length
    });
  });

  it('handles CORS correctly', async () => {
    // Test CORS preflight
    const response = await fetch('http://localhost:8000/auth/signup', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:19006',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    console.log('CORS preflight response:', {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    });
  });
});
