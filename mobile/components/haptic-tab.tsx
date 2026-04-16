/**
 * Tab button with:
 *   - Soft iOS haptic on press
 *   - Liquid-glass "spotlight" capsule behind the active tab so users can
 *     tell which tab they're on at a glance (GUR-98 follow-up — the color-
 *     only active state wasn't reading).
 *
 * The overlay is injected via `accessibilityState.selected` which React
 * Navigation sets on the active tab button.
 */
import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';
import { Platform, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export function HapticTab(props: BottomTabBarButtonProps) {
  const { isDark } = useTheme();
  const selected = (props.accessibilityState as any)?.selected === true;

  const webGlass =
    Platform.OS === 'web' && selected
      ? {
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          boxShadow: isDark
            ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 12px rgba(99,102,241,0.18)'
            : 'inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 12px rgba(15,23,42,0.08)',
        }
      : {};

  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    >
      {selected && (
        <View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 8,
              right: 8,
              top: 6,
              bottom: 6,
              borderRadius: 18,
              backgroundColor: isDark
                ? 'rgba(99,102,241,0.18)'
                : 'rgba(99,102,241,0.10)',
              borderWidth: 1,
              borderColor: isDark
                ? 'rgba(129,140,248,0.35)'
                : 'rgba(99,102,241,0.22)',
            },
            webGlass as any,
          ]}
        />
      )}
      {props.children}
    </PlatformPressable>
  );
}
