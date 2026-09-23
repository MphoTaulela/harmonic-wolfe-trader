import { Candle } from '../marketData';

export type HarmonicPattern = {
  name: 'Gartley' | 'Bat' | 'Butterfly' | 'Crab' | 'Shark';
  type: 'bullish' | 'bearish';
  points: { X: number; A: number; B: number; C: number; D: number };
  indices: { X: number; A: number; B: number; C: number; D: number };
  entry: number;
  stopLoss: number;
  takeProfit: [number, number];
  confidence: number;
};

const PATTERNS = {
  Gartley: { B: [0.618, 0.618], C: [0.382, 0.886], D: [0.786, 0.786] },
  Bat: { B: [0.382, 0.5], C: [0.382, 0.886], D: [0.886, 0.886] },
  Butterfly: { B: [0.786, 0.786], C: [0.382, 0.886], D: [1.27, 1.618] },
  Crab: { B: [0.382, 0.618], C: [0.382, 0.886], D: [1.618, 3.618] },
};

function fibRatio(p1: number, p2: number, p3: number): number {
  const xa = Math.abs(p1 - p2);
  if (xa === 0) return 0;
  return Math.abs(p2 - p3) / xa;
}

function findZigZag(candles: Candle[]): { price: number; index: number }[] {
  const pivots: { price: number; index: number }[] = [];
  const lookback = 5;
  for (let i=lookback; i < candles.length-lookback; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const isHigh = high === Math.max(...candles.slice(i-lookback, i+lookback+1).map(c=>c.high));
    const isLow = low === Math.min(...candles.slice(i-lookback, i+lookback+1).map(c=>c.low));
    if (isHigh) pivots.push({ price: high, index: i });
    else if (isLow) pivots.push({ price: low, index: i });
  }
  // Alternate high/low
  const filtered: typeof pivots = [];
  for (let i=0; i<pivots.length; i++) {
    if (filtered.length===0 || (filtered[filtered.length-1].price < pivots[i].price ? pivots[i].price > filtered[filtered.length-1].price : pivots[i].price < filtered[filtered.length-1].price)) {
      filtered.push(pivots[i]);
    }
  }
  return filtered.slice(-30);
}

export function detectHarmonicPatterns(candles: Candle[]): HarmonicPattern[] {
  const pivots = findZigZag(candles);
  const results: HarmonicPattern[] = [];
  if (pivots.length < 5) return results;

  for (let i=0; i <= pivots.length-5; i++) {
    const X = pivots[i], A = pivots[i+1], B = pivots[i+2], C = pivots[i+3], D = pivots[i+4];
    const bullish = X.price > A.price && A.price < B.price && B.price > C.price && C.price < D.price ? false : X.price < A.price && A.price > B.price;
    // Simplify: determine direction by X->A
    const isBullish = A.price > X.price ? false : true; // X low, A high = bearish start? Let's define properly
    // Actually for bullish Gartley: X low -> A high -> B low -> C high -> D low (buy at D)
    const xa = Math.abs(X.price - A.price);
    if (xa === 0) continue;
    const ab = fibRatio(X.price, A.price, B.price);
    const bc = fibRatio(A.price, B.price, C.price);
    const cd = fibRatio(B.price, C.price, D.price);
    const xaExt = Math.abs(C.price - D.price) / xa;

    for (const [name, ratios] of Object.entries(PATTERNS)) {
      const [bMin,bMax] = ratios.B;
      const [cMin,cMax] = ratios.C;
      const [dMin,dMax] = ratios.D;
      const bOk = ab >= bMin-0.15 && ab <= bMax+0.15;
      const cOk = bc >= cMin-0.2 && bc <= cMax+0.2;
      const dOk = xaExt >= dMin-0.2 && xaExt <= dMax+0.2;
      if (bOk && cOk && dOk) {
        const lastClose = candles[candles.length-1].close;
        const isNearD = Math.abs(lastClose - D.price) / D.price < 0.015; // within 1.5%
        if (!isNearD) continue;
        const bullishPattern = D.price < C.price; // D lower than C in bullish
        const entry = D.price;
        const stop = bullishPattern ? entry * 0.995 : entry * 1.005;
        const tp1 = bullishPattern ? entry + xa*0.382 : entry - xa*0.382;
        const tp2 = bullishPattern ? entry + xa*0.618 : entry - xa*0.618;
        const confidence = ( (bOk?0.3:0) + (cOk?0.3:0) + (dOk?0.4:0) ) * (isNearD?1:0.5);
        results.push({
          name: name as any,
          type: bullishPattern ? 'bullish' : 'bearish',
          points: { X: X.price, A: A.price, B: B.price, C: C.price, D: D.price },
          indices: { X: X.index, A: A.index, B: B.index, C: C.index, D: D.index },
          entry,
          stopLoss: stop,
          takeProfit: [tp1, tp2],
          confidence
        });
      }
    }
  }
  return results.sort((a,b) => b.confidence - a.confidence).slice(0,3);
}
