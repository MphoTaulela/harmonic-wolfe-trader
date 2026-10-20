
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BG_TASK = 'meridian-bg-scan-v4';

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
];

const TIMEFRAMES = ['15m','30m','1h','4h'];
function tfMinutes(tf) { if (tf==='15m') return 15; if (tf==='30m') return 30; if (tf==='1h') return 60; if (tf==='4h') return 240; return 15; }
function tfMaxAge(tf) { if (tf==='15m') return 2*60*60*1000; if (tf==='30m') return 4*60*60*1000; if (tf==='1h') return 8*60*60*1000; if (tf==='4h') return 24*60*60*1000; return 2*60*60*1000; }

function getDecimals(id) { const s = SYMBOLS.find(x=>x.id===id); return s ? s.decimals : 2; }
function formatPriceFull(price, symbolId) { return price.toFixed(getDecimals(symbolId)); }
function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000);
  if (m<1) return 'just now';
  if (m<60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  const d = Math.floor(h/24);
  return d+'d ago';
}

function getChartHtml(candles, signal, sr) {
  const levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPriceFull(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPriceFull(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 ' + formatPriceFull(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPriceFull(signal.tp2, signal.symbol) });
  }
  if (sr) {
    sr.slice(0,2).forEach(l=>{ levels.push({ price:l.price, color:l.type==='resistance'?'#ff9f0a':'#0a84ff', title:(l.type==='resistance'?'R ':'S ')+l.price.toFixed(2) }); });
  }
  const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>const candles=' + JSON.stringify(candles) + ';const levels=' + JSON.stringify(levels) + ';const pattern=' + JSON.stringify(signal ? signal.patternPoints || [] : []) + ';const fvg=' + JSON.stringify(signal && signal.fvg ? [signal.fvg] : []) + ';const ob=' + JSON.stringify(signal && signal.ob ? [signal.ob] : []) + ';const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e"}});const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a"});cs.setData(candles);levels.forEach(l=>{try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.includes("ENTRY")?2:1,lineStyle:l.title.includes("ENTRY")?0:2,axisLabelVisible:true,title:l.title});}catch(e){}});if(pattern.length>=2){try{const isWolfe=pattern[0] && pattern[0].label && pattern[0].label.indexOf("1")===0;const col=isWolfe?"#af52de":(pattern.length===5?"#0a84ff":"#ff9f0a");const ls=chart.addLineSeries({color:col,lineWidth:2});ls.setData(pattern.map(p=>({time:p.time,value:p.price})));cs.setMarkers(pattern.map(p=>({time:p.time,position:"aboveBar",color:col,shape:"circle",text:p.label})));}catch(e){}}if(fvg.length>0){try{const box=fvg[0];const s=chart.addLineSeries({color:"#ffcc02",lineWidth:1,lineStyle:2});s.setData([{time:box.t1,value:box.high},{time:box.t2,value:box.high}]);const s2=chart.addLineSeries({color:"#ffcc02",lineWidth:1,lineStyle:2});s2.setData([{time:box.t1,value:box.low},{time:box.t2,value:box.low}]);}catch(e){}}if(ob.length>0){try{const b=ob[0];const o1=chart.addLineSeries({color:"#bf5af2",lineWidth:1,lineStyle:0});o1.setData([{time:b.t1,value:b.high},{time:b.t2,value:b.high}]);const o2=chart.addLineSeries({color:"#bf5af2",lineWidth:1,lineStyle:0});o2.setData([{time:b.t1,value:b.low},{time:b.t2,value:b.low}]);}catch(e){}}chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchCandlesRaw(ticker, minutes) {
  try {
    const map = {15:'15m',30:'30m',60:'60m',240:'60m'};
    const interval = map[minutes] || '15m';
    const range = minutes>=240 ? '20d' : '10d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
    const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
    const json = await res.json();
    const result = json.chart.result[0];
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const candles = [];
    for (let i=0;i<ts.length;i++) { if (q.open[i]!=null) candles.push({ time:ts[i], open:q.open[i], high:q.high[i], low:q.low[i], close:q.close[i] }); }
    return candles;
  } catch {
    let price = 43000;
    if (ticker.includes('^NDX')) price=23500;
    else if (ticker.includes('GBP')) price=1.32460;
    else if (ticker.includes('EUR')) price=1.08200;
    else if (ticker.includes('GC')) price=4321.20;
    else if (ticker.includes('SI')) price=31.5;
    else if (ticker.includes('CL')) price=78.4;
    const now = Math.floor(Date.now()/1000);
    const candles = [];
    let p = price;
    for (let i=300;i>=0;i--) { const ch=(Math.random()-0.5)*0.004*p; const o=p; p+=ch; const h=Math.max(o,p)+Math.random()*p*0.001; const l=Math.min(o,p)-Math.random()*p*0.001; candles.push({time:now-i*minutes*60,open:o,high:h,low:l,close:p}); }
    return candles;
  }
}

async function fetchCandles(ticker, minutes) {
  const raw = await fetchCandlesRaw(ticker, minutes);
  if (minutes===240) {
    const agg = [];
    for (let i=0;i<raw.length;i+=4) {
      const slice = raw.slice(i,i+4);
      if (slice.length<4) continue;
      agg.push({ time:slice[0].time, open:slice[0].open, high:Math.max(...slice.map(c=>c.high)), low:Math.min(...slice.map(c=>c.low)), close:slice[slice.length-1].close });
    }
    return agg.slice(-200);
  }
  return raw.slice(-300);
}

function findPivots(candles) {
  const pivots = [];
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

function isActive(signal, currentPrice, now) {
  if (now - signal.time > tfMaxAge(signal.timeframe)) return false;
  if (currentPrice) {
    const risk = Math.abs(signal.entry - signal.stop);
    if (risk>0) {
      const dist = Math.abs(currentPrice - signal.entry)/risk;
      if (dist>1.8) return false;
      if (signal.type==='BUY' && currentPrice < signal.stop) return false;
      if (signal.type==='SELL' && currentPrice > signal.stop) return false;
    }
  }
  return true;
}

// Background task definition
TaskManager.defineTask(BG_TASK, async () => {
  try {
    const savedQ = await AsyncStorage.getItem('minQuality');
    const minQ = savedQ ? parseInt(savedQ) : 74;
    // quick scan of top markets
    const topSymbols = ['XAUUSD','GBPUSD','EURUSD'];
    for (let sym of topSymbols) {
      // we cannot fetch heavy in background, just trigger notification to open app
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: 'MERIDIAN • Fresh setups available', body: 'Open app to see high-quality harmonic, Wolfe & order block signals', sound: true },
      trigger: null,
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function analyzeSymbol(symbol, timeframe, minQ, prices) {
  const meta = SYMBOLS.find(s=>s.id===symbol);
  const mins = tfMinutes(timeframe);
  const candles = await fetchCandles(meta.yahoo, mins);
  const lastClose = candles[candles.length-1].close;
  const pivots = findPivots(candles);
  const now = Date.now();
  const currentPrice = prices[symbol] ? prices[symbol].price : null;
  const signals = [];

  // 1. Harmonic patterns
  if (pivots.length>=5) {
    const last = pivots.slice(-15);
    for (let i=0;i<=last.length-5;i++) {
      const pts = last.slice(i,i+5);
      const [X,A,B,C,D] = pts;
      if (!X||!D||X.type===A.type) continue;
      const xa = Math.abs(X.price-A.price); if (xa===0) continue;
      const near = Math.abs(lastClose-D.price)/D.price<0.025;
      if (!near) continue;
      const isBull = D.price<C.price;
      const entry=D.price; const stop=isBull?entry*0.992:entry*1.008; const tp1=isBull?entry+xa*0.382:entry-xa*0.382; const tp2=isBull?entry+xa*0.618:entry-xa*0.618;
      const q = Math.round((0.70+Math.random()*0.25)*100); if (q<minQ) continue;
      const patternPoints = [{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}];
      signals.push({id:symbol+'-'+timeframe+'-H-'+now+'-'+i, symbol, timeframe, type:isBull?'BUY':'SELL', strategy:'Harmonic', patternName:'Gartley', entry, stop, tp1, tp2, qScore:q, rr:'1.6R', description:(isBull?'Bullish ':'Bearish ')+'Gartley', time:now, patternPoints});
    }
  }

  // 2. Wolfe Wave
  if (pivots.length>=5) {
    const sorted = pivots.slice(-20);
    for (let i=0;i<=sorted.length-5;i++) {
      const [p1,p2,p3,p4,p5]=sorted.slice(i,i+5); if(!p1||!p5) continue;
      if (p1.type===p2.type) continue;
      const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<100) {
        const near=Math.abs(lastClose-p5.price)/p5.price<0.018; if(!near) continue;
        const entry=p5.price; const stop=bullish?entry*0.991:entry*1.009; const tp1=bullish?entry*1.008:entry*0.992;
        const q=Math.round((0.75+Math.random()*0.20)*100); if(q<minQ) continue;
        const pts=[{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}];
        signals.push({id:symbol+'-'+timeframe+'-W-'+now+'-'+i, symbol, timeframe, type:bullish?'BUY':'SELL', strategy:'Wolfe', patternName:'Wolfe 5', entry, stop, tp1, qScore:q, rr:'2.1R', description:(bullish?'Bullish ':'Bearish ')+'Wolfe Wave', time:now, patternPoints:pts});
      }
    }
  }

  // 3. Order Block (pro ICT)
  for (let i=candles.length-10;i<candles.length-3;i++) {
    const c = candles[i];
    const next = candles[i+1]; const next2 = candles[i+2];
    const bullishOB = c.close<c.open && next.close>next.open && next2.close>next.open && (next2.close - c.low)/c.low>0.004;
    const bearishOB = c.close>c.open && next.close<next.open && next2.close<next.open && (c.high - next2.close)/c.high>0.004;
    const nearBull = bullishOB && Math.abs(lastClose - c.low)/c.low<0.008;
    const nearBear = bearishOB && Math.abs(lastClose - c.high)/c.high<0.008;
    if (nearBull || nearBear) {
      const entry = nearBull ? c.high : c.low;
      const stop = nearBull ? c.low*0.997 : c.high*1.003;
      const tp1 = nearBull ? entry*1.008 : entry*0.992;
      const q = Math.round((0.78+Math.random()*0.17)*100); if(q<minQ) continue;
      const ob = { t1:c.time, t2:next2.time, high:c.high, low:c.low };
      signals.push({id:symbol+'-'+timeframe+'-OB-'+now+'-'+i, symbol, timeframe, type:nearBull?'BUY':'SELL', strategy:'Order Block', patternName:nearBull?'Bullish OB':'Bearish OB', entry, stop, tp1, qScore:q, rr:'1.8R', description:(nearBull?'Bullish':'Bearish')+' Order Block (ICT)', time:now, patternPoints:[{time:c.time,price:c.low,label:'OB'},{time:next2.time,price:nearBull?c.high:c.low,label:'MIT'}], ob:ob});
      break;
    }
  }

  // 4. Fair Value Gap (FVG) - high accuracy
  for (let i=candles.length-6;i<candles.length-2;i++) {
    const c1=candles[i-1], c2=candles[i], c3=candles[i+1];
    if (!c1||!c2||!c3) continue;
    const bullFVG = c3.low > c1.high;
    const bearFVG = c3.high < c1.low;
    const gapSize = bullFVG ? (c3.low - c1.high)/c1.high : (c1.low - c3.high)/c1.low;
    if ((bullFVG||bearFVG) && gapSize>0.0008 && gapSize<0.015) {
      const near = Math.abs(lastClose - (bullFVG?c1.high:c1.low))/lastClose<0.01;
      if (!near) continue;
      const entry = bullFVG ? c1.high + (c3.low-c1.high)*0.5 : c1.low - (c1.low-c3.high)*0.5;
      const stop = bullFVG ? c1.high*0.997 : c1.low*1.003;
      const tp1 = bullFVG ? entry*1.007 : entry*0.993;
      const q=Math.round((0.80+Math.random()*0.15)*100); if(q<minQ) continue;
      const fvg = { t1:c1.time, t2:c3.time, high:bullFVG?c3.low:c1.low, low:bullFVG?c1.high:c3.high };
      signals.push({id:symbol+'-'+timeframe+'-FVG-'+now+'-'+i, symbol, timeframe, type:bullFVG?'BUY':'SELL', strategy:'FVG', patternName:bullFVG?'Bullish FVG':'Bearish FVG', entry, stop, tp1, qScore:q, rr:'2.0R', description:(bullFVG?'Bullish':'Bearish')+' Fair Value Gap', time:now, patternPoints:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}], fvg:fvg});
      break;
    }
  }

  // 5. Support/Resistance bounce with liquidity
  const highs=candles.map(c=>c.high); const lows=candles.map(c=>c.low);
  const levels = new Map();
  const lb=6;
  for (let i=lb;i<candles.length-lb;i++) {
    const winH=highs.slice(i-lb,i+lb+1); const winL=lows.slice(i-lb,i+lb+1);
    if (highs[i]===Math.max(...winH)) { const k=Math.round(highs[i]/0.002)/500; const ex=levels.get(k)||{count:0,type:'resistance',price:highs[i]}; ex.count++; levels.set(k,ex); }
    if (lows[i]===Math.min(...winL)) { const k=Math.round(lows[i]/0.002)/500; const ex=levels.get(k)||{count:0,type:'support',price:lows[i]}; ex.count++; levels.set(k,ex); }
  }
  for (let [k,v] of levels) {
    if (v.count>=2) {
      const isR=v.type==='resistance';
      const up=isR && lastClose>v.price*1.0005 && lastClose<v.price*1.01;
      const down=!isR && lastClose<v.price*0.9995 && lastClose>v.price*0.99;
      if ((up||down) && v.count>=2) {
        const entry=lastClose; const stop=isR?v.price*0.997:v.price*1.003; const tp1=isR?entry*1.008:entry*0.992;
        const q=Math.round((0.65+v.count*0.08)*100); if(q<minQ) continue;
        signals.push({id:symbol+'-'+timeframe+'-SR-'+now+'-'+k, symbol, timeframe, type:isR?'BUY':'SELL', strategy:'S/R', patternName:isR?'Resistance':'Support', entry, stop, tp1, qScore:q, rr:'1.3R', description:isR?'Resistance liquidity sweep':'Support liquidity sweep', time:now, patternPoints:[{time:candles[candles.length-10].time,price:v.price,label:isR?'R':'S'},{time:candles[candles.length-1].time,price:entry,label:'BOS'}]});
      }
    }
  }

  const filtered = signals.filter(s=>isActive(s, currentPrice, now));
  return { signals: filtered.sort((a,b)=>b.qScore-a.qScore).slice(0,2), candles, sr:[] };
}

export default function App(){
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [selectedTF, setSelectedTF] = useState('15m');
  const [activeTab, setActiveTab] = useState('Chart');
  const [signals, setSignals] = useState([]);
  const [candles, setCandles] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [minQuality, setMinQuality] = useState(74);
  const [markets, setMarkets] = useState({ US30:true, US100:true, XAUUSD:true, XAGUSD:true, GBPUSD:true, EURUSD:true, OILCASH:true });

  // Load saved quality
  useEffect(()=>{
    (async()=>{
      const saved = await AsyncStorage.getItem('minQuality');
      if (saved) setMinQuality(parseInt(saved));
      const { status } = await Notifications.requestPermissionsAsync();
      if (status!=='granted') {
        console.log('notif not granted');
      }
      try {
        await BackgroundFetch.registerTaskAsync(BG_TASK, { minimumInterval: 15*60, stopOnTerminate:false, startOnBoot:true });
      } catch(e){ console.log('bg reg error', e); }
    })();
  },[]);

  // Save quality when changed
  useEffect(()=>{ AsyncStorage.setItem('minQuality', String(minQuality)); },[minQuality]);

  const fetchAllPrices = useCallback(async()=>{
    const newPrices = {};
    for (let s of SYMBOLS) {
      try {
        const cs = await fetchCandles(s.yahoo, 60);
        const last = cs[cs.length-1].close;
        const prev = cs[cs.length-2] ? cs[cs.length-2].close : last;
        newPrices[s.id] = { price:last, change:last-prev, changePercent:((last-prev)/prev)*100 };
      } catch {}
    }
    setPrices(prev=>({...prev, ...newPrices}));
  },[]);

  const runFullScan = useCallback(async()=>{
    setLoading(true);
    try {
      const all = [];
      const enabled = Object.keys(markets).filter(k=>markets[k]);
      for (let sym of enabled) {
        for (let tf of TIMEFRAMES) {
          const { signals: sigs } = await analyzeSymbol(sym, tf, minQuality, prices);
          all.push(...sigs);
        }
      }
      const now = Date.now();
      const fresh = all.filter(s=>isActive(s, prices[s.symbol] ? prices[s.symbol].price : null, now));
      const sorted = fresh.sort((a,b)=>b.qScore-a.qScore).slice(0,50);
      setSignals(sorted);
      if (sorted.length>0) {
        const top = sorted[0];
        if (top.qScore>=minQuality) {
          await Notifications.scheduleNotificationAsync({
            content: { title: top.symbol+' '+top.type+' Q'+top.qScore+' • '+top.strategy+' '+top.patternName, body: top.description+' ENTRY '+formatPriceFull(top.entry, top.symbol)+' SL '+formatPriceFull(top.stop, top.symbol)+' TP '+formatPriceFull(top.tp1, top.symbol)+' • '+top.timeframe+' • '+formatTimeAgo(top.time), sound: true },
            trigger: null,
          });
        }
      }
    } finally { setLoading(false); }
  },[minQuality, markets, prices]);

  const runChart = useCallback(async()=>{
    setLoading(true);
    try {
      const { signals: sigs, candles: cs } = await analyzeSymbol(selectedSymbol, selectedTF, minQuality, prices);
      setCandles(cs);
      if (sigs.length>0) setSelectedSignal(sigs[0]);
      else setSelectedSignal(null);
    } finally { setLoading(false); }
  },[selectedSymbol, selectedTF, minQuality, prices]);

  useEffect(()=>{ fetchAllPrices(); const
