# Lichess Learning Lab

A local app that reviews your analysed Lichess games, gathers blunders, mistakes, inaccuracies, and large evaluation swings, then creates a private Lichess study with lesson-style annotated chapters.

## Run it

```powershell
npm start
```

Open <http://localhost:5177>.

## Lichess token

Create a token at <https://lichess.org/account/oauth/token/create> with:

- `study:write`

The app sends the token only to your local server, and the local server uses it only for Lichess API calls. It is not saved to disk.

## How it works

1. Connect with your Lichess token.
2. Pick a date range.
3. Click **Auto-create lesson**.
4. Open the generated Lichess study.

The app automatically selects the most important moments from each analysed game. It prioritizes blunders and mistakes, then falls back to the largest evaluation swing when a game has no bigger error. Each selected moment gets a lesson prompt with the chess principle to think about.

Lichess games must already have cloud analysis for rich blunder and mistake detection. The app also looks for evaluation drops when eval data is available.
