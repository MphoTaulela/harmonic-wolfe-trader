import { SymbolId, Timeframe, TF_TO_MINUTES } from '../utils/constants';

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

const YAHOO_INTERVAL: Record<Timeframe, string> = { '15m': '15m', '30m': '30m', '1h': '60m' };

export async function fetchCandles(symbolId: SymbolId, yahooTicker: string, tf: Timeframe): Promise<Candle[]> {
  try {
    // Using Yahoo Finance chart API via proxy that allows CORS (free, no key)
    // Fallback to mock generator if fetch fails (offline dev)
    const interval = YAHOO_INTERVAL[tf];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&range=5d`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('yahoo fetch failed');
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('no result');
    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];
    if (!quotes) throw new Error('no quotes');
    const candles: Candle[] = timestamps.map((t: number, i: number) => ({
      time: t,
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume?.[i],
    })).filter((c: Candle) => c.open != null && c.high != null);
    if (candles.length < 50) throw new Error('too few candles');
    return candles.slice(-300);
  } catch (e) {
    console.log('Using synthetic data for', symbolId, e);
    return generateSynthetic(yahooTicker, TF_TO_MINUTES[tf]);
  }
}

function generateSynthetic(seed: string, minutes: number): Candle[] {
  let price = seed.includes('GBP') ? 1.27 : seed.includes('GC') ? 2650 : seed.includes('SI') ? 31 : seed.includes('CL') ? 78 : 44000;
  if (seed.includes('^NDX')) price = 19000;
  if (seed.includes('^DJI')) price = 43000;
  const now = Math.floor(Date.now()/1000);
  const candles: Candle[] = [];
  for (let i=200; i>=0; i--) {
    const vol = 0.003;
    const change = (Math.random()-0.5)*vol*price;
    const open = price;
    price = price + change;
    const high = Math.max(open, price) + Math.random()*price*0.001;
    const low = Math.min(open, price) - Math.random()*price*0.001;
    candles.push({ time: now - i*minutes*60, open, high, low, close: price });
  }
  return candles;
}
