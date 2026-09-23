import { Candle } from '../marketData';

export type SRLevel = { price: number; type: 'support' | 'resistance'; strength: number; touches: number };

export function findSRLevels(candles: Candle[]): SRLevel[] {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const levels: Map<number, { count: number; type: 'support'|'resistance' }> = new Map();

  const lookback = 5;
  for (let i = lookback; i < candles.length - lookback; i++) {
    const isSwingHigh = highs[i] === Math.max(...highs.slice(i-lookback, i+lookback+1));
    const isSwingLow = lows[i] === Math.min(...lows.slice(i-lookback, i+lookback+1));
    if (isSwingHigh) {
      const key = Math.round(highs[i] / (highs[i]*0.002)) * (highs[i]*0.002);
      const k = Number(key.toFixed(2));
      const existing = levels.get(k) || { count: 0, type: 'resistance' as const };
      levels.set(k, { count: existing.count+1, type: 'resistance' });
    }
    if (isSwingLow) {
      const key = Math.round(lows[i] / (lows[i]*0.002)) * (lows[i]*0.002);
      const k = Number(key.toFixed(2));
      const existing = levels.get(k) || { count: 0, type: 'support' as const };
      levels.set(k, { count: existing.count+1, type: 'support' });
    }
  }

  const sorted = Array.from(levels.entries())
    .filter(([_, v]) => v.count >= 2)
    .map(([price, v]) => ({ price, type: v.type, touches: v.count, strength: Math.min(v.count/4,1) }))
    .sort((a,b) => b.strength - a.strength)
    .slice(0, 8);
  return sorted;
}
