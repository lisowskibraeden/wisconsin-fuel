import {eligible,fresh,sourceTime,floorFor,compare,countyModels,inside} from './model.js';
import {stationLogoFile} from './brands.js';
import {renderHistory} from './history.js';
import {createLocationLookup, hasLocation, unpricedLocations} from './locations.js';
const $=id=>document.getElementById(id),money=v=>Number.isFinite(v)?'$'+v.toFixed(3):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const reportDate=value=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(value+'T12:00:00Z'));
const age=value=>{const hours=(Date.now()-Date.parse(value))/3600000;return hours<1?Math.max(1,Math.floor(hours*60))+'m ago':hours<24?Math.floor(hours)+'h ago':Math.floor(hours/24)+'d ago';};
let stored={};try{stored=JSON.parse(localStorage.getItem('wi-fuel-settings')||'{}');}catch{}
const state={layer:'current',county:'55025',source:'available',members:stored.members??false,cash:stored.cash??false,delivery:stored.delivery??.025,gallons:stored.gallons??12};
let map,geoLayer,counties=[],allStations=[],reports=[],stationLayer,labelLayer,selectedStation=null,searchChoices=[],streetLayer;
let countyHistoryData = {};
let currentRows = [];
let stationLocations = [];
let mapLocations = [];
let matchLocation = createLocationLookup([]);
const historyView = {window:30, date:null};
const streetZoom = 10;
const streetDetail = () => Boolean(map && map.getZoom() >= streetZoom && $('basemap').checked);

function stationLogo(name, brand) {
  const file = stationLogoFile(brand || name) || stationLogoFile(name);
  const url = file && (typeof embeddedLogos === 'undefined' ? 'assets/logos/' + file : embeddedLogos[file]);
  return url ? `<span class="station-logo"><img src="${esc(url)}" alt="" decoding="async"></span>` : '';
}

let countyRows=new Map(),countyFloors=new Map(),currentRange=[0,1],floorRange=[0,1];
const save=()=>{try{localStorage.setItem('wi-fuel-settings',JSON.stringify({members:state.members,cash:state.cash,delivery:state.delivery,gallons:state.gallons}));}catch{}};
async function load(url, defaultValue) {
  if (typeof embeddedData !== 'undefined' && Object.hasOwn(embeddedData, url)) return embeddedData[url];
  const response = await fetch(url, {cache:'no-cache', signal:AbortSignal.timeout(15000)});
  if (response.ok) return response.json();
  if (defaultValue !== undefined) return defaultValue;
  throw Error(`${url}: HTTP ${response.status}`);
}
const stationsFor=id=>countyRows.get(id)||[];
const estimate=c=>countyFloors.get(c.id);
function recompute(){const now=Date.now();currentRows=eligible(allStations,{now,source:state.source,members:state.members,cash:state.cash});mapLocations=unpricedLocations(stationLocations,currentRows,matchLocation);countyRows=new Map(counties.map(c=>[c.id,[]]));for(const s of currentRows)countyRows.get(s.countyFips)?.push(s);countyFloors=new Map(counties.map(c=>[c.id,floorFor(c,reports,{now,delivery:state.delivery})]));currentRange=extent([...countyRows.values()].map(r=>r[0]?.price).filter(Number.isFinite));floorRange=extent([...countyFloors.values()].filter(f=>f&&!f.stale).map(f=>f.price));}
const palette=['#d5e6d6','#a6cfb4','#75b59b','#438b77','#205e54'];
const floorsPalette=['#e2e9c5','#c6d7a7','#a4bf8a','#7fa46e','#56845b'];
function extent(values){if(!values.length)return [0,1];return [Math.min(...values),Math.max(...values)];}
function currentExtent(){return currentRange;}
function floorExtent(){return floorRange;}
function shade(value,min,max,colors=palette){return Number.isFinite(value)?colors[Math.max(0,Math.min(4,Math.floor((value-min)/(max-min||1)*4.999))) ]:'#dfe5df';}
function layerStyle(feature){const c=counties.find(c=>c.id===feature.id),rows=stationsFor(c.id),floor=estimate(c);let fill='#dfe5df';if(state.layer==='current')fill=shade(rows[0]?.price,...currentExtent());if(state.layer==='floor'&&floor&&!floor.stale)fill=shade(floor.price,...floorExtent(),floorsPalette);if(state.layer==='gap'){const signal=compare(rows,floor);fill=({near:'#82b59b',watch:'#decfa5',room:'#cd9a6a',unknown:'#dfe5df'})[signal.kind];}const selected = feature.id === state.county;
  const detail = streetDetail();
  return {
    fillColor: fill,
    fillOpacity: detail ? (state.layer === 'current' ? 0 : .15) : .72,
    color: selected ? '#214e40' : detail ? '#4b6458' : '#fff',
    weight: selected ? 2 : 1,
    opacity: detail ? (selected ? .65 : .3) : 1,
  };}
function countyTooltip(c){const rows=stationsFor(c.id),floor=estimate(c);return `<b>${esc(c.name)} County</b><br>Lowest available: ${money(rows[0]?.price)}<br>Estimated minimum: ${money(floor?.price)}${floor?.stale?' · stale':''}<br><span style="color:#78877d">${rows.length} fresh quotes · click to explore</span>`;}
function renderSummary(){const rows=currentRows,coverage=new Set(rows.map(s=>s.countyFips)).size;const middle=Math.floor(rows.length/2),median=rows.length?(rows.length%2?rows[middle].price:(rows[middle-1].price+rows[middle].price)/2):null;const prices=counties.map(c=>estimate(c)).filter(f=>f&&!f.stale).map(f=>f.price);$('summary-low').textContent=money(rows[0]?.price);$('summary-low-place').textContent=rows.length?`${rows[0].city} · ${rows[0].source} · ${fmtDate(sourceTime(rows[0]))} CT`:'No fresh quotes for selected sources';$('summary-median').textContent=money(median);$('summary-floor').textContent=prices.length?`$${Math.min(...prices).toFixed(2)}–${Math.max(...prices).toFixed(2)}`:'—';$('summary-coverage').innerHTML=`${coverage} <em>/ 72 counties</em>`;$('summary-stations').textContent=`${rows.length.toLocaleString()} fresh station quotes · regular 87`;const sources = [...new Set(rows.map(row => row.source === 'Kwik Trip' ? 'Kwik Trip direct' : row.source))];
$('source-message').textContent = rows.length
  ? `${sources.join(' + ')} · Regular prices in ${coverage} of 72 counties`
  : 'No recent station prices are available for the selected sources.';
$('snapshot-label').textContent='Saved price snapshot';const latest=Math.max(...rows.map(s=>Date.parse(sourceTime(s))));$('snapshot-time').textContent=Number.isFinite(latest)?'Newest quote '+fmtDate(latest)+' CT':'No fresh station quotes';$('map-footer').textContent=`${coverage} counties with fresh quotes · ${rows.length} quotes`;}
const timeLabel = station => ({retrieved:'retrieved', published:'snapshot published'})[station.timeBasis] || 'reported';
function stationHTML(s){return `<a class="station-row" href="${esc(s.url)}" target="_blank" rel="noreferrer">${stationLogo(s.name)}<span class="station-info"><b>${esc(s.name)}</b><small>${esc(s.address)} · ${esc(s.city)}</small><small>${esc(s.source)}${s.membership?' · membership':''}${s.payment==='cash'?' · cash':''}</small></span><span class="station-price"><strong>${money(s.price)}</strong><small>${timeLabel(s)} ${age(sourceTime(s))}</small></span></a>`;}
function renderCounty(){const c=counties.find(c=>c.id===state.county),rows=stationsFor(c.id),floor=estimate(c),signal=compare(rows,floor),sourceNames=[...new Set(rows.map(s=>s.source))];const cents=signal.gap===null?null:Math.max(0,signal.gap)*100;const scenario=signal.kind==='unknown'?'Fresh local quotes and a recent terminal report are needed before comparing.':signal.kind==='room'?'There’s a gap to the regional cost estimate. Watching prices may pay off; a drop in the next few days is not confirmed.':signal.kind==='near'?'The lowest collected quote is already close to or below the cost estimate. The model sees little room to fall.':'The gap is modest. Check nearby stations again before deciding to wait.';
  $('county-panel').innerHTML=`<div class="county-location">WISCONSIN <button id="county-zoom">Zoom to county ↗</button></div><h2>${esc(c.name)} County</h2><p class="county-subtitle">${rows.length} fresh quotes${sourceNames.length?' · '+esc(sourceNames.join(' + ')):''} · Regular 87</p><div class="price-comparison"><div><span>Lowest available now</span><strong>${money(rows[0]?.price)}</strong><small>${rows.length?'Among collected quotes':'No fresh local quotes'}</small></div><div><span>Estimated minimum</span><strong class="floor-value">${money(floor?.price)}</strong><small>${floor?.stale?'Stale terminal report':floor?'Regional cost estimate':'No matching product'}</small></div></div><div class="signal ${signal.kind}"><div class="signal-top"><span><span class="signal-icon">${signal.kind==='room'?'↘':signal.kind==='near'?'≈':'◷'}</span>${signal.label}</span>${cents!==null?`<span class="gap">${cents.toFixed(1)}¢</span>`:''}</div><p>${scenario}</p></div><div class="tank-row"><span>If the floor is reached · <label><input id="tank-gallons" aria-label="Fill-up gallons" type="number" min="1" max="100" step="1" value="${state.gallons}"> gal</label></span><strong id="tank-saving">${cents===null?'—':'$'+(Math.max(0,signal.gap)*state.gallons).toFixed(2)} potential</strong></div><div class="floor-note">${floor?`<b>${esc(floor.market.name)} quoted market</b> · ${reportDate(floor.reportDate)}<br>${esc(floor.product)}${floor.rfg?' · Reformulated regular':''} · ${Number(state.delivery*100).toFixed(1)}¢ assumed delivery<br>County-center proximity estimate. Not a guaranteed future price.`:'A matching wholesale grade is needed for this estimate.'}</div><section class="history-panel" id="county-history" aria-labelledby="history-heading"></section><div class="station-header">Available stations <span>LOWEST FIRST</span></div><div class="station-list">${rows.length?rows.slice(0,30).map(stationHTML).join(''):`<div class="no-data">No fresh ${state.source==='GasBuddy'?'GasBuddy ':''}prices collected for this county.<br>We leave the price blank rather than guess.<a href="https://www.gasbuddy.com/home?${new URLSearchParams({search:c.name+' County, WI',fuel:'1'})}" target="_blank" rel="noreferrer">Check ${esc(c.name)} on GasBuddy ↗</a></div>`}</div>${rows.length>30?`<div class="floor-note">Showing 30 of ${rows.length} quotes. Download prices for the full selection.</div>`:''}<div class="filters"><label><input type="checkbox" id="include-members" ${state.members?'checked':''}>Membership</label><label><input type="checkbox" id="include-cash" ${state.cash?'checked':''}>Cash-only quotes</label></div><a class="station-link" href="https://www.gasbuddy.com/home?${new URLSearchParams({search:c.name+' County, WI',fuel:'1'})}" target="_blank" rel="noreferrer">Compare more stations on GasBuddy ↗</a>`;
  renderHistory($('county-history'), countyHistoryData[c.id] ?? {}, state, historyView);
  $('county-zoom').onclick=()=>zoomCounty(c);$('include-members').onchange=e=>{state.members=e.target.checked;save();render();};$('include-cash').onchange=e=>{state.cash=e.target.checked;save();render();};$('tank-gallons').oninput=e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=1&&n<=100){state.gallons=n;save();$('tank-saving').textContent=signal.gap===null?'—':`$${(Math.max(0,signal.gap)*n).toFixed(2)} potential`;}};
}
function zoomCounty(c){const layer=geoLayer.getLayers().find(l=>l.feature.id===c.id);map.fitBounds(layer.getBounds(),{padding:[40,40],maxZoom:10});}
function selectCounty(id,{zoom=false}={}){if(state.county!==id)historyView.date=null;state.county=id;selectedStation=null;renderCounty();renderMap();if(zoom)zoomCounty(counties.find(c=>c.id===id));}
function renderLegend(){
  if (state.layer === 'current' && map.getZoom() >= streetZoom) {
    const locations = state.source === 'available' ? '<span><i class="station-dot unpriced"></i>No price shown</span>' : '';
    $('legend').innerHTML = `<div class="legend-title">Station locations</div><div class="station-legend"><span><i class="station-dot priced"></i>Recent price</span>${locations}</div>`;
    $('map-caption').textContent = 'Station locations · regular 87';
    return;
  }
  const title=state.layer==='current'?'Lowest collected price / gal':state.layer==='floor'?'Estimated minimum / gal':'Gap from lowest quote to estimate';const [min,max]=state.layer==='current'?currentExtent():floorExtent();let contents='';if(state.layer==='gap')contents=`<div class="legend-labels"><span>Near floor</span><span>Watch</span><span>15¢+ gap</span></div><div class="legend-scale" style="margin-top:6px"><span style="background:#82b59b"></span><span style="background:#decfa5"></span><span style="background:#cd9a6a"></span></div>`;else contents=`<div class="legend-scale">${(state.layer==='floor'?floorsPalette:palette).map(c=>`<span style="background:${c}"></span>`).join('')}</div><div class="legend-labels"><span>${min?money(min):'No quotes'}</span><span>${max&&min?money(max):''}</span></div>`;$('legend').innerHTML=`<div class="legend-title">${title}</div>${contents}<div class="legend-empty"><i></i>${state.layer==='floor'?'Unavailable or stale estimate':'No fresh collected reports'}</div>`;$('map-caption').textContent=state.layer==='current'?'Regular 87 · lowest fresh quote per county':state.layer==='floor'?'Regional cost estimates · not a price forecast':'Price headroom · timing is not predicted';}
function renderStationPins() {
  if (!$('show-stations').checked) return;
  const bounds = map.getBounds().pad(.1);
  const displayed = state.source === 'available' ? [...currentRows, ...mapLocations] : currentRows;
  const candidates = displayed.filter(hasLocation).flatMap(station => {
    const coordinates = [station.lat, station.lng];
    if (!bounds.contains(coordinates)) return [];
    return [{station, coordinates, point:map.latLngToContainerPoint(coordinates)}];
  });

  for (const candidate of candidates) {
    const {station, coordinates, point} = candidate;
    const priced = Number.isFinite(station.price);
    const logo = stationLogo(station.name, station.brand);
    const label = priced ? money(station.price) : 'No price shown';
    const width = priced ? 104 : 46;
    const compact = (!priced && !logo) || candidates.some(other => other !== candidate &&
      Math.abs(point.x - other.point.x) < width / 2 + 9 &&
      Math.abs(point.y - other.point.y) < 26);
    const selected = station.countyFips === state.county ? ' active' : '';
    const kind = priced ? 'priced' : 'unpriced';
    const icon = compact ? {
      html:`<span class="station-dot ${kind}${selected}"></span>`,
      iconSize:[16,16], iconAnchor:[8,8], popupAnchor:[0,-9],
    } : {
      html:`<div class="station-pin ${kind}${selected}">${logo}${priced ? `<span class="station-pin-price">${label}</span>` : ''}</div>`,
      iconSize:[width,34], iconAnchor:[width / 2,17], popupAnchor:[0,-17],
    };
    const title = `${station.name} · ${label}`;
    const marker = L.marker(coordinates, {title, icon:L.divIcon({className:'station-marker', ...icon})});
    marker.on('add', () => marker.getElement()?.setAttribute('aria-label', title));
    const address = [station.address, station.city].filter(Boolean).map(esc).join(', ');
    const details = priced
      ? `${esc(station.source)} · ${timeLabel(station)} ${age(sourceTime(station))}`
      : 'Station location from OpenStreetMap';
    marker.bindPopup(`<div class="popup-brand">${logo}<b>${esc(station.name)}</b></div>${address}<span class="popup-price">${label}</span>${details}${station.membership ? ' · Membership' : ''}<br><a href="${esc(station.url)}" target="_blank" rel="noreferrer">View source ↗</a>`, {autoPan:false});
    marker.on('click', () => {
      if (state.county !== station.countyFips) historyView.date = null;
      state.county = station.countyFips;
      renderCounty();
      geoLayer.setStyle(layerStyle);
    });
    stationLayer.addLayer(marker);
  }
}

function renderPins() {
  labelLayer.clearLayers();
  stationLayer.clearLayers();
  if (map.getZoom() >= streetZoom && state.layer === 'current') {
    renderStationPins();
    return;
  }
  const points=[],ordered=[...counties].sort((a,b)=>(b.id===state.county)-(a.id===state.county)||stationsFor(b.id).length-stationsFor(a.id).length);
  for(const c of ordered){const rows=stationsFor(c.id),floor=estimate(c),signal=compare(rows,floor);const value=state.layer==='floor'?floor&&!floor.stale?floor.price:null:state.layer==='gap'?signal.gap===null?null:Math.max(0,signal.gap)*100:rows[0]?.price;if(!Number.isFinite(value))continue;const loc=[(c.labelCenter||c.center).lat,(c.labelCenter||c.center).lng],p=map.latLngToContainerPoint(loc);if(p.x<20||p.y<30||p.x>map.getSize().x-20||p.y>map.getSize().y-20)continue;const width=88;if(points.some(q=>Math.abs(q.x-p.x)<width&&Math.abs(q.y-p.y)<42))continue;points.push(p);const label=state.layer==='gap'?value.toFixed(0)+'¢':money(value);const marker=L.marker(loc,{title:`${c.name} County: ${label}`,icon:L.divIcon({className:'price-pin',html:`<div class="price-pill ${state.layer} ${c.id===state.county?'active':''}">${label}<small>${esc(c.name)}</small></div>`,iconSize:[86,42],iconAnchor:[43,21]})});marker.on('click',()=>selectCounty(c.id));labelLayer.addLayer(marker);}
}
function renderMap(){if(!map)return;geoLayer.setStyle(layerStyle);geoLayer.eachLayer(layer=>{const c=counties.find(c=>c.id===layer.feature.id);layer.setTooltipContent(countyTooltip(c));if(c.id===state.county)layer.bringToFront();});renderPins();renderLegend();}
function render(){recompute();renderSummary();renderCounty();renderMap();}
function initializeMap(geo){map=L.map('map',{zoomControl:false,minZoom:5,maxZoom:19,scrollWheelZoom:true,attributionControl:true});streetLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',maxZoom:19,opacity:1}).addTo(map);geoLayer=L.geoJSON(geo,{style:layerStyle,onEachFeature:(f,layer)=>{const c=counties.find(c=>c.id===f.id);layer.bindTooltip(countyTooltip(c),{sticky:true});layer.on({click:()=>selectCounty(c.id),mouseover:()=>layer.setStyle({weight:2,color:'#658570'}),mouseout:()=>geoLayer.resetStyle(layer)});layer.on('add',()=>{const path=layer.getElement();if(path){path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-label',c.name+' County');path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCounty(c.id);}});}});}}).addTo(map);stationLayer=L.layerGroup().addTo(map);labelLayer=L.layerGroup().addTo(map);L.control.zoom({position:'topright'}).addTo(map);map.fitBounds(geoLayer.getBounds(),{padding:[35,55]});map.on('moveend',renderPins);map.on('zoomend',()=>{geoLayer.setStyle(layerStyle);renderLegend();});$('fit-map').onclick=()=>map.fitBounds(geoLayer.getBounds(),{padding:[35,55]});$('show-stations').onchange=renderPins;$('basemap').onchange=e=>{if(e.target.checked)streetLayer.addTo(map);else map.removeLayer(streetLayer);renderMap();};map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright">Station locations © OpenStreetMap contributors</a>');map.attributionControl.addAttribution('<a href="https://github.com/plotly/datasets/blob/master/geojson-counties-fips.json" target="_blank" rel="noreferrer">County boundaries: Census via Plotly</a>');}
function search(){const term=$('place-search').value.trim().toLowerCase();if(!term){$('search-results').hidden=true;return;}searchChoices=[];for(const c of counties.filter(c=>c.name.toLowerCase().includes(term)))searchChoices.push({label:c.name+' County',detail:'Wisconsin · explore local prices',id:c.id});const cities=new Set();for(const s of allStations){const city=s.city.toLowerCase();if(city.includes(term)&&!cities.has(city)){cities.add(city);searchChoices.push({label:s.city.replace(/\b\w/g,c=>c.toUpperCase()),detail:s.county+' County',id:s.countyFips});}}if(searchChoices.length<4)for(const s of [...allStations,...stationLocations].filter(s=>(s.name+' '+s.address).toLowerCase().includes(term)).slice(0,6))searchChoices.push({label:s.name,detail:s.address+', '+s.city,id:s.countyFips,station:s});searchChoices=searchChoices.slice(0,8);$('search-results').hidden=false;$('search-results').innerHTML=searchChoices.length?searchChoices.map((r,i)=>`<button data-result="${i}">${esc(r.label)}<small>${esc(r.detail)}</small></button>`).join(''):'<p>No match. Try a Wisconsin county name.</p>';$('search-results').querySelectorAll('button').forEach(b=>b.onclick=()=>chooseSearch(Number(b.dataset.result)));}
function chooseSearch(i){const r=searchChoices[i];if(!r)return;$('place-search').value=r.label;$('search-results').hidden=true;selectCounty(r.id,{zoom:true});if(r.station&&Number.isFinite(r.station.lat))map.setView([r.station.lat,r.station.lng],12);}
function openInfo(){$('info-dialog').showModal();}
function download(){const rows=eligible(allStations,{source:state.source,members:state.members,cash:state.cash}),head=['station','address','city','county','source','regular_price','reported_at','retrieved_at','time_basis','estimated_minimum','terminal_market','terminal_date','url','published_at'];const csv=[head,...rows.map(s=>{const c=counties.find(c=>c.id===s.countyFips),f=c?estimate(c):null;return [s.name,s.address,s.city,s.county,s.source,s.price,s.reportedAt||'',s.timeBasis==='published'?'':s.observedAt,s.timeBasis,f?.price??'',f?.market.name??'',f?.reportDate??'',s.url,s.timeBasis==='published'?s.observedAt:''];})].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='wisconsin-fuel-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const priceFiles = {
  terminals: 'data/terminals.json',
  gas: 'data/gasbuddy-current.json',
  fallback: 'data/fallback.json',
  published: 'data/published-prices.json',
  history: 'data/history.json',
};
let snapshots;
let archivedStations;

async function readPriceSnapshots(previous) {
  const entries = await Promise.all(Object.entries(priceFiles).map(async ([key, url]) => {
    try {
      return [key, await load(url)];
    } catch (error) {
      if (previous) return [key, previous[key]];
      if (key === 'terminals') throw error;
      return [key, {stations:[]}];
    }
  }));
  return Object.fromEntries(entries);
}

function applyPriceSnapshots({terminals:terminalData, gas:gasSnapshot, fallback, published, history}) {
  countyHistoryData = history.counties ?? {};
  reports = terminalData.reports;
  const gasRows = [...archivedStations, ...(gasSnapshot.stations ?? [])].filter(station => station.source === 'GasBuddy');
  const byID = new Map();
  for (const station of [...gasRows, ...(fallback.stations ?? []), ...(published.stations ?? [])]) {
    let county = counties.find(candidate => candidate.id === station.countyFips);
    if (!county && Number.isFinite(station.lat) && Number.isFinite(station.lng)) {
      county = counties.find(candidate => inside([station.lng, station.lat], candidate.feature.geometry));
    }
    if (!county) continue;
    const place = !hasLocation(station) && matchLocation({...station, countyFips:county.id});
    const key = `${station.source}:${station.id}`;
    const previous = byID.get(key);
    const timestamp = Date.parse(sourceTime(station));
    if (Number.isFinite(timestamp) && (!previous || timestamp >= Date.parse(sourceTime(previous)))) {
      byID.set(key, {...station, ...(place ? {lat:place.lat, lng:place.lng} : {}), countyFips:county.id, county:county.name});
    }
  }
  allStations = [...byID.values()];
  // Use collected station locations as county label positions when available.
  for(const c of counties){const locations=allStations.filter(s=>s.countyFips===c.id&&fresh(s)&&Number.isFinite(s.lat)&&Number.isFinite(s.lng));c.labelCenter=locations.length?{lat:locations.reduce((n,s)=>n+s.lat,0)/locations.length,lng:locations.reduce((n,s)=>n+s.lng,0)/locations.length}:c.center;}
  $('source-details').innerHTML=`<div class="source-fact"><b>GasBuddy · ${allStations.filter(s=>s.source==='GasBuddy'&&fresh(s)).length} fresh reports</b><small>${gasSnapshot.latestDaneFuelAt?`Dane County refreshed ${fmtDate(gasSnapshot.latestDaneFuelAt)} CT from Dane Fuel. `:''}${gasSnapshot.pages?.length||0} county pages were read; only listings with a visible price and report age were imported. Up to ten listings per county are sampled, not every station. County assignments use the source county listing unless an exact public address match confirms it. Report times are approximated from the source’s relative age label. Prices are displayed at the precision supplied by the page.</small></div><div class="source-fact"><b>Kwik Trip direct · ${fallback.stations?.length||0} quotes in ${new Set((fallback.stations||[]).map(s=>s.countyFips)).size} counties</b><small>${fallback.retrievedAt?'Retrieved '+fmtDate(fallback.retrievedAt)+' CT. ':''}Regular-87 quotes from the public first-party store service. Price-change timestamps and explicit payment terms are not supplied. This is one brand, not a market-wide survey.</small></div><div class="source-fact"><b>FuelRadarDash · ${published.stations.length} published quotes</b><small>${published.publishedAt?fmtDate(published.publishedAt)+' CT. ':''}Regular prices matched to verified station addresses. The publisher provides a page update time. Individual price times are unavailable.</small></div><div class="source-fact"><b>AXXIS · ${reports.length} quoted terminal markets</b><small>${terminalData.retrievedAt?'Retrieved '+fmtDate(terminalData.retrievedAt)+' CT. ':''}Report dates are displayed per county; refreshing the page does not make the source data newer.</small></div>`;
}

async function refreshDisplayedPrices() {
  if (document.hidden) return;
  snapshots = await readPriceSnapshots(snapshots);
  applyPriceSnapshots(snapshots);
  render();
}

async function init(){try{
  const [geo, archived, initial, locations] = await Promise.all([
    load('data/counties.geojson'),
    load('data/gasbuddy-archive.json', {stations:[]}),
    readPriceSnapshots(),
    load('data/station-locations.json', {stations:[]}),
  ]);
  counties = countyModels(geo);
  stationLocations = locations.stations;
  matchLocation = createLocationLookup(stationLocations);
  archivedStations = archived.stations ?? [];
  snapshots = initial;
  applyPriceSnapshots(snapshots);
  recompute();
  initializeMap(geo);
  render();
  document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{state.layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderMap();});$('source-filter').onchange=e=>{state.source=e.target.value;render();};$('place-search').oninput=search;$('place-search').onkeydown=e=>{if(e.key==='Escape')$('search-results').hidden=true;if(e.key==='Enter'){e.preventDefault();chooseSearch(0);}};document.addEventListener('click',e=>{if(!e.target.closest('.search-area'))$('search-results').hidden=true;});document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('info-dialog').open){e.preventDefault();$('place-search').focus();}});$('method-button').onclick=openInfo;$('sources-button').onclick=openInfo;$('close-dialog').onclick=()=>$('info-dialog').close();$('info-dialog').onclick=e=>{if(e.target===$('info-dialog')){const b=$('info-dialog').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('info-dialog').close();}};$('delivery-input').value=state.delivery*100;$('delivery-input').oninput=e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0&&n<=100){state.delivery=n/100;save();render();}};$('export-button').onclick=download;setInterval(render,60000);
  if (typeof embeddedData === 'undefined') setInterval(refreshDisplayedPrices, 5 * 60000);
}catch(e){$('app-error').hidden=false;$('app-error').textContent='The map could not load: '+e.message+'. Start this preview with npm start and check its saved data files.';console.error(e);}}
init();
