import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../site',import.meta.url));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const port=Number(typeof process!=='undefined'?process.env.PORT||8091:8091);
export const server=http.createServer(async(req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=pathname==='/preview.html'?path.resolve(root,'../preview.html'):path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(pathname!=='/preview.html'&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Wisconsin Fuel preview: http://127.0.0.1:${port}`));
