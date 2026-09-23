export const SYMBOLS = [
  { id: 'US30', name: 'US30', yahoo: '^DJI', tv: 'FOREXCOM:DJI', type: 'Indices' },
  { id: 'US100', name: 'US100', yahoo: '^NDX', tv: 'NASDAQ:NDX', type: 'Indices' },
  { id: 'GBPUSD', name: 'GBP/USD', yahoo: 'GBPUSD=X', tv: 'FX:GBPUSD', type: 'Forex' },
  { id: 'GOLD', name: 'GOLD', yahoo: 'GC=F', tv: 'TVC:GOLD', type: 'Metals' },
  { id: 'SILVER', name: 'SILVER', yahoo: 'SI=F', tv: 'TVC:SILVER', type: 'Metals' },
  { id: 'OILCASH', name: 'OIL (WTI)', yahoo: 'CL=F', tv: 'TVC:USOIL', type: 'Energy' },
] as const;

export const TIMEFRAMES = ['15m', '30m', '1h'] as const;
export type Timeframe = typeof TIMEFRAMES[number];
export type SymbolId = typeof SYMBOLS[number]['id'];

export const TF_TO_MINUTES: Record<Timeframe, number> = { '15m': 15, '30m': 30, '1h': 60 };
export const TF_TO_TV: Record<Timeframe, string> = { '15m': '15', '30m': '30', '1h': '60' };
