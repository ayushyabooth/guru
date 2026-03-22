import { Stack } from 'expo-router';
import { OnboardingProvider } from '@/store/user-context';

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack>
        <Stack.Screen
          name="industry"
          options={{
            title: 'Select Industry',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="specializations"
          options={{
            title: 'Choose Specializations',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="interests"
          options={{
            title: 'Additional Interests',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="capacity"
          options={{
            title: 'Weekly Capacity',
            headerShown: false,
          }}
        />
        {/* New consolidated goals screen with liquid glass sliders */}
        <Stack.Screen
          name="goals"
          options={{
            title: 'Set Your Goals',
            headerShown: false,
          }}
        />
        {/* Legacy screens - kept for backward compatibility */}
        <Stack.Screen
          name="goals-catchup"
          options={{
            title: 'Daily Goals',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="goals-divein-recap"
          options={{
            title: 'Weekly Goals',
            headerShown: false,
          }}
        />
      </Stack>
    </OnboardingProvider>
  );
}
