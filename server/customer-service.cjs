'use strict';
const crypto = require('node:crypto');
function createCustomerService(ctx) {
  const {get,all,put,atomic,audit,auth,fail,text,phoneKey,passwordHash,verifyPassword,now,id,receipt}=ctx;
  const sessions=new Map(), attempts=new Map();
  const publicCustomer=c=>({id:c.id,phone:c.phone,active:c.active,createdAt:c.createdAt});
  function mobile(value){const p=phoneKey(text(value,30));if(!/^1[3-9]\d{9}$/.test(p))fail('请输入完整的11位手机号。');return p;}
  function customer(req,required=true){
    const token=String(req.headers.authorization||'').replace(/^Bearer /,''),s=sessions.get(token);
    if(!s||s.expires<Date.now()){sessions.delete(token);if(required||token)fail('客户登录已失效，请重新登录。',401);return null;}
    const c=get('customer',s.id);if(!c?.active)fail('客户账号已停用。',403);return c;
  }
  function session(c){for(const [k,s]of sessions)if(s.expires<Date.now())sessions.delete(k);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:c.id,expires:Date.now()+8*3600000});return{token,customer:publicCustomer(c)};}
  function revoke(cid){for(const[k,s]of sessions)if(s.id===cid)sessions.delete(k);}
  function throttle(key,limit=10){const at=Date.now();for(const[k,v]of attempts)if(v.until<at)attempts.delete(k);let v=attempts.get(key);if(!v){v={count:0,until:at+60000};attempts.set(key,v);}if(++v.count>limit)fail('操作过于频繁，请一分钟后重试。',429);}
  function customerType(value){if(value===undefined)return null;if(!['personal','enterprise'].includes(value))fail('请选择个人或企业用户类型。');return value;}
  const belongsToCustomer=(r,c)=>r.customerId===c.id||(!r.customerId&&phoneKey(r.phone)===c.phone);
  async function route(req,url,body){
    const p=url.pathname;if(!p.startsWith('/api/customer/'))return undefined;
    if(['/api/customer/register','/api/customer/login'].includes(p)&&req.method==='POST'){
      const number=mobile(body.phone);throttle('auth:'+number);throttle('auth-global',100);
      if(p.endsWith('/register'))return atomic(()=>{if(body.password!==body.repeat)fail('两次输入的密码不一致。');if(all('customer').some(c=>c.phone===number))fail('手机号已注册，请直接登录。',409);const c={id:id('CU'),phone:number,password:passwordHash(body.password),active:true,createdAt:now()};put('customer',c);audit('客户','注册客户账号',c.id);return session(c);});
      const c=all('customer').find(c=>c.phone===number);if(!c||!c.active||!verifyPassword(body.password,c.password))fail('手机号或密码错误，或账号已停用。',401);return session(c);
    }
    if(p==='/api/customer/logout'&&req.method==='POST'){sessions.delete(String(req.headers.authorization||'').replace(/^Bearer /,''));return{ok:true};}
    if(p==='/api/customer/me'&&req.method==='GET')return{customer:publicCustomer(customer(req))};
    if(p==='/api/customer/password'&&req.method==='POST')return atomic(()=>{const c=customer(req);throttle('password:'+c.id);if(!verifyPassword(body.currentPassword,c.password))fail('原密码不正确。',401);if(body.password!==body.repeat)fail('两次输入的密码不一致。');c.password=passwordHash(body.password);put('customer',c);revoke(c.id);audit('客户','修改客户密码',c.id);return{ok:true};});
    if(p==='/api/customer/accounts'&&req.method==='GET'){auth(req,['admin']);return{customers:all('customer').map(publicCustomer)};}
    const account=p.match(/^\/api\/customer\/accounts\/([\w-]+)$/);
    if(account&&req.method==='POST')return atomic(()=>{const access=auth(req,['admin']),c=get('customer',account[1]);if(!c)fail('客户不存在。',404);if(typeof body.active!=='boolean')fail('账号状态无效。');c.active=body.active;put('customer',c);revoke(c.id);audit(access.actor,c.active?'启用客户账号':'停用客户账号',c.id);return{customer:publicCustomer(c)};});
    if(p==='/api/customer/after-sales'&&req.method==='GET'){const c=customer(req);return{tickets:all('ticket').filter(t=>{const order=get('order',t.orderId);return order&&belongsToCustomer(order,c);}).map(t=>({id:t.id,number:t.number||t.id,orderId:t.orderId,title:t.product?.name||'设备报修',issue:t.issue,status:t.status,createdAt:t.createdAt})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};}
    if(p==='/api/customer/records'&&req.method==='GET'){const c=customer(req);return{records:['order','project'].flatMap(kind=>all(kind).filter(r=>belongsToCustomer(r,c)).map(r=>({kind,id:r.id,number:r.number,title:r.title||r.product?.name||'设备订单',mode:r.mode,quantity:r.quantity,status:r.status,createdAt:r.createdAt}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};}
    if(p==='/api/customer/record'&&req.method==='POST'){const c=customer(req);if(!['order','project'].includes(body.kind))fail('记录类型无效。');const r=get(body.kind,text(body.id,100));if(!r||!belongsToCustomer(r,c))fail('不能访问其他客户的记录。',403);return{kind:body.kind,...receipt(r,body.kind)};}
    if(p==='/api/customer/notifications'&&req.method==='GET'){
      const c=customer(req), unread=chat=>(chat.messages||[]).filter(m=>m.sender==='staff'&&m.seq>(chat.readByCustomer||0)).length;
      const support=all('supportChat').find(v=>v.customerId===c.id);
      return{supportUnread:support?unread(support):0,records:all('conversation').filter(v=>['order','project'].includes(v.kind)&&belongsToCustomer(get(v.kind,v.recordId)||{},c)).map(v=>({kind:v.kind,id:v.recordId,unread:unread(v)}))};
    }
    const readMatch=p.match(/^\/api\/customer\/chats\/([\w-]+)\/read$/);
    if(readMatch&&req.method==='POST')return atomic(()=>{const chat=get('supportChat',readMatch[1]);if(!chat)fail('会话不存在。',404);const bearer=String(req.headers.authorization||'').replace(/^Bearer /,'');let field;if(sessions.has(bearer)){const c=customer(req);if(chat.customerId!==c.id)fail('不能访问其他客户会话。',403);field='readByCustomer';}else{auth(req,['admin','service']);field='readByStaff';}const seq=Number(body.seq);if(!Number.isSafeInteger(seq)||seq<0||seq>(chat.messages.at(-1)?.seq||0))fail('消息游标无效。');chat[field]=Math.max(chat[field]||0,seq);put('supportChat',chat);return{ok:true};});
    if(p==='/api/customer/chat'&&req.method==='POST')return atomic(()=>{const c=customer(req);let chat=all('supportChat').find(v=>v.customerId===c.id);if(!chat){chat={id:id('CS'),customerId:c.id,createdAt:now(),updatedAt:now(),messages:[]};put('supportChat',chat);}return{chat:{id:chat.id}};});
    if(p==='/api/customer/chats'&&req.method==='GET'){auth(req,['admin','service']);return{chats:all('supportChat').map(c=>({id:c.id,phone:get('customer',c.customerId)?.phone||'已停用客户',updatedAt:c.updatedAt,lastMessage:c.messages.at(-1)?.text||'',count:c.messages.length,unread:c.messages.filter(m=>m.sender==='customer'&&m.seq>(c.readByStaff||0)).length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};}
    const match=p.match(/^\/api\/customer\/chats\/([\w-]+)\/messages$/);
    if(match){const chat=get('supportChat',match[1]);if(!chat)fail('会话不存在。',404);const bearer=String(req.headers.authorization||'').replace(/^Bearer /,'');let actor,sender;
      if(sessions.has(bearer)){const c=customer(req);if(chat.customerId!==c.id)fail('不能访问其他客户会话。',403);actor='客户';sender='customer';}else{const staff=auth(req,['admin','service']);actor=staff.actor;sender='staff';}
      if(req.method==='GET'){const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)fail('消息游标无效。');return{messages:chat.messages.filter(m=>m.seq>after).slice(0,200)};}
      if(req.method==='POST')return atomic(()=>{const content=text(body.text,2000),requestId=text(body.requestId,100);const duplicate=chat.messages.find(m=>m.requestId===requestId&&m.sender===sender);if(duplicate){if(duplicate.text!==content)fail('重复提交的消息内容不同。',409);return{message:duplicate};}throttle('chat:'+chat.id,60);if(chat.messages.length>=5000)fail('演示会话已达5000条上限。');const message={id:id('MSG'),seq:chat.messages.length+1,text:content,sender,senderName:actor,requestId,at:now()};chat.messages.push(message);chat.updatedAt=now();put('supportChat',chat);return{message};});
    }
    fail('客户接口不存在。',404);
  }
  return{route,customer,customerType,revokeAll:()=>sessions.clear()};
}
module.exports={createCustomerService};
