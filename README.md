# Lichess Learning Lab

A local app that reviews your analysed Lichess games, gathers blunders, mistakes, inaccuracies, and large evaluation swings, then creates a private Lichess study with lesson-style annotated chapters.

## Run it

```powershell
npm start
```

Open <http://localhost:5177>.

## Phone install path

The project now includes a web app manifest, so it can be installed like an app from a mobile browser once it is hosted on HTTPS.

For a true Android APK, the app needs to be wrapped with Android tooling such as Capacitor or Bubblewrap after it is hosted. This local workspace does not currently include the Android SDK needed to build an APK directly.

## Hosting

The app can run as a hosted HTTPS Node service. One simple path is Render:

1. Connect the GitHub repo to Render.
2. Create a new Blueprint from `render.yaml`.
3. Deploy the `lichess-learning-lab` web service.
4. Use the deployed HTTPS URL as the phone app's **Backend URL**.

When the frontend and backend are hosted together, leave **Backend URL** blank because the app can call its own `/api` routes.

## Lichess token

Create a token at <https://lichess.org/account/oauth/token/create> with:

- `study:write`

The app sends the token only to your local server, and the local server uses it only for Lichess API calls. It is not saved to disk.

## How it works

1. Connect with your Lichess token.
2. Pick a date range.
3. Click **Auto-create lesson**.
4. Open the generated Lichess study.

The app remembers your token, username, and backend URL on the device after you connect. Use **Edit** to change them or **Forget** to clear them.

The app automatically selects the most important moments from each analysed game. It prioritizes blunders and mistakes, then falls back to the largest evaluation swing when a game has no bigger error. Each selected moment becomes its own short chapter from the critical position, with the better engine line as the main path and the move played in the game as a side variation.

Lichess games must already have cloud analysis for rich blunder and mistake detection. The app also looks for evaluation drops when eval data is available.
