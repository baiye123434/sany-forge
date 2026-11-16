const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPlatform}=require('../server/platform.cjs');
test('项目电话查询：同号多项目、号码归一、摘要字段、隔离授权及限流',async()=>{
 const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'.qa'),{recursive:true});
 const app=createPlatform({root,dataDir:fs.mkdtempSync(path.join(root,'.qa/project-phone-'))});const url=await app.start(0);
 const api=async(p,b,token,status=200)=>{if(!token&&b&&['/api/orders','/api/projects'].includes(p))token=await require('./customer-fixture.cjs')(url);const r=await fetch(url+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:b?JSON.stringify(b):undefined});assert.equal(r.status,status);return r.json()};
 try{
  const product=(await api('/api/products')).products.find(p=>!p.exhibitOnly);
  const data={title:'隔离测试项目',contact:'演示',phone:'13800005555',confidential:true,items:[{productId:product.id,quantity:1}]};
  const a=await api('/api/projects',data),b=await api('/api/projects',{...data,phone:'+86 138-0000-5555'}),c=await api('/api/projects',{...data,phone:'13800006666'});
  const list=await api('/api/guest/phone-projects',{phone:'008613800005555'});assert.equal(list.projects.length,2);
  for(const item of list.projects)for(const key of ['files','notes','phone','contact','token','accessKey','secretHash'])assert.equal(item[key],undefined);
  assert.equal((await api('/api/guest/phone-projects',{phone:'00005555'})).projects.length,0);
  await api('/api/guest/phone-projects',{phone:'bad'},null,400);
  await api('/api/guest/phone-project',{phone:data.phone,projectId:c.project.id},null,401);
  const opened=await api('/api/guest/phone-project',{phone:data.phone,projectId:a.project.number});
  await api('/api/projects/'+a.project.id,undefined,opened.token);
  await api('/api/projects/'+b.project.id,undefined,opened.token,403);
  await api('/api/admin/users',undefined,opened.token,403);
  await api('/api/projects/lookup',{projectId:a.project.id,phone:data.phone,code:a.accessCode});
  let limited=false;for(let i=0;i<61;i++){const r=await fetch(url+'/api/guest/phone-projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:data.phone})});if(r.status===429){limited=true;break}}assert.ok(limited);
 }finally{await app.close()}
});
