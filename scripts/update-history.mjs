import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {countyModels, floorFor, fresh, inside, sourceTime} from '../site/model.js';

const dataRoot = new URL('../site/data/', import.meta.url);
const localDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago'});
const sourceFiles = ['gasbuddy-archive.json', 'gasbuddy-current.json', 'fallback.json', 'published-prices.json', 'costco-prices.json', 'gaswiser-prices.json'];
const quoteSources = new Set(['GasBuddy', 'Kwik Trip', 'FuelRadarDash', 'GasWiser']);

export function mergeHistory(history, counties, stations, reports) {
  const countyById = new Map(counties.map(county => [county.id, county]));
  const dayFor = (county, date) => ((history.counties[county.id] ??= {})[date] ??= {});

  for (const station of stations) {
    const observed = Date.parse(station.observedAt);
    if (!quoteSources.has(station.source) || !Number.isFinite(observed) || !fresh(station, observed)) continue;
    const county = countyById.get(station.countyFips) ?? (
      Number.isFinite(station.lat) && Number.isFinite(station.lng)
        ? counties.find(county => inside([station.lng, station.lat], county.feature.geometry))
        : null
    );
    if (!county) continue;

    const date = localDate.format(new Date(sourceTime(station)));
    const day = dayFor(county, date);
    const quotes = (day.quotes ??= {})[station.source] ??= {};
    const cash = station.payment === 'cash';
    const terms = station.membership ? (cash ? 'memberCash' : 'member') : (cash ? 'cash' : 'standard');
    quotes[terms] = Math.min(quotes[terms] ?? Infinity, station.price);
  }

  for (const county of counties) {
    const floor = floorFor(county, reports);
    if (!floor) continue;
    dayFor(county, floor.reportDate).terminal = {wholesale:floor.wholesale, market:floor.market.name, product:floor.product};
  }
  return history;
}

async function readData(name) {
  try {
    return JSON.parse(await fs.readFile(new URL(name, dataRoot), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

export async function writeHistory(history) {
  const countyBlocks = Object.keys(history.counties).sort().map(id => {
    const days = history.counties[id];
    const records = Object.keys(days).sort().map(date => `      "${date}": ${JSON.stringify(days[date])}`);
    return `    "${id}": {\n${records.join(',\n')}\n    }`;
  });
  const output = `{\n  "schemaVersion": 1,\n  "counties": {\n${countyBlocks.join(',\n')}\n  }\n}\n`;
  const file = new URL('history.json', dataRoot);
  const existing = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing === output) return;
  const temporary = new URL(`history-${process.pid}.tmp`, dataRoot);
  try {
    await fs.writeFile(temporary, output);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force:true});
  }
}

export async function updateHistory() {
  const [geography, terminals, existing, ...sources] = await Promise.all(
    ['counties.geojson', 'terminals.json', 'history.json', ...sourceFiles].map(readData)
  );
  const history = existing ?? {schemaVersion:1, counties:{}};
  if (history.schemaVersion !== 1 || !history.counties) throw Error('Unsupported county history format.');
  mergeHistory(history, countyModels(geography), sources.flatMap(source => source?.stations ?? []), terminals?.reports ?? []);
  await writeHistory(history);
  console.log(`Updated price history for ${Object.keys(history.counties).length} counties.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await updateHistory();
