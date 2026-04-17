import { useState, useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Returns true when the system "Reduce Transparency" accessibility setting is
 * enabled. On web it always returns false (no equivalent API).
 *
 * Consumers should:
 *   - Raise background opacity to ~0.92
 *   - Set blur intensity to 0
 * to ensure adequate contrast for users who need it.
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );

    return () => subscription.remove();
  }, []);

  return reduceTransparency;
}
