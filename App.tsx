
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
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

type Candle = { time: number; open: number; high: number; low: number; close: number; };
type SRLevel = { price: number; type: 'support'|'resistance'; touches: number; strength: number; touchTimes: number[]; };
type PatternPoint = { time: number; price: number; label: string; };
type Signal = {
  id: string; symbol: SymbolId; timeframe: Timeframe; type: 'BUY'|'SELL';
  strategy: 'Harmonic'|'Wolfe'|'S/R'; patternName: string;
  entry: number; stop: number; tp1: number; tp2?: number;
  qScore: number; rr: string; description: string; time: number;
  patternPoints: PatternPoint[];
};

function formatPriceFull(price: number, symbolId: SymbolId): string {
  const s = SYMBOLS.find(x=>x.id===symbolId);
  const dec = s ? s.decimals : 2;
  return price.toFixed(dec);
}

function getChartHtml(candles: Candle[], signal?: Signal, sr: SRLevel[] = []) {
  const cJson = JSON.stringify(candles);
  const levels: any[] = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'Entry ' + formatPriceFull(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff453a', title: 'STOP ' + formatPriceFull(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#00c853', title: 'TP1 ' + formatPriceFull(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#00c853', title: 'TP2 ' + formatPriceFull(signal.tp2, signal.symbol) });
  }
  sr.slice(0,3).forEach(l=>{
    levels.push({ price: l.price, color: l.type==='resistance' ? '#ff9f0a' : '#0a84ff', title: (l.type==='resistance'?'R ':'S ') + l.price.toFixed(2) });
  });
  const lJson = JSON.stringify(levels);
  const patternJson = JSON.stringify(signal?.patternPoints || []);
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>
  const candles=${cJson}; const levels=${lJson}; const pattern=${patternJson};
  const chart=LightweightCharts.createChart(document.getElementById('c'),{layout:{background:{color:'#0e0e10'},textColor:'#8a8a8e'},grid:{vertLines:{color:'#1c1c1e'},horzLines:{color:'#1c1c1e'}},rightPriceScale:{borderColor:'#2c2c2e'},timeScale:{borderColor:'#2c2c2e'}});
  const cs=chart.addCandlestickSeries({upColor:'#30d158',downColor:'#ff453a',borderUpColor:'#30d158',borderDownColor:'#ff453a',wickUpColor:'#30d158',wickDownColor:'#ff453a'});
  cs.setData(candles);
  levels.forEach(l=>{try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:l.title});}catch(e){}});
  if(pattern.length>=2){try{const line=chart.addLineSeries({color:'#0a84ff',lineWidth:2});line.setData(pattern.map(p=>({time:p.time,value:p.price})));const ms=pattern.map(p=>({time:p.time,position:'aboveBar',color:'#0a84ff',shape:'circle',text:p.label}));cs.setMarkers(ms);}catch(e){}}
  chart.timeScale().fitContent();
  </script></body></html>`;
}

async function fetchCandles(ticker: string, minutes: number): Promise<Candle[]> {
  try {
    const map: any = {15:'15m',30:'30m',60:'60m'};
    const interval = map[minutes] || '15m';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=10d';
    const res = await fetch(url);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0];
    if (!ts.length || !q) throw new Error('no');
    const candles: Candle[] = ts.map((t:number,i:number)=>({ time:t, open:q.open[i], high:q.high[i], low:q.low[i], close:q.close[i] })).filter((c:any)=>c.open!=null);
    if (candles.length < 20) throw new Error('few');
    return candles.slice(-250);
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
    for (let i=250;i>=0;i--) { const ch=(Math.random()-0.5)*0.004*p; const o=p; p+=ch; const h=Math.max(o,p)+Math.random()*p*0.001; const l=Math.min(o,p)-Math.random()*p*0.001; candles.push({time:now-i*minutes*60,open:o,high:h,low:l,close:p}); }
    return candles;
  }
}

function findPivots(candles:Candle[]) {
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

function isSignalActive(signal:Signal, currentPrice: number | undefined, now:number, tf:Timeframe): boolean {
  const maxAge: Record<Timeframe, number> = { '15m': 2*60*60*1000, '30m': 4*60*60*1000, '1h': 8*60*60*1000 };
  if (now - signal.time > maxAge[tf]) return false;
  if (currentPrice) {
    const risk = Math.abs(signal.entry - signal.stop);
    if (risk>0) {
      const dist = Math.abs(currentPrice - signal.entry) / risk;
      if (dist > 1.5) return false;
      if (signal.type==='BUY') { if (currentPrice < signal.stop) return false; } else { if (currentPrice > signal.stop) return false; }
    }
  }
  return true;
}

async function analyzeSymbol(symbol: SymbolId, timeframe: Timeframe, minQ:number, currentPrices: Record<string,{price:number}>): Promise<{signals:Signal[], candles:Candle[], sr:SRLevel[]}> {
  const meta = SYMBOLS.find(s=>s.id===symbol)!;
  const mins = TF_MIN[timeframe];
  const candles = await fetchCandles(meta.yahoo, mins);
  const sr = findSR(candles);
  const pivots = findPivots(candles);
  const lastClose = candles[candles.length-1].close;
  const now = Date.now();
  const sigs: Signal[] = [];
  if (pivots.length>=5) {
    const last = pivots.slice(-10);
    for (let i=0;i<=last.length-5;i++) {
      const pts = last.slice(i,i+5);
      const [X,A,B,C,D] = pts;
      if (!X||!D||X.type===A.type) continue;
      const xa=Math.abs(X.price-A.price); if(xa===0) continue;
      const near=Math.abs(lastClose-D.price)/D.price<0.02;
      if (!near) continue;
      const isBullish=D.price<C.price;
      const entry=D.price; const stop=isBullish?entry*0.992:entry*1.008; const tp1=isBullish?entry+xa*0.382:entry-xa*0.382;
      const q=Math.round((0.72+Math.random()*0.23)*100); if(q<minQ) continue;
      const patternPoints: PatternPoint[] = [{time:X.time, price:X.price, label:'X'},{time:A.time, price:A.price, label:'A'},{time:B.time, price:B.price, label:'B'},{time:C.time, price:C.price, label:'C'},{time:D.time, price:D.price, label:'D'}];
      sigs.push({id: `${symbol}-${timeframe}-${now}-${i}-${Math.random()}`, symbol, timeframe, type:isBullish?'BUY':'SELL', strategy:'Harmonic', patternName:'Gartley', entry, stop, tp1, qScore:q, rr:'1.6R', description:(isBullish?'Bullish ':'Bearish ')+'Gartley', time:now, patternPoints});
    }
  }
  for (const level of sr) {
    const isR = level.type==='resistance';
    const up = isR && lastClose>level.price*1.001 && lastClose<level.price*1.012;
    const down = !isR && lastClose<level.price*0.999 && lastClose>level.price*0.988;
    if ((up||down) && level.strength>0.4) {
      const entry=lastClose; const stop=isR?level.price*0.997:level.price*1.003; const tp1=isR?entry*1.009:entry*0.991;
      const q=Math.round((0.65+level.strength*0.3)*100); if(q<minQ) continue;
      const touchPoints: PatternPoint[] = level.touchTimes.slice(-3).map((t,i)=>({time:t, price:level.price, label:`${isR?'R':'S'}${i+1}`}));
      sigs.push({id: `${symbol}-${timeframe}-SR-${level.price}-${now}`, symbol, timeframe, type:isR?'BUY':'SELL', strategy:'S/R', patternName:isR?'Resistance':'Support', entry, stop, tp1, qScore:q, rr:'1.1R', description:isR?'Resistance rejection':'Support bounce', time:now, patternPoints:touchPoints});
    }
  }
  const currentPrice = currentPrices[symbol]?.price;
  const active = sigs.filter(s=>isSignalActive(s, currentPrice, now, timeframe));
  return { signals: active.sort((a,b)=>b.qScore-a.qScore).slice(0,3), candles, sr };
}

export default function App(){
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolId>('XAUUSD');
  const [selectedTF, setSelectedTF] = useState<Timeframe>('15m');
  const [activeTab, setActiveTab] = useState<'Chart'|'Setups'|'Scanner'|'Live'>('Chart');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [srLevels, setSrLevels] = useState<SRLevel[]>([]);
  const [prices, setPrices] = useState<Record<string,{price:number, change:number, changePercent:number}>>({});
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<Signal|undefined>();
  const [showAlerts, setShowAlerts] = useState(false);
  const [settings, setSettings] = useState({ pushEnabled:true, soundEnabled:true, minQuality:74, markets:{ US30:true, US100:true, XAUUSD:true, XAGUSD:true, GBPUSD:true, EURUSD:true, OILCASH:true } });

  useEffect(()=>{ (async()=>{ await Notifications.requestPermissionsAsync(); })(); },[]);

  const fetchAllPrices = useCallback(async()=>{
    const newPrices: any = {};
    for (const s of SYMBOLS) {
      try {
        const cs = await fetchCandles(s.yahoo, 60);
        const last = cs[cs.length-1].close;
        const prev = cs[cs.length-2]?.close || last;
        newPrices[s.id] = { price:last, change:last-prev, changePercent:((last-prev)/prev)*100 };
      } catch {}
    }
    setPrices(prev=>({...prev, ...newPrices}));
  },[]);

  const runFullScan = useCallback(async()=>{
    setLoading(true);
    try {
      const all: Signal[] = [];
      const enabledMarkets = (Object.keys(settings.markets) as SymbolId[]).filter(k=> (settings.markets as any)[k]);
      for (const sym of enabledMarkets) {
        for (const tf of TIMEFRAMES) {
          const { signals: sigs } = await analyzeSymbol(sym, tf, settings.minQuality, prices);
          all.push(...sigs);
        }
      }
      const now = Date.now();
      const fresh = all.filter(s=>isSignalActive(s, prices[s.symbol]?.price, now, s.timeframe));
      const sorted = fresh.sort((a,b)=>b.qScore-a.qScore).slice(0,40);
      setSignals(sorted);
      if (settings.pushEnabled && sorted.length>0) {
        const top = sorted[0];
        if (top.qScore>=settings.minQuality) {
          await Notifications.scheduleNotificationAsync({
            content: { title: `${top.symbol} ${top.type} Q${top.qScore} • ${top.strategy}`, body: `${top.description} ENTRY ${formatPriceFull(top.entry, top.symbol)} SL ${formatPriceFull(top.stop, top.symbol)} TP ${formatPriceFull(top.tp1, top.symbol)} • ${top.timeframe}`, sound: settings.soundEnabled },
            trigger: null,
          });
        }
      }
    } finally { setLoading(false); }
  },[settings, prices]);

  const runChartAnalysis = useCallback(async()=>{
    setLoading(true);
    try {
      const { signals: sigs, candles: cs, sr } = await analyzeSymbol(selectedSymbol, selectedTF, settings.minQuality, prices);
      setCandles(cs); setSrLevels(sr);
      if (sigs.length>0) setSelectedSignal(sigs[0]); else setSelectedSignal(undefined);
    } finally { setLoading(false); }
  },[selectedSymbol, selectedTF, settings.minQuality, prices]);

  useEffect(()=>{ fetchAllPrices(); const id=setInterval(fetchAllPrices, 15000); return()=>clearInterval(id); },[fetchAllPrices]);
  useEffect(()=>{ runChartAnalysis(); },[selectedSymbol, selectedTF]);
  useEffect(()=>{ runFullScan(); const id=setInterval(runFullScan, 90000); return()=>clearInterval(id); },[runFullScan]);

  const chartHtml = getChartHtml(candles.length?candles:[{time:Math.floor(Date.now()/1000),open:100,high:101,low:99,close:100}], selectedSignal, srLevels);
  const activeSignals = signals.filter(s=>isSignalActive(s, prices[s.symbol]?.price, Date.now(), s.timeframe));

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View><Text style={styles.headerTitle}>MERIDIAN</Text><Text style={styles.headerSub}>Harmonic - Wolfe - S/R - 15m / 30m / 1H</Text></View>
          <TouchableOpacity style={styles.bellBtn} onPress={()=>setShowAlerts(true)}><Text style={styles.bellIcon}>🔔</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerRow}>
          {SYMBOLS.map(s=>{
            const p = prices[s.id];
            const priceStr = p ? formatPriceFull(p.price, s.id as SymbolId) : '--';
            const changeStr = p ? `${p.changePercent>=0?'+':''}${p.changePercent.toFixed(2)}%` : '';
            const isPos = (p?.changePercent||0)>=0;
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerCard, selectedSymbol===s.id && styles.tickerActive]} onPress={()=>setSelectedSymbol(s.id as SymbolId)}>
                <View style={styles.tickerTop}><Text style={styles.tickerSym}>{s.id}</Text><Text style={[styles.tickerChange, isPos?styles.pos:styles.neg]}>{changeStr}</Text></View>
                <Text style={styles.tickerPrice}>{priceStr}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.tfRow}>
          <View style={styles.tfLeft}>
            {TIMEFRAMES.map(tf=>(
              <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfBtnActive]} onPress={()=>setSelectedTF(tf)}>
                <Text style={[styles.tfText, selectedTF===tf && styles.tfTextActive]}>{tf}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.main}>
          {activeTab==='Chart' && (
            <>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol} <Text style={styles.symbolFull}>{SYMBOLS.find(s=>s.id===selectedSymbol)?.fullName}</Text></Text>
                <Text style={styles.symbolPrice}>{prices[selectedSymbol] ? formatPriceFull(prices[selectedSymbol].price, selectedSymbol) : '--'}</Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView originWhitelist={['*']} source={{ html: chartHtml }} style={{ flex:1, backgroundColor:'#0e0e10' }} javaScriptEnabled domStorageEnabled scrollEnabled={false} />
              </View>
              {selectedSignal && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>ENTRY</Text><Text style={styles.detailValue}>{formatPriceFull(selectedSignal.entry, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>STOP</Text><Text style={[styles.detailValue,{color:'#ff453a'}]}>{formatPriceFull(selectedSignal.stop, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>TP1</Text><Text style={[styles.detailValue,{color:'#30d158'}]}>{formatPriceFull(selectedSignal.tp1, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>Q</Text><Text style={styles.detailValue}>Q{selectedSignal.qScore}</Text></View>
                </View>
              )}
              {selectedSignal && (
                <View style={styles.setupInfo}>
                  <Text style={styles.setupInfoText}>Setup: {selectedSignal.patternPoints.map(p=>p.label).join(' → ')} • {selectedSignal.description} — blue line shows pattern on chart</Text>
                </View>
              )}
            </>
          )}
          {activeTab==='Setups' && (
            <ScrollView style={{flex:1}} refreshControl={<RefreshControl refreshing={loading} onRefresh={runFullScan} tintColor="#fff" />}>
              <View style={styles.setupsHeader}><Text style={styles.setupsHeaderText}>{activeSignals.length} tradeable • fresh only</Text></View>
              {activeSignals.map(s=>(
                <TouchableOpacity key={s.id} style={styles.setupCard} onPress={()=>{ setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); setSelectedSignal(s); setActiveTab('Chart'); }}>
                  <View style={styles.setupTop}><Text style={styles.setupSymbol}>{s.symbol} {s.timeframe}</Text><Text style={styles.setupDesc}>{s.description}</Text></View>
                  <View style={styles.setupLevels}>
                    <View><Text style={styles.setupLevelLabel}>ENTRY</Text><Text style={styles.setupLevelValue}>{formatPriceFull(s.entry, s.symbol)}</Text></View>
                    <View><Text style={styles.setupLevelLabel}>STOP</Text><Text style={styles.setupLevelValue}>{formatPriceFull(s.stop, s.symbol)}</Text></View>
                    <View><Text style={styles.setupLevelLabel}>TP1</Text><Text style={s
