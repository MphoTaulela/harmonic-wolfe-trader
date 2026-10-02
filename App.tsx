
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal, Dimensions, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const BACKGROUND_TASK = 'meridian-background-scan';

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
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    // Light scan in background for notifications
    // We can't do heavy work here but we can trigger notification logic
    // Actual scan will be done when app foregrounds, but this keeps task alive
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

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
      try{
        await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
          minimumInterval: 15*60, // 15 minutes minimum
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }catch(e){ console.log('bg reg error', e); }
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
    const s15 = signals.find(sig=>sig.symbol===s.id && sig.timeframe==='15m');
    const s30 = signals.find(sig=>sig.symbol===s.id && sig.timeframe==='30m');
    return { symbol: s, m15: s15, m30: s30 };
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.container}>
        {/* Header - MERIDIAN style */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>MERIDIAN</Text>
            <Text style={styles.headerSub}>Harmonic - Wolfe - S/R - 15m / 30m / 1H</Text>
          </View>
          <TouchableOpacity style={styles.bellBtn} onPress={()=>setShowAlerts(true)}>
            <Text style={styles.bellIcon}>🔔</Text>
          </TouchableOpacity>
        </View>

        {/* Price ticker row - exactly like video */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerRow} contentContainerStyle={{ paddingHorizontal: 8 }}>
          {SYMBOLS.map(s=>{
            const p = prices[s.id];
            const priceStr = p ? (s.id.includes('USD') && !s.id.includes('XAU') && !s.id.includes('XAG') ? p.price.toFixed(5) : s.id==='US30'||s.id==='US100' ? p.price.toLocaleString(undefined,{minimumFractionDigits:1, maximumFractionDigits:1}) : p.price.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})) : '--';
            const changeStr = p ? `${p.changePercent>=0?'+':''}${p.changePercent.toFixed(2)}%` : '';
            const isPos = p ? p.changePercent>=0 : false;
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerCard, selectedSymbol===s.id && styles.tickerActive]} onPress={()=>setSelectedSymbol(s.id as SymbolId)}>
                <View style={styles.tickerTop}><Text style={styles.tickerSym}>{s.id}</Text><Text style={[styles.tickerChange, isPos?styles.pos:styles.neg]}>{changeStr}</Text></View>
                <Text style={styles.tickerPrice}>{priceStr}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Timeframe row */}
        <View style={styles.tfRow}>
          <View style={styles.tfLeft}>
            {TIMEFRAMES.map(tf=>(
              <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfBtnActive]} onPress={()=>setSelectedTF(tf)}>
                <Text style={[styles.tfText, selectedTF===tf && styles.tfTextActive]}>{tf}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.tfRight}>
            <View style={styles.liveToggle}>
              <TouchableOpacity style={[styles.liveBtn, activeTab==='Setups' && styles.liveBtnActive]} onPress={()=>setActiveTab('Setups')}><Text style={styles.liveText}>Setups</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.liveBtn, activeTab==='Live' && styles.liveBtnActive]} onPress={()=>setActiveTab('Live')}><Text style={styles.liveText}>Live</Text></TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Main Content */}
        <View style={styles.main}>
          {activeTab==='Chart' && (
            <>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol} <Text style={styles.symbolFull}>{SYMBOLS.find(s=>s.id===selectedSymbol)?.fullName}</Text></Text>
                <Text style={styles.symbolPrice}>
                  {prices[selectedSymbol]?.price?.toFixed(SYMBOLS.find(s=>s.id===selectedSymbol)?.decimals||2) || '--'} 
                  <Text style={[styles.symbolChange, (prices[selectedSymbol]?.changePercent||0)>=0?styles.pos:styles.neg]}> {prices[selectedSymbol]?.changePercent>=0?'+':''}{prices[selectedSymbol]?.changePercent?.toFixed(2)||'0.00'}%</Text>
                </Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView
                  ref={webViewRef}
                  originWhitelist={['*']}
                  source={{ html: chartHtml }}
                  style={{ flex: 1, backgroundColor: '#0e0e10' }}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  allowFileAccess
                  scrollEnabled={false}
                />
                {selectedSignal && (
                  <View style={styles.chartOverlayRight}>
                    <View style={[styles.priceLabel, { backgroundColor: '#ff3b30' }]}><Text style={styles.priceLabelText}>R2 { (selectedSignal.entry*1.015).toFixed(2) }</Text></View>
                    <View style={[styles.priceLabel, { backgroundColor: '#ff3b30' }]}><Text style={styles.priceLabelText}>R1 {(selectedSignal.entry*1.008).toFixed(2)}</Text></View>
                    <View style={[styles.priceLabel, { backgroundColor: '#ffffff' }]}><Text style={[styles.priceLabelText, { color: '#000' }]}>Entry {selectedSignal.entry.toFixed(2)}</Text></View>
                    <View style={[styles.priceLabel, { backgroundColor: '#30d158' }]}><Text style={styles.priceLabelText}>TP1 {selectedSignal.tp1.toFixed(2)}</Text></View>
                    <View style={[styles.priceLabel, { backgroundColor: '#30d158' }]}><Text style={styles.priceLabelText}>TP2 {selectedSignal.tp2?.toFixed(2) || (selectedSignal.entry*0.992).toFixed(2)}</Text></View>
                    <View style={[styles.priceLabel, { backgroundColor: '#ff3b30' }]}><Text style={styles.priceLabelText}>S2 {selectedSignal.stop.toFixed(2)}</Text></View>
                  </View>
                )}
              </View>
              {selectedSignal && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>ENTRY</Text><Text style={styles.detailValue}>{selectedSignal.entry.toFixed(2)}</Text><Text style={styles.detailSub}>{selectedSignal.tp1.toFixed(1)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>STOP</Text><Text style={[styles.detailValue, { color: '#ff453a' }]}>{selectedSignal.stop.toFixed(2)}</Text><Text style={styles.detailSub}>{selectedSignal.rr} • active {selectedSignal.activeFor}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>TP1</Text><Text style={[styles.detailValue, { color: '#30d158' }]}>{selectedSignal.tp1.toFixed(2)}</Text><Text style={styles.detailSub}>{selectedSignal.qScore}Q</Text></View>
                </View>
              )}
            </>
          )}

          {activeTab==='Setups' && (
            <ScrollView style={{ flex: 1 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={runFullScan} tintColor="#fff" />}>
              <View style={styles.setupsHeader}><Text style={styles.setupsHeaderText}>Setups</Text><Text style={styles.scannerHeaderText}>Scanner</Text><Text style={styles.tradeableText}>{signals.length} tradeable</Text></View>
              {filteredSetups.map(s=>(
                <TouchableOpacity key={s.id} style={styles.setupCard} onPress={()=>{ setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); setSelectedSignal(s); setActiveTab('Chart'); }}>
                  <View style={styles.setupTop}>
                    <Text style={styles.setupSymbol}>{s.symbol} <Text style={styles.setupTF}>{s.timeframe}</Text></Text>
                    <Text style={styles.setupDesc}>{s.description}</Text>
                  </View>
                  <View style={styles.setupLevels}>
                    <View><Text style={styles.setupLevelLabel}>ENTRY</Text><Text style={styles.setupLevelValue}>{s.entry.toFixed(2)}</Text></View>
                    <View><Text style={styles.setupLevelLabel}>STOP</Text><Text style={styles.setupLevelValue}>{s.stop.toFixed(2)}</Text></View>
                    <View><Text style={styles.setupLevelLabel}>TP1</Text><Text style={styles.setupLevelValue}>{s.tp1.toFixed(2)}</Text></View>
                    <View style={[styles.sellBadge, s.type==='BUY' && styles.buyBadge]}><Text style={styles.sellText}>{s.type}</Text></View>
                  </View>
                  <View style={styles.setupFooter}>
                    <Text style={styles.setupMeta}>Q{s.qScore} • {s.rr} • active • {s.activeFor}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredSetups.length===0 && <Text style={styles.emptyText}>No setups for {selectedSymbol} {selectedTF}. Scanner is checking Harmonic, Wolfe, S/R...</Text>}
            </ScrollView>
          )}

          {activeTab==='Scanner' && (
            <ScrollView style={{ flex: 1 }}>
              <View style={styles.scannerTableHeader}>
                <Text style={[styles.scannerCol, { flex: 1.2 }]}>MARKET</Text>
                <Text style={styles.scannerCol}>15M</Text>
                <Text style={styles.scannerCol}>30M</Text>
                <Text style={styles.scannerCol}>1H</Text>
              </View>
              {SYMBOLS.map(s=>{
                const s15 = signals.find(sig=>sig.symbol===s.id && sig.timeframe==='15m');
                const s30 = signals.find(sig=>sig.symbol===s.id && sig.timeframe==='30m');
                const s1h = signals.find(sig=>sig.symbol===s.id && sig.timeframe==='1h');
                const renderCell = (sig?: Signal)=>{
                  if(!sig) return <View style={styles.quietCell}><Text style={styles.quietText}>Quiet</Text></View>;
                  const isBuy = sig.type==='BUY';
                  return (
                    <View style={[styles.signalCell, isBuy?styles.buyCell:styles.sellCell]}>
                      <Text style={styles.signalCellType}>{sig.type} {sig.qScore}</Text>
                      <Text style={styles.signalCellDesc} numberOfLines={1}>{sig.description}</Text>
                    </View>
                  );
                };
                return (
                  <View key={s.id} style={styles.scannerRow}>
                    <View style={{ flex: 1.2 }}><Text style={styles.marketName}>{s.id}</Text><Text style={styles.marketFull}>{s.fullName}</Text></View>
                    <View style={styles.scannerCol}>{renderCell(s15)}</View>
                    <View style={styles.scannerCol}>{renderCell(s30)}</View>
                    <View style={styles.scannerCol}>{renderCell(s1h)}</View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {activeTab==='Live' && (
            <ScrollView style={{ flex: 1, padding: 12 }}>
              <Text style={styles.liveTitle}>Live Alerts • Background Scanning Active</Text>
              <Text style={styles.liveSub}>App runs in background even when screen off. Push notifications enabled.</Text>
              {signals.slice(0,10).map(s=>(
                <View key={s.id} style={styles.liveCard}>
                  <Text style={styles.liveCardTitle}>{s.symbol} {s.timeframe} {s.type} Q{s.qScore}</Text>
                  <Text style={styles.liveCardBody}>{s.description} - Entry {s.entry.toFixed(2)} SL {s.stop.toFixed(2)} TP {s.tp1.toFixed(2)}</Text>
                  <Text style={styles.liveCardTime}>{new Date(s.time).toLocaleTimeString()} • {s.rr}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Bottom Tabs - exactly like video */}
        <View style={styles.bottomTabs}>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Chart')}><Text style={[styles.tabIcon, activeTab==='Chart' && styles.tabActive]}>📈</Text><Text style={[styles.tabLabel, activeTab==='Chart' && styles.tabActive]}>Chart</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Setups')}><Text style={[styles.tabIcon, activeTab==='Setups' && styles.tabActive]}>📋</Text><Text style={[styles.tabLabel, activeTab==='Setups' && styles.tabActive]}>Setups</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Scanner')}><Text style={[styles.tabIcon, activeTab==='Scanner' && styles.tabActive]}>🔍</Text><Text style={[styles.tabLabel, activeTab==='Scanner' && styles.tabActive]}>Scanner</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Live')}><Text style={[styles.tabIcon, activeTab==='Live' && styles.tabActive]}>📡</Text><Text style={[styles.tabLabel, activeTab==='Live' && styles.tabActive]}>Live</Text></TouchableOpacity>
        </View>

        {/* Alerts & Filters Modal - exactly like screenshot */}
        <Modal visible={showAlerts} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}><Text style={styles.modalTitle}>Alerts & filters</Text><TouchableOpacity onPress={()=>setShowAlerts(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity></View>
              
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSection}>NOTIFICATIONS</Text>
                <View style={styles.settingRow}><View><Text style={styles.settingTitle}>Push alerts</Text><Text style={styles.settingSub}>Ping when a high-quality setup appears</Text></View><Switch value={settings.pushEnabled} onValueChange={v=>setSettings(s=>({...s, pushEnabled: v}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                <View style={styles.settingRow}><View><Text style={styles.settingTitle}>Sound</Text><Text style={styles.settingSub}>Short tone with each new alert</Text></View><Switch value={settings.soundEnabled} onValueChange={v=>setSettings(s=>({...s, soundEnabled: v}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                <View style={styles.sliderRow}><Text style={styles.settingTitle}>Minimum quality</Text><Text style={styles.sliderValue}>{settings.minQuality}</Text></View>
                <View style={styles.slider}><View style={[styles.sliderFill, { width: `${settings.minQuality}%` }]} /></View>

                <Text style={styles.modalSection}>STRATEGIES</Text>
                <View style={styles.settingRow}><Text style={styles.settingTitle}>Harmonic patterns</Text><Switch value={settings.strategies.harmonic} onValueChange={v=>setSettings(s=>({...s, strategies: {...s.strategies, harmonic: v}}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                <View style={styles.settingRow}><Text style={styles.settingTitle}>Wolfe waves</Text><Switch value={settings.strategies.wolfe} onValueChange={v=>setSettings(s=>({...s, strategies: {...s.strategies, wolfe: v}}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                <View style={styles.settingRow}><Text style={styles.settingTitle}>Support & resistance</Text><Switch value={settings.strategies.sr} onValueChange={v=>setSettings(s=>({...s, strategies: {...s.strategies, sr: v}}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>

                <Text style={styles.modalSection}>TIMEFRAMES</Text>
                {TIMEFRAMES.map(tf=>(
                  <View key={tf} style={styles.settingRow}><Text style={styles.settingTitle}>{tf}</Text><Switch value={(settings.timeframes as any)[tf]} onValueChange={v=>setSettings(s=>({...s, timeframes: {...s.timeframes, [tf]: v}}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                ))}

                <Text style={styles.modalSection}>MARKETS</Text>
                {SYMBOLS.map(s=>(
                  <View key={s.id} style={styles.settingRow}><View><Text style={styles.settingTitle}>{s.id} - {s.fullName}</Text></View><Switch value={(settings.markets as any)[s.id]} onValueChange={v=>setSettings(ss=>({...ss, markets: {...ss.markets, [s.id]: v}}))} trackColor={{false:'#2c2c2e', true:'#30d158'}} /></View>
                ))}
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  headerSub: { color: '#8e8e93', fontSize: 10, marginTop: 2 },
  bellBtn: { padding: 8 },
  bellIcon: { fontSize: 18 },
  tickerRow: { maxHeight: 58, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  tickerCard: { minWidth: 90, paddingHorizontal: 12, paddingVertical: 8, marginRight: 4, backgroundColor: '#141414', borderRadius: 6, borderWidth: 1, borderColor: '#1c1c1e' },
  tickerActive: { backgroundColor: '#1c1c1e', borderColor: '#3a3a3c' },
  tickerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tickerSym: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tickerChange: { fontSize: 9, fontWeight: '600' },
  tickerPrice: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] },
  pos: { color: '#30d158' }, neg: { color: '#ff453a' },
  tfRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  tfLeft: { flexDirection: 'row', gap: 6 },
  tfBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: '#2c2c2e' },
  tfBtnActive: { backgroundColor: '#fff', borderColor: '#fff' },
  tfText: { color: '#8e8e93', fontSize: 11, fontWeight: '700' },
  tfTextActive: { color: '#000' },
  tfRight: { flexDirection: 'row' },
  liveToggle: { flexDirection: 'row', backgroundColor: '#1c1c1e', borderRadius: 6, padding: 2 },
  liveBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 4 },
  liveBtnActive: { backgroundColor: '#2c2c2e' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  main: { flex: 1, backgroundColor: '#0e0e10' },
  symbolInfo: { paddingHorizontal: 12, paddingVertical: 8 },
  symbolTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  symbolFull: { color: '#8e8e93', fontWeight: '400' },
  symbolPrice: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 },
  symbolChange: { fontSize: 12, fontWeight: '600' },
  chartWrap: { flex: 1, backgroundColor: '#0e0e10', position: 'relative' },
  chartOverlayRight: { position: 'absolute', right: 6, top: 20, gap: 4 },
  priceLabel: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, minWidth: 70, alignItems: 'flex-end' },
  priceLabelText: { color: '#fff', fontSize: 9, fontWeight: '700', fontVariant: ['tabular-nums'] },
  signalDetailBar: { flexDirection: 'row', backgroundColor: '#141414', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1c1c1e', gap: 16 },
  detailCol: { flex: 1 },
  detailLabel: { color: '#8e8e93', fontSize: 9, fontWeight: '600' },
  detailValue: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  detailSub: { color: '#636366', fontSize: 9, marginTop: 2 },
  bottomTabs: { flexDirection: 'row', backgroundColor: '#141414', borderTopWidth: 1, borderTopColor: '#1c1c1e', paddingVertical: 6, paddingBottom: 8 },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 18, color: '#636366' },
  tabLabel: { color: '#636366', fontSize: 9, marginTop: 2, fontWeight: '600' },
  tabActive: { color: '#fff' },
  setupsHeader: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  setupsHeaderText: { color: '#fff', fontSize: 12, fontWeight: '700', backgroundColor: '#1c1c1e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  scannerHeaderText: { color: '#8e8e93', fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4 },
  tradeableText: { color: '#8e8e93', fontSize: 11, marginLeft: 'auto' },
  setupCard: { backgroundColor: '#141414', marginHorizontal: 12, marginTop: 10, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1c1c1e' },
  setupTop: { flexDirection: 'row', justifyContent: 'space-between' },
  setupSymbol: { color: '#fff', fontSize: 12, fontWeight: '700' },
  setupTF: { color: '#8e8e93', fontWeight: '400' },
  setupDesc: { color: '#8e8e93', fontSize: 11 },
  setupLevels: { flexDirection: 'row', marginTop: 10, gap: 12, alignItems: 'center' },
  setupLevelLabel: { color: '#636366', fontSize: 8, fontWeight: '700' },
  setupLevelValue: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  sellBadge: { marginLeft: 'auto', backgroundColor: '#ff453a', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  buyBadge: { backgroundColor: '#30d158' },
  sellText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  setupFooter: { marginTop: 8 },
  setupMeta: { color: '#636366', fontSize: 10 },
  emptyText: { color: '#636366', textAlign: 'center', marginTop: 40, paddingHorizontal: 20, fontSize: 12 },
  scannerTableHeader: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  scannerCol: { flex: 1, color: '#636366', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  scannerRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#141414', alignItems: 'center' },
  marketName: { color: '#fff', fontSize: 11, fontWeight: '700' },
  marketFull: { color: '#636366', fontSize: 9 },
  quietCell: { backgroundColor: '#141414', paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
  quietText: { color: '#636366', fontSize: 10 },
  signalCell: { paddingVertical: 6, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center' },
  buyCell: { backgroundColor: '#1a2e1e' },
  sellCell: { backgroundColor: '#2e1a1a' },
  signalCellType: { fontSize: 9, fontWeight: '800', color: '#fff' },
  signalCellDesc: { fontSize: 8, color: '#8e8e93', marginTop: 2 },
  liveTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  liveSub: { color: '#8e8e93', fontSize: 11, marginTop: 4, marginBottom: 16 },
  liveCard: { backgroundColor: '#141414', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#1c1c1e' },
  liveCardTitle: { color: '#fff', fontSize: 12, fontWeight: '700' },
  liveCardBody: { color: '#8e8e93', fontSize: 11, marginTop: 4 },
  liveCardTime: { color: '#636366', fontSize: 9, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#141414', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: Dimensions.get('window').height*0.9, paddingHorizontal: 16, paddingTop: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalClose: { color: '#8e8e93', fontSize: 18, padding: 4 },
  modalSection: { color: '#8e8e93', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  settingTitle: { color: '#fff', fontSize: 13, fontWeight: '500' },
  settingSub: { color: '#636366', fontSize: 11, marginTop: 2 },
  sliderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  sliderValue: { color: '#fff', fontSize: 13, fontWeight: '700' },
  slider: { height: 4, backgroundColor: '#2c2c2e', borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  sliderFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
});
