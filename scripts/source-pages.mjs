import {inside} from '../site/model.js';

const RADAR = 'https://fuelradardash.com/gas-prices/brands/kwik-trip/wisconsin/';
export const COSTCO_RADAR = 'https://fuelradardash.com/gas-prices/brands/costco/wisconsin/';
export const STORE_DIRECTORY = 'https://www.kwiktrip.com/maps-downloads/store-list';

function decodeHtml(value) {
  const entities = {amp:'&', apos:"'", quot:'"', lt:'<', gt:'>', nbsp:' '};
  return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? whole;
    const hex = key[1].toLowerCase() === 'x';
    const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function visible(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tableRows(html) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), row =>
    Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), cell => visible(cell[1])));
}

export function parseStoreDirectory(html) {
  return tableRows(html).flatMap(([number,name,address,city,state,postalCode,,lat,lng,,sellsGas]) => {
    const latitude = Number(lat), longitude = Number(lng);
    if (!/^\d+$/.test(number ?? '') || state !== 'WI' || sellsGas !== 'Yes' ||
        !address || !city || !latitude || !longitude) return [];
    return [{id:'kwiktrip:' + number, name, address, city, postalCode, lat:latitude, lng:longitude}];
  });
}

export function parsePublisherPage(html) {
  const text = visible(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''));
  const stamp = text.match(/\bUpdated ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M E[SD]T)\b/);
  const time = Date.parse(stamp?.[1]);
  const expected = Number(text.match(/\bStations ([\d,]+) Average Regular\b/)?.[1]?.replaceAll(',', ''));
  const rows = tableRows(html).flatMap(([address,city,state,price]) => state === 'Wisconsin' && address && city
    ? [[address, city, /^\$\d{1,2}\.\d{2,3}$/.test(price ?? '') ? Number(price.slice(1)) : null]]
    : []);
  if (!Number.isFinite(time) || !Number.isInteger(expected) || !rows.length) {
    throw Error('The publisher page is missing its dated station table.');
  }
  return {publishedAt:new Date(time).toISOString(), expected, rows};
}

export async function readPublisherSnapshot(read, previous, now, base = RADAR) {
  const html = await read(base);
  const first = parsePublisherPage(html);
  const time = Date.parse(first.publishedAt);
  if (time > now + 300000) throw Error('The publisher snapshot is dated in the future.');
  if (time <= Date.parse(previous.publishedAt)) return null;
  const pageCount = Math.ceil(first.expected / first.rows.length);
  if (pageCount > 10) throw Error('The publisher pagination has changed.');
  const pages = [base];
  for (let n = 2; n <= pageCount; n++) pages.push(base + 'page/' + n + '/');
  const result = {source:'FuelRadarDash', publishedAt:first.publishedAt, pages, rows:[]};
  for (const [index, url] of pages.entries()) {
    const page = index === 0 ? first : parsePublisherPage(await read(url));
    if (page.publishedAt !== first.publishedAt || page.expected !== first.expected) {
      throw Error('Publisher pages disagree on their snapshot time or station count.');
    }
    result.rows.push(...page.rows.map(row => [...row,index]));
  }
  const unique = new Set(result.rows.map(([address, city]) => JSON.stringify([address, city])));
  if (unique.size !== first.expected || result.rows.length !== first.expected) {
    throw Error('The publisher returned an incomplete or repeated page.');
  }
  return result;
}

export async function readCostcoPrices(read, previous, now, counties) {
  const html = await read(COSTCO_RADAR);
  const snapshot = await readPublisherSnapshot(url => url === COSTCO_RADAR ? html : read(url), previous, now, COSTCO_RADAR);
  if (!snapshot) return null;
  const paths = [...new Set(Array.from(html.matchAll(/href="(\/gas-station\/costco-\d+-[a-z0-9-]+-wi\/)"/gi), match => match[1]))];
  if (paths.length !== snapshot.rows.length) throw Error('The Costco listing did not link to every station.');
  const addressKey = (address, city) => `${address}|${city}`.trim().toLowerCase();
  const prices = new Map(snapshot.rows.map(([a,c,price]) => [addressKey(a,c),price]));
  const saved = new Map(previous.stations.map(row => [row.id,row]));
  const stations = [];
  for (let start = 0; start < paths.length; start += 4) {
    const batch = paths.slice(start,start + 4);
    const details = await Promise.allSettled(batch.map(async path => {
      const url = new URL(path,COSTCO_RADAR).href;
      const page = await read(url);
      const records = Array.from(page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g), match => JSON.parse(match[1]));
      const station = records.find(record => record['@type'] === 'GasStation');
      const {streetAddress:address,addressLocality:city,addressRegion:region} = station?.address ?? {};
      const {latitude:lat,longitude:lng} = station?.geo ?? {};
      if (station?.brand?.name !== 'Costco' || region !== 'Wisconsin' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const county = counties.find(candidate => inside([lng,lat],candidate.feature.geometry));
      const price = prices.get(addressKey(address,city));
      if (!county || !Number.isFinite(price) || price < .5 || price > 20) return null;
      const id = 'costco:' + path.match(/costco-(\d+)-/)[1];
      return {id,name:'Costco',address,city,county:county.name,countyFips:county.id,lat,lng,state:'WI',fuel:'regular',price,
        source:'FuelRadarDash',url,reportedAt:null,observedAt:snapshot.publishedAt,timeBasis:'published',membership:true,payment:'unspecified'};
    }));
    for (const result of details) if (result.status === 'fulfilled' && result.value) stations.push(result.value);
  }
  if (stations.length < snapshot.rows.length * .8) throw Error('Too few Costco prices matched verified station locations.');
  for (const station of stations) saved.set(station.id,station);
  return {source:snapshot.source,publishedAt:snapshot.publishedAt,pages:snapshot.pages,stations:[...saved.values()]};
}
