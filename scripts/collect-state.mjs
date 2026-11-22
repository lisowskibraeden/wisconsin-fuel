import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {collectGasBuddy} from './gasbuddy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFile(root+p,'utf8').then(JSON.parse);
const geo=await read('site/data/counties.geojson');
const allTowns=geo.features.map(f=>f.properties.NAME.toLowerCase().replaceAll(' ','-')+'-county');
const requested=process.argv.find(a=>a.startsWith('--county='))?.slice(9);
const towns=requested?[requested.toLowerCase().replaceAll(' ','-')+'-county']:allTowns;
const result=await collectGasBuddy({towns,headless:!process.argv.includes('--headed'),standardChrome:process.argv.includes('--standard-chrome')});
let previous={stations:[]},cache={};try{previous=await read('site/data/gasbuddy-current.json');}catch{}try{cache=await read('site/data/geocode-cache.json');}catch{}
const stations=[];
// Do not infer a station's county from a search radius. Resolve full public addresses.
for(const station of result.stations){
  const key=`${station.address}, ${station.city}, WI`.toUpperCase();let match=cache[key];
  if(!match){try{const url=new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');url.search=new URLSearchParams({address:key,benchmark:'Public_AR_Current',vintage:'Current_Current',format:'json'});const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Census HTTP '+response.status);const matches=(await response.json()).result?.addressMatches;if(matches?.length===1&&matches[0].geographies?.Counties?.length===1){match={countyFips:matches[0].geographies.Counties[0].GEOID,coordinates:matches[0].coordinates,checkedAt:new Date().toISOString()};cache[key]=match;}}catch(e){console.warn(`${station.id}: ${e.message}`);}}
  const county=geo.features.find(f=>f.id===match?.countyFips);if(!county)continue;
  stations.push({...station,countyFips:county.id,county:county.properties.NAME,countyAuthority:'US Census Geocoder',lat:match.coordinates.y,lng:match.coordinates.x});
}
const combined=new Map(previous.stations.map(s=>[s.id,s]));for(const s of stations)combined.set(s.id,s);
// Preserve saved reports when the source refuses requests; never reset their timestamps.
const payload={schemaVersion:1,source:'GasBuddy',scope:'Wisconsin configured county searches',attemptedAt:new Date().toISOString(),retrievedAt:stations.length?new Date().toISOString():previous.retrievedAt,collectionMethod:'GasBuddy search collector',lastError:result.fatal,pages:result.pages,stations:[...combined.values()]};
await fs.writeFile(root+'site/data/gasbuddy-current.json',JSON.stringify(payload,null,2)+'\n');
await fs.writeFile(root+'site/data/geocode-cache.json',JSON.stringify(cache,null,2)+'\n');
console.log(`${stations.length} new county-verified reports saved.`);if(!stations.length)process.exitCode=1;
