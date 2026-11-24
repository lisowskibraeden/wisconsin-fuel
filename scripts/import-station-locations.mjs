import fs from 'node:fs/promises';
import {countyModels, inside} from '../site/model.js';
import {createLocationLookup, unpricedLocations} from '../site/locations.js';

const [pointsFile, areasFile, mapDate] = process.argv.slice(2);
if (!pointsFile || !areasFile || !/^\d{4}-\d{2}-\d{2}$/.test(mapDate ?? '')) {
  throw Error('Usage: node scripts/import-station-locations.mjs <points.geojson> <area-centers.geojson> <extract date YYYY-MM-DD>');
}

const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const data = new URL('../site/data/', import.meta.url);
const [points, areas, geo] = await Promise.all([read(pointsFile), read(areasFile), read(new URL('counties.geojson', data))]);
const counties = countyModels(geo);
const stations = new Map();
for (const feature of [...points.features, ...areas.features]) {
  if (feature.geometry?.type !== 'Point') continue;
  const props = feature.properties;
  const tags = typeof props.other_tags === 'string' ? JSON.parse(props.other_tags) : props.other_tags ?? {};
  if (['private','no'].includes(tags.access) || tags['fuel:marine'] === 'yes' || tags['fuel:aviation'] === 'yes') continue;
  const county = counties.find(candidate => inside(feature.geometry.coordinates, candidate.feature.geometry));
  if (!county) continue;
  const [lng,lat] = feature.geometry.coordinates.map(value => Number(value.toFixed(6)));
  const [kind,ref] = props.kind ? [props.kind,props.id] : ['node',props.osm_id];
  if (!/^(node|way|relation)$/.test(kind) || !/^\d+$/.test(ref ?? '')) continue;
  const name = props.name || tags.brand || tags.operator || 'Gas station';
  const id = `${kind}/${ref}`;
  const street = tags['addr:street'];
  const house = tags['addr:housenumber'];
  const address = street && house ? `${house} ${street}` : '';
  stations.set(id,{id,name,brand:tags.brand || '',address,city:tags['addr:city'] || '',
    county:county.name,countyFips:county.id,lat,lng,url:`https://www.openstreetmap.org/${id}`,
    ...(/\b(?:Costco|Sam['’]?s Club)\b/i.test(name) ? {membership:true} : {})});
}

// A station may have both a point marker and an outline. Prefer the point when both match.
const nodes = [...stations.values()].filter(station => station.id.startsWith('node/'));
const outlines = [...stations.values()].filter(station => !station.id.startsWith('node/'));
const unique = [...nodes,...unpricedLocations(outlines,nodes,createLocationLookup(outlines))];
const coverage = new Set(unique.map(station => station.countyFips)).size;
if (unique.length < 1000 || coverage < 70) throw Error('The station extract is incomplete.');
const output = `{"source":"OpenStreetMap contributors","license":"ODbL-1.0","extractDate":"${mapDate}","stations":[\n${unique.map(station=>JSON.stringify(station)).join(',\n')}\n]}\n`;
await fs.writeFile(new URL('station-locations.json',data),output);
console.log(`${unique.length} station locations in ${coverage} Wisconsin counties.`);
