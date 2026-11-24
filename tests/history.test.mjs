import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mergeHistory} from '../scripts/update-history.mjs';
import {countyHistory, historyLines, renderHistory} from '../site/history.js';
import {costFloor, countyModels} from '../site/model.js';

const geography = JSON.parse(await fs.readFile(new URL('../site/data/counties.geojson', import.meta.url), 'utf8'));
const counties = countyModels(geography);
const archived = JSON.parse(await fs.readFile(new URL('../site/data/history.json', import.meta.url), 'utf8')).counties;
const options = {source:'available', members:false, cash:false, delivery:.025};

test('retains daily minima by source and terms without assigning stale quotes to the collection date', () => {
  const history = {schemaVersion:1, counties:{}};
  const station = {
    state:'WI', fuel:'regular', source:'GasBuddy', countyFips:'55025',
    observedAt:'2026-11-22T08:00:00Z', reportedAt:'2026-11-22T05:00:00Z', price:3.399
  };
  const retrievedAt = '2026-11-22T11:00:00Z';
  const observations = [station,
    {...station, price:3.09, payment:'cash'},
    {...station, price:3.29, membership:true},
    {...station, price:2.99, payment:'cash', membership:true},
    {...station, price:3.49},
    {...station, price:2.19, reportedAt:'2026-11-20T20:00:00Z'},
    {...station, price:3.19, source:'Kwik Trip', timeBasis:'retrieved', observedAt:retrievedAt, reportedAt:null},
  ];
  mergeHistory(history, counties, observations, []);
  mergeHistory(history, counties, [observations[4]], []);
  const dane = history.counties['55025'];
  assert.deepEqual(Object.keys(dane), ['2026-11-21', '2026-11-22']);
  assert.equal(countyHistory(dane, options)[0].quote.price, 3.399);
  assert.equal(countyHistory(dane, {...options, cash:true})[0].quote.price, 3.09);
  assert.equal(countyHistory(dane, {...options, members:true})[0].quote.price, 3.29);
  assert.equal(countyHistory(dane, {...options, members:true, cash:true})[0].quote.price, 2.99);
  assert.equal(countyHistory(dane, {...options, source:'GasBuddy'}).length, 1);
  assert.deepEqual(countyHistory(dane, {...options, source:'Kwik Trip'})[0].quote, {price:3.19, source:'Kwik Trip'});
});

test('historical estimates use saved terminal quotes and the selected delivery assumption', () => {
  assert.equal(Object.keys(archived).length, 72);
  for (const days of Object.values(archived)) {
    assert.ok(days['2026-11-17'].terminal);
    assert.ok(days['2026-11-20'].terminal);
  }
  const dane = countyHistory(archived['55025'], {...options, delivery:.075});
  const earliest = dane.find(point => point.date === '2026-11-02');
  assert.equal(earliest.estimate.price, costFloor(2.958, .075).price);
  const milwaukee = countyHistory(archived['55079'], options);
  assert.equal(milwaukee.find(point => point.date === '2026-11-17').estimate.product, '87RE10');
});

test('the chart preserves separate gaps in the quote and estimate series', () => {
  const days = {
    '2026-11-17':{quotes:{GasBuddy:{standard:3.4}}, terminal:{wholesale:2.3}},
    '2026-11-18':{quotes:{GasBuddy:{standard:3.3}}},
    '2026-11-20':{quotes:{GasBuddy:{standard:3.2}}, terminal:{wholesale:2.2}},
  };
  const points = countyHistory(days, options);
  const chartX = time => (time - points[0].time) / 86400000;
  const chartY = price => price;
  assert.equal(historyLines(points, 'quote', chartX, chartY), 'M0.00,3.40 L1.00,3.30 M3.00,3.20');
  assert.match(historyLines(points, 'estimate', chartX, chartY), /^M0\.00,\d+\.\d+ M3\.00,\d+\.\d+$/);
});

test('selecting a history date updates its quote and changing counties renders local estimates', () => {
  const daneDays = {
    '2026-11-01':{quotes:{GasBuddy:{standard:3.499}}},
    '2026-11-12':{quotes:{GasBuddy:{standard:3.299}}},
    '2026-11-21':{quotes:{GasBuddy:{standard:3.099}}},
  };
  const milwaukeeDays = {
    '2026-11-20':{terminal:{wholesale:2.275, market:'Milwaukee, WI', product:'87RE10'}},
  };
  const target = {
    setAttribute(name, value) { this[name] = value; },
    getBoundingClientRect() { return {left:0, width:300}; },
    replaceChildren(...children) { this.children = children; },
    focus() {}
  };
  const elements = Object.fromEntries(['select', 'input', '.history-cursor', '.history-reading', 'svg'].map(key => [key, {...target}]));
  const panel = {querySelector: selector => elements[selector]};
  const view = {window:30, date:null};
  const before = globalThis.document;
  globalThis.document = {createElement:() => ({}), createTextNode:text => text};
  try {
    renderHistory(panel, daneDays, options, view);
    assert.match(panel.innerHTML, /Lowest collected quote/);
    assert.match(panel.innerHTML, /Estimated minimum/);
    assert.equal(view.date, '2026-11-21');
    elements.input.value = '0';
    elements.input.oninput();
    assert.equal(view.date, '2026-11-01');
    assert.equal(elements.input['aria-valuetext'], 'Nov 1, 2026');
    assert.match(elements['.history-reading'].children[1], /\$3\.499/);
    elements.svg.onclick({clientX:145});
    assert.equal(view.date, '2026-11-12');
    view.date = null;
    renderHistory(panel, milwaukeeDays, options, view);
    assert.match(panel.innerHTML, /history-estimate/);
    assert.equal(elements['.history-reading'].children[0].textContent, 'Nov 20, 2026');
    assert.match(elements['.history-reading'].children[2], /Milwaukee, WI/);
  } finally {
    globalThis.document = before;
  }
});
