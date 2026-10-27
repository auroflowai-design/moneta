# Moneta — Code Audit

**Audit date:** 27 October 2026  
**Scope:** whole repo (`D:\moneta`), current source and Android shell  
**Load assumed:** one person, one device, offline IndexedDB, tens of thousands of ledger rows  
**Method:** static review of the entry points, storage, money/import/backup logic, native launch and back handling; `npm test`; headless Chrome mobile checks. Native visuals were not run on hardware (no device or emulator attached).

This replaces the 26 October report. That report described an older build and its claims that the journal model and IndexedDB were missing are no longer true.

## Verdict

The app is now a working offline journal: **Date | Particulars | Debit | Credit** is the stored model, money is integer minor units, IndexedDB has versioned migrations, import/report/backup paths are covered by tests, and the mobile sheet/dialog/top-bar work is in place. The release APK builds, is v2-signed, zipaligned, and is about 3.6 MB.

## Fixed in this pass

1. **Android back was dead after launch (high).** `MainActivity.finishOverlay()` set `finishing = true` when the splash faded and never cleared it, so the back callback returned immediately for the rest of the session. The flag is now cleared when the fade ends, the overlay guard uses the overlay reference, and the back callback no longer requires `appReady` before asking the WebView whether a sheet/dialog is open.
2. **Stale PWA shell (medium).** `sw.js` cached assets under a fixed `moneta-shell-v7` name. A web install could keep serving old JS/CSS after a release. Bumped to `v8` and documented the need to bump on every release. Native builds do not register the service worker.

## Verified

- **Money:** integer minor units, signed balance, 86-row bank fixture and 248-row workbook fixture reconcile exactly (`npm test`).
- **Backup restore:** `DB.replaceAll()` clears and rewrites transactions, settings, imports and meta in one IndexedDB transaction. A failed write cannot leave a half-restored ledger.
- **Dialogs:** exit animation is 180 ms and cleanup runs at 220 ms; a generation token stops an old timeout from clearing a newer dialog.
- **Sheets:** close transition is 280 ms and cleanup runs at 300 ms, so the animation is not cut. Grab-handle drag, short-drag snap-back, scrim/Done close, calendar sheets, and 30 open/close cycles passed in headless Chrome.
- **Long sessions:** no polling intervals or persistent animation frames. Mobile backdrop filters and large shadows are removed; closed sheets are detached from the DOM. The 30-cycle headless run showed no growth.
- **Import escaping:** spreadsheet cell text and file names are escaped in the preview and import history.
- **Native back when JS is unavailable:** if the WebView is missing or the JS guard returns false, the activity finishes as expected.

## Remaining findings (not changed)

1. **Import is not one transaction (medium).** An import may write a matched opening balance first, then transactions, then import history. If a later write fails, the UI says “Nothing was saved” although the opening balance or entries may already be stored. Fixing it needs a single multi-store IndexedDB transaction (`db.js`) and is best done with a storage-failure test.
2. **Backup integrity is FNV-1a 64-bit (low).** It catches accidental corruption, not deliberate tampering. Backups are local files; this is acceptable until backups are shared or synced.
3. **Large ledgers (low).** Every render filters and sorts the full in-memory transaction list on the main thread. Fine for tens of thousands of rows; pagination at the database level would be needed for much larger datasets.
4. **Android edge-to-edge (risk).** `targetSdk` is 36. Android 15+ ignores legacy status/navigation bar colours, and the WebView inset handling could only be confirmed visually on a device. The CSS uses safe-area insets, but this is unverified on hardware.
5. **Native behaviour is untested on hardware.** The splash overlay, back gesture, drawer drag and top bar were checked in the browser/simulated events only. `adb devices` was empty and no emulator is installed.

## Not reviewed exhaustively

Deep UI rendering functions in `app.js` and every visual rule in `styles.css` were not read line by line. The data, money, import, backup, sheet/dialog and native lifecycle paths were.
