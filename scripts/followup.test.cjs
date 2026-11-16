'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createPlatform } = require('../server/platform.cjs');
test('全流程跟进：真实 HTTP、角色边界、幂等、并发与持久化', async t => {
  const root = path.resolve(__dirname, '..'); fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, '.qa/followup-test-'));
  let platform = createPlatform({ root, dataDir }), url = await platform.start(0);
  t.after(() => platform.close());
  async function request(endpoint, method = 'GET', body, token, status = 200) {
    if (!token && method === 'POST' && ['/api/orders','/api/projects'].includes(endpoint)) token = await require('./customer-fixture.cjs')(url);
    const res = await fetch(url + endpoint, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = await res.json(); assert.equal(res.status, status, `${method} ${endpoint}: ${value.error || ''}`); return value;
  }
  const password = 'Isolated-test-only-2026!';
  const register = (username, role) => request('/api/register','POST',{ username, name: username, role, password, repeat: password });
  const admin = await register('follow.admin','admin'), worker = await register('follow.worker','service'), other = await register('follow.other','service'), reviewer = await register('follow.reviewer','reviewer');
  const product = (await request('/api/products')).products.find(p => !p.exhibitOnly);
  const order = await request('/api/orders','POST',{ productId: product.id, mode:'buy', quantity:1, contact:'隔离测试', phone:'13800000000', address:'测试省测试市测试区隔离验收地址', date:'2099-01-01', files:[] });
  const project = await request('/api/projects','POST',{ title:'隔离工程需求', contact:'隔离测试', phone:'13800000000', confidential:true, items:[{productId:product.id,quantity:1}] });
  const plan = { kind:'order',recordId:order.order.id,ownerId:worker.user.id,action:'确认配置和交付日期',dueAt:'2099-01-01T00:00:00.000Z',priority:'normal',requestId:'first-plan' };
  let task;
  await t.test('初始空列表；客户和未登录访问被拒绝',async()=>{
    assert.equal((await request('/api/followups','GET',undefined,admin.token)).tasks.length,0);
    await request('/api/followups','GET',undefined,undefined,401);
    await request('/api/followups','GET',undefined,order.token,403);
    await request('/api/followups','POST',plan,reviewer.token,403);
  });
  await t.test('创建有效计划；不改变主单状态，不泄露重试指纹',async()=>{
    task=(await request('/api/followups','POST',plan,admin.token)).task;
    assert.equal(task.ownerName,'follow.worker'); assert.equal(task.status,'open'); assert.equal(task.requestHash,undefined); assert.equal(task.requestId,undefined);
    assert.equal((await request(`/api/orders/${order.order.id}`,'GET',undefined,order.token)).order.status,'submitted');
  });
  await t.test('同一请求重试不重复；内容改变拒绝复用请求标识',async()=>{
    assert.equal((await request('/api/followups','POST',plan,admin.token)).task.id,task.id);
    await request('/api/followups','POST',{...plan,action:'不同的行动'},admin.token,409);
    assert.equal((await request('/api/followups','GET',undefined,admin.token)).tasks.length,1);
  });
  await t.test('校验关联对象、负责人、时间、优先级与必填行动',async()=>{
    let seq=0;
    for(const patch of [{kind:'user'},{recordId:'missing'},{ownerId:reviewer.user.id},{dueAt:'2026-02-30T00:00:00.000Z'},{dueAt:'2000-01-01T00:00:00.000Z'},{dueAt:'2099-01-01'},{priority:'critical'},{action:'   '}]) {
      await request('/api/followups','POST',{...plan,...patch,requestId:`invalid-${seq++}`},admin.token,patch.recordId?404:400);
    }
    await request('/api/followups','POST',{...plan,requestId:'other-owner'},other.token,403);
  });
  await t.test('服务人员自建；审核员可读；工程需求关联独立',async()=>{
    const self=(await request('/api/followups','POST',{...plan,kind:'project',recordId:project.project.id,requestId:'project-plan'},worker.token)).task;
    assert.equal(self.target.kind,'project');
    const list=await request('/api/followups','GET',undefined,reviewer.token); assert.equal(list.tasks.length,2);
    assert.equal((await request('/api/followups','GET',undefined,worker.token)).counts.mine,2);
  });
  await t.test('非负责人和审核员不能完成；空结果不能关闭',async()=>{
    await request(`/api/followups/${task.id}/complete`,'POST',{revision:1,note:'已联系'},other.token,403);
    await request(`/api/followups/${task.id}/complete`,'POST',{revision:1,note:'已联系'},reviewer.token,403);
    await request(`/api/followups/${task.id}/complete`,'POST',{revision:1,note:''},worker.token,400);
  });
  await t.test('改派和改期留痕，旧负责人不能处理，旧版本冲突',async()=>{
    task=(await request(`/api/followups/${task.id}/reschedule`,'POST',{revision:1,note:'由另一位人员接续',ownerId:other.user.id,dueAt:'2099-02-01T00:00:00.000Z'},admin.token)).task;
    assert.equal(task.history[1].previousOwnerId,worker.user.id);
    await request(`/api/followups/${task.id}/complete`,'POST',{revision:2,note:'已联系'},worker.token,403);
    await request(`/api/followups/${task.id}/complete`,'POST',{revision:1,note:'已联系'},other.token,409);
  });
  await t.test('同版本并发完成仅一笔成功；状态和历史不重复',async()=>{
    const responses=await Promise.all([1,2].map(()=>fetch(url+`/api/followups/${task.id}/complete`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${other.token}`},body:JSON.stringify({revision:2,note:'客户已确认方案'})})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]); await Promise.all(responses.map(r=>r.arrayBuffer()));
    const done=(await request('/api/followups','GET',undefined,admin.token)).tasks.find(v=>v.id===task.id);
    assert.equal(done.history.length,3); assert.equal(done.status,'done');
    await request(`/api/followups/${task.id}/reschedule`,'POST',{revision:3,note:'重开',ownerId:other.user.id,dueAt:plan.dueAt},admin.token,409);
  });
  await t.test('逾期口径按服务端时间且排除已完成；停用负责人标记',async()=>{
    const db=new DatabaseSync(path.join(dataDir,'platform.sqlite'));
    const rows=db.prepare("SELECT id,body FROM records WHERE kind='followup'").all();
    for(const row of rows){ const record=JSON.parse(row.body);record.dueAt='2000-01-01T00:00:00.000Z';db.prepare("UPDATE records SET body=? WHERE kind='followup' AND id=?").run(JSON.stringify(record),row.id); } db.close();
    await request(`/api/admin/users/${worker.user.id}`,'PATCH',{active:false},admin.token);
    const list=await request('/api/followups','GET',undefined,admin.token);
    assert.equal(list.counts.overdue,1); assert.equal(list.counts.open,1);assert.equal(list.counts.done,1);
    assert.equal(list.tasks.find(v=>v.status==='open').ownerActive,false);
    await request('/api/followups','POST',{...plan,requestId:'disabled-owner'},admin.token,400);
  });
  await t.test('重启后任务及历史保留，旧会话失效',async()=>{
    await platform.close();platform=createPlatform({root,dataDir});url=await platform.start(0);
    await request('/api/followups','GET',undefined,admin.token,401);
    const session=await request('/api/login','POST',{username:'follow.admin',password});
    const list=await request('/api/followups','GET',undefined,session.token);assert.equal(list.tasks.length,2);assert.equal(list.tasks.find(v=>v.id===task.id).history.length,3);
  });
});
