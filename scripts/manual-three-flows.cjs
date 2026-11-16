'use strict';
// Isolated end-to-end demonstration. Business transitions and messages use the real UI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createPlatform}=require('../server/platform.cjs');
const root=path.resolve(__dirname,'..');
const out=path.resolve(root,'../匠造智服_参赛展示资料包/三业务流截图');
fs.mkdirSync(out,{recursive:true});
const run=path.join(root,'.qa','manual-'+Date.now());fs.mkdirSync(run,{recursive:true});
const report={time:new Date().toISOString(),steps:[],errors:[],browsers:[]};
let app,edge,chrome,a,b,url,admin,engineer,reviewer,customer,seq=0;
const phone='13800008826',password=crypto.randomUUID();
const status={submitted:'待受理',confirmed:'已确认报价',preparing:'备货中',shipped:'待收货',delivered:'已交付',assigned:'待工程师接单',in_progress:'维修处理中',pending_review:'待材料审核',awaiting_customer:'待客户验收',closed:'已完成'};
async function api(p,body,token){const r=await fetch(url+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,p+': '+JSON.stringify(data));return data;}
async function close(p){if(await p.locator('#modal').isVisible())await p.locator('#modal [data-action="close"]').click();}
async function snap(flow,p,title,instruction,expected,selectors=[]){
 const boxes=[];
 for(const selector of selectors){const loc=p.locator(selector).first();if(await loc.isVisible()){const v=await loc.boundingBox();if(v&&v.y<1000&&v.y+v.height>0)boxes.push({x:Math.max(0,v.x-4),y:Math.max(0,v.y-4),w:Math.min(1438-v.x,v.width+8),h:Math.min(998-Math.max(0,v.y-4),v.height+8)});}}
 assert.ok(boxes.length,'截图没有可标注的关键位置：'+title);
 const file=String(++seq).padStart(2,'0')+'-'+(p===a?'A':'B')+'.png';
 await p.screenshot({path:path.join(out,file)});
 report.steps.push({flow,browser:p===a?'A · Edge 客户端':'B · Chrome 工作端',title,instruction,expected,file,boxes});
 fs.writeFileSync(path.join(out,'步骤与验证.json'),JSON.stringify(report,null,2));console.log('CAPTURE '+seq+' '+title);
}
async function customerList(mode){await close(a);await a.goto(url+'/?workspace=customer#customer');await a.locator('[data-cu="order-section"][data-section="'+mode+'"]').click();}
async function staffList(tab='orders',mode=''){await close(b);await b.goto(url+'/?workspace=staff#work');await b.locator('.sidebar [data-tab="'+tab+'"]').click();if(mode)await b.locator('[data-action="work-order-mode"][data-mode="'+mode+'"]').click();}
async function staffOrder(id){await staffList('orders');await b.locator('[data-action="staff-order"][data-id="'+id+'"]').click();await b.locator('[data-action="order-chat"]').waitFor();}
async function customerOrder(id,mode){await customerList(mode);await a.locator('[data-cu="record"][data-id="'+id+'"]').click();await a.locator('[data-action="order-chat"]').waitFor();}
async function send(p,text){const f=p.locator('[data-project-form="chat"]');await f.locator('[name="text"]').fill(text);await f.locator('[type="submit"]').click();await p.locator('#projectMessages').getByText(text,{exact:true}).waitFor();}
async function switchStaff(account){await close(b);await b.evaluate(token=>sessionStorage.setItem('sany-staff',token),account.token);await b.goto(url+'/?workspace=staff#work');await b.locator('.sidebar').waitFor();}
async function chatDemo(flow,id,mode){
 const isAfter=flow==='售后流',tab=isAfter?'tickets':'orders';
 await staffList(tab, isAfter?'':mode);await customerList(isAfter?'after-sales':mode);
 await a.locator('[data-order-panel="'+(isAfter?'after-sales':mode)+'"] [data-cu="record-chat"][data-id="'+id+'"]').first().click();
 const question=isAfter?'售后沟通：设备出现异响，请安排工程师检查。':mode==='rent'?'租赁沟通：预计租用3个月，请确认运输和交付安排。':'购买沟通：请确认设备配置，并告知报价及交付日期。';
 await send(a,question);
 await snap(flow,a,'客户发送业务消息','在当前业务记录点击“联系客服”，填写消息并发送。','消息出现在关联订单会话中。',['#projectMessages','[data-project-form="chat"]']);
 const dot=b.locator('[data-action="staff-unread-chat"][data-id="'+id+'"]');await dot.first().waitFor({timeout:15000});
 await snap(flow,b,'切换到 B：工作端出现未读红点','保持工作端对话关闭，切换到对应订单／维保列表，等待自动同步。','左侧业务菜单和明细操作旁出现未读提醒。',['.sidebar [data-tab="'+tab+'"]','[data-action="staff-unread-chat"][data-id="'+id+'"]']);
 await close(a);await customerList(isAfter?'after-sales':mode);
 await dot.first().click();await b.locator('#projectMessages').getByText(question,{exact:true}).waitFor();
 const answer=isAfter?'售后回复：已收到报修，将派工程师处理，完成后请您验收。':mode==='rent'?'租赁回复：已确认租期3个月，将按沟通结果报价并安排发运。':'购买回复：配置已确认，稍后登记报价并推进备货发运。';
 await send(b,answer);
 await snap(flow,b,'工作端读取并回复消息','点击红点进入对应会话，阅读客户消息并回复。','双方消息保存在同一会话。',['#projectMessages']);
 const section=isAfter?'after-sales':mode;
 const badge=a.locator('[data-cu="order-section"][data-section="'+section+'"] .cu-unread');await badge.waitFor({state:'visible',timeout:15000});
 await snap(flow,a,'切回 A：页签与联系客服出现红点','客户保持会话关闭，查看对应页签和订单按钮。','收到客服回复后，页签和记录上的小红点同步出现。',['[data-cu="order-section"][data-section="'+section+'"]','[data-order-panel="'+section+'"] .cu-record-chat']);
 await a.locator('[data-order-panel="'+section+'"] [data-cu="record-chat"][data-id="'+id+'"]').first().click();await a.locator('#projectMessages').getByText(answer,{exact:true}).waitFor();
 await snap(flow,a,'客户打开对话，查看客服回复','点击“联系客服”，阅读本次业务回复。','回复可见，消息进入已读状态。',['#projectMessages']);
 await close(a);await badge.waitFor({state:'hidden',timeout:15000});
 await snap(flow,a,'读完消息后红点消除','关闭对话，返回原业务页签。','已读消息不再显示红点；只切换页签不会清除未读。',['[data-cu="order-section"][data-section="'+section+'"]','[data-order-panel="'+section+'"] .cu-record-chat']);
 await close(b);
}
async function purchase(mode){
 const flow=mode==='buy'?'购买流':'租赁流';
 await a.goto(url+'/?workspace=customer#catalog');await a.locator('[data-action="buy"]').first().click();
 const f=a.locator('[data-form="purchase"]');await f.locator('[name="mode"]').selectOption(mode);await f.locator('[name="customerType"]').selectOption('enterprise');
 // 行政区划代码分别对应湖南省、长沙市、芙蓉区，选择后再填写街道和工地信息。
 await f.locator('[name="addressProvince"]').selectOption('430000');await f.locator('[name="addressCity"]').selectOption('430100');await f.locator('[name="addressCounty"]').selectOption('430102');
 for(const [k,v] of Object.entries({quantity:'1',contact:'参赛演示客户',phone,addressDetail:'教学园区模拟工地（不配送）',date:'2099-01-01',notes:flow+'操作手册演示；不是真实交易。'}))await f.locator('[name="'+k+'"]').fill(v);
 if(mode==='rent')await f.locator('[name="duration"]').fill('3');
 await f.locator('input[type="checkbox"][required]').check();await f.locator('[name="mode"]').scrollIntoViewIfNeeded();
 await snap(flow,a,'客户填写'+(mode==='buy'?'购买':'租赁')+'申请','设备租购 → 询价租购；选择办理方式，填写用户类型、数量、联系方式和交付信息。'+(mode==='rent'?'租期填写3个月。':''),'提交后形成独立订单，进入待受理。',['[name="mode"]','[name="quantity"]',mode==='rent'?'[name="duration"]':'[name="customerType"]']);
 const response=a.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');await f.locator('[type="submit"]').click();const data=await(await response).json();assert.ok(data.order?.id,JSON.stringify(data));const order=data.order;
 await a.locator('.receipt-summary').waitFor();await close(a);await customerList(mode);
 await snap(flow,a,'客户列表：待受理','进入“订单与售后”，选择'+(mode==='buy'?'购买订单':'租赁订单')+'。','新订单显示待受理，保留订单编号。',['[data-cu="order-section"][data-section="'+mode+'"]','[data-order-panel="'+mode+'"] .record']);
 await staffList('orders',mode);await b.locator('[data-action="staff-order"][data-id="'+order.id+'"]').waitFor();
 await snap(flow,b,'切换到 B：受理同一订单','服务工作台 → 售中订单跟进 → '+(mode==='buy'?'购买订单':'租赁订单')+'；核对编号。','工作端能看到客户端刚提交的订单及类型。',['[data-action="work-order-mode"][data-mode="'+mode+'"]','#workList tbody']);
 await chatDemo(flow,order.id,mode);
 for(const next of ['confirmed','preparing','shipped']){
  await staffOrder(order.id);const f=b.locator('[data-form="order-transition"]');await f.locator('[name="status"]').selectOption(next);
  if(next==='confirmed')await f.locator('[name="amount"]').fill(mode==='rent'?'3000':'100000');
  if(next==='shipped'){await f.locator('[name="carrier"]').fill('教学演示运输');await f.locator('[name="tracking"]').fill('DEMO-'+mode.toUpperCase());}
  await f.locator('[name="note"]').fill(flow+'演示：'+status[next]+'，材料及金额仅用于教学。');await f.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await f.locator('[name="status"]').scrollIntoViewIfNeeded();
  await snap(flow,b,'工作端提交：'+status[next],'查看／处理 → 填写本次操作、处理说明和材料。'+(next==='confirmed'?'填写双方沟通后的报价总额，不代表在线收款。':next==='shipped'?'填写承运单位和运输登记号。':''),'保存后状态变为'+status[next]+'。',['[data-form="order-transition"]']);
  await f.locator('[type="submit"]').click();await b.locator('#modal .record .pill').getByText(status[next],{exact:true}).waitFor();
  await customerOrder(order.id,mode);await a.locator('#modal .record .pill').getByText(status[next],{exact:true}).waitFor();
  await snap(flow,a,'切回 A：核对'+status[next],'重新打开订单详情，核对工作人员处理后的状态。','同一订单当前状态为'+status[next]+'。',['#modal .record .pill','#modal .progress']);
 }
 const confirm=a.locator('[data-form="order-confirm"]');await confirm.locator('[name="note"]').fill('演示客户已核对型号与数量，确认收货。');await confirm.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await confirm.locator('[name="confirmed"]').check();await confirm.scrollIntoViewIfNeeded();
 await snap(flow,a,'客户确认收货','核对设备后填写说明、上传签收材料并勾选确认，点击确认收货。','客户签收后才进入已交付。',['[data-form="order-confirm"]']);
 await confirm.locator('[type="submit"]').click();await a.locator('#modal .record .pill').getByText('已交付',{exact:true}).waitFor();await staffOrder(order.id);
 await b.locator('#modal .record .pill').getByText('已交付',{exact:true}).waitFor();
 await snap(flow,b,'切换到 B：已交付','工作端重新打开同一订单，检查客户签收结果。','购买完成本次交付；租赁只完成交付阶段，不表示退租结算完成。',['#modal .record','#modal .progress']);
 await close(a);await close(b);return order;
}
async function staffTicket(id){await staffList('tickets');await b.locator('[data-action="staff-ticket"][data-id="'+id+'"]').click();await b.locator('#modal .progress').waitFor();}
async function afterFlow(order){
 const flow='售后流';await customerList('buy');await a.locator('[data-cu="after-create"][data-id="'+order.id+'"]').click();const f=a.locator('[data-form="ticket-create"]');
 await f.locator('[name="issue"]').fill('演示故障：设备运行异响，申请检查与维护，非真实故障。');await f.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await f.locator('[name="issue"]').scrollIntoViewIfNeeded();
 await snap(flow,a,'从已交付订单申请售后','购买订单 → 已交付订单的申请售后；填写故障、地点、紧急程度及材料。','售后工单关联原订单，不需要重复下单。',['[data-form="ticket-create"]']);
 const response=a.waitForResponse(r=>r.url().endsWith('/api/tickets')&&r.request().method()==='POST');await f.locator('[type="submit"]').click();const data=await(await response).json();assert.ok(data.ticket?.id,JSON.stringify(data));const ticket=data.ticket;
 await a.locator('[data-action="ticket-chat"]').waitFor();await customerList('after-sales');
 await snap(flow,a,'售后订单：待受理','订单与售后 → 售后订单，查看刚提交的工单。','显示故障描述、工单号、状态及联系客服。',['[data-cu="order-section"][data-section="after-sales"]','[data-order-panel="after-sales"]']);
 await chatDemo(flow,order.id,'buy');
 await staffTicket(ticket.id);let f2=b.locator('[data-form="ticket-transition"]');await f2.locator('[name="assignee"]').selectOption(engineer.user.id);await f2.locator('[name="note"]').fill('演示派单：安排工程师检查设备异响。');await f2.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await f2.scrollIntoViewIfNeeded();
 await snap(flow,b,'管理员派单给工程师','售后维保工单 → 查看／处理 → 选择服务工程师，填写说明和材料。','保存后进入待工程师接单。',['[data-form="ticket-transition"]']);await f2.locator('[type="submit"]').click();await b.locator('#modal .pill').getByText(status.assigned,{exact:true}).waitFor();
 await snap(flow,b,'派单完成：待工程师接单','检查工单状态与服务负责人。','工单已指派给指定工程师。',['#modal .section-top','#modal .progress']);
 await switchStaff(engineer);
 for(const next of ['in_progress','pending_review']){
  await staffTicket(ticket.id);const form=b.locator('[data-form="ticket-transition"]');await form.locator('[name="note"]').fill(next==='in_progress'?'演示：工程师已接单，开始现场检查。':'演示：检查与维修完成，提交维修结果和材料审核。');await form.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await form.scrollIntoViewIfNeeded();
  await snap(flow,b,next==='in_progress'?'切换工程师：开始维修':'工程师提交维修材料','在Chrome工作端退出原账号，使用被派单的工程师账号登录，打开同一维保工单。'+(next==='pending_review'?'维修完成后填写结论并上传材料。':'登记现场检查说明及材料。'),'保存后状态为'+status[next]+'。',['[data-form="ticket-transition"]']);
  await form.locator('[type="submit"]').click();await b.locator('#modal .pill').getByText(status[next],{exact:true}).waitFor();
  await snap(flow,b,'状态更新：'+status[next],'检查流程条与当前状态。','未通过审核及客户验收，工单不会直接关闭。',['#modal .section-top','#modal .progress']);
 }
 await switchStaff(reviewer);await staffTicket(ticket.id);const review=b.locator('[data-form="ticket-review"]');await review.locator('[name="decision"]').selectOption('approve');await review.locator('[name="note"]').fill('演示独立审核：维修结果与材料一致，提交客户验收。');await review.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await review.scrollIntoViewIfNeeded();
 await snap(flow,b,'切换审核员：独立审核','在Chrome工作端登录另一名审核人员，核对维修说明和材料，选择通过。','处理人不能审核自己的工单；通过后等待客户验收。',['[data-form="ticket-review"]']);await review.locator('[type="submit"]').click();await b.locator('#modal .pill').getByText('待客户验收',{exact:true}).waitFor();
 await snap(flow,b,'审核通过：待客户验收','检查审核通过后的状态。','工单尚未完成，需要客户最后确认。',['#modal .section-top','#modal .progress']);
 await customerList('after-sales');await a.locator('[data-cu="after-detail"][data-id="'+ticket.id+'"]').click();const accept=a.locator('[data-form="ticket-accept"]');await accept.locator('[name="decision"]').selectOption('accept');await accept.locator('[name="note"]').fill('演示验收：已核对维修结果，确认通过。');await accept.locator('[name="materials"]').setInputFiles(path.join(run,'proof.png'));await accept.scrollIntoViewIfNeeded();
 await snap(flow,a,'切回 A：客户验收','售后订单 → 查看售后进度 → 填写验收结论、说明及材料。','验收通过关闭工单；仍有问题可退回维修处理中。',['[data-form="ticket-accept"]']);await accept.locator('[type="submit"]').click();await a.locator('#modal .pill').getByText('已完成',{exact:true}).waitFor();
 await snap(flow,a,'售后完成：客户已验收','查看已完成状态和全过程记录。','报修、派单、维修、审核、客户验收形成完整记录。',['#modal .section-top','#modal .progress']);
 await switchStaff(admin);await staffTicket(ticket.id);await b.locator('#modal .pill').getByText('已完成',{exact:true}).waitFor();
 await snap(flow,b,'切换到 B：核对已完成','管理员重新打开同一工单。','工作端与客户端均为已完成。',['#modal .section-top','#modal .progress']);
}
(async()=>{
 try{
  app=createPlatform({root,dataDir:path.join(run,'business')});url=await app.start(0);
  for(const [role,name] of [['admin','演示管理员'],['service','演示工程师'],['reviewer','演示审核员']]){const r=await api('/api/register',{username:'manual.'+role,name,role,password,repeat:password});if(role==='admin')admin=r;else if(role==='service')engineer=r;else reviewer=r;}
  customer=await api('/api/customer/register',{phone,password,repeat:password});
  edge=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});chrome=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
  report.browsers=[{name:'Microsoft Edge',version:edge.version()},{name:'Google Chrome',version:chrome.version()}];
  const ac=await edge.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),bc=await chrome.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await ac.addInitScript(token=>{sessionStorage.setItem('sany-brand-intro-v1','seen');sessionStorage.setItem('sany-customer-session',token);},customer.token);
  await bc.addInitScript(()=>sessionStorage.setItem('sany-brand-intro-v1','seen'));
  a=await ac.newPage();b=await bc.newPage();for(const p of[a,b]){p.setDefaultTimeout(12000);p.on('pageerror',e=>report.errors.push(e.message));}
  await b.goto(url+'/?workspace=staff#work');await switchStaff(admin);
  // Explicitly synthetic proof image; not a real repair or delivery certificate.
  fs.writeFileSync(path.join(run,'proof.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=','base64'));
  const buy=await purchase('buy');await purchase('rent');await afterFlow(buy);
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true;
 }catch(e){report.failure=e.message;console.error(e.stack);process.exitCode=1;for(const [tag,p] of [['A',a],['B',b]])if(p){await p.screenshot({path:path.join(run,'error-'+tag+'.png')}).catch(()=>{});fs.writeFileSync(path.join(run,'error-'+tag+'.txt'),await p.locator('body').innerText().catch(()=>''));}}
 finally{fs.writeFileSync(path.join(out,'步骤与验证.json'),JSON.stringify(report,null,2));await edge?.close();await chrome?.close();await app?.close();console.log('RESULT '+JSON.stringify({passed:report.passed,steps:report.steps.length,failure:report.failure,run}));}
})();

