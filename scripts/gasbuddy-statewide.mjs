import {censusMatch} from './core.mjs';
import {cachedStationLocation} from './import-gasbuddy.mjs';
import {addressCityKey, hasLocation} from '../site/locations.js';
import {fresh} from '../site/model.js';

const censusURL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const markets = ['milwaukee','green-bay','appleton','eau-claire','racine','kenosha','janesville',
  'la-crosse','oshkosh','sheboygan','wausau','superior','stevens-point','fond-du-lac','madison'];

export function statewideSearchAreas(counties, now = Date.now()) {
  const start = Math.floor(now / 86400000) % markets.length;
  const citySearches = [...markets.slice(start),...markets.slice(0,start)];
  const countyStart = Math.floor(now / 86400000) * 8 % counties.length;
  const countySearches = [...counties.slice(countyStart),...counties.slice(0,countyStart)].slice(0,8);
  return [...citySearches.slice(0,5), ...countySearches.map(c => c.name.toLowerCase().replaceAll(' ','-') + '-county'), ...citySearches.slice(5)];
}

export async function locateSearchReports(stations, {locations, known, locationCache, counties, read, now}) {
  const addresses = new Map();
  for (const row of [...locations,...known]) {
    if (!hasLocation(row) || !row.address || !row.city || !row.countyFips) continue;
    const key = addressCityKey(row.address,row.city);
    const previous = addresses.get(key);
    if (!addresses.has(key)) addresses.set(key,row);
    else if (previous && (previous.countyFips !== row.countyFips || Math.abs(previous.lat-row.lat) > .002 ||
      Math.abs(previous.lng-row.lng) > .002)) addresses.set(key,null);
  }

  const located = [], missing = [];
  for (const station of stations.filter(row => fresh(row,now))) {
    const cached = cachedStationLocation(station,locationCache,counties);
    const exact = addresses.get(addressCityKey(station.address,station.city));
    if (cached.countyFips) located.push({...station,...cached});
    else if (exact) located.push({...station,countyFips:exact.countyFips,county:exact.county,lat:exact.lat,lng:exact.lng,
      countyAuthority:'Exact station address match'});
    else missing.push(station);
  }
  // Bound public geocoding work independently of collection.
  const requested = missing.slice(0,60);
  for (let offset = 0; offset < requested.length; offset += 6) {
    await Promise.all(requested.slice(offset,offset + 6).map(async station => {
      const address = `${station.address}, ${station.city}, WI`;
      const url = new URL(censusURL);
      url.search = new URLSearchParams({address,benchmark:'Public_AR_Current',vintage:'Current_Current',format:'json'});
      try {
        const match = censusMatch(JSON.parse(await read(url.href)));
        if (!match?.countyFips?.startsWith('55')) return;
        locationCache[address.toUpperCase()] = match;
        const verified = cachedStationLocation(station,locationCache,counties);
        if (verified.countyFips) located.push({...station,...verified});
      } catch {
        // A failed lookup cannot establish a station's county.
      }
    }));
  }
  return located;
}
