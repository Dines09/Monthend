# Month End — Ship Electrical Records PWA

Mobile-first offline PWA for M.T. SEAWAYS MIRAGE. Enter daily / weekly / monthly
electrical records on the phone during rounds, then export the exact month-end
Excel files (same names, same layout as the originals).

## What it does
- **9 record files** covered: ICCP/MGPS daily, Battery Log (weekly Sat), Fire
  Detector test (weekly Sat, quarterly file), Motor Temp, Motor Vibration, Busbar
  Temp, Freon, Condition Monitoring, Overhaul & Megger register.
- **Seeded** with Jan–June 2026 history from the original files, so yearly/cumulative
  files export with the full year filled in.
- **Export** → one ZIP (`Monthend <MONTH> <YEAR>.zip`) or individual files.
  Reporting month auto-detected (last day of month, or 1st–14th → previous month);
  override on the Export screen.
- **Offline**: after first load it works with no internet (installable to Home Screen).

## Run locally
```
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/ (also writes offline sw.js)
npm run preview  # serve the production build
```

## Deploy (free, one time)

### Netlify (drag & drop — easiest)
1. `npm run build`
2. Go to https://app.netlify.com/drop and drag the **`dist`** folder onto the page.
3. You get a URL like `https://xxxx.netlify.app`. Open it on the phone.

### Netlify (connected to a repo, auto-deploys)
Push this `app/` folder to GitHub, "Add new site" → pick the repo. `netlify.toml`
already sets build = `npm run build`, publish = `dist`.

### GitHub Pages
`npm run build`, then publish the `dist/` folder to a `gh-pages` branch (base is
already `./` so it works from a subpath).

## Install on the phone
1. Open the deployed URL in Chrome (Android) or Safari (iPhone).
2. Chrome: menu → **Add to Home screen**. Safari: Share → **Add to Home Screen**.
3. Launch from the icon — runs full-screen, offline.

## Data & backup
- All data lives in the browser (IndexedDB) on the phone. Nothing goes to a server.
- **Settings → Backup** downloads a JSON of everything; **Restore** re-imports it.
  Use this before reinstalling or to move to another device.
- **Settings → Reset** wipes entries and re-seeds from the original June data.

## Notes
- The 3 originally-`.xls` files export as `.xlsx` (identical layout; Excel opens them
  the same). All other files keep their original format and styling.
- Condition Monitoring's Diff/Normalised columns stay as Excel formulas — only raw
  temperatures are written, Excel recomputes the rest.
- Export was verified cell-by-cell against the June originals (≈4,800 data cells, 0
  differences apart from one garbled source value).
