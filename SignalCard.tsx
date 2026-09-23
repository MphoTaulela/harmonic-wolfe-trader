import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Signal } from '../services/analyzer';

export default function SignalCard({ signal, onPress }: { signal: Signal; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.card, signal.type==='buy'?styles.buyBorder:styles.sellBorder]} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.symbol}>{signal.symbol} • {signal.timeframe}</Text>
        <View style={[styles.typeBadge, signal.type==='buy'?styles.buy:styles.sell]}>
          <Text style={styles.typeText}>{signal.type.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.strategy}>{signal.strategy}{signal.patternName?` - ${signal.patternName}`:''} • {(signal.confidence*100).toFixed(0)}%</Text>
      <Text style={styles.desc}>{signal.description}</Text>
      <View style={styles.levelRow}>
        <Text style={styles.level}>E: {signal.entry.toFixed(2)}</Text>
        <Text style={[styles.level, styles.sl]}>SL: {signal.stopLoss.toFixed(2)}</Text>
        <Text style={[styles.level, styles.tp]}>TP: {signal.takeProfit[0].toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#151c2c', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 },
  buyBorder: { borderLeftColor: '#00c853' }, sellBorder: { borderLeftColor: '#ff1744' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symbol: { color: '#fff', fontWeight: '700', fontSize: 14 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  buy: { backgroundColor: '#00c853' }, sell: { backgroundColor: '#ff1744' },
  typeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  strategy: { color: '#8b9bb4', fontSize: 12, marginTop: 4 },
  desc: { color: '#cbd5e1', fontSize: 12, marginTop: 6 },
  levelRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  level: { color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' },
  sl: { color: '#ff8a80' }, tp: { color: '#a5d6a7' }
});
