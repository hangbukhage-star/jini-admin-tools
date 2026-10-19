// Local-only preview: all database writes remain in memory and vanish when stopped.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const db=new DatabaseSync(':memory:');
for(const name of readdirSync(resolve(root,'analytics/migrations')).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(resolve(root,'analytics/migrations',name),'utf8'));
const env={NEWS_ADMIN_KEY:'local-test-admin-key-at-least-32-characters',ALLOWED_ORIGINS:'http://127.0.0.1:8765',DB:{prepare(sql){const statement=db.prepare(sql);let values=[];return {bind(...args){values=args.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return this;},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},async run(){return {meta:{changes:Number(statement.run(...values).changes)}};}};}}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://127.0.0.1:8765').pathname;
    if(path==='/site/visits'||path==='/news'||path==='/news/venues'||path==='/news/admin'||/^\/news\/(posts|images|admin)\//.test(path)||path==='/counts'||path.startsWith('/count/')||path.startsWith('/comments/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await worker.fetch(new Request(`http://127.0.0.1:8765${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),env);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(path==='/assets/stats-config.js'){res.setHeader('Content-Type',mime['.js']);res.end('window.JINI_STATS_CONFIG={apiBase:"http://127.0.0.1:8765"};');return;}
    let file=resolve(root,'.'+decodeURIComponent(path));
    if((file!==root&&!file.startsWith(root+sep))||file.includes(`${sep}.git${sep}`)||file.includes('node_modules')){res.writeHead(403);res.end();return;}
    if(statSync(file).isDirectory())file=resolve(file,'index.html');
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }catch(e){res.writeHead(404);res.end('Not found');}
}).listen(8765,'127.0.0.1',()=>console.log('Local preview http://127.0.0.1:8765/news/admin.html (in-memory test data only)'));
