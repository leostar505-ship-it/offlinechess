# OfflineChess

A Windows desktop version of [WintrChess](https://github.com/WintrCat/wintrchess) game analysis with no ads, no analytics and no account system. Everything runs on your own computer: Stockfish 17 evaluates the positions in the app and the move classifications (brilliant, great, blunder and so on) are computed locally.

The only network use is looking up games by username on Chess.com (and Lichess). Every other outgoing request is blocked by the app.

## Download

Open the **Actions** tab, pick the latest successful "Build Windows app" run and download:

- `OfflineChess-Setup` - installer, adds a desktop shortcut and a Start menu entry
- `OfflineChess-Portable` - single .exe, nothing to install

Windows SmartScreen will warn about an unknown publisher because the app is not code signed. Choose "More info", then "Run anyway".

## What changed from WintrChess

- Ad scripts, Google Analytics, consent popups and the Ko-fi button removed
- Server, database, captcha, accounts, news, archive and the internal dashboard removed
- Game report generation moved into the client
- Lichess cloud evaluations switched off so analysis is fully local
- Electron wrapper serving the app from a loopback-only server, with a network allowlist

## Build it yourself

Requires Node.js 22 or later.

```sh
npm install
npm run build
npm run desktop:dev
```

Windows installers are built by the GitHub Actions workflow, or locally on Windows with `npm run desktop:dist` (output in `desktop/release`).

## Changing the icon

Replace `desktop/build/icon.png` (1024x1024, transparent background) and `desktop/build/icon.ico` (multi-size, 256x256 down to 16x16), then rebuild.

## Licence

GPL-3.0, same as WintrChess. Stockfish is GPL-3.0 as well.
