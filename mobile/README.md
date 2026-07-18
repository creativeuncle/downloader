# VidSnatch Mobile (Expo / React Native)

A thin mobile client for the VidSnatch backend (`../server.js`) — paste a video URL,
fetch available formats, download and share the file.

## 1. Deploy the backend first

The app calls a hosted backend (`/api/info`, `/api/download`), not `localhost` — a
phone can't reach your dev machine. Deploy `server.js` (with `yt-dlp` installed) to
something like Render, Railway, or a VPS, and note the public URL, e.g.
`https://vidsnatch-api.onrender.com`.

## 2. Set the backend URL

Edit `app.json` → `expo.extra.apiBaseUrl` and replace the placeholder with your
deployed backend URL.

## 3. Install dependencies

```bash
cd mobile
npm install
```

## 4. Run in development (Expo Go)

```bash
npm start
```

Scan the QR code with the Expo Go app on your Android phone.

## 5. Build an APK with EAS Build (no local Android SDK needed)

```bash
npm install -g eas-cli
eas login              # your Expo account
eas build:configure    # first time only, links this project to your Expo account
eas build -p android --profile preview
```

This runs on Expo's cloud build servers and gives you a downloadable `.apk` link
when done — nothing needs to be installed locally.

## 6. Later: iOS

Same project, just run:

```bash
eas build -p ios --profile preview
```

(Requires an Apple Developer account for a real device/App Store build.)
