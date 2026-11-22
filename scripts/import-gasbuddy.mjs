import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {countyModels,fresh} from '../site/model.js';
import {reportTime} from './core.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function parsePageSample(sample,geo,{locationCache={},fallback=[]}={}) {
  const counties=countyModels(geo),stations=new Map(),rejected=[];
  const normalize=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  for(const [id,name,address,city,price,age,pageIndex] of sample.rows){
    const page=sample.pages[pageIndex];
    const county=counties.find(c=>c.name===page?.[0]?.replace(/ County$/,''));
    if(!county||!page[1].includes('in '+page[0]+', WI')||!/^\d+$/.test(id)||!age||!Number.isFinite(price)||price<.5||price>20||!Number.isFinite(Date.parse(page[3]))){rejected.push(id);continue;}
    const observedAt=page[3],reportedAt=reportTime(age,Date.parse(observedAt));
    if(!reportedAt){rejected.push(id);continue;}
    const station={id,name,address,city,state:'WI',fuel:'regular',price,reportedAt,observedAt,reportAgeLabel:age,reportTimePrecision:'relative source display; approximate',source:'GasBuddy',membership:/\bcostco\b|\bsam['’]?s club\b/i.test(name),payment:'unspecified',url:'https://www.gasbuddy.com/station/'+id,county:county.name,countyFips:county.id,countyAuthority:'GasBuddy county page (not independently geocoded)',countyPage:page[4]||'https://www.gasbuddy.com/gasprices/wisconsin',timeBasis:'reported'};
    // Coordinates come only from exact street/city matches; never place a station at a county centroid.
    const key=`${address}, ${city}, WI`.toUpperCase(),cached=locationCache[key];
    const direct=fallback.find(s=>normalize(s.address)===normalize(address)&&normalize(s.city)===normalize(city));
    if(cached?.countyFips?.startsWith('55')){
      const verified=counties.find(c=>c.id===cached.countyFips);if(!verified){rejected.push(id);continue;}
      Object.assign(station,{countyFips:verified.id,county:verified.name,countyAuthority:'US Census Geocoder',lat:cached.coordinates?.y,lng:cached.coordinates?.x});
    }else if(direct){Object.assign(station,{countyFips:direct.countyFips,county:direct.county,countyAuthority:'Exact address match to Kwik Trip county field',lat:direct.lat,lng:direct.lng});}
    const previous=stations.get(id);if(!previous||Date.parse(reportedAt)>Date.parse(previous.reportedAt))stations.set(id,station);
  }
  return {schemaVersion:1,source:'GasBuddy',scope:'Wisconsin county-page sample; not a census of all stations',collectionMethod:'Public county-page listings',retrievedAt:sample.pages.map(p=>p[3]).sort().at(-1),pages:sample.pages.map(p=>({county:p[0],heading:p[1],listed:p[2],observedAt:p[3]})),stations:[...stations.values()],rejected};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const sample=JSON.parse(await fs.readFile(root+'site/data/gasbuddy-page-sample.json','utf8'));
  const geo=JSON.parse(await fs.readFile(root+'site/data/counties.geojson','utf8'));
  const fallback=JSON.parse(await fs.readFile(root+'site/data/fallback.json','utf8')).stations;
  let locationCache={};try{locationCache=JSON.parse(await fs.readFile(root+'site/data/geocode-cache.json','utf8'));}catch{}
  const result=parsePageSample(sample,geo,{locationCache,fallback});
  await fs.writeFile(root+'site/data/gasbuddy-current.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({reports:result.stations.length,fresh:result.stations.filter(s=>fresh(s)).length,freshCounties:new Set(result.stations.filter(s=>fresh(s)).map(s=>s.countyFips)).size,rejected:result.rejected.length}));
}
