import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root=process.argv[2] || process.cwd();
const output=process.argv[3] || '/tmp/tips-initial-js-review.json';
const routes=['dashboard','students','classes','registration','tasks','textbooks','makeup-requests','statistics','public-content'];
const result=[];
for(const route of routes){
  const html=fs.readFileSync(path.join(root,`.next/server/app/admin/${route}.html`),'utf8');
  const files=[...new Set([...html.matchAll(/<script\b[^>]*>/g)].filter(m=>!m[0].includes('noModule=')).flatMap(m=>{
    const src=/src="(\/_next\/[^"?]+\.js)/.exec(m[0]);
    return src?[src[1].replace('/_next/','')]:[];
  }))];
  const sizes=files.map(file=>{
    const buffer=fs.readFileSync(path.join(root,'.next',file));
    return {file,rawBytes:buffer.length,gzipBytes:zlib.gzipSync(buffer).length};
  });
  result.push({route,jsFiles:files.length,rawKiB:Math.round(sizes.reduce((s,a)=>s+a.rawBytes,0)/1024),gzipKiB:Math.round(sizes.reduce((s,a)=>s+a.gzipBytes,0)/1024),files:sizes});
}
fs.writeFileSync(output,JSON.stringify({method:'fresh build HTML script src; exclude noModule polyfill; gzipSync per file; not actual network or route-change delta',commit:'b0f16bf5e5001edcdb25410fd68a8be3297adde3',routes:result},null,2));
console.log(JSON.stringify(result.map(({files,...row})=>row),null,2));
