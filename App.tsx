import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import HomeScreen from './src/screens/HomeScreen';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  useEffect(() => {
    ScreenOrientation.unlockAsync();
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') console.log('Notification permission not granted');
    })();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}
