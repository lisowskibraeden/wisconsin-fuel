import {costFloor} from './model.js';

const historyDay = 86400000;
const historyMonthDay = new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'short', day:'numeric'});
const historyFullDate = new Intl.DateTimeFormat('en-US', {timeZone:'UTC', dateStyle:'medium'});
const historyPrice = value => `$${value.toFixed(3)}`;

export function countyHistory(days, {source, members, cash, delivery}) {
  const terms = ['standard'];
  if (members) terms.push('member');
  if (cash) terms.push('cash');
  if (members && cash) terms.push('memberCash');

  return Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, day]) => {
    let quote = null;
    for (const [name, prices] of Object.entries(day.quotes ?? {})) {
      if (source !== 'available' && source !== name) continue;
      for (const term of terms) {
        const price = prices[term];
        if (Number.isFinite(price) && (!quote || price < quote.price)) quote = {price, source:name};
      }
    }
    const cost = costFloor(day.terminal?.wholesale, delivery);
    const estimate = cost && {price:cost.price, market:day.terminal.market, product:day.terminal.product};
    const time = Date.parse(date);
    return Number.isFinite(time) && (quote || estimate) ? [{date, time, quote, estimate}] : [];
  });
}

export function historyLines(points, key, x, y) {
  let previous = null;
  return points.flatMap(point => {
    if (!point[key]) return [];
    const command = previous && point.time - previous.time === historyDay ? 'L' : 'M';
    previous = point;
    return `${command}${x(point.time).toFixed(2)},${y(point[key].price).toFixed(2)}`;
  }).join(' ');
}

function historyChart(points) {
  const width = 300, height = 130, left = 48, right = 290, top = 12, bottom = 104;
  const first = points[0].time, last = points.at(-1).time;
  const amounts = points.flatMap(point => [point.quote?.price, point.estimate?.price]).filter(Number.isFinite);
  const minimum = Math.floor(Math.min(...amounts) * 10) / 10;
  const maximum = Math.max(minimum + .2, Math.ceil(Math.max(...amounts) * 10) / 10);
  const x = time => first === last ? (left + right) / 2 : left + (time - first) / (last - first) * (right - left);
  const y = price => bottom - (price - minimum) / (maximum - minimum) * (bottom - top);
  const valueTicks = [minimum, (minimum + maximum) / 2, maximum];
  const dateTicks = last - first >= 4 * historyDay ? [first, first + Math.floor((last - first) / (historyDay * 2)) * historyDay, last] : [...new Set([first, last])];
  const priceGrid = valueTicks.map(price => `<line class="history-grid" x1="${left}" x2="${right}" y1="${y(price)}" y2="${y(price)}"/><text x="2" y="${y(price)}" dy=".34em">$${price.toFixed(2)}</text>`).join('');
  const dateLabels = dateTicks.map(time => {
    const anchor = first === last || (time !== first && time !== last) ? 'middle' : time === first ? 'start' : 'end';
    return `<text x="${x(time)}" y="124" text-anchor="${anchor}">${historyMonthDay.format(new Date(time))}</text>`;
  }).join('');
  const series = ['estimate', 'quote'].map(key => {
    const path = historyLines(points, key, x, y);
    const marks = points.filter(point => point[key]).map(point => {
      const horizontal = x(point.time), vertical = y(point[key].price);
      return key === 'quote' ? `<circle cx="${horizontal}" cy="${vertical}" r="3.2"/>` : `<rect x="${horizontal - 2.5}" y="${vertical - 2.5}" width="5" height="5" transform="rotate(45 ${horizontal} ${vertical})"/>`;
    }).join('');
    return `<g class="history-series history-${key}"><path d="${path}"/>${marks}</g>`;
  }).join('');
  return {
    view:`<svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily regular gas quotes and regional estimates in dollars per gallon" aria-describedby="history-caption">${priceGrid}${dateLabels}<line class="history-cursor" y1="${top}" y2="${bottom}"/>${series}</svg>`,
    x, width
  };
}

export function renderHistory(panel, days, options, view) {
  const full = countyHistory(days, options);
  const newest = full.at(-1)?.time;
  const points = view.window ? full.filter(point => point.time > newest - view.window * historyDay) : full;
  const chart = points.length && historyChart(points);
  panel.innerHTML = `<div class="history-heading"><h3 id="history-heading">Price history</h3>${chart ? `
    <select aria-label="History date range">
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
      <option value="0">All dates</option>
    </select>` : ''}</div>${chart ? `
    <div class="history-key"><span class="history-key-quote">Lowest collected quote</span><span class="history-key-estimate">Estimated minimum</span></div>
    ${chart.view}
    ${points.length > 1 ? `<label class="history-scrub">Explore dates <input type="range" min="0" max="${points.length - 1}" step="1"></label>` : ''}
    <p class="history-reading" aria-live="polite"></p>
    <p id="history-caption" class="history-caption">Recorded days through ${historyFullDate.format(new Date(newest))}. Gaps mark days without data. Quote dates use Central time.</p>` : '<p class="history-caption">No historical records are available for this selection.</p>'}`;
  if (!chart) return;

  const range = panel.querySelector('select');
  const slider = panel.querySelector('input');
  const cursor = panel.querySelector('.history-cursor');
  const reading = panel.querySelector('.history-reading');
  const plot = panel.querySelector('svg');
  function showPoint(index) {
    const point = points[index];
    view.date = point.date;
    const date = historyFullDate.format(new Date(point.time));
    if (slider) {
      slider.value = index;
      slider.setAttribute('aria-valuetext', date);
    }
    cursor.setAttribute('x1', chart.x(point.time));
    cursor.setAttribute('x2', chart.x(point.time));
    const label = document.createElement('strong');
    label.textContent = date;
    const quote = point.quote ? `${historyPrice(point.quote.price)} · ${point.quote.source}` : 'No collected quote';
    const estimate = point.estimate ? `${historyPrice(point.estimate.price)} estimate · ${point.estimate.market}` : 'No terminal estimate';
    reading.replaceChildren(label, document.createTextNode(quote), document.createTextNode(estimate));
  }

  range.value = String(view.window);
  range.onchange = () => {
    view.window = Number(range.value);
    renderHistory(panel, days, options, view);
    panel.querySelector('select')?.focus();
  };
  if (slider) slider.oninput = () => showPoint(Number(slider.value));
  plot.onclick = event => {
    const bounds = plot.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width * chart.width;
    const nearest = points.reduce((best, point, index) => Math.abs(chart.x(point.time) - horizontal) < Math.abs(chart.x(points[best].time) - horizontal) ? index : best, 0);
    showPoint(nearest);
  };
  const index = points.findIndex(point => point.date === view.date);
  showPoint(index < 0 ? points.length - 1 : index);
}
