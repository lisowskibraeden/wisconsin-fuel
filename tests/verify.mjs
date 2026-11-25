import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {eligible,costFloor,countyModels,floorFor,parseTerminals,fresh,sourceTime,inside} from '../site/model.js';
import {createLocationLookup, hasLocation, unpricedLocations} from '../site/locations.js';
const root=new URL('../',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
const data=async name=>JSON.parse(await read('site/data/'+name));
const reports=parseTerminals(await read('tests/fixtures/terminal-report.txt'));
const counties=countyModels(await data('counties.geojson'));
assert.equal(counties.length,72);
assert.equal(reports.length,13);
assert.equal(costFloor(2.958).price,3.817);
const testDate=Date.parse(`${reports[0].reportDate}T10:30:00-06:00`);
const dane=counties.find(c=>c.name==='Dane');
assert.equal(floorFor(dane,reports,{now:testDate}).price,costFloor(reports.find(report=>report.id==='967').prices.ULC10).price);
assert.equal(floorFor(counties.find(c=>c.name==='Milwaukee'),reports,{now:testDate}).product,'87RE10');
const gas=await data('gasbuddy-current.json'),direct=await data('fallback.json');
assert.ok(gas.stations.length>0 && direct.stations.length>0);
const rows=[...gas.stations,...direct.stations];
assert.ok(rows.every(row=>counties.some(county=>county.id===row.countyFips)||row.countyFips===null));
assert.ok(!fresh({...gas.stations[0],reportedAt:'2020-01-01T00:00:00Z'},testDate));
const bundle=await read('preview.html');
const scripts=[...bundle.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,2);
for(const script of scripts)new vm.Script(script[1]);
const published=await data('published-prices.json');
const publishedTime=Date.parse(published.publishedAt);
assert.ok(Number.isFinite(publishedTime));
assert.ok(published.stations.every(s=>s.timeBasis==='published' && s.observedAt===published.publishedAt && s.reportedAt===null));
assert.equal(eligible(published.stations,{source:'FuelRadarDash',now:publishedTime}).length,published.stations.length);
assert.equal(eligible(published.stations,{now:publishedTime+24*3600000+1}).length,0);
const embedded=JSON.parse(scripts[1][1].match(/^const embeddedData=(.*);$/m)[1]);
assert.deepEqual(embedded['data/published-prices.json'],published);
const costco = await data('costco-prices.json');
assert.ok(costco.stations.length > 0 && costco.stations.every(s => s.membership && s.source === 'FuelRadarDash' && s.timeBasis === 'published'));
assert.deepEqual(embedded['data/costco-prices.json'],costco);
assert.deepEqual(embedded['data/gaswiser-prices.json'],await data('gaswiser-prices.json'));
assert.deepEqual(embedded['data/history.json'],await data('history.json'));
assert.deepEqual(embedded['data/station-locations.json'],await data('station-locations.json'));
assert.ok(!bundle.includes('basemaps.cartocdn.com'));
const app=await read('site/app.js');
const station={...rows[0],id:'fixture',name:'Test "One", Inc.',address:'123 Main St',city:'Madison',county:'Dane',countyFips:'55025',price:3.499,observedAt:new Date().toISOString(),reportedAt:null,timeBasis:'retrieved',source:'Kwik Trip'};
let csvBlob,anchor={click(){this.clicked=true;}};
const context=vm.createContext({allStations:[station],state:{source:'available',members:false,cash:false},counties,eligible,estimate:c=>floorFor(c,reports,{now:testDate}),Blob,Date,URL:{createObjectURL(blob){csvBlob=blob;return 'blob:csv-test';},revokeObjectURL(){}},document:{createElement(tag){assert.equal(tag,'a');return anchor;}},setTimeout(fn){fn();}});
vm.runInContext(app.slice(app.indexOf('function download()'),app.indexOf('async function init()'))+'\ndownload();',context);
assert.ok(anchor.clicked);
assert.match(anchor.download,/^wisconsin-fuel-\d{4}-\d{2}-\d{2}\.csv$/);
const csv=await csvBlob.text();
assert.equal(csv.split('\r\n').length,2);
assert.ok(csv.includes('"Test ""One"", Inc."'));
assert.ok(csv.includes('"reported_at","retrieved_at","time_basis"'));
assert.ok(csv.includes('"3.499"'));
assert.equal(csvBlob.type,'text/csv;charset=utf-8');
const field={},deliveryState={delivery:.025};let saves=0,renders=0;
const deliveryContext=vm.createContext({$:()=>field,state:deliveryState,save:()=>saves++,render:()=>renders++});
const handler=app.match(/\$\('delivery-input'\)\.oninput=e=>\{.*?render\(\);\}\}/)?.[0];
assert.ok(handler,'Delivery handler exists');vm.runInContext(handler,deliveryContext);
field.oninput({target:{value:'7.5'}});
assert.equal(deliveryState.delivery,.075);
assert.equal(saves,1);assert.equal(renders,1);
assert.ok(costFloor(2.278,deliveryState.delivery).price>3.075);
field.oninput({target:{value:'-5'}});assert.equal(deliveryState.delivery,.075);
field.oninput({target:{value:'2.5'}});assert.equal(costFloor(2.278,deliveryState.delivery).price,3.075);

const fields = new Map();
let currentQuote = {...station, observedAt:'2026-11-23T15:00:00Z'};
const priceContext = vm.createContext({
  eligible, floorFor, fresh, sourceTime, inside, createLocationLookup, hasLocation, unpricedLocations, AbortSignal, Intl, countiesFixture:counties,
  Date:class extends Date { static now() { return Date.parse('2026-11-23T17:00:00Z'); } },
  document:{hidden:false,getElementById(id) {
    if (!fields.has(id)) fields.set(id, {});
    return fields.get(id);
  }},
  fetch:async (url, options) => {
    assert.equal(options.cache, 'no-cache');
    if (url === 'data/published-prices.json') throw Error('Temporary network failure');
    const content = url === 'data/terminals.json' ? {reports} :
      {stations:url === 'data/fallback.json' ? [currentQuote] : []};
    return new Response(JSON.stringify(content));
  },
});
vm.runInContext(app.replace(/^import .+;\n/gm,'').replace(/\ninit\(\);\s*$/,'') + `
  counties = countiesFixture;
  archivedStations = [];
  renderCounty = () => {};
  renderMap = () => {};
`, priceContext);
await vm.runInContext('refreshDisplayedPrices()', priceContext);
assert.equal(fields.get('summary-low').textContent, '$3.499');
currentQuote = {...currentQuote, price:3.199, observedAt:'2026-11-23T16:30:00Z'};
await vm.runInContext('refreshDisplayedPrices()', priceContext);
assert.equal(fields.get('summary-low').textContent, '$3.199');
assert.match(fields.get('summary-low-place').textContent, /10:30 AM CT/);
console.log('PASS: data import, 72-county geometry, snapshot county assignments, freshness, regional grades, rounding, standalone script syntax, CSV escaping/download wiring, and delivery-cost control.');
