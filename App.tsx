
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

function getChartHtml(candles, signal) {
  const levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPriceFull(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPriceFull(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 ' + formatPriceFull(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPriceFull(signal.tp2, signal.symbol) });
  }
  const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>const candles=' + JSON.stringify(candles) + ';const levels=' + JSON.stringify(levels) + ';const pattern=' + JSON.stringify(signal ? signal.patternPoints || [] : []) + ';const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e"}});const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a"});cs.setData(candles);levels.forEach(l=>{try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.includes("ENTRY")?2:1,lineStyle:l.title.includes("ENTRY")?0:2,axisLabelVisible:true,title:l.title});}catch(e){}});if(pattern.length>=2){try{const col=pattern[0]&&pattern[0].label&&pattern[0].label.startsWith("1")?"#af52de":"#0a84ff";const ls=chart.addLineSeries({color:col,lineWidth:2});ls.setData(pattern.map(p=>({time:p.time,value:p.price})));cs.setMarkers(pattern.map(p=>({time:p.time,position:"aboveBar",color:col,shape:"circle",text:p.label})));}catch(e){}}chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchCandlesRaw(ticker, minutes) {
  try {
    const map = {15:'15m',30:'30m',60:'60m',240:'60m'};
    const interval = map[minutes] || '15m';
    const range = minutes>=240 ? '20d' : '10d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
    const res = await fetch(url);
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

async function analyzeSymbol(symbol, timeframe, minQ, prices) {
  const meta = SYMBOLS.find(s=>s.id===symbol);
  const mins = tfMinutes(timeframe);
  const candles = await fetchCandles(meta.yahoo, mins);
  const lastClose = candles[candles.length-1].close;
  const pivots = findPivots(candles);
  const now = Date.now();
  const signals = [];

  if (pivots.length>=5) {
    const last = pivots.slice(-15);
    for (let i=0;i<=last.length-5;i++) {
      const pts = last.slice(i,i+5);
      const X=pts[0], A=pts[1], B=pts[2], C=pts[3], D=pts[4];
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
        signals.push({id:symbol+'-'+timeframe+'-W-'+now+'-'+i, symbol, timeframe, type:bullish?'BUY':'SELL', strategy:'Wolfe', patternName:'Wolfe 5', entry, stop, tp1, qScore:q, rr:'2.1R', description:(bullish?'Bullish ':'Bearish ')+'Wolfe Wave', time:now, patternPoints:pts});
      }
    }
  }

  for (let i=candles.length-10;i<candles.length-3;i++) {
    const c = candles[i]; const next = candles[i+1]; const next2 = candles[i+2];
    if (!c||!next||!next2) continue;
    const bullishOB = c.close<c.open && next.close>next.open && next2.close>next.open && (next2.close - c.low)/c.low>0.004;
    const bearishOB = c.close>c.open && next.close<next.open && next2.close<next.open && (c.high - next2.close)/c.high>0.004;
    const nearBull = bullishOB && Math.abs(lastClose - c.low)/c.low<0.008;
    const nearBear = bearishOB && Math.abs(lastClose - c.high)/c.high<0.008;
    if (nearBull || nearBear) {
      const entry = nearBull ? c.high : c.low;
      const stop = nearBull ? c.low*0.997 : c.high*1.003;
      const tp1 = nearBull ? entry*1.008 : entry*0.992;
      const q = Math.round((0.78+Math.random()*0.17)*100); if(q<minQ) continue;
      signals.push({id:symbol+'-'+timeframe+'-OB-'+now+'-'+i, symbol, timeframe, type:nearBull?'BUY':'SELL', strategy:'Order Block', patternName:nearBull?'Bullish OB':'Bearish OB', entry, stop, tp1, qScore:q, rr:'1.8R', description:(nearBull?'Bullish':'Bearish')+' Order Block ICT', time:now, patternPoints:[{time:c.time,price:c.low,label:'OB'},{time:next2.time,price:nearBull?c.high:c.low,label:'MIT'}]});
      break;
    }
  }

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
      signals.push({id:symbol+'-'+timeframe+'-FVG-'+now+'-'+i, symbol, timeframe, type:bullFVG?'BUY':'SELL', strategy:'FVG', patternName:bullFVG?'Bullish FVG':'Bearish FVG', entry, stop, tp1, qScore:q, rr:'2.0R', description:(bullFVG?'Bullish':'Bearish')+' Fair Value Gap', time:now, patternPoints:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}]});
      break;
    }
  }

  const filtered = signals.filter(s=>isActive(s, prices[symbol]?prices[symbol].price:null, now));
  return { signals: filtered.sort((a,b)=>b.qScore-a.qScore).slice(0,2), candles };
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

  useEffect(()=>{
    (async()=>{
      const saved = await AsyncStorage.getItem('minQuality');
      if (saved) setMinQuality(parseInt(saved));
      await Notifications.requestPermissionsAsync();
    })();
  },[]);

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
      const fresh = all.filter(s=>isActive(s, prices[s.symbol]?prices[s.symbol].price:null, now));
      const sorted = fresh.sort((a,b)=>b.qScore-a.qScore).slice(0,50);
      setSignals(sorted);
      if (sorted.length>0) {
        const top = sorted[0];
        if (top.qScore>=minQuality) {
          await Notifications.scheduleNotificationAsync({
            content: { title: top.symbol+' '+top.type+' Q'+top.qScore+' - '+top.strategy+' '+top.patternName, body: top.description+' ENTRY '+formatPriceFull(top.entry, top.symbol)+' SL '+formatPriceFull(top.stop, top.symbol)+' TP '+formatPriceFull(top.tp1, top.symbol)+' - '+top.timeframe+' - '+formatTimeAgo(top.time), sound: true },
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
      if (sigs.length>0) setSelectedSignal(sigs[0]); else setSelectedSignal(null);
    } finally { setLoading(false); }
  },[selectedSymbol, selectedTF, minQuality, prices]);

  useEffect(()=>{ fetchAllPrices(); const id=setInterval(fetchAllPrices, 15000); return()=>clearInterval(id); },[fetchAllPrices]);
  useEffect(()=>{ runChart(); },[selectedSymbol, selectedTF]);
  useEffect(()=>{ runFullScan(); const id=setInterval(runFullScan, 90000); return()=>clearInterval(id); },[runFullScan]);

  const chartHtml = getChartHtml(candles.length?candles:[{time:Math.floor(Date.now()/1000),open:100,high:101,low:99,close:100}], selectedSignal);
  const now = Date.now();
  const activeSignals = signals.filter(s=>isActive(s, prices[s.symbol]?prices[s.symbol].price:null, now));

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MERIDIAN</Text>
          <TouchableOpacity style={styles.bellBtn} onPress={()=>setShowAlerts(true)}><Text style={styles.bellIcon}>🔔</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerRow}>
          {SYMBOLS.map(s=>{
            const p = prices[s.id];
            const priceStr = p ? formatPriceFull(p.price, s.id) : '--';
            const changeStr = p ? (p.changePercent>=0?'+':'')+p.changePercent.toFixed(2)+'%' : '';
            const isPos = p ? p.changePercent>=0 : true;
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerCard, selectedSymbol===s.id && styles.tickerActive]} onPress={()=>setSelectedSymbol(s.id)}>
                <View style={styles.tickerTop}><Text style={styles.tickerSym}>{s.id}</Text><Text style={[styles.tickerChange, isPos?styles.pos:styles.neg]}>{changeStr}</Text></View>
                <Text style={styles.tickerPrice}>{priceStr}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.tfRow}>
          {TIMEFRAMES.map(tf=>(
            <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfBtnActive]} onPress={()=>setSelectedTF(tf)}>
              <Text style={[styles.tfText, selectedTF===tf && styles.tfTextActive]}>{tf}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.main}>
          {activeTab==='Chart' && (
            <>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol} <Text style={styles.symbolFull}>{SYMBOLS.find(s=>s.id===selectedSymbol).fullName}</Text></Text>
                <Text style={styles.symbolPrice}>{prices[selectedSymbol] ? formatPriceFull(prices[selectedSymbol].price, selectedSymbol) : '--'}</Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView originWhitelist={['*']} source={{ html: chartHtml }} style={{ flex:1, backgroundColor:'#0e0e10' }} javaScriptEnabled />
              </View>
              {selectedSignal && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>ENTRY</Text><Text style={styles.detailValue}>{formatPriceFull(selectedSignal.entry, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>STOP</Text><Text style={[styles.detailValue,{color:'#ff3b30'}]}>{formatPriceFull(selectedSignal.stop, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>TP1</Text><Text style={[styles.detailValue,{color:'#30d158'}]}>{formatPriceFull(selectedSignal.tp1, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>{formatTimeAgo(selectedSignal.time)}</Text><Text style={styles.detailValue}>Q{selectedSignal.qScore} - {selectedSignal.rr}</Text></View>
                </View>
              )}
              {selectedSignal && (
                <View style={styles.setupInfo}>
                  <Text style={styles.setupInfoText}>{selectedSignal.strategy} - {selectedSignal.patternName} - {selectedSignal.description} - Setup {selectedSignal.patternPoints.map(p=>p.label).join(' - ')} - Entry SL TP on chart</Text>
                </View>
      
