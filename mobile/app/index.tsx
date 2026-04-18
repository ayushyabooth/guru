import { useState, useEffect } from 'react';
import { Redirect } from 'expo-router';
import { getAuthToken } from '../utils/auth';

export default function Index() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    getAuthToken()
      .then((token) => {
        setIsAuthenticated(!!token);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return null;
  return <Redirect href={isAuthenticated ? '/(tabs)' : '/(auth)/login'} />;
}
