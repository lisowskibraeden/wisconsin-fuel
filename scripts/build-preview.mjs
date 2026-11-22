import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFile(root+'site/'+p,'utf8');
const files=['data/counties.geojson','data/terminals.json','data/fallback.json','data/published-prices.json','data/gasbuddy-current.json','data/gasbuddy-archive.json','data/history.json'];
const data={};for(const f of files){try{data[f]=JSON.parse(await read(f));}catch{data[f]={stations:[]};}}
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const styles=(await read('vendor/leaflet.css'))+'\n'+(await read('style.css')).replace(/@font-face\{[^}]+\}/,'');
const model=(await read('model.js')).replace(/export /g,'');
const brands=(await read('brands.js')).replace(/^export /gm,'');
const history=(await read('history.js')).replace(/^import .+;\n/gm,'').replace(/^export /gm,'');
const logosDir=root+'site/assets/logos/';
const logoFiles=(await fs.readdir(logosDir)).filter(file=>/\.(png|svg)$/.test(file));
const logos=Object.fromEntries(await Promise.all(logoFiles.map(async file=>{
  const mime=file.endsWith('.svg')?'image/svg+xml':'image/png';
  return [file, `data:${mime};base64,${(await fs.readFile(logosDir+file)).toString('base64')}`];
})));
const app=(await read('app.js')).replace(/^import .+;\n/gm,'').replace('const r=await fetch(url);','if(Object.hasOwn(embeddedData,url))return embeddedData[url];const r=await fetch(url);');
let html=await read('index.html');html=html.replace(/<link rel="icon"[^>]+>/,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace(/<script[^>]+><\/script>/g,'').replace('</head>',()=>`<style>${styles}</style></head>`);
// Use one script to share the pure model bindings without browser module imports.
const leaflet=await read('vendor/leaflet.js');
html=html.replace('</body>',()=>`<script>${leaflet}</script><script>const embeddedData=${json(data)};\nconst embeddedLogos=${json(logos)};\n${model}\n${brands}\n${history}\n${app}</script></body>`);
await fs.writeFile(root+'preview.html',html);
console.log('Built '+root+'preview.html');
