import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {countyModels, fresh, inside, MARKETS, parseTerminals, sourceTime} from '../site/model.js';
import {collectCountyPages} from './gasbuddy-county-pages.mjs';
import {cachedStationLocation, parsePageSample} from './import-gasbuddy.mjs';
import {normalizePublishedPrices} from './import-published-prices.mjs';
import {parseStoreDirectory, readCostcoPrices, readPublisherSnapshot, STORE_DIRECTORY} from './source-pages.mjs';
import {locateSearchReports, statewideSearchAreas} from './gasbuddy-statewide.mjs';
import {collectGasWiser} from './gaswiser.mjs';

const DATA = new URL('../site/data/', import.meta.url);
const AXXIS = 'https://old.axxispetro.com/download/wisconsin-cta.txt';
const DANE_FUEL = 'https://raw.githubusercontent.com/lisowskibraeden/dane-fuel/main/site/data/prices.json';
const KWIK_TRIP = 'https://api.kwiktrip.com/api';

function terminalTime(report) {
  const time = Date.parse(report.reportDate + ' ' + report.reportTime + ' UTC');
  if (!Number.isFinite(time)) throw Error('Invalid terminal report time.');
  return time;
}

function mergeQuotes(previous, incoming) {
  const rows = new Map(previous.map(row => [row.id,row]));
  let updated = 0;
  for (const row of incoming) {
    const old = rows.get(row.id);
    if (old && Date.parse(sourceTime(row)) <= Date.parse(sourceTime(old))) continue;
    rows.set(row.id,row);
    updated++;
  }
  return {rows:[...rows.values()], updated};
}

async function readKwikTrip(store, read, counties) {
  const number = store.id.slice('kwiktrip:'.length);
  const url = KWIK_TRIP + '/location/store/information/' + number;
  const detail = JSON.parse(await read(url));
  const address = detail.address;
  if (String(detail.storeNumber) !== number || address?.state !== 'WI') {
    throw Error('Store detail did not match the Wisconsin location.');
  }
  const regular = (detail.fuel || []).filter(fuel => /^UNLEADED 87(?:\s|$)/i.test(fuel.type || ''));
  if (regular.length !== 1) return null;
  const price = regular[0].currentPrice;
  const lat = address.latitude ?? store.lat, lng = address.longitude ?? store.lng;
  if (!Number.isFinite(price) || price < .5 || price > 20 || !address.address1 || !address.city) return null;
  const county = counties.find(c => c.name.toUpperCase() === address.county?.trim().toUpperCase()) ||
    (Number.isFinite(lat) && Number.isFinite(lng) ? counties.find(c => inside([lng,lat],c.feature.geometry)) : null);
  if (!county) return null;
  return {id:store.id,name:detail.name || 'Kwik Trip #' + number,address:address.address1,city:address.city,
    state:'WI',postalCode:address.zip,county:county.name,countyFips:county.id,lat,lng,fuel:'regular',price,
    source:'Kwik Trip',reportedAt:null,observedAt:new Date().toISOString(),timeBasis:'retrieved',
    membership:false,payment:'unspecified',url};
}

export async function refresh({data=DATA,fetchResource=fetch,collectGasBuddy=null,collectSearch=null,log=console.log,now=Date.now()}={}) {
  const attemptedAt = new Date(now).toISOString();
  const readData = async name => JSON.parse(await fs.readFile(new URL(name,data),'utf8'));
  async function write(name,value) {
    const target = new URL(name,data), temporary = new URL(name + '.tmp',data);
    const text = typeof value === 'string' ? value : JSON.stringify(value,null,2) + '\n';
    await fs.writeFile(temporary,text);
    await fs.rename(temporary,target);
  }
  async function read(url) {
    const response = await fetchResource(url,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('HTTP ' + response.status);
    return response.text();
  }
  const [geo,terminals,direct,gas,published] = await Promise.all([
    'counties.geojson','terminals.json','fallback.json','gasbuddy-current.json','published-prices.json',
  ].map(readData));
  const counties = countyModels(geo);
  const states = {};
  let successful = 0;
  async function attempt(source, task) {
    try {
      states[source] = await task();
      successful++;
    } catch (error) {
      states[source] = 'Preserved prior data. ' + (error.cause?.code || error.message);
    }
    log(source + ': ' + states[source]);
  }

  const getDirectory = async () => {
    try {
      const stores = parseStoreDirectory(await read(STORE_DIRECTORY));
      if (!stores.length) throw Error('No Wisconsin gasoline stores were found.');
      return stores;
    } catch (error) {
      log('Kwik Trip directory unavailable. Using saved store identities. ' + (error.cause?.code || error.message));
      return [];
    }
  };
  const directoryPromise = getDirectory();
  const getDane = async () => {
    try {
      const exportData = JSON.parse(await read(DANE_FUEL));
      if (!Array.isArray(exportData.stations)) throw Error('Missing station export.');
      const rows = exportData.stations.filter(row => row.source === 'GasBuddy' && row.countyFips === '55025' &&
        /^\d+$/.test(row.id) && row.state === 'WI' && row.fuel === 'regular' && Number.isFinite(row.price) &&
        row.price >= .5 && row.price <= 20 && Date.parse(row.reportedAt) <= now + 300000)
        .map(row => ({...row,id:String(row.id),county:'Dane',countyAuthority:'Dane Fuel verified county',timeBasis:'reported'}));
      if (!rows.length) throw Error('No valid GasBuddy reports in the Dane Fuel export.');
      return {rows, timestamp:exportData.lastSuccessAt};
    } catch (error) {
      log('Dane Fuel export unavailable. ' + (error.cause?.code || error.message));
      return {rows:[]};
    }
  };
  const danePromise = getDane();

  await Promise.all([
    attempt('AXXIS', async () => {
      const text = await read(AXXIS);
      const reports = parseTerminals(text);
      const previous = new Map(terminals.reports.map(report => [report.id,terminalTime(report)]));
      const locations = new Set(reports.map(report => report.id));
      if (locations.size !== reports.length || MARKETS.some(market => !locations.has(market.id)) ||
          !reports.some(report => report.prices.ULC10) || !reports.some(report => report.prices['87RE10'])) {
        throw Error('The terminal report is incomplete.');
      }
      if (reports.some(report => terminalTime(report) < previous.get(report.id))) {
        throw Error('The upstream report is older than saved data.');
      }
      if (reports.every(report => terminalTime(report) === previous.get(report.id))) return 'Same report date and time.';
      await write('terminal-report.txt',text);
      await write('terminals.json',{source:'AXXIS',retrievedAt:attemptedAt,reports});
      return reports.length + ' markets updated.';
    }),
    attempt('Kwik Trip', async () => {
      const directory = await directoryPromise;
      const stores = new Map();
      for (const row of [...published.stations,...direct.stations,...directory]) {
        const id = row.id.replace(/^published:/,'');
        if (/^kwiktrip:\d+$/.test(id)) stores.set(id,{...row,id});
      }
      const pending = [...stores.values()];
      const errors = [];
      const stations = [];
      let cursor = 0;
      let consecutiveFailed = 0;
      await Promise.all(Array.from({length:8}, async () => {
        while (cursor < pending.length && consecutiveFailed < 16) {
          const store = pending[cursor++];
          try {
            const row = await readKwikTrip(store,read,counties);
            consecutiveFailed = 0;
            if (row) stations.push(row);
          } catch (error) {
            consecutiveFailed++;
            errors.push({source:'Kwik Trip',store:store.id,error:error.cause?.code || error.message});
          }
        }
      }));
      if (!stations.length) throw Error('No valid regular quotes were returned' + (errors.length ? ' (' + errors[0].error + ').' : '.'));
      const {rows, updated} = mergeQuotes(direct.stations,stations);
      if (updated) await write('fallback.json',{...direct,attemptedAt,retrievedAt:new Date().toISOString(),
        stations:rows.sort((a,b) => a.id.localeCompare(b.id)),errors:errors.sort((a,b) => a.store.localeCompare(b.store))});
      const coverage = new Set(stations.map(row => row.countyFips)).size;
      return updated + ' regular quotes in ' + coverage + ' counties. ' + errors.length + ' requests failed.';
    }),
    attempt('GasBuddy', async () => {
      const dane = await danePromise;
      const locationCache = await readData('geocode-cache.json').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return {};
      });
      let pages;
      let searchReports = [];
      if (collectSearch) {
        try {
          const search = await collectSearch(statewideSearchAreas(counties,now));
          if (search.fatal) log('GasBuddy paginated search: ' + search.fatal);
          const locations = await readData('station-locations.json');
          searchReports = await locateSearchReports(search.stations,{locations:locations.stations,
            known:[...gas.stations,...direct.stations,...published.stations],locationCache,counties,read,now:Date.now()});
          log(`GasBuddy paginated search: ${searchReports.length} fresh, located reports in ${new Set(searchReports.map(row => row.countyFips)).size} counties.`);
        } catch (error) {
          log('GasBuddy paginated search unavailable. ' + error.message);
        }
      }
      if (collectGasBuddy) {
        try {
          const sample = await collectGasBuddy(counties);
          if (sample.errors?.length) log('GasBuddy county page issues: ' + sample.errors.length + '. ' + sample.errors[0]);
          pages = parsePageSample(sample,geo,{locationCache,fallback:direct.stations});
        } catch (error) {
          log('GasBuddy county pages unavailable. ' + error.message);
        }
      }
      const eligiblePages = (pages?.stations || []).filter(row => fresh(row,Date.now()));
      if (!eligiblePages.length && !dane.rows.length && !searchReports.length) throw Error('No valid GasBuddy station reports were available.');
      const daneRows = dane.rows.map(row => ({...row, ...cachedStationLocation(row, locationCache, counties)}));
      const {rows, updated} = mergeQuotes(gas.stations,[...eligiblePages,...daneRows,...searchReports]);
      if (!updated) return 'No newer station reports. Saved reports keep their original timestamps.';
      const metadata = new Map((gas.pages || []).map(page => [page.county,page]));
      for (const page of pages?.pages || []) metadata.set(page.county,page);
      const timestamps = [gas.retrievedAt,pages?.retrievedAt,dane.timestamp,...searchReports.map(row => row.observedAt)]
        .filter(value => Number.isFinite(Date.parse(value)));
      await write('gasbuddy-current.json',{...gas,retrievedAt:timestamps.sort().at(-1) || gas.retrievedAt,
        latestDaneFuelAt:Date.parse(dane.timestamp) > (Date.parse(gas.latestDaneFuelAt) || -Infinity) ? dane.timestamp : gas.latestDaneFuelAt,
        pages:[...metadata.values()].sort((a,b) => a.county.localeCompare(b.county)),
        stations:rows.sort((a,b) => a.id.localeCompare(b.id))});
      return updated + ' newer reports saved.';
    }),
    attempt('FuelRadarDash', async () => {
      const snapshot = await readPublisherSnapshot(read,published,now);
      if (!snapshot) return 'No newer publisher snapshot.';
      const directory = await directoryPromise;
      const locations = published.stations.map(row => ({...row,id:row.id.replace(/^published:/,'')}));
      const {result,unmatched} = normalizePublishedPrices(snapshot,[...locations,...directory],direct,geo);
      if (result.stations.length < 0.8 * snapshot.rows.filter(row => row[2] !== null).length) {
        throw Error('Too few published quotes could be matched to verified stations.');
      }
      await write('published-prices.json',result);
      return result.stations.length + ' matched quotes in ' + new Set(result.stations.map(row => row.countyFips)).size +
        ' counties. ' + unmatched.length + ' station addresses did not match.';
    }),
    attempt('Costco via FuelRadarDash', async () => {
      const previous = await readData('costco-prices.json').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return {stations:[]};
      });
      const current = await readCostcoPrices(read,previous,now,counties);
      if (!current) return 'No newer Costco snapshot.';
      await write('costco-prices.json',current);
      return current.stations.filter(row => row.observedAt === current.publishedAt).length + ' Costco member prices updated.';
    }),
    attempt('GasWiser', async () => {
      const previous = await readData('gaswiser-prices.json').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return {stations:[]};
      });
      const current = await collectGasWiser(read,counties,now);
      const {rows,updated} = mergeQuotes(previous.stations.filter(row => fresh(row,now)),current.stations);
      if (updated || rows.length !== previous.stations.length) {
        await write('gaswiser-prices.json',{source:'GasWiser',retrievedAt:attemptedAt,stations:rows.sort((a,b) => a.id.localeCompare(b.id))});
      }
      return `${updated} newer reports in ${current.checked} checked cities.`;
    }),
  ]);
  return {states,successful};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const collectSearch = args.includes('--gasbuddy-statewide-search') ? async towns => {
    const {collectGasBuddy} = await import('./gasbuddy.mjs');
    const headed = args.includes('--headed');
    return collectGasBuddy({towns,headless:!headed,standardChrome:headed,deadline:Date.now()+9*60000});
  } : null;
  const {states,successful} = await refresh({collectSearch,collectGasBuddy:args.includes('--gasbuddy-county-pages') ? collectCountyPages : null});
  const outcome = successful ? 'Verified ' + successful + ' of ' + Object.keys(states).length + ' sources.' :
    'Every source failed verification. All prior data has been preserved.';
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = Object.entries(states).map(([source, status]) => '- **' + source + '** — ' + status.split('\n')[0]).join('\n');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'## Fuel data refresh\n\n' + outcome + '\n\n' + summary + '\n');
  }
  if (!successful) {
    console.error(outcome);
    process.exitCode = 1;
  }
}
