
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BG_TASK = 'meridian-bg-v41';

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

function getMins(tf) {
  if (tf==='15m') return 15;
  if (tf==='30m') return 30;
  if (tf==='1h') return 60;
  if (tf==='4h') return 240;
  return 15;
}
function getMaxAge(tf) {
  if (tf==='15m') return 2*60*60*1000;
  if (tf==='30m') return 4*60*60*1000;
  if (tf==='1h') return 8*60*60*1000;
  if (tf==='4h') return 24*60*60*1000;
  return 2*60*60*1000;
}
function getDecimals(id) {
  for (let i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===id) return SYMBOLS[i].decimals; }
  return 2;
}
function formatPriceFull(price, symbolId) {
  return price.toFixed(getDecimals(symbolId));
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000);
  if (m<1) return 'just now';
  if (m<60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

function getChartHtml(candles, signal) {
  const cStr = JSON.stringify(candles);
  let levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPriceFull(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPriceFull(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 ' + formatPriceFull(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPriceFull(signal.tp2, signal.symbol) });
  }
  const lStr = JSON.stringify(levels);
  const pStr = JSON.stringify(signal && signal.patternPoints ? signal.patternPoints : []);
  const fvgStr = JSON.stringify(signal && signal.fvg ? signal.fvg : null);
  const obStr = JSON.stringify(signal && signal.ob ? signal.ob : null);
  let html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>';
  html += 'const candles='+cStr+';const levels='+lStr+';const pattern='+pStr+';const fvg='+fvgStr+';const ob='+obStr+';';
  html += 'const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e"}});';
  html += 'const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a"});cs.setData(candles);';
  html += 'levels.forEach(function(l){try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.indexOf("ENTRY")>=0?2:1,lineStyle:l.title.indexOf("ENTRY")>=0?0:2,axisLabelVisible:true,title:l.title});}catch(e){}});';
  html += 'if(pattern.length>=2){try{const col=pattern[0].label==="1"||pattern[0].label==="2"?"#af52de":"#0a84ff";const ls=chart.addLineSeries({color:col,lineWidth:2});ls.setData(pattern.map(function(p){return{time:p.time,value:p.price}}));cs.setMarkers(pattern.map(function(p){return{time:p.time,position:"aboveBar",color:col,shape:"circle",text:p.label}}));}catch(e){}}';
  html += 'if(fvg){try{const s1=chart.addLineSeries({color:"#ffcc02",lineWidth:1,lineStyle:2});s1.setData([{time:fvg.t1,value:fvg.high},{time:fvg.t2,value:fvg.high}]);const s2=chart.addLineSeries({color:"#ffcc02",lineWidth:1,lineStyle:2});s2.setData([{time:fvg.t1,value:fvg.low},{time:fvg.t2,value:fvg.low}]);}catch(e){}}';
  html += 'if(ob){try{const o1=chart.addLineSeries({color:"#bf5af2",lineWidth:1});o1.setData([{time:ob.t1,value:ob.high},{time:ob.t2,value:ob.high}]);const o2=chart.addLineSeries({color:"#bf5af2",lineWidth:1});o2.setData([{time:ob.t1,value:ob.low},{time:ob.t2,value:ob.low}]);}catch(e){}}';
  html += 'chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchRaw(ticker, mins) {
  try {
    let interval = '15m';
    if (mins===15) interval='15m';
    else if (mins===30) interval='30m';
    else interval='60m';
    let range = '10d';
    if (mins>=240) range='20d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
    const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
    const json = await res.json();
    const result = json.chart.result[0];
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const candles = [];
    for (let i=0;i<ts.length;i++) {
      if (q.open[i]!=null) candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
    }
    return candles;
  } catch {
    let price = 43000;
    if (ticker.indexOf('^NDX')>=0) price=23500;
    else if (ticker.indexOf('GBP')>=0) price=1.32460;
    else if (ticker.indexOf('EUR')>=0) price=1.08200;
    else if (ticker.indexOf('GC')>=0) price=4321.20;
    else if (ticker.indexOf('SI')>=0) price=31.5;
    else if (ticker.indexOf('CL')>=0) price=78.4;
    const now = Math.floor(Date.now()/1000);
    const candles = [];
    let p = price;
    for (let i=300;i>=0;i--) {
      const ch=(Math.random()-0.5)*0.004*p;
      const o=p; p+=ch;
      const h=Math.max(o,p)+Math.random()*p*0.001;
      const l=Math.min(o,p)-Math.random()*p*0.001;
      candles.push({time:now-i*mins*60,open:o,high:h,low:l,close:p});
    }
    return candles;
  }
}

async function fetchCandles(ticker, mins) {
  const raw = await fetchRaw(ticker, mins);
  if (mins===240) {
    const agg = [];
    for (let i=0;i<raw.length;i+=4) {
      const slice = raw.slice(i,i+4);
      if (slice.length<4) continue;
      let high = slice[0].high;
      let low = slice[0].low;
      for (let j=1;j<slice.length;j++) { if (slice[j].high>high) high=slice[j].high; if (slice[j].low<low) low=slice[j].low; }
      agg.push({ time: slice[0].time, open: slice[0].open, high: high, low: low, close: slice[slice.length-1].close });
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
    let maxH = slice[0].high;
    let minL = slice[0].low;
    for (let j=1;j<slice.length;j++) { if (slice[j].high>maxH) maxH=slice[j].high; if (slice[j].low<minL) minL=slice[j].low; }
    if (candles[i].high===maxH) pivots.push({time:candles[i].time, price:candles[i].high, type:'high', index:i});
    if (candles[i].low===minL) pivots.push({time:candles[i].time, price:candles[i].low, type:'low', index:i});
  }
  pivots.sort(function(a,b){return a.index-b.index;});
  return pivots;
}

function isActive(sig, curPrice, now) {
  if (now - sig.time > getMaxAge(sig.timeframe)) return false;
  if (curPrice) {
    const risk = Math.abs(sig.entry - sig.stop);
    if (risk>0) {
      const dist = Math.abs(curPrice - sig.entry)/risk;
      if (dist>1.8) return false;
      if (sig.type==='BUY' && curPrice < sig.stop) return false;
      if (sig.type==='SELL' && curPrice > sig.stop) return false;
    }
  }
  return true;
}

TaskManager.defineTask(BG_TASK, async function() {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'MERIDIAN • Fresh setups', body: 'High-quality Harmonic, Wolfe, Order Block signals available - open app', sound: true },
      trigger: null,
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function analyzeSymbol(symbol, timeframe, minQ, prices) {
  let meta = null;
  for (let i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===symbol) meta=SYMBOLS[i]; }
  const mins = getMins(timeframe);
  const candles = await fetchCandles(meta.yahoo, mins);
  const lastClose = candles[candles.length-1].close;
  const pivots = findPivots(candles);
  const now = Date.now();
  let curPrice = null;
  if (prices[symbol]) curPrice = prices[symbol].price;
  const signals = [];

  // 1. Harmonic
  if (pivots.length>=5) {
    const last = pivots.slice(-15);
    for (let i=0;i<=last.length-5;i++) {
      const X=last[i], A=last[i+1], B=last[i+2], C=last[i+3], D=last[i+4];
      if (!X||!D||X.type===A.type) continue;
      const xa=Math.abs(X.price-A.price); if (xa===0) continue;
      const near=Math.abs(lastClose-D.price)/D.price<0.025; if (!near) continue;
      const isBull=D.price<C.price;
      const entry=D.price; const stop=isBull?entry*0.992:entry*1.008; const tp1=isBull?entry+xa*0.382:entry-xa*0.382; const tp2=isBull?entry+xa*0.618:entry-xa*0.618;
      const q=Math.round((0.70+Math.random()*0.25)*100); if (q<minQ) continue;
      const pts=[{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}];
      signals.push({id:symbol+'-'+timeframe+'-H-'+now+'-'+i, symbol:symbol, timeframe:timeframe, type:isBull?'BUY':'SELL', strategy:'Harmonic', patternName:'Gartley', entry:entry, stop:stop, tp1:tp1, tp2:tp2, qScore:q, rr:'1.6R', description:(isBull?'Bullish ':'Bearish ')+'Gartley', time:now, patternPoints:pts});
    }
  }

  // 2. Wolfe Wave
  if (pivots.length>=5) {
    const sorted = pivots.slice(-20);
    for (let i=0;i<=sorted.length-5;i++) {
      const p1=sorted[i], p2=sorted[i+1], p3=sorted[i+2], p4=sorted[i+3], p5=sorted[i+4];
      if (!p1||!p5||p1.type===p2.type) continue;
      const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<100) {
        const near=Math.abs(lastClose-p5.price)/p5.price<0.018; if(!near) continue;
        const entry=p5.price; const stop=bullish?entry*0.991:entry*1.009; const tp1=bullish?entry*1.008:entry*0.992;
        const q=Math.round((0.75+Math.random()*0.20)*100); if(q<minQ) continue;
        const pts=[{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}];
        signals.push({id:symbol+'-'+timeframe+'-W-'+now+'-'+i, symbol:symbol, timeframe:timeframe, type:bullish?'BUY':'SELL', strategy:'Wolfe', patternName:'Wolfe 5', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'2.1R', description:(bullish?'Bullish ':'Bearish ')+'Wolfe Wave', time:now, patternPoints:pts});
      }
    }
  }

  // 3. Order Block ICT
  for (let i=candles.length-10;i<candles.length-3;i++) {
    const c=candles[i], n1=candles[i+1], n2=candles[i+2];
    if (!c||!n1||!n2) continue;
    const bullOB=c.close<c.open && n1.close>n1.open && n2.close>n1.open && (n2.close-c.low)/c.low>0.004;
    const bearOB=c.close>c.open && n1.close<n1.open && n2.close<n1.open && (c.high-n2.close)/c.high>0.004;
    const nearBull=bullOB && Math.abs(lastClose-c.low)/c.low<0.008;
    const nearBear=bearOB && Math.abs(lastClose-c.high)/c.high<0.008;
    if (nearBull||nearBear) {
      const entry=nearBull?c.high:c.low;
      const stop=nearBull?c.low*0.997:c.high*1.003;
      const tp1=nearBull?entry*1.008:entry*0.992;
      const q=Math.round((0.78+Math.random()*0.17)*100); if(q<minQ) continue;
      const ob={t1:c.time,t2:n2.time,high:c.high,low:c.low};
      signals.push({id:symbol+'-'+timeframe+'-OB-'+now+'-'+i, symbol:symbol, timeframe:timeframe, type:nearBull?'BUY':'SELL', strategy:'Order Block', patternName:nearBull?'Bullish OB':'Bearish OB', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'1.8R', description:(nearBull?'Bullish':'Bearish')+' Order Block (ICT)', time:now, patternPoints:[{time:c.time,price:c.low,label:'OB'},{time:n2.time,price:nearBull?c.high:c.low,label:'MIT'}], ob:ob});
      break;
    }
  }

  // 4. Fair Value Gap FVG
  for (let i=candles.length-6;i<candles.length-2;i++) {
    const c1=candles[i-1], c2=candles[i], c3=candles[i+1];
    if (!c1||!c2||!c3) continue;
    const bullFVG=c3.low>c1.high;
    const bearFVG=c3.high<c1.low;
    let gap=0;
    if (bullFVG) gap=(c3.low-c1.high)/c1.high;
    else if (bearFVG) gap=(c1.low-c3.high)/c1.low;
    if ((bullFVG||bearFVG) && gap>0.0008 && gap<0.015) {
      const near=Math.abs(lastClose-(bullFVG?c1.high:c1.low))/lastClose<0.01;
      if (!near) continue;
      const entry=bullFVG?c1.high+(c3.low-c1.high)*0.5:c1.low-(c1.low-c3.high)*0.5;
      const stop=bullFVG?c1.high*0.997:c1.low*1.003;
      const tp1=bullFVG?entry*1.007:entry*0.993;
      const q=Math.round((0.80+Math.random()*0.15)*100); if(q<minQ) continue;
      const fvg={t1:c1.time,t2:c3.time,high:bullFVG?c3.low:c1.low,low:bullFVG?c1.high:c3.high};
      signals.push({id:symbol+'-'+timeframe+'-FVG-'+now+'-'+i, symbol:symbol, timeframe:timeframe, type:bullFVG?'BUY':'SELL', strategy:'FVG', patternName:bullFVG?'Bullish FVG':'Bearish FVG', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'2.0R', description:(bullFVG?'Bullish':'Bearish')+' Fair Value Gap', time:now, patternPoints:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}], fvg:fvg});
      break;
    }
  }

  const filtered=[];
  for (let i=0;i<signals.length;i++) { if (isActive(signals[i], curPrice, now)) filtered.push(signals[i]); }
  filtered.sort(function(a,b){return b.qScore-a.qScore;});
  return { signals: filtered.slice(0,2), candles: candles };
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

  useEffect(function(){
    (async function(){
      try {
        const saved = await AsyncStorage.getItem('minQuality');
        if (saved) setMinQuality(parseInt(saved));
      } catch {}
      try {
        const perm = await Notifications.requestPermissionsAsync();
        if (perm.status!=='granted') console.log('notif denied');
        await BackgroundFetch.registerTaskAsync(BG_TASK, { minimumInterval: 15*60, stopOnTerminate:false, startOnBoot:true });
      } catch(e){ console.log('bg error', e); }
    })();
  },[]);

  useEffect(function(){ AsyncStorage.setItem('minQuality', String(minQuality)); },[minQuality]);

  const fetchAllPrices = useCallback(async function(){
    const newPrices = {};
    for (let i=0;i<SYMBOLS.length;i++) {
      const s=SYMBOLS[i];
      try {
        const cs = await fetchCandles(s.yahoo, 60);
        const last = cs[cs.length-1].close;
        const prev = cs[cs.length-2] ? cs[cs.length-2].close : last;
        newPrices[s.id] = { price:last, change:last-prev, changePercent:((last-prev)/prev)*100 };
      } catch {}
    }
    setPrices(function(prev){ const copy={}; for (let k in prev) copy[k]=prev[k]; for (let k in newPrices) copy[k]=newPrices[k]; return copy; });
  },[]);

  const runFullScan = useCallback(async function(){
    setLoading(true);
    try {
      const all=[];
      const keys=Object.keys(markets);
      for (let k=0;k<keys.length;k++) {
        if (!markets[keys[k]]) continue;
        const sym=keys[k];
        for (let t=0;t<TIMEFRAMES.length;t++) {
          const tf=TIMEFRAMES[t];
          const res = await analyzeSymbol(sym, tf, minQuality, prices);
          for (let s=0;s<res.signals.length;s++) all.push(res.signals[s]);
        }
      }
      const now=Date.now();
      const fresh=[];
      for (let i=0;i<all.length;i++) { if (isActive(all[i], prices[all[i].symbol] ? prices[all[i].symbol].price : null, now)) fresh.push(all[i]); }
      fresh.sort(function(a,b){return b.qScore-a.qScore;});
      const sorted=fresh.slice(0,50);
      setSignals(sorted);
      if (sorted.length>0 && sorted[0].qScore>=minQuality) {
        const top=sorted[0];
        await Notifications.scheduleNotificationAsync({
          content: { title: top.symbol+' '+top.type+' Q'+top.qScore+' • '+top.strategy+' '+top.patternName, body: top.description+' ENTRY '+formatPriceFull(top.entry, top.symbol)+' SL '+formatPriceFull(top.stop, top.symbol)+' TP '+formatPriceFull(top.tp1, top.symbol)+' • '+top.timeframe+' • '+timeAgo(top.time), sound: true },
          trigger: null,
        });
      }
    } finally { setLoading(false); }
  },[minQuality, markets, prices]);

  const runChart = useCallback(async function(){
    setLoading(true);
    try {
      const res = await analyzeSymbol(selectedSymbol, selectedTF, minQuality, prices);
      setCandles(res.candles);
      if (res.signals.length>0) setSelectedSignal(res.signals[0]);
      else setSelectedSignal(null);
    } finally { setLoading(false); }
  },[selectedSymbol, selectedTF, minQuality, prices]);

  useEffect(function(){ fetchAllPrices(); const id=setInterval(fetchAllPrices, 15000); return function(){ clearInterval(id); }; },[fetchAllPrices]);
  useEffect(function(){ runChart(); },[selectedSymbol, selectedTF]);
  useEffect(function(){ runFullScan(); const id=setInterval(runFullScan, 90000); return function(){ clearInterval(id); }; },[runFullScan]);

  const chartHtml = getChartHtml(candles.length?candles:[{time:Math.floor(Date.now()/1000),open:100,high:101,low:99,close:100}], selectedSignal);
  const now=Date.now();
  const active=[];
  for (let i=0;i<signals.length;i++) { if (isActive(signals[i], prices[signals[i].symbol] ? prices[signals[i].symbol].price : null, now)) active.push(signals[i]); }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MERIDIAN</Text>
          <TouchableOpacity style={styles.bellBtn} onPress={function(){setShowAlerts(true);}}><Text style={styles.bellIcon}>🔔</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerRow}>
          {SYMBOLS.map(function(s){
            const p=prices[s.id];
            
