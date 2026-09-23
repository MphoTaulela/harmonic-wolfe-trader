import { Candle, fetchCandles } from './marketData';
import { detectHarmonicPatterns, HarmonicPattern } from './patterns/harmonic';
import { detectWolfeWaves, WolfeWave } from './patterns/wolfe';
import { findSRLevels, SRLevel } from './patterns/supportResistance';
import { SYMBOLS, SymbolId, Timeframe } from '../utils/constants';

export type Signal = {
  id: string;
  symbol: SymbolId;
  timeframe: Timeframe;
  type: 'buy' | 'sell';
  strategy: 'Harmonic' | 'Wolfe' | 'SR Breakout';
  patternName?: string;
  entry: number;
  stopLoss: number;
  takeProfit: number[];
  confidence: number;
  timestamp: number;
  description: string;
  srLevels: SRLevel[];
  harmonic?: HarmonicPattern;
  wolfe?: WolfeWave;
};

export async function analyzeSymbol(symbolId: SymbolId, tf: Timeframe): Promise<Signal[]> {
  const meta = SYMBOLS.find(s=>s.id===symbolId)!;
  const candles = await fetchCandles(symbolId, meta.yahoo, tf);
  const sr = findSRLevels(candles);
  const harmonics = detectHarmonicPatterns(candles);
  const wolfes = detectWolfeWaves(candles);

  const signals: Signal[] = [];
  const lastClose = candles[candles.length-1].close;

  for (const h of harmonics) {
    signals.push({
      id: `${symbolId}-${tf}-harmonic-${h.name}-${Date.now()}-${Math.random()}`,
      symbol: symbolId,
      timeframe: tf,
      type: h.type === 'bullish' ? 'buy' : 'sell',
      strategy: 'Harmonic',
      patternName: h.name,
      entry: h.entry,
      stopLoss: h.stopLoss,
      takeProfit: [...h.takeProfit],
      confidence: h.confidence,
      timestamp: Date.now(),
      description: `${h.type.toUpperCase()} ${h.name} at ${h.entry.toFixed(2)}. PRZ confirmed near S/R.`,
      srLevels: sr,
      harmonic: h
    });
  }

  for (const w of wolfes) {
    signals.push({
      id: `${symbolId}-${tf}-wolfe-${Date.now()}-${Math.random()}`,
      symbol: symbolId,
      timeframe: tf,
      type: w.type,
      strategy: 'Wolfe',
      patternName: 'Wolfe Wave 5',
      entry: w.entry,
      stopLoss: w.stopLoss,
      takeProfit: [w.target],
      confidence: w.confidence,
      timestamp: Date.now(),
      description: `${w.type.toUpperCase()} Wolfe Wave: Point 5 reversal, EPA target ${w.target.toFixed(2)}`,
      srLevels: sr,
      wolfe: w
    });
  }

  // SR Breakout logic
  const recentHigh = Math.max(...candles.slice(-20).map(c=>c.high));
  const recentLow = Math.min(...candles.slice(-20).map(c=>c.low));
  for (const level of sr) {
    if (level.type==='resistance' && lastClose > level.price * 1.001 && lastClose < level.price*1.01 && level.strength > 0.5) {
      signals.push({
        id: `${symbolId}-${tf}-sr-${level.price}`,
        symbol: symbolId,
        timeframe: tf,
        type: 'buy',
        strategy: 'SR Breakout',
        entry: lastClose,
        stopLoss: level.price * 0.997,
        takeProfit: [lastClose + (lastClose - recentLow)*0.8, lastClose + (lastClose - recentLow)*1.5],
        confidence: 0.65 + level.strength*0.2,
        timestamp: Date.now(),
        description: `Resistance breakout above ${level.price.toFixed(2)} (${level.touches} touches)`,
        srLevels: sr
      });
    }
    if (level.type==='support' && lastClose < level.price * 0.999 && lastClose > level.price*0.99 && level.strength > 0.5) {
      signals.push({
        id: `${symbolId}-${tf}-sr-${level.price}`,
        symbol: symbolId,
        timeframe: tf,
        type: 'sell',
        strategy: 'SR Breakout',
        entry: lastClose,
        stopLoss: level.price * 1.003,
        takeProfit: [lastClose - (recentHigh - lastClose)*0.8, lastClose - (recentHigh - lastClose)*1.5],
        confidence: 0.65 + level.strength*0.2,
        timestamp: Date.now(),
        description: `Support breakdown below ${level.price.toFixed(2)} (${level.touches} touches)`,
        srLevels: sr
      });
    }
  }

  return signals.filter(s=>s.confidence >= 0.6).sort((a,b)=>b.confidence-a.confidence).slice(0,3);
}

export async function scanAll(timeframes: Timeframe[]): Promise<Signal[]> {
  const all: Signal[] = [];
  for (const sym of SYMBOLS) {
    for (const tf of timeframes) {
      const sigs = await analyzeSymbol(sym.id as SymbolId, tf);
      all.push(...sigs);
    }
  }
  return all.sort((a,b)=>b.confidence - a.confidence);
}
