# Wisconsin Fuel

Wisconsin Fuel maps regular gas prices and regional cost estimates for all 72 Wisconsin counties. It runs as a static site in its own repository.

Open **preview.html** directly in a browser for the self-contained snapshot, or run `npm start` and visit http://localhost:8091. The latter serves the source version; http://localhost:8091/preview.html serves the standalone version. The app itself requires no npm dependencies. Online street tiles are optional; turn off **Street map** to use the embedded county geometry alone.

Select a county on the map or in the county list to see its price history. The graph shows the lowest collected regular-gas quote and the estimated minimum on dates with saved observations. Missing dates remain gaps. The live map has current-price, estimated-minimum and price-headroom layers, plus source filters, station details, membership filtering, configurable delivery costs, fill-up savings scenarios and CSV export.

At street zoom, **Available sources** shows dated station prices alongside mapped fuel stops. White markers identify stations with no price shown. Close-together stations use small clickable markers so prices and logos have room. The location catalog comes from a Wisconsin OpenStreetMap extract. Its data is © OpenStreetMap contributors and available under the [Open Database License](https://www.openstreetmap.org/copyright). The dated price snapshots are separate files with their own sources.

## GitHub Pages

The Pages workflow publishes `site/` on pushes to `main`. The refresh workflow is scheduled daily for **10:40 a.m. America/Chicago**, including daylight saving time. It can also be run from the Actions tab. GitHub may queue scheduled runs when Actions is busy.

The daily workflow runs Dane Fuel’s paginated GasBuddy search in Chrome across rotating Wisconsin cities and counties. It also checks the public Dane Fuel export, direct Kwik Trip quotes, dated FuelRadarDash snapshots for Kwik Trip and Costco, timestamped GasWiser city listings, and the AXXIS terminal report. Data from unavailable sources keeps its original timestamps. Costco and other membership quotes appear when **Member prices** is selected. The workflow records county history, validates the site, commits changed data, and deploys that commit to Pages.

For the initial deployment, run these commands from the project folder with GitHub CLI authenticated. If using an extracted source ZIP, first initialize the Git repository and commit the files with `git init -b main`, `git add .`, and `git commit -m "Build the Wisconsin fuel map"`. Set `origin` to the GitHub repository if it has not been added yet.

```sh
git remote add origin https://github.com/lisowskibraeden/wisconsin-fuel.git
git push -u origin main
gh api -X POST 'repos/{owner}/{repo}/pages' -f build_type=workflow --jq .html_url
gh workflow run pages.yml --ref main
```

To configure Pages in the browser, select **Settings → Pages → Build and deployment → Source → GitHub Actions**, then run the Pages workflow from the Actions tab. The Pages settings and successful deployment both show the site URL. If GitHub CLI requests the `workflow` scope for the first push, run `gh auth refresh -h github.com -s workflow` and `gh auth setup-git`, then push `main`.

## Starting snapshot and sources

The Nov. 21 statewide update includes 504 published Kwik Trip-family regular prices from FuelRadarDash in 66 counties. Station addresses were matched against the official Kwik Trip directory and the previously verified location data. The prices use the publisher's 7:21 a.m. Central snapshot time. Individual report times are unavailable. Fresh direct quotes and GasBuddy reports take priority when there is an exact station address match. Bayfield, Burnett, Florence, Forest, Iron and Menominee lack a verified current station quote in this update.

On November 21, 2026, the preview imported newer Dane County GasBuddy reports from Dane Fuel, preserving their original timestamps. The latest confirmed AXXIS report is dated November 20. The older statewide pump-price samples remain subject to the 24-hour freshness window.

The initial snapshot was collected November 17, 2026, Central time. GasBuddy's 72 county pages were read; 483 listings included both a visible price and a report age, across 54 counties. At the snapshot verification time, 414 of those reports were under 24 hours old, across 53 counties. The direct Kwik Trip fallback contains 426 regular-87 quotes across 60 counties. Combining eligible reports and excluding membership/cash quotes by default gave coverage in 68 counties. These counts decline as reports expire. This is a sample, not an inventory of every Wisconsin station.

GasBuddy relative-age labels are converted into approximate report timestamps at the time each page was read. County assignments follow the county listing unless an exact public address match verifies the county. Station coordinates are included only where obtained from an exact address match; unlocated reports still contribute to county comparisons but do not receive an invented station pin. Direct-source quotes have retrieval times; price-change times are unknown. Exact normalized street/city duplicates prefer GasBuddy when its report is fresh, although different street abbreviations can still leave duplicates.

The estimated minimum reuses Dane Fuel's automatic terminal-cost scenario: `(wholesale + $0.513 taxes/fees + delivery) × 1.0918`, rounded upward to $0.001. It uses the nearest *quoted market center* as a county-level geographic proxy, not a verified station-to-terminal assignment. Six southeast counties use 87RE10 reformulated regular. Other counties use ULC10. Retailer invoice costs, eligible prior-day prices and statutory exceptions are not known. This is not a verified legal minimum or a prediction that the price will fall in two days.

“Room to fall” means the lowest fresh eligible collected quote exceeds the estimate by at least 15¢. At 8¢ or less the app says “Near estimated floor.” Intermediate gaps say “Keep an eye on prices.” Savings are hypothetical if the price reaches the estimate. Reports expire after 24 hours and terminal estimates are flagged after 96 hours.

## Updating and checks

- `npm run refresh`: refresh AXXIS, Kwik Trip, the public Dane Fuel export and FuelRadarDash. Add `-- --gasbuddy-statewide-search --headed` to run the paginated search using Chrome. On a headless runner use `xvfb-run -a` as in the workflow.
- `node scripts/update-history.mjs`: add saved quotes and terminal reports to the county history without replacing prior dates. Pump-price records use Central report or observation dates. The chart applies the selected source, payment and membership filters, plus the current delivery setting for the historical estimate.
- `npm run import:gasbuddy`: rebuild the normalized snapshot from saved public county-page observations.
- `node scripts/import-published-prices.mjs <price-table.json> <store-directory.json>`: import a dated FuelRadarDash snapshot using station addresses and coordinates from the official directory.
- `npm run collect:gasbuddy -- --county=Dane`: optional existing GasBuddy search adapter, followed by Census address verification. Install the optional Playwright dependency and its supported browser first. Public-source access can fail; failures retain saved timestamps and reports. Omit `--county` to search every configured county.
- `npm run build`: regenerate `preview.html` after changing code or data.
- `npm test`: model checks.
- `node tests/verify.mjs`: snapshot, standalone packaging, delivery-control and CSV-generation checks.

## References

- [Wisconsin DATCP cost guidance](https://datcp.wi.gov/Pages/Programs_Services/UnfairSalesAct.aspx)
- [AXXIS Wisconsin terminal report](https://old.axxispetro.com/download/wisconsin-cta.txt)
- [Wisconsin fuel-blend requirements](https://dnr.wisconsin.gov/topic/AirQuality/Mobile.html)
- [GasBuddy Wisconsin listings](https://www.gasbuddy.com/gasprices/wisconsin)
- [FuelRadarDash Wisconsin Kwik Trip snapshot](https://fuelradardash.com/gas-prices/brands/kwik-trip/wisconsin/)
- [GasWiser Wisconsin](https://www.gaswiser.com/state/wi)
- [Kwik Trip official store directory](https://www.kwiktrip.com/maps-downloads/store-list)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Geofabrik Wisconsin OpenStreetMap extract](https://download.geofabrik.de/north-america/us/wisconsin.html)
- [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Actions schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- County geometry: U.S. Census-derived GeoJSON distributed in Plotly datasets; Leaflet 1.9.4 is vendored with its copyright notice.
