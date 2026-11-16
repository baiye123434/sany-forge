'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {createPlatform}=require('../server/platform.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'.qa',`two-browsers-${Date.now()}`);fs.mkdirSync(out,{recursive:true});
 const service=createPlatform({root,dataDir:path.join(out,'business')}),url=await service.start(0);
 const report={at:new Date().toISOString(),browsers:['Edge 客户','Chrome 管理员'],steps:[],errors:[]};let edge,chrome,a,b;
 const snap=async(name,title)=>{const files=[];for(const [tag,p]of[['A',a],['B',b]]){const f=`${name}-${tag}.png`;await p.screenshot({path:path.join(out,f)});files.push(f);}report.steps.push({title,files,pass:true});console.log('PASS '+title);};
 const close=async p=>{if(await p.locator('#modal').isVisible())await p.locator('[data-action="close"]').click();};
 const staffOrder=async()=>{await close(b);await b.locator('[data-action="refresh-work"]').click();await b.locator('.sidebar [data-tab="orders"]').click();await b.locator('[data-action="staff-order"]').first().click();};
 const customerOrder=async()=>{await close(a);await a.goto(url+'/?workspace=customer#customer');const f=a.locator('[data-form="phone-lookup"]');await f.locator('[name="phone"]').fill('13800000000');await f.locator('button[type="submit"]').click();await a.locator('[data-action="phone-order"]').first().click();};
 try{
  edge=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});chrome=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
  const ac=await edge.newContext({viewport:{width:1360,height:900},reducedMotion:'reduce'}),bc=await chrome.newContext({viewport:{width:1360,height:900},reducedMotion:'reduce'});a=await ac.newPage();b=await bc.newPage();
  for(const p of[a,b])p.on('pageerror',e=>report.errors.push(e.message));
  await b.goto(url+'/?workspace=staff#work');await b.locator('[data-access="continue"]').click();await b.locator('[data-action="auth-mode"][data-mode="register"]').click();if(await b.locator('[data-access="continue"]').isVisible())await b.locator('[data-access="continue"]').click();
  const reg=b.locator('[data-form="register"]'),password=crypto.randomUUID();
  for(const[k,v]of Object.entries({username:'demo.admin',name:'演示管理员',password,repeat:password}))await reg.locator(`[name="${k}"]`).fill(v);
  await reg.locator('[name="role"]').selectOption('admin');await reg.locator('button[type="submit"]').click();await b.locator('[data-access="enter"]').click();await b.locator('.sidebar').waitFor();
  await a.goto(url+'/?workspace=customer#catalog');await a.locator('[data-action="buy"]').first().click();const purchase=a.locator('[data-form="purchase"]');
  // 使用湖南省、长沙市、芙蓉区的现行代码完成三级联动，再填写详细地址。
  await purchase.locator('[name="addressProvince"]').selectOption('430000');await purchase.locator('[name="addressCity"]').selectOption('430100');await purchase.locator('[name="addressCounty"]').selectOption('430102');
  for(const[k,v]of Object.entries({contact:'参赛演示客户',phone:'13800000000',addressDetail:'参赛测试工地',date:'2099-01-01',notes:'双浏览器演示订单，仅用于验证，不是真实交易。'}))await purchase.locator(`[name="${k}"]`).fill(v);
  await purchase.locator('input[type="checkbox"][required]').check();await purchase.locator('button[type="submit"]').click();await a.locator('.receipt-summary').waitFor();report.orderNumber=await a.locator('.receipt-summary > strong').innerText();await staffOrder();await b.locator('#modalContent').getByText(report.orderNumber,{exact:true}).waitFor();await snap('01-order','A 在网页下单，B 刷新后看到相同订单编号');
  await a.locator('[data-action="receipt-chat"]').click();await b.locator('[data-action="order-chat"]').click();
  const send=async(p,message)=>{const f=p.locator('[data-project-form="chat"]');await f.locator('[name="text"]').fill(message);await f.locator('button[type="submit"]').click();};
  const am='客户演示：请确认设备配置，并告知预计交付安排。',bm='管理员演示：已收到需求，将确认报价、备货并安排发运。';
  await send(a,am);await b.locator('#projectMessages').getByText(am,{exact:true}).waitFor({timeout:15000});await snap('02-chat-a','A 发送消息，B 自动收到，无需刷新');
  await send(b,bm);await a.locator('#projectMessages').getByText(bm,{exact:true}).waitFor({timeout:15000});await snap('03-chat-b','B 回复消息，A 自动收到，无需刷新');
  await a.reload();await customerOrder();await a.locator('[data-action="order-chat"]').click();await a.locator('#projectMessages').getByText(bm,{exact:true}).waitFor();await snap('04-persist','A 刷新页面并重新查询，订单与聊天记录仍保留');
  const proof=path.join(out,'演示证明材料.png');fs.copyFileSync(path.join(out,'01-order-B.png'),proof);
  for(const [status,label] of [['confirmed','已确认报价'],['preparing','备货中'],['shipped','待收货']]){
   await staffOrder();const f=b.locator('[data-form="order-transition"]');await f.locator('[name="status"]').selectOption(status);
   if(status==='confirmed')await f.locator('[name="amount"]').fill('100');
   if(status==='shipped'){await f.locator('[name="carrier"]').fill('演示承运单位');await f.locator('[name="tracking"]').fill('DEMO-DELIVERY-001');}
   await f.locator('[name="note"]').fill('参赛模拟：'+label+'。金额和材料仅作流程测试。');await f.locator('[name="materials"]').setInputFiles(proof);await f.locator('button[type="submit"]').click();await b.locator('#modalContent > .dialog-body > .record .pill').getByText(label,{exact:true}).waitFor();
   await customerOrder();await a.locator('#modalContent > .dialog-body > .record .pill').getByText(label,{exact:true}).waitFor();await snap('05-'+status,`B 更新${label}，A 重新查询后同步显示`);
  }
  const confirm=a.locator('[data-form="order-confirm"]');await confirm.locator('[name="note"]').fill('演示客户已核对设备，模拟确认收货。');await confirm.locator('[name="materials"]').setInputFiles(proof);await confirm.locator('[name="confirmed"]').check();await confirm.locator('button[type="submit"]').click();await a.locator('#modalContent > .dialog-body > .record .pill').getByText('已交付',{exact:true}).waitFor();await staffOrder();await b.locator('#modalContent > .dialog-body > .record .pill').getByText('已交付',{exact:true}).waitFor();await snap('06-delivered','A 确认收货，B 刷新后显示已交付');
  assert.equal(await a.evaluate(()=>sessionStorage.getItem('sany-staff')),null);assert.equal(report.errors.length,0);report.passed=true;
 }catch(e){report.failure=e.message;console.error(e.stack);process.exitCode=1;if(a&&b)try{await snap('error','失败现场（不计为通过）');report.steps.at(-1).pass=false;}catch{}}
 finally{
  await edge?.close();await chrome?.close();await service.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>双浏览器交付演示</title><style>body{font:16px/1.7 Microsoft YaHei,sans-serif;margin:24px;background:#f5f6f2;color:#25312d}header,footer{padding:16px 0;border-bottom:1px solid #aaa}section{margin:30px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #aaa}h1{font-size:26px}h2{font-size:20px}a{color:#245f50}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><header>生成时间：${esc(new Date().toLocaleString('zh-CN'))}<br>数据截至时间：${esc(report.at)}<br>报告对象：三一匠造 3.5.0 双浏览器交付演示</header><h1>${report.passed?'演示通过':'演示未完成'}：Edge 客户 / Chrome 管理员</h1><p>订单编号：${esc(report.orderNumber||'尚未创建')}。所有联系人、金额、地址和证明材料均为测试内容，不代表真实交易。以下为实际网页操作截图；聊天自动轮询，订单列表需刷新或重新查询。</p>${report.failure?`<p>${esc(report.failure)}</p>`:''}${report.steps.map((s,i)=>`<section><h2>${i+1}. ${esc(s.title)}</h2><div class="pair">${s.files.map((f,j)=>`<div><p>${j?'B · Chrome 管理员':'A · Edge 客户'}</p><a href="${f}"><img src="${f}" alt="${esc(s.title)}"></a></div>`).join('')}</div></section>`).join('')}<footer>报告来源方:SDMC-IT</footer></html>`;
  fs.writeFileSync(path.join(out,'演示回放.html'),html);console.log('ARTIFACT '+path.join(out,'演示回放.html'));
 }
})();
