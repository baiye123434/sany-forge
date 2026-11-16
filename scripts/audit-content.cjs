'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.qa/review-20261026');
const inventory=JSON.parse(fs.readFileSync(path.join(out,'inventory.json'),'utf8'));
const modules=[];
const baselinePaths=new Set(inventory.files.filter(f=>f.category==='project-text').map(f=>f.path));
function currentText(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const file=path.join(dir,e.name),rel=path.relative(root,file).replaceAll('\\','/');
    if(e.isSymbolicLink()) return [];
    if(e.isDirectory()) return ['node_modules','.qa','.git','release','.desktop-reference','.desktop-dev'].includes(e.name)||['dist/assets','dist/vendor'].includes(rel)?[]:currentText(file);
    return /\.(c?js|css|html|md|json|cmd|py|svg)$/.test(rel)?[{path:rel}]:[];
  });
}
for(const item of currentText(root)){
  const file=path.join(root,item.path),source=fs.readFileSync(file,'utf8');
  const info={path:item.path,lines:source.split(/\r?\n/).length,bytes:Buffer.byteLength(source),newSinceInventory:!baselinePaths.has(item.path)};
  if(/\.(c?js|py)$/.test(item.path)) {
    info.functions=[...source.matchAll(/(?:function\s+|(?:async\s+)?def\s+)([\w$]+)\s*\(/g)].map(m=>m[1]);
    info.localRequires=[...source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map(m=>m[1]);
    info.tests=[...source.matchAll(/(?:t\.)?test\(['"]([^'"]+)['"]/g)].map(m=>m[1]);
  }
  if(item.path.endsWith('.json')){const parsed=JSON.parse(source);info.jsonShape=Array.isArray(parsed)?{arrayLength:parsed.length}:{keys:Object.keys(parsed)};}
  modules.push(info);
}
const catalog=JSON.parse(fs.readFileSync(path.join(root,'dist/catalog.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.join(root,'dist/catalog-audit.json'),'utf8'));
const missingImages=catalog.products.filter(p=>!p.image||!fs.existsSync(path.join(root,'dist',p.image))).map(p=>p.id);
const index=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const entries=[...index.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m=>m[1]);
const legacy=['app.js','commerce.js','style.css','index-2.4-archive.html'];
const summary={at:new Date().toISOString(),textFilesParsed:modules.length,catalog:{products:catalog.products.length,categories:catalog.categories.length,subcategories:catalog.categories.reduce((n,c)=>n+c.children.length,0),withoutSpecs:catalog.products.filter(p=>!p.specs?.length).length,collectedAt:catalog.collectedAt,missingImages,hashMatchesRecorded:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/catalog.json'))).digest('hex')===audit.catalogSha256},entryResources:entries,missingEntryResources:entries.filter(p=>!fs.existsSync(path.join(root,'dist',p))),legacyOutsideMainEntry:legacy.filter(p=>!entries.includes(p)),modules};
fs.writeFileSync(path.join(out,'content-map.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,modules:undefined},null,2));
