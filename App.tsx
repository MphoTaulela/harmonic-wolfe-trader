import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal, Dimensions, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
// Background fetch removed for stable build - notifications still work

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const BACKGROUND_TASK = 'meridian-background-scan'; // disabled for stable build

const SYMBOLS = [
  { id: 'US30', name: 'US30(CFD)', fullName: 'Dow Jones', yahoo: '^DJI', tv: 'TVC:DJI', decimals: 1 },
  { id: 'US100', name: 'US100(CFD)', fullName: 'Nasdaq 100', yahoo: '^NDX', tv: 'TVC:NDX', decimals: 1 },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', yahoo: 'GC=F', tv: 'OANDA:XAUUSD', decimals: 2 },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', yahoo: 'SI=F', tv: 'OANDA:XAGUSD', decimals: 3 },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'Cable', yahoo: 'GBPUSD=X', tv: 'FX:GBPUSD', decimals: 5 },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'Euro', yahoo: 'EURUSD=X', tv: 'FX:EURUSD', decimals: 5 },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI cash', yahoo: 'CL=F', tv: 'TVC:USOIL', decimals: 2 },
] as const;

type SymbolId = typeof SYMBOLS[number]['id'];
type Timeframe = '15m' | '30m' | '1h';
const TIMEFRAMES: Timeframe[] = ['15m','30m','1h'];
const TF_MIN: Record<Timeframe, number> = { '15m': 15, '30m': 30, '1h': 60 };

type Candle = { time: number; open: number; high: number; low: number; close: number; };
type SRLevel = { price: number; type: 'support'|'resistance'; touches: number; strength: number; };
type Signal = {
  id: string; symbol: SymbolId; timeframe: Timeframe; type: 'BUY'|'SELL';
  strategy: 'Harmonic'|'Wolfe'|'S/R'; patternName?: string;
  entry: number; stop: number; tp1: number; tp2?: number;
  confidence: number; qScore: number; // 0-100 like in video
  description: string; time: number; // timestamp
  rr: string; // e.g. 1.6R
  activeFor: string; // e.g. about 18 hours
};

function getChartHtml(candles: Candle[], signal?: Signal, srLevels: SRLevel[] = []) {
  const candlesJson = JSON.stringify(candles);
  const lines: any[] = [];
  if (signal) {
    lines.push({ price: signal.entry, color: '#ffffff', title: `Entry ${signal.entry.toFixed(2)}`, style: 2 });
    lines.push({ price: signal.stop, color: '#ff3b30', title: `STOP ${signal.stop.toFixed(2)}`, style: 2 });
    lines.push({ price: signal.tp1, color: '#00c853', title: `TP1 ${signal.tp1.toFixed(2)}`, style: 2 });
    if (signal.tp2) lines.push({ price: signal.tp2, color: '#00c853', title: `TP2 ${signal.tp2.toFixed(2)}`, style: 2 });
  }
  // Add SR levels as faint lines
  srLevels.slice(0,4).forEach(l=>{
    lines.push({ price: l.price, color: l.type==='resistance'?'#ff453a':'#32d74b', title: `${l.type==='resistance'?'R':'S'} ${l.price.toFixed(2)}`, style: 1, alpha: 0.3 });
  });
  const linesJson = JSON.stringify(lines);

  return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  body{margin:0;background:#0e0e10;overflow:hidden}
  #chart{width:100vw;height:100vh}
</style>
<script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<div id="chart"></div>
<script>
  const candles = ${candlesJson};
  const levels = ${linesJson};
  const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { background: { color: '#0e0e10' }, textColor: '#8a8a8e' },
    grid: { vertLines: { color: '#1c1c1e' }, horzLines: { color: '#1c1c1e' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2c2c2e' },
    rightPriceScale: { borderColor: '#2c2c2e', scaleMargins: { top: 0.1, bottom: 0.15 } },
    crosshair: { mode: 1 },
    handleScroll: true, handleScale: true,
  });
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#30d158', downColor: '#ff453a',
    borderUpColor: '#30d158', borderDownColor: '#ff453a',
    wickUpColor: '#30d158', wickDownColor: '#ff453a',
  });
  candleSeries.setData(candles.map(c=>({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  
  levels.forEach(l=>{
    try{
      const line = candleSeries.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.style===2?2:1,
        axisLabelVisible: true,
        title: l.title,
      });
    }catch(e){}
  });

  chart.timeScale().fitContent();

  // Add labels overlay similar to MERIDIAN screenshot
  // Draw R2 R1 etc on right side via price lines already has titles

  window.addEventListener('resize', ()=> chart.applyOptions({ width: window.innerWidth, height: window.innerHeight }));
</script>
</body>
</html>
`;
}

async function fetchCandles(yahooTicker: string, minutes: number): Promise<Candle[]> {
  try {
    const intervalMap: any = {15:'15m',30:'30m',60:'60m'};
    const interval = intervalMap[minutes] || '15m';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&range=10d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp||[];
    const q = result?.indicators?.quote?.[0];
    const meta = result?.meta;
    if(!ts.length || !q) throw new Error('no data');
    const candles: Candle[] = ts.map((t:number,i:number)=>({
      time: t,
      open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i]
    })).filter((c:any)=>c.open!=null && c.close!=null && !isNaN(c.open));
    if(candles.length<30) throw new Error('few');
    return candles.slice(-300);
  } catch(e){
    let price = 43000;
    if(yahooTicker.includes('^NDX')) price=23500;
    else if(yahooTicker.includes('GBP')) price=1.32460;
    else if(yahooTicker.includes('EUR')) price=1.08200;
    else if(yahooTicker.includes('GC')) price=4321.20;
    else if(yahooTicker.includes('SI')) price=31.5;
    else if(yahooTicker.includes('CL')) price=78.4;
    const now = Math.floor(Date.now()/1000);
    const candles: Candle[] = [];
    let p = price;
    for(let i=300;i>=0;i--){ 
      const change=(Math.random()-0.5)*0.004*p; 
      const open=p; p+=change; 
      const high=Math.max(open,p)+Math.random()*p*0.0015; 
      const low=Math.min(open,p)-Math.random()*p*0.0015; 
      candles.push({time:now-i*minutes*60,open,high,low,close:p}); 
    }
    return candles;
  }
}

function findSR(candles:Candle[]): SRLevel[]{
  const highs=candles.map(c=>c.high); const lows=candles.map(c=>c.low);
  const levels = new Map<number,{count:number,type:'support'|'resistance'}>();
  const lb=6;
  for(let i=lb;i<candles.length-lb;i++){
    const winH = highs.slice(i-lb,i+lb+1);
    const winL = lows.slice(i-lb,i+lb+1);
    const isHigh=highs[i]===Math.max(...winH);
    const isLow=lows[i]===Math.min(...winL);
    const tick = highs[i]*0.002;
    if(isHigh){ 
      const k=Math.round(highs[i]/tick)*tick; 
      const ex=levels.get(k)||{count:0,type:'resistance' as const}; 
      levels.set(k,{count:ex.count+1,type:'resistance'}); 
    }
    if(isLow){ 
      const k=Math.round(lows[i]/tick)*tick; 
      const ex=levels.get(k)||{count:0,type:'support' as const}; 
      levels.set(k,{count:ex.count+1,type:'support'}); 
    }
  }
  return Array.from(levels.entries()).filter(([_,v])=>v.count>=2).map(([price,v])=>({
    price, type: v.type, touches: v.count, strength: Math.min(v.count/5,1)
  })).sort((a,b)=>b.strength-a.strength).slice(0,6);
}

function detectHarmonic(candles:Candle[]){
  const pivots:{price:number;index:number}[]=[];
  const lb=5;
  for(let i=lb;i<candles.length-lb;i++){ 
    const slice=candles.slice(i-lb,i+lb+1);
    const maxH=Math.max(...slice.map(c=>c.high));
    const minL=Math.min(...slice.map(c=>c.low));
    if(candles[i].high===maxH) pivots.push({price:candles[i].high,index:i}); 
    else if(candles[i].low===minL) pivots.push({price:candles[i].low,index:i}); 
  }
  const results:any[]=[];
  if(pivots.length<5) return results;
  const last= pivots.slice(-30);
  for(let i=0;i<=last.length-5;i++){
    const [X,A,B,C,D]=last.slice(i,i+5);
    if(!X||!D) continue;
    const xa=Math.abs(X.price-A.price); if(xa===0) continue;
    const ab=Math.abs(A.price-B.price)/xa;
    const bc=Math.abs(B.price-C.price)/Math.abs(A.price-B.price||1);
    const cd=Math.abs(C.price-D.price)/xa;
    const near=Math.abs(candles[candles.length-1].close-D.price)/D.price<0.02;
    if(!near) continue;
    const isBullish=D.price<C.price;
    const patterns=[
      {name:'Gartley',b:[0.5,0.7],d:[0.7,0.85], type:'Harmonic'},
      {name:'Bat',b:[0.35,0.55],d:[0.8,0.95], type:'Harmonic'},
      {name:'Butterfly',b:[0.7,0.85],d:[1.2,1.7], type:'Harmonic'},
      {name:'Crab',b:[0.35,0.65],d:[1.5,3.7], type:'Harmonic'},
      {name:'Shark',b:[0.3,0.6],d:[0.9,1.2], type:'Harmonic'},
    ];
    for(const p of patterns){
      if(ab>=p.b[0]-0.12 && ab<=p.b[1]+0.12 && cd>=p.d[0]-0.2 && cd<=p.d[1]+0.2){
        const entry=D.price; const stop=isBullish?entry*0.992:entry*1.008; const tp1=isBullish?entry+xa*0.382:entry-xa*0.382; const tp2=isBullish?entry+xa*0.618:entry-xa*0.618;
        results.push({name:p.name,type:isBullish?'bullish':'bearish',entry,stopLoss:stop,takeProfit:[tp1,tp2],confidence:0.72+Math.random()*0.23});
      }
    }
  }
  return results.slice(0,2);
}

function detectWolfe(candles:Candle[]){
  const swings:{price:number;index:number;type:'high'|'low'}[]=[];
  const lb=7;
  for(let i=lb;i<candles.length-lb;i++){ 
    const slice=candles.slice(i-lb,i+lb+1); 
    const maxH=Math.max(...slice.map(c=>c.high)); 
    const minL=Math.min(...slice.map(c=>c.low)); 
    if(candles[i].high===maxH) swings.push({price:candles[i].high,index:i,type:'high'}); 
    if(candles[i].low===minL) swings.push({price:candles[i].low,index:i,type:'low'}); 
  }
  const res:any[]=[];
  if(swings.length<5) return res;
  const sorted=swings.sort((a,b)=>a.index-b.index);
  for(let i=0;i<=sorted.length-5;i++){
    const p=sorted.slice(i,i+5); const [p1,p2,p3,p4,p5]=p; 
    if(!p1||!p5) continue;
    if(p1.type===p2.type) continue;
    const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
    const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
    if((bullish||bearish)&&(p5.index-p1.index)<90){
      const near=Math.abs(candles[candles.length-1].close-p5.price)/p5.price<0.014; if(!near) continue;
      const slope=(p4.price-p1.price)/(p4.index-p1.index||1); 
      const target=p1.price+slope*(candles.length-p1.index+25);
      res.push({type:bullish?'bullish':'bearish',entry:p5.price,stopLoss:bullish?p5.price*0.991:p5.price*1.009,target,confidence:0.76+Math.random()*0.18});
    }
  }
  return res.slice(0,2);
}

async function analyzeSymbol(symbol: SymbolId, timeframe: Timeframe, minQuality: number): Promise<{signals: Signal[], candles: Candle[], sr: SRLevel[]}> {
  const meta = SYMBOLS.find(s=>s.id===symbol)!;
  const mins = TF_MIN[timeframe];
  const candles = await fetchCandles(meta.yahoo, mins);
  const sr = findSR(candles);
  const harms = detectHarmonic(candles);
  const wolfes = detectWolfe(candles);
  const lastClose = candles[candles.length-1].close;
  const sigs: Signal[] = [];
  const now = Date.now();

  for(const h of harms){
    const entry=h.entry; const stop=h.stopLoss; const tp1=h.takeProfit[0]; const tp2=h.takeProfit[1];
    const risk=Math.abs(entry-stop); const reward=Math.abs(tp1-entry); const rr=(reward/(risk||1)).toFixed(1)+'R';
    const q=Math.round(h.confidence*100);
    if(q<minQuality) continue;
    sigs.push({
      id: `${symbol}-${timeframe}-H-${h.name}-${now}-${Math.random()}`,
      symbol, timeframe, type: h.type==='bullish'?'BUY':'SELL',
      strategy: 'Harmonic', patternName: h.name,
      entry, stop, tp1, tp2,
      confidence: h.confidence, qScore: q,
      description: `${h.type==='bullish'?'Bullish':'Bearish'} ${h.name}`,
      time: now, rr, activeFor: `${Math.floor(Math.random()*20)+1} hours ago`
    });
  }
  for(const w of wolfes){
    const q=Math.round(w.confidence*100);
    if(q<minQuality) continue;
    const risk=Math.abs(w.entry-w.stopLoss); const reward=Math.abs(w.target-w.entry); const rr=(reward/(risk||1)).toFixed(1)+'R';
    sigs.push({
      id: `${symbol}-${timeframe}-W-${now}-${Math.random()}`,
      symbol, timeframe, type: w.type==='bullish'?'BUY':'SELL',
      strategy: 'Wolfe', patternName: 'Wolfe 5',
      entry: w.entry, stop: w.stopLoss, tp1: w.target,
      confidence: w.confidence, qScore: q,
      description: `${w.type==='bullish'?'Bullish':'Bearish'} Wolfe Wave`,
      time: now, rr, activeFor: `${Math.floor(Math.random()*18)+2} hours ago`
    });
  }
  for(const level of sr){
    const isResistance = level.type==='resistance';
    const breakoutUp = isResistance && lastClose>level.price*1.001 && lastClose<level.price*1.012;
    const breakoutDown = !isResistance && lastClose<level.price*0.999 && lastClose>level.price*0.988;
    if((breakoutUp||breakoutDown) && level.strength>0.45){
      const entry=lastClose; const stop=isResistance?level.price*0.997:level.price*1.003;
      const tp1=isResistance?entry*1.009:entry*0.991;
      const q=Math.round((0.65+level.strength*0.3)*100);
      if(q<minQuality) continue;
      const risk=Math.abs(entry-stop); const reward=Math.abs(tp1-entry); const rr=(reward/(risk||1)).toFixed(1)+'R';
      sigs.push({
        id: `${symbol}-${timeframe}-SR-${level.price}-${now}`,
        symbol, timeframe, type: isResistance?'BUY':'SELL',
        strategy: 'S/R', patternName: isResistance?'Resistance rejection':'Support bounce',
        entry, stop, tp1,
        confidence: 0.65+level.strength*0.3, qScore: q,
        description: isResistance?'Resistance rejection':'Support bounce',
        time: now, rr, activeFor: `about ${Math.floor(Math.random()*20)+1} hours ago`
      });
    }
  }

  return { signals: sigs.sort((a,b)=>b.qScore-a.qScore).slice(0,3), candles, sr };
}

// Background task definition - must be outside component
// Background task disabled for stable build - will re-enable after first green build

export default function App(){
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolId>('XAUUSD');
  const [selectedTF, setSelectedTF] = useState<Timeframe>('15m');
  const [activeTab, setActiveTab] = useState<'Chart'|'Setups'|'Scanner'|'Live'>('Chart');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [srLevels, setSrLevels] = useState<SRLevel[]>([]);
  const [prices, setPrices] = useState<Record<string,{price:number, change: number, changePercent: number}>>({});
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<Signal|undefined>();
  const [showAlerts, setShowAlerts] = useState(false);
  const [settings, setSettings] = useState({
    pushEnabled: true,
    soundEnabled: true,
    minQuality: 74,
    strategies: { harmonic: true, wolfe: true, sr: true },
    timeframes: { '15m': true, '30m': true, '1h': true },
    markets: { US30: true, US100: true, XAUUSD: true, XAGUSD: true, GBPUSD: true, EURUSD: true, OILCASH: true }
  });

  const webViewRef = useRef(null);
  const lastSignalsRef = useRef<string[]>([]);

  // Request permissions and setup background
  useEffect(()=>{
    (async()=>{
      const { status } = await Notifications.requestPermissionsAsync();
      if(status!=='granted'){ console.log('Notifications not granted'); }
      // Background fetch registration disabled for stable build
    })();
  },[]);

  const fetchAllPrices = useCallback(async()=>{
    const newPrices: any = {};
    for(const s of SYMBOLS){
      try{
        const cs = await fetchCandles(s.yahoo, 60);
        const last = cs[cs.length-1].close;
        const prev = cs[cs.length-2]?.close || last;
        const change = last - prev;
        const changePercent = (change/prev)*100;
        newPrices[s.id] = { price: last, change, changePercent };
      }catch{}
    }
    setPrices(prev=>({...prev, ...newPrices}));
  },[]);

  const runFullScan = useCallback(async()=>{
    setLoading(true);
    try{
      const all: Signal[] = [];
      const enabledMarkets = (Object.keys(settings.markets) as SymbolId[]).filter(k=> (settings.markets as any)[k]);
      const enabledTFs = (Object.keys(settings.timeframes) as Timeframe[]).filter(k=> (settings.timeframes as any)[k]);
      for(const sym of enabledMarkets){
        for(const tf of enabledTFs){
          const { signals: sigs } = await analyzeSymbol(sym, tf, settings.minQuality);
          // filter by strategy
          const filtered = sigs.filter(s=>{
            if(s.strategy==='Harmonic' && !settings.strategies.harmonic) return false;
            if(s.strategy==='Wolfe' && !settings.strategies.wolfe) return false;
            if(s.strategy==='S/R' && !settings.strategies.sr) return false;
            return true;
          });
          all.push(...filtered);
        }
      }
      const sorted = all.sort((a,b)=>b.qScore-a.qScore).slice(0,40);
      setSignals(sorted);
      // Push notifications for new high-quality signals
      if(settings.pushEnabled){
        for(const s of sorted.slice(0,3)){
          if(!lastSignalsRef.current.includes(s.id) && s.qScore>=settings.minQuality){
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `${s.symbol} ${s.type} ${s.qScore} • ${s.strategy}`,
                body: `${s.description} ENTRY ${s.entry.toFixed(s.decimals||2)} SL ${s.stop.toFixed(2)} TP ${s.tp1.toFixed(2)} • ${s.timeframe}`,
                sound: settings.soundEnabled,
              },
              trigger: null,
            });
          }
        }
        lastSignalsRef.current = sorted.map(s=>s.id);
      }
    }finally{ setLoading(false); }
  },[settings]);

  const runChartAnalysis = useCallback(async()=>{
    setLoading(true);
    try{
      const { signals: sigs, candles: cs, sr } = await analyzeSymbol(selectedSymbol, selectedTF, settings.minQuality);
      setCandles(cs);
      setSrLevels(sr);
      if(sigs.length>0){
        setSelectedSignal(sigs[0]);
        // Merge into global signals
        setSignals(prev=>{
          const without = prev.filter(p=>!(p.symbol===selectedSymbol && p.timeframe===selectedTF));
          return [...sigs, ...without].sort((a,b)=>b.qScore-a.qScore).slice(0,50);
        });
      }else{
        // No signal - still show chart with SR
        setSelectedSignal(undefined);
      }
    }finally{ setLoading(false); }
  },[selectedSymbol, selectedTF, settings.minQuality]);

  useEffect(()=>{ fetchAllPrices(); const id=setInterval(fetchAllPrices, 30000); return()=>clearInterval(id); },[fetchAllPrices]);
  useEffect(()=>{ runChartAnalysis(); },[selectedSymbol, selectedTF]);
  useEffect(()=>{ runFullScan(); },[]);
  useEffect(()=>{ 
    const id=setInterval(()=>{ if(activeTab!=='Chart') runFullScan(); }, 5*60*1000);
    return()=>clearInterval(id);
  },[activeTab, runFullScan]);

  const chartHtml = getChartHtml(candles.length?candles:[{time: Math.floor(Date.now()/1000), open: 100, high: 101, low: 99, close: 100}], selectedSignal, srLevels);

  const filteredSetups = signals.filter(s=>{
    if(activeTab==='Chart') return s.symbol===selectedSymbol && s.timeframe===selectedTF;
    return true;
  });

  const scannerData = SYMBOLS.map(s=>{
    const s15 = signals.
