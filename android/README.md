# LanTv Android App

A small native Android wrapper around the LanTv web player. It's a `WebView` pointed at your
LanTv server, so it gets the exact same channel bar, shuffle-loop playback, and now-playing
overlay as the browser version — packaged as a real app with its own icon, so it sits on the
home screen / launcher of a phone, tablet, or Android TV box like any other app.

## What it does

- On first launch, asks for your LanTv server address (defaults to a placeholder you should
  replace with what your server printed on startup — see the main [README](../README.md)).
- Remembers the address (`SharedPreferences`) so you only enter it once.
- A small gear icon (top-right) reopens that dialog any time you need to change the address
  — e.g. if the Mac's IP changed and you're not using the `.local` link.
- Keeps the screen from sleeping while open (`FLAG_KEEP_SCREEN_ON`) and locks to landscape,
  since this is meant to be watched like a TV.
- Allows cleartext HTTP (`usesCleartextTraffic`), since LanTv serves plain HTTP over your LAN
  with no TLS certificate involved.

## Get the app without building it

Download the signed APK from the [Releases page](../../releases) of this repo and install it
directly — see the **Android App** section in the main README for step-by-step install
instructions (enabling "install unknown apps", etc).

## Building it yourself

Requirements: JDK 17, Android SDK (`compileSdk 34`, `minSdk 23`).

```bash
cd android
./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
```

To install straight onto a connected device/emulator via adb:

```bash
./gradlew installDebug
```

### Building a signed release APK

The committed project does **not** include a signing key (kept out of git on purpose). To
build your own signed release:

```bash
keytool -genkeypair -v -keystore keystore/lantv-release.keystore -alias lantv \
  -keyalg RSA -keysize 2048 -validity 10000

cat > keystore.properties <<EOF
storeFile=keystore/lantv-release.keystore
storePassword=<your-store-password>
keyAlias=lantv
keyPassword=<your-key-password>
EOF

./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk
```

If `keystore.properties` isn't present, the release build type just falls back to unsigned
output.

## Project layout

```
android/
├── app/
│   ├── build.gradle.kts              # app module config, signing setup
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/lantv/app/MainActivity.kt   # WebView + server-address dialog
│       └── res/                      # launcher icons (generated from ../image.png), layout, theme
├── docs/                             # source logo + a 512px reference icon (not used by the build)
├── build.gradle.kts                  # root Gradle config (AGP + Kotlin plugin versions)
├── settings.gradle.kts
└── gradlew / gradlew.bat             # Gradle wrapper — no local Gradle install needed
```

## Why a WebView wrapper instead of a fully native player?

The browser player (hls.js + a plain `<video>` tag) already handles shuffle playback, channel
switching, HDR-tonemapped streams, and reconnect/retry logic. A WebView wrapper reuses all of
that exactly as-is — one codebase, one place to fix bugs or add channels — while still giving
you an installable app with its own icon instead of having to open a browser and type a URL.
Android's WebView is Chromium-based, so HLS-via-MSE (what hls.js relies on) works the same way
it does in Chrome on desktop.
