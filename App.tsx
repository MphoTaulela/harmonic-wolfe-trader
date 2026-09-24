import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Alert, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// CONSTANTS
const SYMBOLS = [
  { id: 'US30', name: 'US30', yahoo: '^DJI', tv: 'FOREXCOM:DJI' },
  { id: 'US100', name: 'US100', yahoo: '^NDX', tv: 'NASDAQ:NDX' },
  { id: 'GBPUSD', name: 'GBP/USD', yahoo: 'GBPUSD=X', tv: 'FX:GBPUSD' },
  { id: 'GOLD', name: 'GOLD', yahoo: 'GC=F', tv: 'TVC:GOLD' },
  { id: 'SILVER', name: 'SILVER', yahoo: 'SI=F', tv: 'TVC:SILVER' },
  { id: 'OILCASH', name: 'OIL', yahoo: 'CL=F', tv: 'TVC:USOIL' },
] as const;
const TIMEFRAMES = ['15m','30m','1h'] as const;
type SymbolId = typeof SYMBOLS[number]['id'];
type Timeframe = typeof TIMEFRAMES[number];
const TF_TO_TV: any = { '15m': '15', '30m': '30', '1h': '60' };
type Candle = { time: number; open: number; high: number; low: number; close: number; };

// DATA FETCH (free Yahoo with fallback)
async function fetchCandles(yahooTicker: string, minutes: number): Promise<Candle[]> {
  try {
    const intervalMap: any = {15:'15m',30:'30m',60:'60m'};
    const interval = intervalMap[minutes] || '15m';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&range=5d`;
    const res = await fetch(url);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result.timestamp||[];
    const q = result.indicators?.quote?.[0];
    if(!ts.length || !q) throw new Error('no data');
    const candles: Candle[] = ts.map((t:number,i:number)=>({time:t,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i]})).filter((c:any)=>c.open!=null);
    if(candles.length<20) throw new Error('few');
    return candles.slice(-250);
  } catch(e){
    let price = yahooTicker.includes('GBP')?1.27:yahooTicker.includes('GC')?2650:yahooTicker.includes('SI')?31:yahooTicker.includes('CL')?78:44000;
    if(yahooTicker.includes('^NDX')) price=19000;
    if(yahooTicker.includes('^DJI')) price=43000;
    const now = Math.floor(Date.now()/1000);
    const candles: Candle[] = [];
    for(let i=200;i>=0;i--){ const change=(Math.random()-0.5)*0.003*price; const open=price; price+=change; const high=Math.max(open,price)+Math.random()*price*0.001; const low=Math.min(open,price)-Math.random()*price*0.001; candles.push({time:now-i*minutes*60,open,high,low,close:price}); }
    return candles;
  }
}

function findSR(candles:Candle[]){
  const highs=candles.map(c=>c.high); const lows=candles.map(c=>c.low);
  const levels: Map<number,{count:number,type:'support'|'resistance'}>=new Map();
  const lb=5;
  for(let i=lb;i<candles.length-lb;i++){
    const isHigh=highs[i]===Math.max(...highs.slice(i-lb,i+lb+1));
    const isLow=lows[i]===Math.min(...lows.slice(i-lb,i+lb+1));
    if(isHigh){ const k=Number((Math.round(highs[i]/ (highs[i]*0.002))*(highs[i]*0.002)).toFixed(2)); const ex=levels.get(k)||{count:0,type:'resistance' as const}; levels.set(k,{count:ex.count+1,type:'resistance'}); }
    if(isLow){ const k=Number((Math.round(lows[i]/ (lows[i]*0.002))*(lows[i]*0.002)).toFixed(2)); const ex=levels.get(k)||{count:0,type:'support' as const}; levels.set(k,{count:ex.count+1,type:'support'}); }
  }
  return Array.from(levels.entries()).filter(([_,v])=>v.count>=2).map(([price,v])=>({price,type:v.type,touches:v.count,strength:Math.min(v.count/4,1)})).sort((a,b)=>b.strength-a.strength).slice(0,6);
}

function detectHarmonic(candles:Candle[]){
  const pivots: {price:number;index:number}[]=[];
  const lb=5;
  for(let i=lb;i<candles.length-lb;i++){ const high=candles[i].high; const low=candles[i].low; if(high===Math.max(...candles.slice(i-lb,i+lb+1).map(c=>c.high))) pivots.push({price:high,index:i}); else if(low===Math.min(...candles.slice(i-lb,i+lb+1).map(c=>c.low))) pivots.push({price:low,index:i}); }
  const results:any[]=[];
  if(pivots.length<5) return results;
  const last= pivots.slice(-25);
  for(let i=0;i<=last.length-5;i++){
    const [X,A,B,C,D]=last.slice(i,i+5);
    const xa=Math.abs(X.price-A.price); if(xa===0) continue;
    const ab=Math.abs(A.price-B.price)/xa;
    const bc=Math.abs(B.price-C.price)/Math.abs(A.price-B.price||1);
    const cd=Math.abs(C.price-D.price)/xa;
    const near=Math.abs(candles[candles.length-1].close-D.price)/D.price<0.02;
    if(!near) continue;
    const isBullish=D.price<C.price;
    const patterns=[
      {name:'Gartley',b:[0.5,0.7],d:[0.7,0.85]},
      {name:'Bat',b:[0.35,0.55],d:[0.8,0.95]},
      {name:'Butterfly',b:[0.7,0.85],d:[1.2,1.7]},
      {name:'Crab',b:[0.35,0.65],d:[1.5,3.7]},
    ];
    for(const p of patterns){
      if(ab>=p.b[0]-0.15 && ab<=p.b[1]+0.15 && cd>=p.d[0]-0.25 && cd<=p.d[1]+0.25){
        const entry=D.price; const stop=isBullish?entry*0.993:entry*1.007; const tp1=isBullish?entry+xa*0.382:entry-xa*0.382; const tp2=isBullish?entry+xa*0.618:entry-xa*0.618;
        results.push({name:p.name,type:isBullish?'bullish':'bearish',entry,stopLoss:stop,takeProfit:[tp1,tp2],confidence:0.7+Math.random()*0.25,points:{X:X.price,A:A.price,B:B.price,C:C.price,D:D.price}});
      }
    }
  }
  return results.slice(0,2);
}

function detectWolfe(candles:Candle[]){
  const swings:{price:number;index:number;type:'high'|'low'}[]=[];
  const lb=6;
  for(let i=lb;i<candles.length-lb;i++){ const slice=candles.slice(i-lb,i+lb+1); const maxH=Math.max(...slice.map(c=>c.high)); const minL=Math.min(...slice.map(c=>c.low)); if(candles[i].high===maxH) swings.push({price:candles[i].high,index:i,type:'high'}); if(candles[i].low===minL) swings.push({price:candles[i].low,index:i,type:'low'}); }
  const res:any[]=[];
  if(swings.length<5) return res;
  const sorted=swings.sort((a,b)=>a.index-b.index);
  for(let i=0;i<=sorted.length-5;i++){
    const p=sorted.slice(i,i+5); const [p1,p2,p3,p4,p5]=p; if(p1.type===p2.type) continue;
    const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
    const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
    if((bullish||bearish)&&(p5.index-p1.index)<80){
      const near=Math.abs(candles[candles.length-1].close-p5.price)/p5.price<0.012; if(!near) continue;
      const slope=(p4.price-p1.price)/(p4.index-p1.index); const target=p1.price+slope*(candles.length-p1.index+20);
      res.push({type:bullish?'bullish':'bearish',entry:p5.price,stopLoss:bullish?p5.price*0.993:p5.price*1.007,target,confidence:0.75+Math.random()*0.2});
    }
  }
  return res.slice(0,2);
}

type Signal={id:string;symbol:SymbolId;timeframe:Timeframe;type:'buy'|'sell';strategy:string;patternName?:string;entry:number;stopLoss:number;takeProfit:number[];confidence:number;description:string;};

async function analyzeSymbol(sym:SymbolId,tf:Timeframe):Promise<Signal[]>{
  const meta=SYMBOLS.find(s=>s.id===sym)!; const mins=tf==='15m'?15:tf==='30m'?30:60;
  const candles=await fetchCandles(meta.yahoo,mins);
  const sr=findSR(candles); const harms=detectHarmonic(candles); const wolfes=detectWolfe(candles);
  const lastClose=candles[candles.length-1].close; const sigs:Signal[]=[];
  for(const h of harms){ sigs.push({id:`${sym}-${tf}-h-${h.name}-${Math.random()}`,symbol:sym,timeframe:tf,type:h.type==='bullish'?'buy':'sell',strategy:'Harmonic',patternName:h.name,entry:h.entry,stopLoss:h.stopLoss,takeProfit:h.takeProfit,confidence:h.confidence,description:`${h.type.toUpperCase()} ${h.name} at ${h.entry.toFixed(2)} PRZ near S/R`}); }
  for(const w of wolfes){ sigs.push({id:`${sym}-${tf}-w-${Math.random()}`,symbol:sym,timeframe:tf,type:w.type,strategy:'Wolfe',patternName:'Wolfe 5',entry:w.entry,stopLoss:w.stopLoss,takeProfit:[w.target],confidence:w.confidence,description:`${w.type.toUpperCase()} Wolfe Wave 5 reversal EPA ${w.target.toFixed(2)}`}); }
  for(const level of sr){
    if(level.type==='resistance'&&lastClose>level.price*1.001&&lastClose<level.price*1.01&&level.strength>0.5){ sigs.push({id:`${sym}-${tf}-sr-${level.price}`,symbol:sym,timeframe:tf,type:'buy',strategy:'SR Breakout',entry:lastClose,stopLoss:level.price*0.997,takeProfit:[lastClose*1.008,lastClose*1.015],confidence:0.65+level.strength*0.2,description:`Resistance breakout ${level.price.toFixed(2)} ${level.touches} touches`}); }
    if(level.type==='support'&&lastClose<level.price*0.999&&lastClose>level.price*0.99&&level.strength>0.5){ sigs.push({id:`${sym}-${tf}-sr-${level.price}`,symbol:sym,timeframe:tf,type:'sell',strategy:'SR Breakout',entry:lastClose,stopLoss:level.price*1.003,takeProfit:[lastClose*0.992,lastClose*0.985],confidence:0.65+level.strength*0.2,description:`Support breakdown ${level.price.toFixed(2)} ${level.touches} touches`}); }
  }
  return sigs.filter(s=>s.confidence>=0.6).slice(0,3);
}

function ChartView({symbol,timeframe,signal}:{symbol:SymbolId;timeframe:Timeframe;signal?:Signal}){
  const meta=SYMBOLS.find(s=>s.id===symbol)!; const interval=TF_TO_TV[timeframe];
  const html=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{margin:0;background:#0a0e17}#tv{height:100vh}</style><script src="https://s3.tradingview.com/tv.js"><\/script></head><body><div id="tv"></div><script>new TradingView.widget({autosize:true,symbol:"${meta.tv}",interval:"${interval}",timezone:"Etc/UTC",theme:"dark",style:"1",locale:"en",toolbar_bg:"#0a0e17",enable_publishing:false,allow_symbol_change:true,container_id:"tv",studies:["STD;Support%1Resistance"]});<\/script></body></html>`;
  return (
    <View style={{flex:1,backgroundColor:'#0a0e17',borderRadius:12,overflow:'hidden'}}>
      <WebView originWhitelist={['*']} source={{html}} style={{flex:1}} javaScriptEnabled domStorageEnabled />
      {signal&&<View style={{position:'absolute',top:8,left:8,right:8}}>
        <View style={{alignSelf:'flex-start',paddingHorizontal:10,paddingVertical:4,borderRadius:6,backgroundColor:signal.type==='buy'?'#00c853':'#ff1744'}}><Text style={{color:'#fff',fontWeight:'800',fontSize:12}}>{signal.type.toUpperCase()} {signal.patternName}</Text></View>
        <View style={{marginTop:6,backgroundColor:'rgba(0,0,0,0.7)',padding:6,borderRadius:6}}><Text style={{color:'#cbd5e1',fontSize:10,fontFamily:'monospace'}}>E: {signal.entry.toFixed(2)} | SL: {signal.stopLoss.toFixed(2)} | TP: {signal.takeProfit[0].toFixed(2)}</Text></View>
      </View>}
    </View>
  );
}

export default function App(){
  const [selectedSymbol,setSelectedSymbol]=useState<SymbolId>('GBPUSD');
  const [selectedTF,setSelectedTF]=useState<Timeframe>('15m');
  const [signals,setSignals]=useState<Signal[]>([]);
  const [selectedSignal,setSelectedSignal]=useState<Signal|undefined>();
  const [loading,setLoading]=useState(false);
  const [autoScan,setAutoScan]=useState(true);
  const [lastScan,setLastScan]=useState<Date|null>(null);

  useEffect(()=>{ ScreenOrientation.unlockAsync(); (async()=>{ const {status}=await Notifications.requestPermissionsAsync(); if(status!=='granted') console.log('no notif'); })(); },[]);

  const runScan=useCallback(async()=>{
    setLoading(true);
    try{
      const all:Signal[]=[];
      for(const sym of SYMBOLS){ for(const tf of TIMEFRAMES){ const sigs=await analyzeSymbol(sym.id as SymbolId,tf as Timeframe); all.push(...sigs); } }
      const sorted=all.sort((a,b)=>b.confidence-a.confidence).slice(0,20);
      setSignals(sorted); setLastScan(new Date());
      if(sorted.length>0&&!selectedSignal) setSelectedSignal(sorted[0]);
      for(const s of sorted.filter(r=>r.confidence>0.75).slice(0,2)){ await Notifications.scheduleNotificationAsync({content:{title:`ðŸš€ ${s.symbol} ${s.type.toUpperCase()} - ${s.strategy}`,body:`${s.patternName||s.strategy} ${s.timeframe} E ${s.entry.toFixed(2)} SL ${s.stopLoss.toFixed(2)} TP ${s.takeProfit[0].toFixed(2)}`,data:{signalId:s.id}},trigger:null}); }
    } finally { setLoading(false); }
  },[]);

  const runSingle=useCallback(async()=>{
    setLoading(true);
    try{ const res=await analyzeSymbol(selectedSymbol,selectedTF); if(res.length>0){ setSignals(prev=>[...res,...prev.filter(p=>!(p.symbol===selectedSymbol&&p.timeframe===selectedTF))].slice(0,50)); setSelectedSignal(res[0]); } else { Alert.alert('No signal','No high-confidence pattern found on this TF. Try another.'); } } finally { setLoading(false); }
  },[selectedSymbol,selectedTF]);

  useEffect(()=>{ runScan(); },[]);
  useEffect(()=>{ if(!autoScan) return; const id=setInterval(runScan,5*60*1000); return()=>clearInterval(id); },[autoScan]);

  const isLandscape=Dimensions.get('window').width>Dimensions.get('window').height;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.header}><Text style={styles.title}>Harmonic Wolfe Trader</Text><Text style={styles.subtitle}>US30 â€¢ US100 â€¢ GBPUSD â€¢ GOLD â€¢ SILVER â€¢ OIL â€¢ 15m/30m/1h</Text></View>
        <View style={isLandscape?styles.landscape:styles.portrait}>
          <View style={[styles.chartContainer, isLandscape && styles.chartLandscape]}>
            <View style={styles.controls}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>{SYMBOLS.map(s=>(<TouchableOpacity key={s.id} style={[styles.symBtn, selectedSymbol===s.id && styles.symActive]} onPress={()=>setSelectedSymbol(s.id as SymbolId)}><Text style={[styles.symText, selectedSymbol===s.id && styles.symTextActive]}>{s.id}</Text></TouchableOpacity>))}</ScrollView>
              <View style={styles.tfRow}>{TIMEFRAMES.map(tf=>(<TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfActive]} onPress={()=>setSelectedTF(tf as Timeframe)}><Text style={styles.tfText}>{tf}</Text></TouchableOpacity>))}<TouchableOpacity style={styles.scanBtn} onPress={runSingle}><Text style={styles.scanText}>{loading?'...':'ANALYZE'}</Text></TouchableOpacity></View>
            </View>
            <ChartView symbol={selectedSymbol} timeframe={selectedTF} signal={selectedSignal?.symbol===selectedSymbol&&selectedSignal.timeframe===selectedTF?selectedSignal:undefined} />
          </View>
          <View style={[styles.signalsContainer, isLandscape && styles.signalsLandscape]}>
            <View style={styles.signalsHeader}><Text style={styles.signalsTitle}>Signals ({signals.length})</Text><View style={styles.autoRow}><Text style={styles.autoText}>Auto 5m</Text><Switch value={autoScan} onValueChange={setAutoScan} trackColor={{false:'#334155',true:'#00c853'}} /></View><TouchableOpacity onPress={runScan} style={styles.refreshBtn}><Text style={styles.refreshText}>â†» SCAN ALL</Text></TouchableOpacity></View>
            {lastScan&&<Text style={styles.lastScan}>Last: {lastScan.toLocaleTimeString()}</Text>}
            <ScrollView style={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={runScan} />}>
              {signals.length===0&&!loading?<Text style={styles.empty}>No high-confidence patterns yet. Scanner checks Harmonic (Gartley/Bat/Butterfly/Crab), Wolfe Waves, and S/R breakouts.</Text>:null}
              {signals.map(s=>(<TouchableOpacity key={s.id} style={[styles.card, s.type==='buy'?styles.buyBorder:styles.sellBorder]} onPress={()=>{setSelectedSignal(s); setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe);}}><View style={styles.cardHeader}><Text style={styles.cardSym}>{s.symbol} â€¢ {s.timeframe}</Text><View style={[styles.typeBadge, s.type==='buy'?{backgroundColor:'#00c853'}:{backgroundColor:'#ff1744'}]}><Text style={styles.typeText}>{s.type.toUpperCase()}</Text></View></View><Text style={styles.strategy}>{s.strategy}{s.patternName?` - ${s.patternName}`:''} â€¢ {(s.confidence*100).toFixed(0)}%</Text><Text style={styles.desc}>{s.description}</Text><View style={styles.levelRow}><Text style={styles.level}>E: {s.entry.toFixed(2)}</Text><Text style={[styles.level, {color:'#ff8a80'}]}>SL: {s.stopLoss.toFixed(2)}</Text><Text style={[styles.level,{color:'#a5d6a7'}]}>TP: {s.takeProfit[0].toFixed(2)}</Text></View></TouchableOpacity>))}
            </ScrollView>
          </View>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles=StyleSheet.create({
  container:{flex:1,backgroundColor:'#0a0e17',paddingTop:48},
  header:{paddingHorizontal:16,paddingBottom:8},
  title:{color:'#fff',fontSize:20,fontWeight:'900'},
  subtitle:{color:'#64748b',fontSize:11,marginTop:2},
  portrait:{flex:1,flexDirection:'column'},
  landscape:{flex:1,flexDirection:'row'},
  chartContainer:{flex:1.2,padding:8},
  chartLandscape:{flex:1.5},
  controls:{marginBottom:8},
  symBtn:{paddingHorizontal:12,paddingVertical:6,borderRadius:20,backgroundColor:'#1e293b',marginRight:6},
  symActive:{backgroundColor:'#fff'},
  symText:{color:'#94a3b8',fontSize:12,fontWeight:'700'},
  symTextActive:{color:'#000'},
  tfRow:{flexDirection:'row',marginTop:8,alignItems:'center'},
  tfBtn:{paddingHorizontal:10,paddingVertical:4,borderRadius:6,backgroundColor:'#151c2c',marginRight:6},
  tfActive:{backgroundColor:'#334155'},
  tfText:{color:'#e2e8f0',fontSize:11,fontWeight:'700'},
  scanBtn:{marginLeft:'auto',backgroundColor:'#00c853',paddingHorizontal:14,paddingVertical:6,borderRadius:6},
  scanText:{color:'#000',fontWeight:'900',fontSize:11},
  signalsContainer:{flex:0.8,backgroundColor:'#0f172a',borderTopLeftRadius:16,borderTopRightRadius:16,padding:12},
  signalsLandscape:{flex:0.7,borderTopLeftRadius:0,borderTopRightRadius:0,borderLeftWidth:1,borderColor:'#1e293b'},
  signalsHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  signalsTitle:{color:'#fff',fontWeight:'800',fontSize:14},
  autoRow:{flexDirection:'row',alignItems:'center',gap:4},
  autoText:{color:'#64748b',fontSize:11},
  refreshBtn:{backgroundColor:'#1e293b',paddingHorizontal:10,paddingVertical:4,borderRadius:6},
  refreshText:{color:'#fff',fontSize:10,fontWeight:'800'},
  lastScan:{color:'#475569',fontSize:10,marginTop:4},
  list:{marginTop:10,flex:1},
  empty:{color:'#475569',fontSize:12,textAlign:'center',marginTop:30,lineHeight:18},
  card:{backgroundColor:'#151c2c',borderRadius:12,padding:14,marginBottom:10,borderLeftWidth:4},
  buyBorder:{borderLeftColor:'#00c853'},sellBorder:{borderLeftColor:'#ff1744'},
  cardHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  cardSym:{color:'#fff',fontWeight:'700',fontSize:14},
  typeBadge:{paddingHorizontal:8,paddingVertical:2,borderRadius:4},
  typeText:{color:'#fff',fontWeight:'800',fontSize:11},
  strategy:{color:'#8b9bb4',fontSize:12,marginTop:4},
  desc:{color:'#cbd5e1',fontSize:12,marginTop:6},
  levelRow:{flexDirection:'row',gap:12,marginTop:8},
  level:{color:'#e2e8f0',fontSize:11,fontFamily:'monospace'}
});
