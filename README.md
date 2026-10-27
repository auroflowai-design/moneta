# Moneta

Moneta is an offline-first personal ledger built around a canonical four-column
journal: **Date | Particulars | Debit | Credit**. It runs entirely on the device.
There is no account, no server, and no tracking.

## Features

- **Journal ledger** with search, date/date-range, category and amount filters,
  sorting, pagination, and totals calculated from the filtered rows.
- **Accurate money** using integer minor units (decimal-safe), with a signed
  balance of `opening + credits - debits`.
- **Entry management** for adding, editing, duplicating and deleting entries.
- **Five mobile destinations** in one floating black capsule: Home,
  Transactions, Analytics, Goals and Accounts.
- **Reports** with monthly movement, category breakdown and four-column
  CSV/XLSX exports.
- **Category register** limited to 5–7 categories. Settings lets you rename,
  remove and add categories; removing a category reassigns its entries to
  `Other`.
- **Excel import** with header-row selection (including “No header row”),
  optional category mapping, automatic categorisation, and duplicate detection
  against existing journal entries with multiplicity preserved.
- **Complete backups** (format version 3) containing transactions, imports,
  settings, goals, budgets, account metadata and the category register. Older
  version 2 backups remain supported.
- **Separate destructive actions**: delete all entries, or clear all app data.
- **In-app Apple-style controls** for every select, date picker and popover —
  no native Chrome dropdowns.
- **Native-feeling launch** with a dark brand moment that settles into the
  journal, plus app-like text behavior: long-press selection and copy are
  disabled outside editable fields.
- Light and dark themes, PWA install support, and a Capacitor Android shell.

## Run the web app

```powershell
npm install
npm test          # core, import, category, money and backup tests
npm run build     # production files in www/
```

Serve the project root (or `www/`) from localhost and open `index.html`:

```powershell
npm start         # http://127.0.0.1:4173/
```

Entries are stored in IndexedDB. Use **Backup** before clearing browser data
or moving to another device.

## Build the Android APK

The Android project is already configured. Tooling used for the release build
lives on `D:` and nothing needs to be installed on `C:`.

| Tool | Path |
| --- | --- |
| JDK 21 | `D:\tools\jdk21` |
| Android SDK 36 | `D:\Android\sdk` |
| Gradle cache | `D:\gradle-home` |
| Android user home | `D:\Android\.android` |
| Release keystore | local `android/` (never committed) |

`JDK 21` is required by the Android Gradle Plugin. Do not use a newer JDK.

```powershell
$env:JAVA_HOME = 'D:\tools\jdk21'
$env:ANDROID_HOME = 'D:\Android\sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\sdk'
$env:ANDROID_USER_HOME = 'D:\Android\.android'
$env:GRADLE_USER_HOME = 'D:\gradle-home'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

npm run android:sync      # rebuild www/ and copy it into android/
cd android
.\gradlew.bat assembleRelease --no-daemon
```

The signed APK is written to:

```
android\app\build\outputs\apk\release\app-release.apk
```

A ready-to-share copy is placed at `dist\Moneta-release.apk`.

Signing credentials are not part of this repository. To build a signed release,
create your own keystore and a local `android/keystore.properties` with
`storeFile`, `storePassword`, `keyAlias` and `keyPassword`. Keep it safe: future
updates must be signed with the same key.

### Install on a phone

Enable **Install unknown apps** for your file manager, copy the APK to the
phone, and open it. The app needs no network permission and stores all data
locally inside the WebView's IndexedDB.

## Project layout

```
index.html              App shell and all views/dialogs
styles.css              Premium design system, mobile layout, dock
app.js                  Routing, ledger, reports, goals, accounts, settings
js/core.js              Money, categories, import, backup, calculations
js/db.js                IndexedDB schema and migrations
js/controls.js          Custom select, date and sheet controls
js/                         other app modules
scripts/build.mjs       Production www/ build
scripts/test-core.cjs   Automated test suite
scripts/make-brand-assets.ps1  Web/Android icons and splash artwork
android/                Capacitor Android project
www/                    Generated production bundle
```

## Privacy and data

All records live in local storage on the device. Clearing app data or browser
storage removes them permanently; keep a JSON backup. The Android app and a
browser install keep separate data stores. Moneta has no bank connection and
invents no transfers or external accounts.
