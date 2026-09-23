# How to get APK in 3 steps (No coding errors)

## OPTION 1: Super Easy (Expo Go - No APK needed) - 30 seconds
1. Install **Expo Go** from Play Store
2. In your project folder run: `npx expo start`
3. Scan QR code -> App opens instantly on phone
This is best for testing. Same features, notifications work.

## OPTION 2: Real APK to Install (Recommended) - 10 mins

### Step 1: Install EAS
```bash
npm install -g eas-cli
eas login  # login with free Expo account
```

### Step 2: Configure (one time)
```bash
cd trading-bot-app
eas build:configure
# Say YES to android
```

### Step 3: Build APK (cloud build, free)
```bash
eas build -p android --profile preview
```

What happens:
- Expo uploads your code to cloud
- Builds APK for you (5-10 mins)
- Gives you a link like https://expo.dev/artifacts/xxxx.apk
- Download on phone and tap Install
- Enable "Install from unknown sources" if asked

That's it. You will get a file like `harmonic-wolfe-trader.apk`

### Update app later?
Just run `eas build -p android --profile preview` again. New link, reinstall.

## Troubleshooting
- Build fails? Run `npx expo doctor` to fix
- Want AAB for Play Store? `eas build -p android --profile production`
- APK too big? Normal ~50-60MB for React Native

## Direct Install Link
After build, you can share link to friends: they can install directly without Play Store.
