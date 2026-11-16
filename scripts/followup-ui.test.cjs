'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/followup-service.js'),'utf8');
function harness(role='admin',respond){
  const state={staffToken:'test-session',user:{id:'U1',role},users:[{id:'U1',name:'本人',role,active:true},{id:'U2',name:'其他工程师',role:'service',active:true}]};
  const calls=[],modals=[],notices=[];let closed=0;
  const data={asOf:'2026-10-26T00:00:00.000Z',counts:{open:1,overdue:0,mine:1,done:0},targets:[{kind:'order',id:'SO1',number:'SO1',title:'设备'}],tasks:[{id:'F1',kind:'order',recordId:'SO1',action:'<img src=x>',ownerId:'U1',ownerName:'本人',ownerActive:true,status:'open',dueAt:'2099-01-01T00:00:00.000Z',target:{number:'SO1',title:'设备'},history:[],revision:1}]};
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const ctx={getState:()=>state,api:async(...args)=>{calls.push(args);return respond?respond(...args):data;},esc,time:esc,button:(a,label,_c,attrs='')=>`<button data-action="${a}" ${attrs}>${label}</button>`,field:(label,name)=>`<input name="${name}" aria-label="${label}">`,textarea:(label,name)=>`<textarea name="${name}">${label}</textarea>`,select:(label,name,values)=>`<select name="${name}">${values.map(v=>esc(v[1])).join(',')}</select>`,formEnd:label=>`<button>${label}</button>`,empty:(a,b)=>`${a} ${b}`,toast:v=>notices.push(v),showModal:(title,html)=>modals.push(html),closeModal:()=>closed++};
  const sandbox={window:{SanyRequestId:{create:()=>require('node:crypto').randomUUID()}}};vm.runInNewContext(source,sandbox);
  return {service:sandbox.window.SanyFollowups.create(ctx),state,data,calls,modals,notices,closed:()=>closed,host:{isConnected:true,innerHTML:''}};
}
test('跟进界面：审核员只读，业务文本转义，说明包含口径与落款',async()=>{
  const h=harness('reviewer');await h.service.render(h.host);assert.doesNotMatch(h.host.innerHTML,/data-action="followup-new"/);assert.match(h.host.innerHTML,/&lt;img/);
  await h.service.click('followup-detail',{dataset:{id:'F1'}});assert.doesNotMatch(h.modals[0],/data-form="followup-complete"/);
  h.service.design(h.host);assert.match(h.host.innerHTML,/原型来源方：SDMC-IT/);assert.match(h.host.innerHTML,/kind=followup/);assert.match(h.host.innerHTML,/SLA/);
});
test('跟进界面：离开或注销后迟到列表不得恢复',async()=>{
  let done;const h=harness('admin',()=>new Promise(r=>{done=r;}));const pending=h.service.render(h.host);h.service.stop();h.host.innerHTML='其他页面';done(h.data);await pending;assert.equal(h.host.innerHTML,'其他页面');
  const pending2=h.service.render(h.host);h.state.staffToken='';h.host.innerHTML='登录页面';done(h.data);await pending2;assert.equal(h.host.innerHTML,'登录页面');
});
test('跟进界面：服务人员只可选自己，非负责人没有处理表单',async()=>{
  const h=harness('service');await h.service.render(h.host);await h.service.click('followup-new',{dataset:{}});assert.doesNotMatch(h.modals[0],/其他工程师/);
  h.data.tasks[0].ownerId='U2';await h.service.render(h.host);await h.service.click('followup-detail',{dataset:{id:'F1'}});assert.doesNotMatch(h.modals.at(-1),/data-form="followup-complete"/);
});
test('跟进界面：失败重试保留同一提交标识，不关闭表单或伪报成功',async()=>{
  const h=harness('admin',()=>{throw new Error('网络中断');});
  const form={dataset:{request:'retry-1'}},fields={target:'order:SO1',action:'联系客户',ownerId:'U1',priority:'normal',dueAt:'2099-01-01T10:00'};
  await assert.rejects(h.service.submit('followup-create',form,fields),/网络中断/);await assert.rejects(h.service.submit('followup-create',form,fields),/网络中断/);
  assert.equal(h.calls[0][2].requestId,h.calls[1][2].requestId);assert.equal(h.closed(),0);assert.equal(h.notices.length,0);
});
test('跟进界面：搜索与完成筛选不改变全量统计',async()=>{
  const h=harness();await h.service.render(h.host);await h.service.submit('followup-search',{}, {term:'不存在的词'});assert.match(h.host.innerHTML,/暂无符合条件/);assert.match(h.host.innerHTML,/待跟进<\/span><strong>1/);
});
