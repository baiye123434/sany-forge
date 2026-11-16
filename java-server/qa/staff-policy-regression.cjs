'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createPlatform}=require('../../server/java-platform.cjs');
const root=path.resolve(__dirname,'../..'),qa=path.join(root,'.qa',`staff-policy-${Date.now()}`);
fs.mkdirSync(qa,{recursive:true});
const platform=createPlatform({root,dataDir:path.join(qa,'data')}),checks=[];
const password=`Test-${crypto.randomUUID()}`;
const files=[{name:'报价单.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII='}];
let url;
async function api(p,token,body,status=200){const r=await fetch(url+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,`${p}: ${JSON.stringify(data)}`);return data;}
async function check(name,fn){await fn();checks.push(name);console.log('通过：'+name);}
async function main(){
 url=await platform.start(0);
 const admin=(await api('/api/setup',null,{username:'policy.admin',name:'策略测试超管',password})).token;
 for(const [username,role]of [['service','service'],['sales','operations']])await api('/api/staff/users',admin,{username:`policy.${username}`,name:`策略测试${username}`,password,roles:[role]});
 const service=(await api('/api/login',null,{username:'policy.service',password})).token;
 const sales=(await api('/api/login',null,{username:'policy.sales',password})).token;
 const product=(await api('/api/staff/catalog',sales)).products.find(p=>!p.exhibitOnly);
 const payload=(phone,urgency='normal')=>({requestId:crypto.randomUUID(),customerName:'隔离策略测试',customerPhone:phone,productId:product.id,quantity:1,dealPrice:800000,quotedPrice:800000,urgency,notes:'策略测试资料',files});
 await check('重复上线保留首次打卡时间且不重复审计，下班后再次上线新建班次',async()=>{
  const first=(await api('/api/staff/presence',service,{action:'online'})).presence;
  const second=(await api('/api/staff/presence',service,{action:'online'})).presence;
  assert.equal(second.checkedInAt,first.checkedInAt);
  let events=(await api('/api/staff/audit?employeeNumber=policy.service',admin)).events;
  assert.equal(events.filter(e=>e.action==='客服上线自动打卡').length,1);
  await api('/api/staff/presence',service,{action:'offline'});
  const third=(await api('/api/staff/presence',service,{action:'online'})).presence;
  assert.notEqual(third.checkedInAt,first.checkedInAt);
  events=(await api('/api/staff/audit?employeeNumber=policy.service',admin)).events;
  assert.equal(events.filter(e=>e.action==='客服上线自动打卡').length,2);
  assert.equal(events.filter(e=>e.action==='客服下线打卡').length,1);
 });
 await check('原租赁订单拒绝销售接入，原记录及回执保持完整',async()=>{
  const customer=(await api('/api/customer/register',null,{phone:'13988000000',password,repeat:password})).token;
  const original=await api('/api/orders',customer,{productId:product.id,mode:'rent',quantity:2,duration:6,contact:'租赁测试客户',phone:'13988000000',address:'湖南省长沙市租赁验收路88号',date:'2099-01-01',customerType:'personal',files:[]});
  const before=(await api('/api/staff/orders/'+original.order.id,sales)).order;
  await api(`/api/staff/orders/${original.order.id}/actions`,sales,{...payload('13988000000'),action:'resubmit',revision:before.revision,note:'不得转换租赁'},409);
  const after=(await api('/api/staff/orders/'+original.order.id,sales)).order;
  assert.deepEqual(after,before); assert.equal(after.mode,'rent'); assert.equal(after.salesId,undefined);
  assert.equal((await api('/api/orders/'+original.order.id,original.token)).order.mode,'rent');
 });
 await check('复购客户优先，同一客户类型按紧急等级排序',async()=>{
  const repeatedLow=(await api('/api/staff/orders',sales,payload('13988000001','low'))).order;
  const repeatedUrgent=(await api('/api/staff/orders',sales,payload('13988000001','urgent'))).order;
  const newNormal=(await api('/api/staff/orders',sales,payload('13988000002','normal'))).order;
  const newUrgent=(await api('/api/staff/orders',sales,payload('13988000003','urgent'))).order;
  const rows=(await api('/api/staff/orders',service)).orders,ids=rows.map(o=>o.id);
  assert.ok(ids.indexOf(repeatedUrgent.id)<ids.indexOf(repeatedLow.id));
  assert.ok(ids.indexOf(repeatedLow.id)<ids.indexOf(newUrgent.id));
  assert.ok(ids.indexOf(newUrgent.id)<ids.indexOf(newNormal.id));
 });
}
/* 只创建隔离资料并正常关闭本脚本持有的服务，不读取日常业务库。 */
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await platform.close();fs.writeFileSync(path.join(qa,'report.json'),JSON.stringify({ok:!process.exitCode,checks,finishedAt:new Date().toISOString()},null,2));console.log('REPORT='+path.join(qa,'report.json'));});
