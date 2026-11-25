import {fresh, inside} from '../site/model.js';

const ORIGIN = 'https://www.gaswiser.com';
const cities = ['milwaukee','eau-claire','green-bay','appleton','racine','kenosha','janesville','la-crosse',
  'oshkosh','sheboygan','wausau','superior','stevens-point','fond-du-lac','madison'];

function cityStations(html, slug) {
  for (const [,script] of html.matchAll(/<script\b[^>]*\bdata-tsr-stream-part[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!script.includes('initialCityInfo')) continue;
    for (const [literal] of script.matchAll(/"(?:[^"\\]|\\.)*"/gs)) {
      if (!literal.includes('initialCityInfo')) continue;
      const page = JSON.parse(JSON.parse(literal));
      const props = page.c?.find(node => node.p?.cityName === slug && node.p?.initialCityInfo)?.p;
      if (Array.isArray(props?.initialCityInfo.stations)) return props.initialCityInfo.stations;
    }
  }
  throw Error('The public regular-price station listing was not found.');
}

export function parseGasWiserCity(html, slug, counties, now) {
  return cityStations(html,slug).flatMap(row => {
    if (![row.store_name,row.street_address,row.city].every(value => typeof value === 'string' && value.trim()) ||
        row.state !== 'WI' || row.country !== 'US' ||
        !/^\/station\/[\w/-]+$/.test(row.canonical_path ?? '') || row.currency !== 'USD' || row.price_unit !== 'gallon' ||
        !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return [];
    const county = counties.find(item => inside([row.longitude,row.latitude],item.feature.geometry));
    if (!county) return [];
    const station = {id:'gaswiser:'+row.canonical_path,name:row.store_name,address:row.street_address,city:row.city,
      state:'WI',county:county.name,countyFips:county.id,lat:row.latitude,lng:row.longitude,source:'GasWiser',
      fuel:'regular',price:row.latest_price,reportedAt:row.last_updated,observedAt:new Date(now).toISOString(),
      timeBasis:'reported',membership:/\b(?:costco|sam['’]?s club)\b/i.test(row.store_name),
      payment:'unspecified',url:ORIGIN+row.canonical_path};
    return fresh(station,now) ? [station] : [];
  });
}

export async function collectGasWiser(read, counties, now) {
  const stations = new Map();
  let checked = 0;
  for (let offset = 0; offset < cities.length; offset += 5) {
    const results = await Promise.allSettled(cities.slice(offset,offset + 5).map(async city => {
      const slug = `${city}-wi`;
      return parseGasWiserCity(await read(`${ORIGIN}/city/${slug}`),slug,counties,now);
    }));
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      checked++;
      for (const station of result.value) stations.set(station.id,station);
    }
  }
  if (!checked) throw Error('No GasWiser city pages could be verified.');
  return {stations:[...stations.values()],checked};
}
