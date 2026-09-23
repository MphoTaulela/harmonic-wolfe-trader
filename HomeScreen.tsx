import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Alert, Dimensions } from 'react-native';
import { SYMBOLS, TIMEFRAMES, SymbolId, Timeframe } from '../utils/constants';
import ChartView from '../components/ChartView';
import SignalCard from '../components/SignalCard';
import { scanAll, analyzeSymbol, Signal } from '../services/analyzer';
import { notifySignal } from '../services/notificationService';

export default function HomeScreen() {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolId>('GBPUSD');
  const [selectedTF, setSelectedTF] = useState<Timeframe>('15m');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<Signal | undefined>();
  const [loading, setLoading] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    try {
      const results = await scanAll([...TIMEFRAMES]);
      setSignals(results);
      setLastScan(new Date());
      // Notify high-confidence signals
      for (const s of results.filter(r=>r.confidence>0.75).slice(0,2)) {
        await notifySignal(s);
      }
      if (results.length>0 && !selectedSignal) setSelectedSignal(results[0]);
    } catch (e: any) {
      Alert.alert('Scan error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runSingle = useCallback(async () => {
    setLoading(true);
    try {
      const res = await analyzeSymbol(selectedSymbol, selectedTF);
      if (res.length>0) {
        setSignals(prev => [...res, ...prev.filter(p=>!(p.symbol===selectedSymbol && p.timeframe===selectedTF))].slice(0,50));
        setSelectedSignal(res[0]);
      }
    } finally { setLoading(false); }
  }, [selectedSymbol, selectedTF]);

  useEffect(() => { runScan(); }, []);
  useEffect(() => {
    if (!autoScan) return;
    const id = setInterval(runScan, 5*60*1000);
    return () => clearInterval(id);
  }, [autoScan]);

  const isLandscape = Dimensions.get('window').width > Dimensions.get('window').height;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Harmonic Wolfe Trader</Text>
        <Text style={styles.subtitle}>US30 • US100 • GBPUSD • GOLD • SILVER • OIL • 15m/30m/1h</Text>
      </View>

      <View style={isLandscape?styles.landscape:styles.portrait}>
        <View style={[styles.chartContainer, isLandscape && styles.chartLandscape]}>
          <View style={styles.controls}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {SYMBOLS.map(s => (
                <TouchableOpacity key={s.id} style={[styles.symBtn, selectedSymbol===s.id && styles.symActive]} onPress={()=>setSelectedSymbol(s.id as SymbolId)}>
                  <Text style={[styles.symText, selectedSymbol===s.id && styles.symTextActive]}>{s.id}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.tfRow}>
              {TIMEFRAMES.map(tf => (
                <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfActive]} onPress={()=>setSelectedTF(tf)}>
                  <Text style={styles.tfText}>{tf}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.scanBtn} onPress={runSingle}><Text style={styles.scanText}>{loading?'...':'ANALYZE'}</Text></TouchableOpacity>
            </View>
          </View>
          <ChartView symbol={selectedSymbol} timeframe={selectedTF} signal={selectedSignal?.symbol===selectedSymbol && selectedSignal.timeframe===selectedTF ? selectedSignal : undefined} />
        </View>

        <View style={[styles.signalsContainer, isLandscape && styles.signalsLandscape]}>
          <View style={styles.signalsHeader}>
            <Text style={styles.signalsTitle}>Signals ({signals.length})</Text>
            <View style={styles.autoRow}>
              <Text style={styles.autoText}>Auto 5m</Text>
              <Switch value={autoScan} onValueChange={setAutoScan} trackColor={{false:'#334155',true:'#00c853'}} />
            </View>
            <TouchableOpacity onPress={runScan} style={styles.refreshBtn}><Text style={styles.refreshText}>↻ SCAN ALL</Text></TouchableOpacity>
          </View>
          {lastScan && <Text style={styles.lastScan}>Last: {lastScan.toLocaleTimeString()}</Text>}
          <ScrollView style={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={runScan} />}>
            {signals.length===0 && !loading ? <Text style={styles.empty}>No high-confidence patterns yet. Scanner checks Harmonic (Gartley/Bat/Butterfly/Crab), Wolfe Waves, and S/R breakouts. Try switching timeframe.</Text> : null}
            {signals.map(s => (
              <SignalCard key={s.id} signal={s} onPress={() => { setSelectedSignal(s); setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); }} />
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e17', paddingTop: 48 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#64748b', fontSize: 11, marginTop: 2 },
  portrait: { flex: 1, flexDirection: 'column' },
  landscape: { flex: 1, flexDirection: 'row' },
  chartContainer: { flex: 1.2, padding: 8 },
  chartLandscape: { flex: 1.5 },
  controls: { marginBottom: 8 },
  symBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', marginRight: 6 },
  symActive: { backgroundColor: '#fff' },
  symText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  symTextActive: { color: '#000' },
  tfRow: { flexDirection: 'row', marginTop: 8, alignItems: 'center' },
  tfBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#151c2c', marginRight: 6 },
  tfActive: { backgroundColor: '#334155' },
  tfText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  scanBtn: { marginLeft: 'auto', backgroundColor: '#00c853', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  scanText: { color: '#000', fontWeight: '900', fontSize: 11 },
  signalsContainer: { flex: 0.8, backgroundColor: '#0f172a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12 },
  signalsLandscape: { flex: 0.7, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderLeftWidth: 1, borderColor: '#1e293b' },
  signalsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signalsTitle: { color: '#fff', fontWeight: '800', fontSize: 14 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  autoText: { color: '#64748b', fontSize: 11 },
  refreshBtn: { backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  refreshText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  lastScan: { color: '#475569', fontSize: 10, marginTop: 4 },
  list: { marginTop: 10, flex: 1 },
  empty: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 30, lineHeight: 18 }
});
