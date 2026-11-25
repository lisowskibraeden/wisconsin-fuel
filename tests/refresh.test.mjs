import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {countyModels, eligible, parseTerminals} from '../site/model.js';
import {refresh} from '../scripts/refresh.mjs';
import {COSTCO_RADAR, readCostcoPrices, readPublisherSnapshot} from '../scripts/source-pages.mjs';
import {locateSearchReports} from '../scripts/gasbuddy-statewide.mjs';
import {parseGasWiserCity} from '../scripts/gaswiser.mjs';

const fixtureTerminals = await fs.readFile(new URL('./fixtures/terminal-report.txt',import.meta.url),'utf8');
const now = Date.parse('2026-11-22T16:40:00Z');
const date = '2026-11-17T16:40:00.000Z';
const counties = countyModels(JSON.parse(await fs.readFile(new URL('../site/data/counties.geojson',import.meta.url))));
const direct = (id,address) => ({id:'kwiktrip:' + id,name:'Kwik Trip #' + id,address,city:'MADISON',
  county:'Dane',countyFips:'55025',state:'WI',lat:43.07,lng:-89.39,fuel:'regular',
  price:3.499,source:'Kwik Trip',observedAt:date,timeBasis:'retrieved'});
const first = direct(100,'123 MAIN ST');
const second = direct(101,'456 GRAND AVE');
const gasReport = {id:'10',name:'BP',address:'321 STATE ST',city:'MADISON',state:'WI',fuel:'regular',
  countyFips:'55025',price:3.799,reportedAt:date,source:'GasBuddy'};
const publishedMarkup = (updated, address, price, expected=2) => `
  <h1>Kwik Trip Gas Stations in Wisconsin</h1>
  <div>Stations <strong>${expected}</strong></div><div>Average Regular</div>
  <table><tbody><tr><td><a href="/store/">${address}</a></td><td>Madison</td><td>Wisconsin</td>
  <td>$${price}</td></tr></tbody></table><small>Updated ${updated}</small>`;

test('Costco snapshots retain the publisher timestamp and membership terms', async () => {
  const path = '/gas-station/costco-1020-middleton-wi/';
  const snapshot = await readCostcoPrices(async url => {
    if (url === COSTCO_RADAR) return publishedMarkup('Nov 22, 2026, 08:21 AM EST','2150 Deming Way','3.099',1)
      .replace('/store/',path).replace('<td>Madison','<td>Middleton');
    assert.equal(new URL(url).pathname,path);
    const details = {'@type':'GasStation',brand:{name:'Costco'},address:{streetAddress:'2150 Deming Way',
      addressLocality:'Middleton',addressRegion:'Wisconsin'},geo:{latitude:43.1,longitude:-89.522}};
    return `<script type="application/ld+json">${JSON.stringify(details)}</script>`;
  },{stations:[]},now,counties);
  const [quote] = snapshot.stations;
  assert.equal(quote.countyFips,'55025');
  assert.equal(quote.observedAt,'2026-11-22T13:21:00.000Z');
  assert.equal(quote.reportedAt,null);
  assert.equal(eligible([quote],{now,members:true})[0].price,3.099);
  assert.deepEqual(eligible([quote],{now,members:false}),[]);
});

test('search reports use exact Wisconsin locations outside Dane County',async () => {
  const quote = {...gasReport,address:'123 N Main St',city:'Green Bay',countyFips:undefined,reportedAt:'2026-11-22T12:00:00Z'};
  const place = {address:'123 North Main Street',city:'Green Bay',countyFips:'55009',county:'Brown',lat:44.52,lng:-88.01};
  const found = await locateSearchReports([quote],{locations:[place],known:[],locationCache:{},counties,now,
    read:async () => assert.fail('An exact address match should require no network request')});
  assert.equal(found[0].countyFips,'55009');
  assert.equal(found[0].reportedAt,quote.reportedAt);
});

test('GasWiser uses the station timestamp and rejects stale or out-of-state rows', () => {
  const station = {store_name:'Shell',street_address:'101 Main St',city:'Green Bay',state:'WI',country:'US',
    canonical_path:'/station/green-bay-wi/101-main-st',latitude:44.52,longitude:-88.01,currency:'USD',price_unit:'gallon',
    latest_price:3.29,last_updated:'2026-11-22T15:30:00Z'};
  const stations = [station,{...station,last_updated:date},{...station,state:'MN'}];
  const payload = {c:[{p:{cityName:'green-bay-wi',initialCityInfo:{stations}}}]};
  const html = `<script data-tsr-stream-part="">render(${JSON.stringify(JSON.stringify(payload))})</script>`;
  const [price,...other] = parseGasWiserCity(html,'green-bay-wi',counties,now);
  assert.equal(price.reportedAt,station.last_updated);
  assert.equal(price.countyFips,'55009');
  assert.deepEqual(other,[]);
});

test('round-trip refresh preserves failed sources and old stations while recording new dated observations',async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'wi-fuel-refresh-'));
  t.after(() => fs.rm(folder,{recursive:true,force:true}));
  const data = pathToFileURL(folder + '/');
  async function seed(file,value) {
    await fs.writeFile(new URL(file,data),JSON.stringify(value));
  }
  const read = async file => JSON.parse(await fs.readFile(new URL(file,data),'utf8'));
  await fs.copyFile(new URL('../site/data/counties.geojson',import.meta.url),new URL('counties.geojson',data));
  await fs.writeFile(new URL('terminal-report.txt',data),fixtureTerminals);
  await Promise.all([
    seed('terminals.json',{retrievedAt:date,reports:parseTerminals(fixtureTerminals)}),
    seed('fallback.json',{stations:[first,second]}),
    seed('gasbuddy-current.json',{stations:[gasReport],retrievedAt:date,latestDaneFuelAt:date}),
    seed('geocode-cache.json',{'321 STATE ST, MADISON, WI':{countyFips:'55025',coordinates:{x:-89.39,y:43.07}}}),
    seed('published-prices.json',{stations:[],publishedAt:date}),
  ]);
  const correctedTerminals = fixtureTerminals.replaceAll('11/17/2026','11/20/2026');
  assert.notEqual(correctedTerminals,fixtureTerminals);
  const newerDane = {...gasReport,price:3.299,reportedAt:'2026-11-22T12:00:00Z'};
  const stamp = 'Nov 22, 2026, 08:21 AM EST';
  const storeDetails = {storeNumber:100,name:'Kwik Trip #100',
    address:{state:'WI',address1:first.address,city:first.city,county:'Dane'},
    fuel:[{type:'UNLEADED 87',currentPrice:3.459}]};
  const fetchResource = async url => {
    if (url.endsWith('wisconsin-cta.txt')) return new Response(correctedTerminals);
    if (url.endsWith('prices.json')) return Response.json({stations:[newerDane],lastSuccessAt:'2026-11-22T13:00:00Z'});
    if (url.endsWith('/page/2/')) return new Response(publishedMarkup(stamp,'456 Grand Ave','3.419'));
    if (url.endsWith('/wisconsin/')) return new Response(publishedMarkup(stamp,'123 Main St','3.459'));
    if (url.endsWith('/100')) return Response.json(storeDetails);
    return new Response(null,{status:503});
  };
  const run = await refresh({data,fetchResource,now,log:() => {}});
  assert.equal(run.successful,4);
  assert.match(run.states['Kwik Trip'],/1 regular quotes in 1 counties\. 1 requests failed/);
  assert.match(run.states.GasBuddy,/1 newer reports saved/);
  assert.equal((await read('terminals.json')).reports[0].reportDate,'2026-11-20');
  assert.equal((await read('fallback.json')).stations[0].price,3.459);
  assert.deepEqual((await read('fallback.json')).stations[1],second);
  assert.equal((await read('gasbuddy-current.json')).stations[0].reportedAt,newerDane.reportedAt);
  assert.equal((await read('gasbuddy-current.json')).stations[0].lat,43.07);
  assert.equal((await read('published-prices.json')).stations.length,2);
  assert.equal((await read('published-prices.json')).stations[0].observedAt,'2026-11-22T13:21:00.000Z');

  const beforeFailure = await Promise.all([
    'terminal-report.txt','terminals.json','fallback.json','gasbuddy-current.json','published-prices.json',
  ].map(async file => [file,await fs.readFile(new URL(file,data),'utf8')]));
  const unchanged = await refresh({data,now,log:() => {},fetchResource:async url => {
    if (url.endsWith('wisconsin-cta.txt')) return new Response(fixtureTerminals);
    if (url.endsWith('prices.json')) return Response.json({stations:[gasReport]});
    if (url.endsWith('/wisconsin/')) return new Response(publishedMarkup(stamp,'123 Main St','3.459'));
    return new Response(null,{status:403});
  }});
  assert.equal(unchanged.successful,2);
  const failed = await refresh({data,now,log:() => {},fetchResource:async () => new Response(null,{status:403})});
  assert.equal(failed.successful,0);
  for (const [file, before] of beforeFailure) assert.equal(await fs.readFile(new URL(file,data),'utf8'),before);
});

test('publisher refuses to combine pages from different updates',async () => {
  const read = async url => publishedMarkup(
    url.endsWith('/page/2/') ? 'Nov 22, 2026, 08:19 AM EST' : 'Nov 22, 2026, 08:21 AM EST',
    url.endsWith('/page/2/') ? second.address : first.address,'3.449');
  await assert.rejects(readPublisherSnapshot(read,{publishedAt:date},now),/pages disagree/);
});
