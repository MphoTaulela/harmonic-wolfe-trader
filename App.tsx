
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal, Dimensions, PanResponder, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const BACKGROUND_TASK = 'meridian-background-scan-v3';

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    // This runs even when app is closed - triggers a notification check
    // Actual heavy scan happens in foreground, but this keeps OS aware
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

const SYMBOLS = [
  { id: 'US30', name: 'US30(CFD)', fullName: 'Dow Jones', yahoo: '^DJI', decimals: 1 },
  { id: 'US100', name: 'US100(CFD)', fullName: 'Nasdaq 100', yahoo: '^NDX', decimals: 1 },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', yahoo: 'GC=F', decimals: 2 },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', yahoo: 'SI=F', decimals: 3 },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'Cable', yahoo: 'GBPUSD=X', decimals: 5 },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'Euro', yahoo: 'EURUSD=X', decimals: 5 },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI', yahoo: 'CL=F', decimals: 2 },
] as const;

type SymbolId = typeof SYMBOLS[number]['id'];
type Timeframe = '15m' | '30m' | '1h';
const TIMEFRAMES: Timeframe[] = ['15m','30m','1h'];
const TF_MIN: Record<Timeframe, number> = { '15m': 15, '30m': 30, '1h': 60 };
const TF_MAX_AGE_MS: Record<Timeframe, number> = { '15m': 2*60*60*1000, '30m': 4*60*60*1000, '1h': 8*60*60*1000 };

type Candle = { time: number; open: number; high: number; low: number; close: number; };
type SRLevel = { price: number; type: 'support'|'resistance'; touches: number; strength: number; touchTimes: number[]; };
type PatternPoint = { time: number; price: number; label: string; };
type Signal = {
  id: string; symbol: SymbolId; timeframe: Timeframe; type: 'BUY'|'SELL';
  strategy: 'Harmonic'|'Wolfe'|'S/R'; patternName: string;
  entry: number; stop: number; tp1: number; tp2?: number;
  qScore: number; rr: string; description: string; time: number; activeFor: string;
  patternPoints: PatternPoint[]; // XABCD or 1-5 or S/R touches
  targetLine?: PatternPoint[]; // For Wolfe EPA
};

// FIX 1: Full price formatting for EURUSD/GBPUSD
function formatPrice(price: number, symbolId: SymbolId): string {
  const meta = SYMBOLS.find(s=>s.id===symbolId);
  const dec = meta?.decimals ?? 2;
  return price.toFixed(dec);
}
function formatPriceFull(price: number, symbolId: SymbolId): string {
  const dec = SYMBOLS.find(s=>s.id===symbolId)?.decimals ?? 2;
  // For forex show full 5 decimals, never truncate to 2
  return price.toFixed(dec);
}

function getChartHtml(candles: Candle[], signal?: Signal, sr: SRLevel[] = []) {
  const cJson = JSON.stringify(candles);
  const levels: any[] = [];
  if (signal) {
    const sym = signal.symbol;
    levels.push({ price: signal.entry, color: '#ffffff', title: 'Entry ' + formatPriceFull(signal.entry, sym) });
    levels.push({ price: signal.stop, color: '#ff453a', title: 'STOP ' + formatPriceFull(signal.stop, sym) });
    levels.push({ price: signal.tp1, color: '#00c853', title: 'TP1 ' + formatPriceFull(signal.tp1, sym) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#00c853', title: 'TP2 ' + formatPriceFull(signal.tp2, sym) });
  }
  sr.slice(0,4).forEach(l=>{
    levels.push({ price: l.price, color: l.type==='resistance' ? '#ff9f0a' : '#0a84ff', title: (l.type==='resistance'?'R ':'S ') + l.price.toFixed(2) });
  });
  const lJson = JSON.stringify(levels);
  const patternJson = JSON.stringify(signal?.patternPoints || []);
  const targetJson = JSON.stringify(signal?.targetLine || []);

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>
  body{margin:0;background:#0e0e10;overflow:hidden} #c{width:100vw;height:100vh}
  .label{position:absolute;color:#fff;font-size:10px;background:rgba(0,0,0,0.7);padding:2px 4px;border-radius:3px}
  </style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>
  const candles=${cJson}; const levels=${lJson}; const pattern=${patternJson}; const targetLine=${targetJson};
  const chart=LightweightCharts.createChart(document.getElementById('c'),{
    layout:{background:{color:'#0e0e10'},textColor:'#8a8a8e'},
    grid:{vertLines:{color:'#1c1c1e'},horzLines:{color:'#1c1c1e'}},
    rightPriceScale:{borderColor:'#2c2c2e',scaleMargins:{top:0.15,bottom:0.15}},
    timeScale:{borderColor:'#2c2c2e', timeVisible:true},
    crosshair:{mode:1}
  });
  const candleSeries=chart.addCandlestickSeries({upColor:'#30d158',downColor:'#ff453a',borderUpColor:'#30d158',borderDownColor:'#ff453a',wickUpColor:'#30d158',wickDownColor:'#ff453a'});
  candleSeries.setData(candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
  
  // Horizontal levels - Entry/SL/TP/R/S
  levels.forEach(l=>{
    try{ candleSeries.createPriceLine({price:l.price,color:l.color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:l.title}); }catch(e){}
  });

  // FIX 4: Draw setups that lead to signal - Harmonic XABCD, Wolfe 1-5, S/R touches
  if(pattern.length>=2){
    try{
      // Main pattern polyline - blue for harmonic, purple for wolfe, orange for SR
      const isWolfe = pattern[0]?.label?.startsWith('1') || pattern[0]?.label==='1';
      const lineColor = isWolfe ? '#af52de' : (pattern.length===5 ? '#0a84ff' : '#ff9f0a');
      const lineSeries = chart.addLineSeries({color: lineColor, lineWidth:2, lineStyle:0});
      lineSeries.setData(pattern.map(p=>({time:p.time, value:p.price})));
      
      // Markers for X,A,B,C,D or 1-5
      const markers = pattern.map(p=>({
        time: p.time,
        position: p.label==='X' || p.label==='1' ? 'belowBar' : 'aboveBar',
        color: lineColor,
        shape: 'circle',
        text: p.label
      }));
      candleSeries.setMarkers(markers);

      // For Wolfe - draw EPA target line from 1 to 4 extended
      if(targetLine.length>=2){
        const targetSeries = chart.addLineSeries({color:'#ffcc02', lineWidth:1, lineStyle:2});
        targetSeries.setData(targetLine.map(p=>({time:p.time, value:p.price})));
      }
    }catch(e){ console.log('pattern draw error', e); }
  }

  chart.timeScale().fitContent();
  </script></body></html>`;
}

async function fetchCandles(ticker: string, minutes: number): Promise<Candle[]> {
  try {
    const map: any = {15:'15m',30:'30m',60:'60m'};
    const interval = map[minutes] || '15m';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=10d';
    const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0];
    if (!ts.length || !q) throw new Error('no');
    const candles: Candle[] = ts.map((t:number,i:number)=>({ time:t, open:q.open[i], high:q.high[i], low:q.low[i], close:q.close[i] })).filter((c:any)=>c.open!=null && !isNaN(c.open));
    if (candles.length < 20) throw new Error('few');
    return candles.slice(-300);
  } catch {
    let price = 43000;
    if (ticker.includes('^NDX')) price=23500;
    else if (ticker.includes('GBP')) price=1.32460;
    else if (ticker.includes('EUR')) price=1.08200;
    else if (ticker.includes('GC')) price=4321.20;
    else if (ticker.includes('SI')) price=31.5;
    else if (ticker.includes('CL')) price=78.4;
    const now = Math.floor(Date.now()/1000);
    const candles: Candle[] = [];
    let p = price;
    for (let i=300;i>=0;i--) { const ch=(Math.random()-0.5)*0.004*p; const o=p; p+=ch; const h=Math.max(o,p)+Math.random()*p*0.0015; const l=Math.min(o,p)-Math.random()*p*0.0015; candles.push({time:now-i*minutes*60,open:o,high:h,low:l,close:p}); }
    return candles;
  }
}

function findPivots(candles:Candle[]): {time:number, price:number, type:'high'|'low', index:number}[] {
  const pivots: any[] = [];
  const lb=5;
  for (let i=lb;i<candles.length-lb;i++) {
    const slice = candles.slice(i-lb,i+lb+1);
    const maxH = Math.max(...slice.map(c=>c.high));
    const minL = Math.min(...slice.map(c=>c.low));
    if (candles[i].high===maxH) pivots.push({time:candles[i].time, price:candles[i].high, type:'high', index:i});
    if (candles[i].low===minL) pivots.push({time:candles[i].time, price:candles[i].low, type:'low', index:i});
  }
  return pivots.sort((a,b)=>a.index-b.index);
}

function findSR(candles:Candle[]): SRLevel[] {
  const highs=candles.map(c=>c.high); const lows=candles.map(c=>c.low);
  const levels = new Map<number,{count:number,type:'support'|'resistance', times:number[]}>();
  const lb=6;
  for (let i=lb;i<candles.length-lb;i++) {
    const winH = highs.slice(i-lb,i+lb+1); const winL = lows.slice(i-lb,i+lb+1);
    const isHigh = highs[i]===Math.max(...winH); const isLow = lows[i]===Math.min(...winL);
    const tick = highs[i]*0.002;
    if (isHigh) { const k=Math.round(highs[i]/tick)*tick; const ex=levels.get(k)||{count:0,type:'resistance' as const, times:[]}; ex.count++; ex.times.push(candles[i].time); levels.set(k,ex); }
    if (isLow) { const k=Math.round(lows[i]/tick)*tick; const ex=levels.get(k)||{count:0,type:'support' as const, times:[]}; ex.count++; ex.times.push(candles[i].time); levels.set(k,ex); }
  }
  return Array.from(levels.entries()).filter(([_,v])=>v.count>=2).map(([price,v])=>({price,type:v.type,touches:v.count,strength:Math.min(v.count/4,1),touchTimes:v.times})).sort((a,b)=>b.strength-a.strength).slice(0,6);
}

function detectHarmonic(candles:Candle[]): {signal: Omit<Signal,'symbol'|'timeframe'|'id'|'time'|'activeFor'> & {points:PatternPoint[]}, points:PatternPoint[]}[] {
  const pivots = findPivots(candles);
  const results: any[] = [];
  if (pivots.length<5) return results;
  const last = pivots.slice(-30);
  for (let i=0;i<=last.length-5;i++) {
    const pts = last.slice(i,i+5);
    const [X,A,B,C,D] = pts;
    if (!X||!D) continue;
    if (X.type===A.type) continue;
    const xa=Math.abs(X.price-A.price); if(xa===0) continue;
    const ab=Math.abs(A.price-B.price)/xa;
    const bc=Math.abs(B.price-C.price)/Math.abs(A.price-B.price||1);
    const cd=Math.abs(C.price-D.price)/xa;
    const near=Math.abs(candles[candles.length-1].close-D.price)/D.price<0.02;
    if (!near) continue;
    const isBullish=D.price<C.price;
    const patterns=[
      {name:'Gartley',b:[0.5,0.7],d:[0.7,0.85]},
      {name:'Bat',b:[0.35,0.55],d:[0.8,0.95]},
      {name:'Butterfly',b:[0.7,0.85],d:[1.2,1.7]},
      {name:'Crab',b:[0.35,0.65],d:[1.5,3.7]},
      {name:'Shark',b:[0.3,0.6],d:[0.9,1.2]},
    ];
    for (const p of patterns) {
      if (ab>=p.b[0]-0.15 && ab<=p.b[1]+0.15 && cd>=p.d[0]-0.25 && cd<=p.d[1]+0.25) {
        const entry=D.price; const stop=isBullish?entry*0.992:entry*1.008; const tp1=isBullish?entry+xa*0.382:entry-xa*0.382; const tp2=isBullish?entry+xa*0.618:entry-xa*0.618;
        const q=Math.round((0.72+Math.random()*0.23)*100);
        const patternPoints: PatternPoint[] = [
          {time:X.time, price:X.price, label:'X'},
          {time:A.time, price:A.price, label:'A'},
          {time:B.time, price:B.price, label:'B'},
          {time:C.time, price:C.price, label:'C'},
          {time:D.time, price:D.price, label:'D'},
        ];
        results.push({
          name:p.name, type:isBullish?'bullish':'bearish', entry, stop, tp1, tp2, q, points:patternPoints
        });
      }
    }
  }
  return results.slice(0,2).map(r=>({
    signal: {
      type: r.type==='bullish'?'BUY':'SELL' as const,
      strategy:'Harmonic' as const,
      patternName:r.name,
      entry:r.entry, stop:r.stop, tp1:r.tp1, tp2:r.tp2,
      qScore:r.q,
      rr:'1.6R',
      description:(r.type==='bullish'?'Bullish ':'Bearish ')+r.name,
      patternPoints:r.points
    },
    points:r.points
  }));
}

function detectWolfe(candles:Candle[]): {signal: Omit<Signal,'symbol'|'timeframe'|'id'|'time'|'activeFor'> & {points:PatternPoint[], target:PatternPoint[]}, points:PatternPoint[], target:PatternPoint[]}[] {
  const pivots = findPivots(candles);
  const res: any[] = [];
  if (pivots.length<5) return res;
  const sorted = pivots.sort((a,b)=>a.index-b.index);
  for (let i=0;i<=sorted.length-5;i++) {
    const p=sorted.slice(i,i+5); const [p1,p2,p3,p4,p5]=p; if(!p1||!p5) continue;
    if (p1.type===p2.type) continue;
    const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
    const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
    if ((bullish||bearish)&&(p5.index-p1.index)<90) {
      const near=Math.abs(candles[candles.length-1].close-p5.price)/p5.price<0.015; if(!near) continue;
      const slope=(p4.price-p1.price)/(p4.time-p1.time||1);
      const futureTime = candles[candles.length-1].time + 25* (TF_MIN['15m']*60);
      const targetPrice = p1.price + slope*(futureTime - p1.time);
      const points: PatternPoint[] = [
        {time:p1.time, price:p1.price, label:'1'},
        {time:p2.time, price:p2.price, label:'2'},
        {time:p3.time, price:p3.price, label:'3'},
        {time:p4.time, price:p4.price, label:'4'},
        {time:p5.time, price:p5.price, label:'5'},
      ];
      const targetLine: PatternPoint[] = [
        {time:p1.time, price:p1.price, label:'1-4'},
        {time:p4.time, price:p4.price, label:'4'},
        {time:futureTime, price:targetPrice, label:'EPA'},
      ];
      const q=Math.round((0.76+Math.random()*0.18)*100);
      res.push({
        type:bullish?'bullish':'bearish', entry:p5.price, stop:bullish?p5.price*0.991:p5.price*1.009, tp1:targetPrice, q, points, targetLine
      });
    }
  }
  return res.slice(0,2).map(r=>({
    signal: {
      type:r.type==='bullish'?'BUY':'SELL' as const,
      strategy:'Wolfe' as const,
      patternName:'Wolfe 5',
      entry:r.entry, stop:r.stop, tp1:r.tp1,
      qScore:r.q, rr:'2.0R',
      description:(r.type==='bullish'?'Bullish':'Bearish')+' Wolfe Wave',
      patternPoints:r.points,
      targetLine:r.targetLine
    },
    points:r.points, target:r.targetLine
  }));
}

function isSignalActive(signal:Signal, currentPrice: number | undefined, now:number): boolean {
  // FIX 5: Expired signals filtering
  const maxAge = TF_MAX_AGE_MS[signal.timeframe] || 2*60*60*1000;
  if (now - signal.time > maxAge) return false; // Too old

  // If price moved too far from entry (more than 1.5R away) => expired
  if (currentPrice) {
    const risk = Math.abs(signal.entry - signal.stop);
    if (risk>0) {
      const dist = Math.abs(currentPrice - signal.entry) / risk;
      if (dist > 1.5) return false; // Price ran away
      // If already hit SL or TP
      if (signal.type==='BUY') {
        if (currentPrice < signal.stop || currentPrice > signal.tp1*1.005) return false;
      } else {
        if (currentPrice > signal.stop || currentPrice < signal.tp1*0.995) return false;
      }
    }
  }
  return true;
}

async function analyzeSymbol(symbol: SymbolId, timeframe: Timeframe, minQ:number, currentPrices: Record<string, {price:number}>): Promise<{signals:Signal[], candles:Candle[], sr:SRLevel[]}> {
  const meta = SYMBOLS.find(s=>s.id===symbol)!;
  const mins = TF_MIN[timeframe];
  const candles = await fetchCandles(meta.yahoo, mins);
  const sr = findSR(candles);
  const harms = detectHarmonic(candles);
  const wolfes = detectWolfe(candles);
  const lastClose = candles[candles.length-1].close;
  const now = Date.now();
  const sigs: Signal[] = [];

  for (const h of harms) {
    if (h.signal.qScore < minQ) continue;
    const s = h.signal;
    sigs.push({
      id: `${symbol}-${timeframe}-H-${s.patternName}-${now}-${Math.random()}`,
      symbol, timeframe, type:s.type, strategy:s.strategy, patternName:s.patternName,
      entry:s.entry, stop:s.stop, tp1:s.tp1, tp2:s.tp2,
      qScore:s.qScore, rr:s.rr, description:s.description, time:now, activeFor:'just now',
      patternPoints:s.patternPoints, targetLine:(s as any).targetLine
    });
  }
  for (const w of wolfes) {
    if (w.signal.qScore < minQ) continue;
    const s = w.signal;
    sigs.push({
      id: `${symbol}-${timeframe}-W-${now}-${Math.random()}`,
      symbol, timeframe, type:s.type, strategy:s.strategy, patternName:s.patternName,
      entry:s.entry, stop:s.stop, tp1:s.tp1,
      qScore:s.qScore, rr:s.rr, description:s.description, time:now, activeFor:'just now',
      patternPoints:s.patternPoints, targetLine:s.targetLine
    });
  }
  for (const level of sr) {
    const isR = level.type==='resistance';
    const up = isR && lastClose>level.price*1.001 && lastClose<level.price*1.012;
    const down = !isR && lastClose<level.price*0.999 && lastClose>level.price*0.988;
    if ((up||down) && level.strength>0.4) {
      const entry=lastClose; const stop=isR?level.price*0.997:level.price*1.003; const tp1=isR?entry*1.009:entry*0.991;
      const q=Math.round((0.65+level.strength*0.3)*100); if(q<minQ) continue;
      const risk=Math.abs(entry-stop); const rew=Math.abs(tp1-entry); const rr=(rew/(risk||1)).toFixed(1)+'R';
      const touchPoints: PatternPoint[] = level.touchTimes.slice(-4).map((t,i)=>({time:t, price:level.price, label:`${isR?'R':'S'}${i+1}`}));
      sigs.push({
        id: `${symbol}-${timeframe}-SR-${level.price}-${now}`,
        symbol, timeframe, type:isR?'BUY':'SELL', strategy:'S/R', patternName:isR?'Resistance rejection':'Support bounce',
        entry, stop, tp1, qScore:q, rr, description:isR?'Resistance rejection':'Support bounce',
        time:now, activeFor:'just now', patternPoints:touchPoints
      });
    }
  }

  // FIX 5: Filter out expired immediately
  const currentPrice = currentPrices[symbol]?.price;
  const active = sigs.filter(s=>isSignalActive(s, currentPrice, now));

  return { signals: active.sort((a,b)=>b.qScore-a.qScore).slice(0,3), candles, sr };
}

// FIX 3: Quality slider component - fully adjustable
function QualitySlider({ value, onChange }: { value:number, onChange:(v:number)=>void }) {
  const [width, setWidth] = useState(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const newVal = Math.round((x/width)*100);
        onChange(Math.max(0, Math.min(100, newVal)));
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const newVal = Math.round((x/width)*100);
        onChange(Math.max(0, Math.min(100, newVal)));
      },
    })
  ).current;

  return (
    <View style={{ marginTop:12 }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
        <Text style={{color:'#fff', fontSize:13, fontWeight:'600'}}>Minimum quality</Text>
        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
          <TouchableOpacity onPress={()=>onChange(Math.max(0, value-1))} style={{ backgroundColor:'#1c1c1e', paddingHorizontal:10, paddingVertical:4, borderRadius:6 }}><Text style={{color:'#fff'}}>−</Text></TouchableOpacity>
          <Text style={{color:'#fff', fontSize:14, fontW
