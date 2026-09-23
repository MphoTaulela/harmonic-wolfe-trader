import * as Notifications from 'expo-notifications';
import { Signal } from './analyzer';

export async function notifySignal(signal: Signal) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚀 ${signal.symbol} ${signal.type.toUpperCase()} - ${signal.strategy}`,
      body: `${signal.patternName || signal.strategy} on ${signal.timeframe} | Entry ${signal.entry.toFixed(2)} SL ${signal.stopLoss.toFixed(2)} TP ${signal.takeProfit[0].toFixed(2)} | ${(signal.confidence*100).toFixed(0)}% conf`,
      data: { signalId: signal.id },
    },
    trigger: null,
  });
}
