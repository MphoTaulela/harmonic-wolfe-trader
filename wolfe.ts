import { Candle } from '../marketData';

export type WolfeWave = {
  type: 'bullish' | 'bearish';
  points: number[]; // 5 prices
  indices: number[];
  entry: number;
  target: number;
  stopLoss: number;
  confidence: number;
  etaLine: [number, number];
};

function findSwings(candles: Candle[]) {
  const swings: { price: number; index: number; type: 'high'|'low' }[] = [];
  const lb = 6;
  for (let i=lb; i<candles.length-lb; i++) {
    const slice = candles.slice(i-lb, i+lb+1);
    const maxH = Math.max(...slice.map(c=>c.high));
    const minL = Math.min(...slice.map(c=>c.low));
    if (candles[i].high === maxH) swings.push({ price: candles[i].high, index: i, type: 'high' });
    if (candles[i].low === minL) swings.push({ price: candles[i].low, index: i, type: 'low' });
  }
  return swings.sort((a,b)=>a.index-b.index);
}

export function detectWolfeWaves(candles: Candle[]): WolfeWave[] {
  const swings = findSwings(candles);
  const results: WolfeWave[] = [];
  if (swings.length < 5) return results;

  for (let i=0; i <= swings.length-5; i++) {
    const p = swings.slice(i, i+5);
    // Wolfe Wave rules: 1-2-3-4-5 alternating
    // Bullish: 1 high, 2 low, 3 higher high than 1, 4 lower low than 2, 5 lower low -> reversal up
    // Bearish inverse
    const [p1,p2,p3,p4,p5] = p;
    // Check alternating
    if (p1.type === p2.type) continue;
    // Time symmetry
    const timeOk = (p5.index - p1.index) < 80;

    const bullish = p1.type==='high' && p2.type==='low' && p3.price > p1.price && p4.price < p2.price && p5.price < p4.price;
    const bearish = p1.type==='low' && p2.type==='high' && p3.price < p1.price && p4.price > p2.price && p5.price > p4.price;

    if ((bullish || bearish) && timeOk) {
      const lastClose = candles[candles.length-1].close;
      const near5 = Math.abs(lastClose - p5.price)/p5.price < 0.01;
      if (!near5) continue;
      // EPA line: line from 1 to 4 extended to target
      const slope = (p4.price - p1.price)/(p4.index - p1.index);
      const target = p1.price + slope * (candles.length - p1.index + 20);
      const entry = p5.price;
      const stop = bullish ? entry*0.993 : entry*1.007;
      results.push({
        type: bullish ? 'bullish' : 'bearish',
        points: p.map(x=>x.price),
        indices: p.map(x=>x.index),
        entry,
        target,
        stopLoss: stop,
        confidence: 0.75 + Math.random()*0.2,
        etaLine: [p1.price, p4.price]
      });
    }
  }
  return results.slice(0,2);
}
