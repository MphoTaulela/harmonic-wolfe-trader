# Harmonic Wolfe Trader - Mobile Trading Bot

Professional mobile app (Expo React Native) that scans **US30, US100, GBPUSD, GOLD, SILVER, OILCASH** on **15m, 30m, 1h** using:

- **Harmonic Patterns**: Gartley, Bat, Butterfly, Crab with Fibonacci validation
- **Wolfe Waves**: 1-2-3-4-5 reversal detection + EPA target projection
- **Support & Resistance**: Swing high/low clustering with strength scoring

### Features
- Free real-time charts via TradingView widget (no API key needed) with entry/SL/TP overlay
- Signal scanner with confidence scoring
- Push notifications for high-confidence (>75%) setups
- Portrait + Landscape (orientation unlocked)
- Works offline with synthetic fallback data
- No errors: fully typed, try/catch on all network calls

### Market Data
Uses Yahoo Finance public chart API `query1.finance.yahoo.com/v8/finance/chart` (free, no key). Falls back to synthetic generator if offline. Charts are TradingView free widgets (freely accessible real-time).

### Install & Run
```bash
npm install
npx expo start
# Scan QR with Expo Go app
```

### Build APK
```bash
eas build -p android
```

### GitHub Push
```bash
git init
git add .
git commit -m "Initial: harmonic wolfe trader"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/harmonic-wolfe-trader.git
git push -u origin main
```

### How Signals Work
1. `fetchCandles()` gets last 300 candles for symbol/TF
2. `findSRLevels()` finds swing points, clusters levels
3. `detectHarmonicPatterns()` uses zigzag pivots + fib ratios (0.618, 0.786, 0.886, 1.27, 1.618)
4. `detectWolfeWaves()` finds 5-point alternating swings
5. Entry = Point D (harmonic) or Point 5 (Wolfe), SL = 0.5-0.7%, TP = XA extensions / EPA line
6. Only signals with confidence >=60% shown, >=75% trigger notification

### Structure
```
src/
  utils/constants.ts
  services/marketData.ts
  services/patterns/harmonic.ts
  services/patterns/wolfe.ts
  services/patterns/supportResistance.ts
  services/analyzer.ts
  services/notificationService.ts
  components/ChartView.tsx
  components/SignalCard.tsx
  screens/HomeScreen.tsx
```

License MIT.


## Build APK (Easiest)
See APK_GUIDE.md
