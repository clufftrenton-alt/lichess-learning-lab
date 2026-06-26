# Android Build Notes

The project now has a Capacitor Android wrapper in `android/`.

## Current blocker

Gradle cannot build an APK until Java is available:

```text
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
```

Open Android Studio once and finish its setup wizard. Then install:

- Android SDK
- Android SDK Platform Tools
- Android SDK Build Tools
- Android Studio bundled JDK or another JDK 17+

After that, restart the terminal and run:

```powershell
cd android
.\gradlew.bat assembleDebug
```

The debug APK should appear under:

```text
android/app/build/outputs/apk/debug/
```

## Backend URL

The Android app wraps the web interface. To create Lichess studies from a phone, the app needs a reachable backend URL.

Good options:

- Host the Node server on HTTPS and paste that URL into the app's **Backend URL** field.
- For local testing on the same Wi-Fi, run the server on your computer and use `http://YOUR-COMPUTER-IP:5177`.

The desktop browser version should leave **Backend URL** blank.

After the first successful connection, the Android app remembers the backend URL, Lichess token, and username on that device. Use **Edit** to change the connection or **Forget** to clear saved settings.
