const RADAR = 'https://fuelradardash.com/gas-prices/brands/kwik-trip/wisconsin/';
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

export async function readPublisherSnapshot(read, previous, now) {
  const first = parsePublisherPage(await read(RADAR));
  const time = Date.parse(first.publishedAt);
  if (time > now + 300000) throw Error('The publisher snapshot is dated in the future.');
  if (time <= Date.parse(previous.publishedAt)) return null;
  const pageCount = Math.ceil(first.expected / first.rows.length);
  if (pageCount > 10) throw Error('The publisher pagination has changed.');
  const pages = [RADAR];
  for (let n = 2; n <= pageCount; n++) pages.push(RADAR + 'page/' + n + '/');
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
