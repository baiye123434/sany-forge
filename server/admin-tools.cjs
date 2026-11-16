'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
function createAdminTools(ctx){
 const {db,dataDir,get,put,auth,atomic,audit,fail,now,revoke}=ctx,started=Date.now(),metrics={requests:0,errors:0};
 const dir=path.join(dataDir,'backups');fs.mkdirSync(dir,{recursive:true});
 const capabilities=['projects','orders','tickets','chat','followups'];
 const defaults=()=>({service:Object.fromEntries(capabilities.map(k=>[k,true])),reviewer:Object.fromEntries(capabilities.map(k=>[k,k!=='chat']))});
 const permissions=()=>get('settings','permissions')||{id:'permissions',revision:0,roles:defaults()};
 const content=()=>get('settings','content')||{id:'content',revision:0,published:false,title:'',announcement:'',contact:'',hours:''};
 function enforce(req,user){if(user.role==='admin')return;const p=new URL(req.url,'http://localhost').pathname;let key=p.startsWith('/api/projects')?'projects':p.startsWith('/api/orders')?'orders':p.startsWith('/api/tickets')?'tickets':p.startsWith('/api/conversations')||p.startsWith('/api/customer/chats')?'chat':p.startsWith('/api/followup')?'followups':null;if(key&&permissions().roles[user.role]?.[key]===false)fail('该角色已关闭此功能权限，请联系管理员。',403);}
 const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 function list(){return fs.readdirSync(dir).filter(n=>/^backup-[\w-]+\.json$/.test(n)).map(n=>{try{return JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))}catch{return null}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 function snapshot(actor,reason){const id='backup-'+crypto.randomUUID(),file=path.join(dir,id+'.sqlite');db.exec("VACUUM INTO '"+file.replace(/'/g,"''")+"'");const meta={id,createdAt:now(),reason,size:fs.statSync(file).size,sha256:digest(file)};fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(meta));audit(actor,'创建本机备份',id,reason);return meta;}
 function checked(id){if(typeof id!=='string'||!/^backup-[a-f0-9-]{36}$/.test(id))fail('备份编号无效。');const meta=list().find(v=>v.id===id),file=path.join(dir,id+'.sqlite');if(!meta||!fs.existsSync(file))fail('备份不存在。',404);if(digest(file)!==meta.sha256)fail('备份校验失败，不能恢复。');return{meta,file};}
 function inspect(file){const source=new DatabaseSync(file,{readOnly:true});try{if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('数据库完整性检查失败。');for(const table of ['records','files','audit'])source.prepare(`SELECT * FROM ${table} LIMIT 0`).all();const counts=source.prepare('SELECT kind,COUNT(*) count FROM records GROUP BY kind').all();return{source,counts};}catch(e){source.close();throw e;}}
 async function route(req,url,body){const p=url.pathname;
  if(p==='/api/site-content'&&req.method==='GET'){const c=content();return c.published?{content:{title:c.title,announcement:c.announcement,contact:c.contact,hours:c.hours}}:{content:null};}
  if(!p.startsWith('/api/admin/tools/'))return undefined;
  const access=auth(req,['admin']);
  if(p.endsWith('/monitor')&&req.method==='GET')return{at:now(),uptimeSeconds:Math.floor((Date.now()-started)/1000),requests:metrics.requests,errors:metrics.errors,memoryBytes:process.memoryUsage().rss,databaseBytes:fs.statSync(path.join(dataDir,'platform.sqlite')).size,walBytes:fs.existsSync(path.join(dataDir,'platform.sqlite-wal'))?fs.statSync(path.join(dataDir,'platform.sqlite-wal')).size:0,counts:db.prepare('SELECT kind,COUNT(*) count FROM records GROUP BY kind').all(),attachments:db.prepare('SELECT COUNT(*) count FROM files').get().count,backupCount:list().length,integrity:db.prepare('PRAGMA quick_check').get().quick_check};
  if(p.endsWith('/backups')){if(req.method==='GET')return{backups:list()};if(req.method==='POST')return{backup:snapshot(access.actor,'手动备份')};}
  if(p.endsWith('/restore-preview')&&req.method==='POST'){const {meta,file}=checked(body.id),{source,counts}=inspect(file);source.close();return{backup:meta,counts};}
  if(p.endsWith('/restore')&&req.method==='POST'){
   if(body.confirm!=='恢复数据')fail('请输入“恢复数据”确认。');const{file}=checked(body.id),{source}=inspect(file);try{
    const rows=source.prepare('SELECT * FROM records').all(),files=source.prepare('SELECT * FROM files').all();const safety=snapshot(access.actor,'恢复前自动备份');
    // 保留当前身份与审计链，不通过数据恢复覆盖账号、人脸、密码及权限。
    const excluded=new Set(['user','customer']);atomic(()=>{db.exec("DELETE FROM records WHERE kind NOT IN ('user','customer') AND NOT (kind='settings' AND id='permissions')");db.exec('DELETE FROM files');for(const r of rows){if(excluded.has(r.kind)||r.kind==='settings'&&r.id==='permissions')continue;db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?)').run(r.kind,r.id,r.body);}for(const f of files)db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)').run(f.id,f.owner_kind,f.owner_id,f.name,f.mime,f.bytes,f.created_at);audit(access.actor,'恢复业务数据',body.id,'恢复前备份：'+safety.id);});revoke();return{ok:true,safetyBackup:safety.id};
   }finally{source.close();}
  }
  if(p.endsWith('/permissions')){if(req.method==='GET')return{config:permissions(),capabilities};if(req.method==='POST')return atomic(()=>{const old=permissions();if(body.revision!==old.revision)fail('权限配置已变更，请刷新。',409);const roles={};for(const role of ['service','reviewer']){roles[role]={};for(const key of capabilities){if(typeof body.roles?.[role]?.[key]!=='boolean')fail('权限选项不完整。');roles[role][key]=body.roles[role][key];}}if(roles.reviewer.chat)fail('审核员不能授予客服会话权限。');const config={id:'permissions',revision:old.revision+1,roles};put('settings',config);audit(access.actor,'更新角色功能权限','permissions');return{config};});}
  if(p.endsWith('/content')){if(req.method==='GET')return{content:content()};if(req.method==='POST')return atomic(()=>{const old=content();if(body.revision!==old.revision)fail('内容已被修改，请刷新。',409);if(typeof body.published!=='boolean')fail('发布状态无效。');const c={id:'content',revision:old.revision+1,published:body.published};for(const[k,max]of Object.entries({title:60,announcement:1000,contact:100,hours:100})){if(typeof body[k]!=='string'||body[k].length>max)fail('内容长度或格式无效。');c[k]=body[k].trim();}if(c.published&&!c.title)fail('发布时需填写标题。');put('settings',c);audit(access.actor,c.published?'发布首页内容':'保存未发布内容','content');return{content:c};});}
  fail('管理工具接口不存在。',404);
 }
 return{route,enforce,metrics,capabilities:role=>role==='admin'?Object.fromEntries(capabilities.map(k=>[k,true])):permissions().roles[role]};
}
module.exports={createAdminTools};
