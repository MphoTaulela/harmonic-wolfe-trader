import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { SymbolId, Timeframe, SYMBOLS, TF_TO_TV } from '../utils/constants';
import { Signal } from '../services/analyzer';

export default function ChartView({ symbol, timeframe, signal }: { symbol: SymbolId; timeframe: Timeframe; signal?: Signal }) {
  const meta = SYMBOLS.find(s=>s.id===symbol)!;
  const tvSymbol = meta.tv;
  const interval = TF_TO_TV[timeframe];

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{margin:0;background:#0a0e17} #tv{height:100vh}</style>
<script src="https://s3.tradingview.com/tv.js"></script>
</head>
<body>
<div id="tv"></div>
<script>
new TradingView.widget({
  autosize: true,
  symbol: "${tvSymbol}",
  interval: "${interval}",
  timezone: "Etc/UTC",
  theme: "dark",
  style: "1",
  locale: "en",
  toolbar_bg: "#0a0e17",
  enable_publishing: false,
  allow_symbol_change: true,
  container_id: "tv",
  studies: ["STD;Support%1Resistance", "STD;Harmonic_Patterns"],
  drawings_access: { type: 'black', tools: [{ name: "Regression Trend" }] }
});
</script>
</body>
</html>
`;

  return (
    <View style={styles.container}>
      <WebView originWhitelist={['*']} source={{ html }} style={styles.webview} javaScriptEnabled domStorageEnabled />
      {signal && (
        <View style={styles.overlay}>
          <View style={[styles.badge, signal.type==='buy'?styles.buy:styles.sell]}>
            <Text style={styles.badgeText}>{signal.type.toUpperCase()} {signal.patternName}</Text>
          </View>
          <View style={styles.levels}>
            <Text style={styles.levelText}>Entry: {signal.entry.toFixed(2)} | SL: {signal.stopLoss.toFixed(2)} | TP1: {signal.takeProfit[0].toFixed(2)}</Text>
            {signal.takeProfit[1] && <Text style={styles.levelText}>TP2: {signal.takeProfit[1].toFixed(2)} | Conf: {(signal.confidence*100).toFixed(0)}%</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e17', borderRadius: 12, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#0a0e17' },
  overlay: { position: 'absolute', top: 8, left: 8, right: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  buy: { backgroundColor: '#00c853' }, sell: { backgroundColor: '#ff1744' },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  levels: { marginTop: 6, backgroundColor: 'rgba(0,0,0,0.7)', padding: 6, borderRadius: 6 },
  levelText: { color: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' }
});
