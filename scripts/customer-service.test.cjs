const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPlatform}=require('../server/platform.cjs');
test('客户账号、独立咨询、业务归属及用户类型的端到端隔离验证',async t=>{
 const root=path.resolve(__dirname,'..'),dataDir=fs.mkdtempSync(path.join(root,'.qa/customer-test-'));let app=createPlatform({root,dataDir}),url=await app.start(0);
 const pass=crypto.randomBytes(20).toString('hex');
 const api=async(p,b,token,status=200)=>{const r=await fetch(url+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:b===undefined?undefined:JSON.stringify(b)});assert.equal(r.status,status,p);return r.json();};
 try{
  const a=await api('/api/customer/register',{phone:'13800008881',password:pass,repeat:pass,role:'admin'}),b=await api('/api/customer/register',{phone:'13800008882',password:pass,repeat:pass});
  assert.equal(a.customer.role,undefined);assert.equal(a.customer.password,undefined);
  await api('/api/customer/register',{phone:'+86 138-0000-8881',password:pass,repeat:pass},null,409);
  await api('/api/customer/login',{phone:a.customer.phone,password:'wrong'},null,401);
  await api('/api/customer/register',{phone:'bad',password:pass,repeat:pass},null,400);
  await api('/api/customer/register',{phone:'13800008883',password:'short',repeat:'short'},null,400);
  await api('/api/admin/users',undefined,a.token,401);
  const staff=await api('/api/register',{username:'customer.test.admin',name:'测试管理员',role:'admin',password:pass,repeat:pass});
  const product=(await api('/api/products')).products.find(p=>!p.exhibitOnly);
  const orderData={productId:product.id,mode:'buy',quantity:1,phone:a.customer.phone,contact:'测试客户',address:'演示省演示市测试地址不配送',date:'2099-01-01',customerType:'enterprise'};
  const order=await api('/api/orders',orderData,a.token);assert.equal(order.order.customerType,'enterprise');assert.equal(order.order.customerId,a.customer.id);
  const projectData={title:'企业设备需求',phone:a.customer.phone,contact:'测试客户',confidential:true,items:[{productId:product.id,quantity:1}],customerType:'personal'};
  const project=await api('/api/projects',projectData,a.token);assert.equal(project.project.customerType,'personal');assert.equal(project.project.customerId,a.customer.id);
  await api('/api/orders',{...orderData,customerType:'admin'},a.token,400);await api('/api/projects',{...projectData,customerType:'unknown'},a.token,400);
  await api('/api/orders',orderData,undefined,401);await api('/api/projects',projectData,undefined,401);await api('/api/orders',{...orderData,mode:'rent',duration:2},undefined,401);await api('/api/orders',orderData,staff.token,401);const guest=await api('/api/orders',orderData,b.token);assert.equal(guest.order.customerId,b.customer.id);
  const records=await api('/api/customer/records',undefined,a.token);assert.equal(records.records.length,2);assert.equal((await api('/api/customer/records',undefined,b.token)).records.length,1);
  await api('/api/customer/record',{kind:'order',id:order.order.id},b.token,403);
  await api('/api/customer/record',{kind:'order',id:guest.order.id},a.token,403);
  const receipt=await api('/api/customer/record',{kind:'order',id:order.order.id},a.token);await api('/api/orders/'+order.order.id,undefined,receipt.token);
  const chat=(await api('/api/customer/chat',{},a.token)).chat;assert.equal((await api('/api/customer/chat',{},a.token)).chat.id,chat.id);
  await api(`/api/customer/chats/${chat.id}/messages`,undefined,b.token,403);await api('/api/customer/accounts',undefined,a.token,401);
  const message={text:'演示咨询',requestId:crypto.randomUUID()};await api(`/api/customer/chats/${chat.id}/messages`,message,a.token);await api(`/api/customer/chats/${chat.id}/messages`,message,a.token);
  assert.equal((await api(`/api/customer/chats/${chat.id}/messages`,undefined,staff.token)).messages.length,1);
  await api(`/api/customer/chats/${chat.id}/messages`,{text:'演示回复',requestId:crypto.randomUUID()},staff.token);assert.equal((await api(`/api/customer/chats/${chat.id}/messages?after=1`,undefined,a.token)).messages[0].sender,'staff');
  assert.equal((await api('/api/customer/notifications',undefined,a.token)).supportUnread,1);
  assert.equal((await api('/api/customer/notifications',undefined,b.token)).supportUnread,0);
  await api(`/api/customer/chats/${chat.id}/read`,{seq:2},b.token,403);
  await api(`/api/customer/chats/${chat.id}/read`,{seq:999},a.token,400);
  await api(`/api/customer/chats/${chat.id}/read`,{seq:2},a.token);
  await api(`/api/customer/chats/${chat.id}/read`,{seq:0},a.token);
  assert.equal((await api('/api/customer/notifications',undefined,a.token)).supportUnread,0);
  const convo=(await api('/api/conversations',{kind:'order',recordId:order.order.id},receipt.token)).conversation;
  await api(`/api/conversations/${convo.id}/messages`,{text:'订单进度回复',clientMessageId:crypto.randomUUID()},staff.token);
  assert.equal((await api('/api/customer/notifications',undefined,a.token)).records.find(r=>r.id===order.order.id).unread,1);
  assert.equal((await api('/api/customer/notifications',undefined,b.token)).records.length,0);
  await api(`/api/conversations/${convo.id}/read`,{seq:1},receipt.token);
  assert.equal((await api('/api/conversations/unread',undefined,staff.token)).conversations.length,0);
  await api('/api/conversations/unread',undefined,a.token,401);
  await api(`/api/conversations/${convo.id}/messages`,{text:'客户回复',clientMessageId:crypto.randomUUID()},receipt.token);
  assert.equal((await api('/api/conversations/unread',undefined,staff.token)).conversations.find(c=>c.recordId===order.order.id).unread,1);
  await api(`/api/conversations/${convo.id}/read`,{seq:2},staff.token);
  assert.equal((await api('/api/conversations/unread',undefined,staff.token)).conversations.length,0);

  assert.equal((await api('/api/customer/notifications',undefined,a.token)).records[0].unread,0);
  assert.equal((await api('/api/conversations/unread',undefined,staff.token)).supportUnread,1);
  await api(`/api/customer/chats/${chat.id}/read`,{seq:2},staff.token);
  assert.equal((await api('/api/conversations/unread',undefined,staff.token)).supportUnread,0);
  assert.equal((await api('/api/customer/chats',undefined,staff.token)).chats[0].unread,0);
  await api('/api/customer/after-sales',undefined,undefined,401);assert.deepEqual((await api('/api/customer/after-sales',undefined,a.token)).tickets,[]);
  const accounts=await api('/api/customer/accounts',undefined,staff.token);assert.ok(accounts.customers.every(c=>c.password===undefined));
  await api('/api/customer/accounts/'+a.customer.id,{active:false},staff.token);await api('/api/customer/me',undefined,a.token,401);await api('/api/customer/login',{phone:a.customer.phone,password:pass},null,401);
  await api('/api/customer/accounts/'+a.customer.id,{active:true},staff.token);const relogin=await api('/api/customer/login',{phone:a.customer.phone,password:pass});
  const next=crypto.randomBytes(20).toString('hex');await api('/api/customer/password',{currentPassword:pass,password:next,repeat:next},relogin.token);await api('/api/customer/me',undefined,relogin.token,401);
  await app.close();app=createPlatform({root,dataDir});url=await app.start(0);const restored=await api('/api/customer/login',{phone:a.customer.phone,password:next});assert.equal((await api(`/api/customer/chats/${chat.id}/messages`,undefined,restored.token)).messages.length,2);assert.equal((await api('/api/customer/records',undefined,restored.token)).records.length,2);
  const historyDb=new (require('node:sqlite').DatabaseSync)(path.join(dataDir,'platform.sqlite'));
  const insert=historyDb.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?)');
  for(const [kind,source] of [['order',order.order],['project',project.project]]){
   const legacy={...source,id:'LEGACY-'+kind,number:'LEGACY-'+kind,phone:'+86 138-0000-8881'};delete legacy.customerId;
   insert.run(kind,legacy.id,JSON.stringify(legacy));
   const other={...legacy,id:'OTHER-'+kind,phone:'13800008889'};insert.run(kind,other.id,JSON.stringify(other));
  }
  for(const [id,orderId]of [['OWN-TICKET',order.order.id],['OTHER-TICKET',guest.order.id]])insert.run('ticket',id,JSON.stringify({id,orderId,product:{name:'演示设备'},issue:'演示报修',status:'submitted',createdAt:new Date().toISOString()}));
  assert.deepEqual((await api('/api/customer/after-sales',undefined,restored.token)).tickets.map(t=>t.id),['OWN-TICKET']);
  const before=historyDb.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all();
  const history=(await api('/api/customer/records',undefined,restored.token)).records;assert.equal(history.length,4);
  for(const kind of ['order','project']){assert.ok(history.some(r=>r.id==='LEGACY-'+kind));await api('/api/customer/record',{kind,id:'LEGACY-'+kind},restored.token);await api('/api/customer/record',{kind,id:'OTHER-'+kind},restored.token,403);}
  await api('/api/customer/record',{kind:'order',id:guest.order.id},restored.token,403);
  assert.deepEqual(historyDb.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all(),before);historyDb.close();
  await api('/api/customer/logout',{},restored.token);await api('/api/customer/me',undefined,restored.token,401);
  const db=new (require('node:sqlite').DatabaseSync)(path.join(dataDir,'platform.sqlite'),{readOnly:true});const customer=JSON.parse(db.prepare("SELECT body FROM records WHERE kind='customer' AND id=?").get(a.customer.id).body);assert.notEqual(customer.password,next);assert.ok(customer.password.includes(':'));db.close();
 }finally{await app.close()}
});
