# OfflineChess

A Windows desktop version of [WintrChess](https://github.com/WintrCat/wintrchess) game analysis with no ads, no analytics and no account system. Everything runs on your own computer: Stockfish 19 evaluates the positions in the app and the move classifications (brilliant, great, blunder and so on) are computed locally.

The only network use is looking up games by username on Chess.com (and Lichess). Every other outgoing request is blocked by the app.

## Download

Go to the **Releases** page on the right of this repository and download the newest build:

- `Full_suite.zip` - unzip, run the installer. Everything is included, it adds a desktop shortcut and a Start menu entry.
- `Full_portable.zip` - unzip, run the exe. No install, everything is included, and its data stays in a folder next to the exe.
- `Lite_suite.zip` and `Lite_portable.zip` - the same, about half the size. They ship Stockfish 19 Lite. If you pick the full Stockfish 19 in the engine settings, the app downloads it once (with a progress bar) and keeps it.

Nothing else needs to be installed first.

Windows SmartScreen will warn about an unknown publisher because the app is not code signed. Click "More info", then "Run anyway".

## What changed from WintrChess

- Ad scripts, Google Analytics, consent popups and the Ko-fi button removed
- Server, database, captcha, accounts, news, archive and the internal dashboard removed
- Game report generation moved into the client
- Lichess cloud evaluations switched off so analysis is fully local
- Stockfish upgraded from 17 to 19
- Electron wrapper serving the app from a loopback-only server, with a network allowlist

## Changing the icon

Replace `desktop/build/icon.png` (1024x1024, transparent background) and `desktop/build/icon.ico` (multi-size, 256x256 down to 16x16), then rebuild.

## Licence

GPL-3.0, same as WintrChess. Stockfish is GPL-3.0 as well.
