import {addressCityKey} from './locations.js';

export const RFG = new Set(['Kenosha','Milwaukee','Ozaukee','Racine','Washington','Waukesha']);
export const MARKETS = [
  ['291','Dubuque, IA',42.5006,-90.6646],['335','Chicago, IL',41.8781,-87.6298],
  ['355','Rockford, IL',42.2711,-89.0940],['503','Duluth, MN',46.7867,-92.1005],
  ['511','Minneapolis / St. Paul, MN',44.9537,-93.09],['513','Rochester, MN',44.0121,-92.4802],
  ['961','Chippewa Falls, WI',44.9369,-91.3929],['963','Green Bay, WI',44.5133,-88.0133],
  ['965','Junction City, WI',44.5936,-89.7635],['967','Madison, WI',43.0731,-89.4012],
  ['969','Milwaukee, WI',43.0389,-87.9065],['971','Superior, WI',46.7208,-92.1041],
  ['973','Waupun, WI',43.6333,-88.7296]
].map(([id,name,lat,lng])=>({id,name,lat,lng}));
export const sourceTime = s => s.timeBasis === 'retrieved' || s.timeBasis === 'published' ? s.observedAt : s.reportedAt;
const sourceRank = station => station.timeBasis === 'published' ? 0 : station.source === 'GasWiser' ? 1 : 2;
export function fresh(s,now=Date.now(),maxAge=24) {
  const t=Date.parse(sourceTime(s));
  return s.state==='WI' && s.fuel==='regular' && Number.isFinite(s.price) && s.price>=.5 && s.price<=20 && Number.isFinite(t) && t<=now+300000 && now-t<=maxAge*3600000;
}
export function eligible(stations,{now=Date.now(),source='available',members=false,cash=false,query=''}={}) {
  const selected=stations.filter(s=>fresh(s,now) && (source==='available'||s.source===source) && (members||!s.membership) && (cash||s.payment!=='cash') && (!query||`${s.name} ${s.city} ${s.address} ${s.county}`.toLowerCase().includes(query.toLowerCase())));
  const unique=new Map();
  for (const station of selected) {
    const key = station.address && station.city
      ? `${station.countyFips}|${addressCityKey(station.address,station.city)}`
      : station.id;
    const previous = unique.get(key);
    if (!previous || sourceRank(station) > sourceRank(previous) ||
        (sourceRank(station) === sourceRank(previous) && Date.parse(sourceTime(station)) > Date.parse(sourceTime(previous)))) {
      unique.set(key, station);
    }
  }
  return [...unique.values()].sort((a,b)=>a.price-b.price);
}
export function parseTerminals(text) {
  const reports=[];
  for(const block of text.replace(/\r/g,'').split(/(?=^\d{3}\s+[A-Z].+Date:)/m)) {
    const header=block.match(/^(\d{3})\s+(.+?)\s+Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/m);
    if(!header)continue;
    const columns=block.match(/^Supplier\s+(.+)$/m)?.[1].trim().split(/\s+/);
    const values=block.match(/^Contract Average\s+([\d.\s]+)$/m)?.[1].trim().split(/\s+/);
    if(!columns||!values||columns.length!==values.length)throw Error('Terminal columns changed.');
    const prices=Object.fromEntries(columns.map((c,i)=>[c,Number(values[i])]));
    if(Object.values(prices).some(v=>!Number.isFinite(v)||v<=0||v>30))throw Error('Invalid terminal quote.');
    const reportDate=`${header[5]}-${header[3].padStart(2,'0')}-${header[4].padStart(2,'0')}`;
    if(!Number.isFinite(Date.parse(reportDate))||new Date(reportDate+'T00:00:00Z').toISOString().slice(0,10)!==reportDate)throw Error('Invalid terminal date.');
    reports.push({id:header[1],name:header[2].trim(),reportDate,reportTime:header[6],prices});
  }
  if(!reports.length)throw Error('No terminal reports found.');
  return reports;
}
export function distance(a,b) {
  const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r;
  return 3958.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2)));
}
export function costFloor(wholesale,delivery=.025) {
  if(!Number.isFinite(wholesale)||wholesale<=0||!Number.isFinite(delivery)||delivery<0||delivery>1)return null;
  const raw=(wholesale+.184+.309+.020+delivery)*1.0918;
  return {raw,price:Math.ceil((raw-1e-10)*1000)/1000,wholesale,delivery,taxes:.513,markup:.0918};
}
export function floorFor(county,reports,{delivery=.025,now=Date.now()}={}) {
  const rfg=RFG.has(county.name),product=rfg?'87RE10':'ULC10';
  const choices=MARKETS.map(m=>({...m,report:reports.find(r=>r.id===m.id)})).filter(m=>Number.isFinite(m.report?.prices[product])).sort((a,b)=>distance(county.center,a)-distance(county.center,b));
  const market=choices[0]; if(!market)return null;
  const cost=costFloor(market.report.prices[product],delivery);
  const age=(now-Date.parse(market.report.reportDate+'T10:30:00-06:00'))/3600000;
  return {...cost,market,product,rfg,stale:age>96||age< -24,reportDate:market.report.reportDate};
}
export function compare(stations,floor,now=Date.now()) {
  const rows=eligible(stations,{now,members:true,cash:true});
  if(!rows.length||!floor||floor.stale)return {kind:'unknown',label:'Not enough recent data',gap:null};
  const low=rows[0].price,gap=low-floor.price;
  if(gap<=.08+1e-9)return {kind:'near',label:gap<0?'Below estimated floor':'Near estimated floor',gap,low};
  if(gap>=.15-1e-9)return {kind:'room',label:'Room to fall',gap,low};
  return {kind:'watch',label:'Keep an eye on prices',gap,low};
}
export function inside(point,geometry) {
  function ringContains(ring) {let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>point[1])!==(b[1]>point[1]))&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(poly=>ringContains(poly[0])&&!poly.slice(1).some(ringContains));
}
export function countyModels(geo) {
  return geo.features.map(f=>{
    const coords=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);
    const xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]);
    return {id:f.id,name:f.properties.NAME,feature:f,center:{lat:(Math.min(...ys)+Math.max(...ys))/2,lng:(Math.min(...xs)+Math.max(...xs))/2}};
  });
}
