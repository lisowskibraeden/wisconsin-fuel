import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {countyModels, inside} from '../site/model.js';

export function normalizePublishedPrices(snapshot, directory, direct, geo) {
if (snapshot.source !== 'FuelRadarDash' || !Number.isFinite(Date.parse(snapshot.publishedAt))) {
  throw Error('The price table needs a valid publisher and publication timestamp.');
}
const counties = countyModels(geo);
const normalize = value => value.toUpperCase()
  .replace(/\b(?:US|U\.S\.)\s+(?:HIGHWAY|HWY)\b/g, 'USH')
  .replace(/\bSTATE\s+(?:HIGHWAY|HWY|ROAD|RD)\b/g, 'STH')
  .replace(/\bCOUNTY\s+(?:ROAD|RD|HIGHWAY|HWY)\b/g, 'CTH')
  .replace(/\bSTREET\b/g, 'ST')
  .replace(/\bAVENUE\b/g, 'AVE')
  .replace(/\bROAD\b/g, 'RD')
  .replace(/\bDRIVE\b/g, 'DR')
  .replace(/[^A-Z0-9]/g, '');
const key = (address, city) => normalize(address) + '|' + normalize(city);
const locations = new Map();
for (const store of [...directory, ...direct.stations]) {
  if (!Number.isFinite(store.lat) || !Number.isFinite(store.lng)) continue;
  const county = store.countyFips ? counties.find(item => item.id === store.countyFips)
    : counties.find(item => inside([store.lng, store.lat], item.feature.geometry));
  if (!county) continue;
  const addressKey = key(store.address, store.city);
  const previous = locations.get(addressKey);
  if (previous === null || (previous && previous.id !== store.id)) {
    locations.set(addressKey, null);
    continue;
  }
  locations.set(addressKey, {...store, county: county.name, countyFips: county.id});
}
const stations = new Map();
const unmatched = [];
for (const [address, city, price, pageIndex = 0] of snapshot.rows) {
  if (!Number.isFinite(price) || price < .5 || price > 20) continue;
  const store = locations.get(key(address, city));
  if (!store) { unmatched.push([address, city]); continue; }
  stations.set(store.id, {
    id: 'published:' + store.id, name: store.name, address: store.address, city: store.city,
    county: store.county, countyFips: store.countyFips, state: 'WI',
    lat: store.lat, lng: store.lng, fuel: 'regular', price,
    source: snapshot.source, url: snapshot.pages[pageIndex],
    reportedAt: null, observedAt: snapshot.publishedAt, timeBasis: 'published',
    payment: 'unspecified', membership: false,
  });
}
if (!stations.size) throw Error('No published rows matched verified stations.');
return {result:{source:snapshot.source, publishedAt:snapshot.publishedAt, pages:snapshot.pages, stations:[...stations.values()]}, unmatched};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pricesPath, directoryPath] = process.argv.slice(2);
  if (!pricesPath || !directoryPath) {
    throw Error('Usage: node scripts/import-published-prices.mjs <price table JSON> <store directory JSON>');
  }
  const read = async path => JSON.parse(await fs.readFile(path, 'utf8'));
  const data = new URL('../site/data/', import.meta.url);
  const [snapshot, directory, direct, geo] = await Promise.all([
    read(pricesPath), read(directoryPath), read(new URL('fallback.json', data)), read(new URL('counties.geojson', data)),
  ]);
  const {result, unmatched} = normalizePublishedPrices(snapshot, directory, direct, geo);
  const target = new URL('published-prices.json', data);
  const temporary = new URL('published-prices.json.tmp', data);
  await fs.writeFile(temporary, JSON.stringify(result, null, 2) + '\n');
  await fs.rename(temporary, target);
  console.log(JSON.stringify({stations:result.stations.length, counties:new Set(result.stations.map(row => row.countyFips)).size, unmatched}, null, 2));
}
