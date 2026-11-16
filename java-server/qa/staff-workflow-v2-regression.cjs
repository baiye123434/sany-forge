'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createPlatform}=require('../../server/java-platform.cjs');

const root=path.resolve(__dirname,'../..');
const qa=path.join(root,'.qa',`staff-workflow-v2-${Date.now()}`);
fs.mkdirSync(qa,{recursive:true});
const platform=createPlatform({root,dataDir:path.join(qa,'data')});
const checks=[];
const password=`Test-${crypto.randomUUID()}`;
const files=[{name:'订单确认材料.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII='}];
let url;

async function api(route,token,body,status=200){
  const response=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  assert.equal(response.status,status,`${route}: ${JSON.stringify(data)}`);
  return data;
}
async function methodApi(route,token,method,body,status=200){
  const response=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body||{})});
  const data=await response.json();
  assert.equal(response.status,status,`${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}
async function check(name,work){await work();checks.push(name);console.log(`通过：${name}`);}

async function main(){
  url=await platform.start(0);
  let admin,service,secondService,reviewer,customer,customerId,serviceId,product,order,orderToken,supportChatId;

  await check('系统只公开超级管理员、客服和订单审核员三个岗位',async()=>{
    const bootstrap=await api('/api/bootstrap');
    assert.deepEqual(bootstrap.roles,['admin','service','reviewer']);
    admin=(await api('/api/setup',null,{username:'qa.admin',name:'测试超级管理员',password})).token;
    await api('/api/staff/users',admin,{username:'qa.service',name:'测试客服',password,roles:['service']});
    await api('/api/staff/users',admin,{username:'qa.service.backup',name:'测试接班客服',password,roles:['service']});
    await api('/api/staff/users',admin,{username:'qa.reviewer',name:'测试订单审核员',password,roles:['reviewer']});
    await api('/api/staff/users',admin,{username:'qa.operations',name:'不应存在的运营',password,roles:['operations']},400);
    await api('/api/staff/users',admin,{username:'qa.finance',name:'不应存在的财务',password,roles:['finance']},400);
    await api('/api/staff/users',admin,{username:'qa.mixed',name:'不允许混岗',password,roles:['service','reviewer']},400);
    service=(await api('/api/login',null,{username:'qa.service',password,role:'service'})).token;
    secondService=(await api('/api/login',null,{username:'qa.service.backup',password,role:'service'})).token;
    reviewer=(await api('/api/login',null,{username:'qa.reviewer',password,role:'reviewer'})).token;
    const serviceSession=await api('/api/staff/session',service);
    const adminSession=await api('/api/staff/session',admin);
    serviceId=serviceSession.user.id;
    assert.ok(serviceSession.permissions.includes('orders.accept'),'客服应拥有初步审核权限');
    assert.ok(serviceSession.permissions.includes('orders.handoff'),'客服应拥有向上提交权限');
    assert.ok(adminSession.permissions.includes('products.manage'),'超级管理员应拥有产品展览管理权限');
    await api('/api/customer/chats',reviewer,undefined,403);
    await api('/api/customer/chats',admin,undefined,403);
  });

  await check('超级管理员可对产品展览增删改查，其他岗位无权进入',async()=>{
    await api('/api/admin/products',service,undefined,403);
    await api('/api/admin/products',reviewer,{code:'DENIED',name:'越权产品',category:'测试',specs:[]},403);
    await api('/api/admin/product-images',service,files[0],403);
    const uploaded=(await api('/api/admin/product-images',admin,files[0])).image;
    const imageResponse=await fetch(url+uploaded);
    assert.equal(imageResponse.status,200);
    assert.match(imageResponse.headers.get('content-type')||'',/^image\//);
    let managed=(await api('/api/admin/products',admin,{code:'QA-EXHIBIT',name:'超管产品展览测试设备',category:'测试设备',subcategory:'权限回归',summary:'用于验证产品展览权限',image:uploaded,published:true,specs:[{name:'用途',value:'权限回归',unit:''}]})).product;
    assert.ok((await api('/api/admin/products',admin)).products.some(item=>item.id===managed.id),'新增产品应可在后台查询');
    assert.ok((await api('/api/products')).products.some(item=>item.id===managed.id),'已上架产品应出现在客户展览目录');
    managed=(await methodApi('/api/admin/products',admin,'PATCH',{...managed,name:'超管产品展览测试设备（已修改）',published:false})).product;
    assert.equal(managed.name,'超管产品展览测试设备（已修改）');
    assert.ok(!(await api('/api/products')).products.some(item=>item.id===managed.id),'下架产品不应出现在客户展览目录');
    await methodApi(`/api/admin/products/${managed.id}`,admin,'DELETE',{});
    const removed=(await api('/api/admin/products',admin)).products.find(item=>item.id===managed.id);
    assert.equal(removed.deleted,true,'删除采用软删除并保留产品台账');
    assert.equal(removed.published,false);
  });

  await check('客户离线留言在客服上线后可靠派单并产生通知',async()=>{
    const registered=await api('/api/customer/register',null,{phone:'13911112222',password,repeat:password});
    customer=registered.token; customerId=registered.customer.id;
    const chat=(await api('/api/customer/chat',customer,{})).chat;
    supportChatId=chat.id;
    await api(`/api/customer/chats/${chat.id}/messages`,customer,{text:'客户咨询：需要设备选型和交期建议',files,requestId:crypto.randomUUID()});
    assert.equal((await api('/api/staff/notifications',service)).notifications.length,0);
    const online=await api('/api/staff/presence',service,{action:'online'});
    assert.equal(online.presence.online,true);
    assert.ok((await api('/api/customer/chats',service)).chats.some(item=>item.id===chat.id&&item.unread===1));
    assert.ok((await api('/api/staff/notifications',service)).notifications.some(item=>item.title==='新的客户咨询'&&item.chatId===chat.id));
    await api(`/api/customer/chats/${chat.id}/messages`,service,{text:'客服回复：已收到，请确认设备数量和使用工况',files:[],requestId:crypto.randomUUID()});
    const messages=(await api(`/api/customer/chats/${chat.id}/messages?after=0`,customer)).messages;
    assert.ok(messages.some(item=>item.sender==='staff'&&item.text.includes('已收到')));
    await api(`/api/customer/chats/${chat.id}/read`,service,{seq:1});
  });

  await check('原客服离线后，客户新消息自动转派给当前在线客服',async()=>{
    await api('/api/staff/presence',service,{action:'offline'});
    await api('/api/staff/presence',secondService,{action:'online'});
    await api(`/api/customer/chats/${supportChatId}/messages`,customer,{text:'客户追问：请由当前在线客服继续接待',files:[],requestId:crypto.randomUUID()});
    await api(`/api/customer/chats/${supportChatId}/messages`,service,undefined,403);
    const assigned=(await api('/api/customer/chats',secondService)).chats.find(item=>item.id===supportChatId);
    assert.equal(assigned.unread,1);
    assert.ok((await api('/api/staff/notifications',secondService)).notifications.some(item=>item.chatId===supportChatId&&item.text.includes('当前在线客服')));
    await api('/api/staff/presence',secondService,{action:'offline'});
    await api('/api/staff/presence',service,{action:'online'});
  });

  product=(await api('/api/staff/catalog',service)).products.find(item=>!item.exhibitOnly);
  const action=async(name,token,extra={},expected=200)=>{
    const result=await api(`/api/staff/orders/${order.id}/actions`,token,{action:name,revision:order.revision,requestId:crypto.randomUUID(),...extra},expected);
    if(result.order)order=result.order;
    return result;
  };

  await check('客户下单后进入当前接待客服的我的客户订单，会话显示客户名称',async()=>{
    await api('/api/staff/presence',secondService,{action:'online'});
    assert.ok((await api('/api/customer/chats',service)).chats.some(item=>item.id===supportChatId),'下单前咨询会话应仍归当前接待客服');
    assert.ok(!(await api('/api/customer/chats',secondService)).chats.some(item=>item.id===supportChatId),'其他在线客服不应接管仍在接待的会话');
    /* 先给当前接待客服制造一笔公共队列负载；随后客户下单仍应优先归属当前会话客服，而不是转给空闲客服。 */
    const otherCustomer=(await api('/api/customer/register',null,{phone:'13911113333',password,repeat:password})).token;
    const otherOrder=(await api('/api/orders',otherCustomer,{productId:product.id,mode:'buy',quantity:1,contact:'其他客户',phone:'13911113333',address:'湖南省长沙市测试路66号',date:'2099-01-01',customerType:'personal',files:[]})).order;
    assert.equal(otherOrder.assigneeId,serviceId);
    const created=await api('/api/orders',customer,{productId:product.id,mode:'buy',quantity:2,contact:'客户甲',phone:'13911112222',address:'湖南省长沙市测试路88号',date:'2099-01-01',customerType:'personal',files:[]});
    order=created.order; orderToken=created.token;
    assert.equal(order.assigneeId,serviceId);
    assert.equal(order.handoffStatus,'pending_accept');
    assert.ok((await api('/api/staff/orders',service)).orders.some(item=>item.id===order.id));
    assert.ok(!(await api('/api/staff/orders',secondService)).orders.some(item=>item.id===order.id));
    const support=(await api('/api/customer/chats',service)).chats.find(item=>item.id===supportChatId);
    assert.equal(support.customerName,'客户甲');
    const conversation=(await api('/api/conversations',orderToken,{kind:'order',recordId:order.id})).conversation;
    assert.equal(conversation.record.customerName,'客户甲');
    assert.equal(conversation.record.customerPhone,'13911112222');
    assert.notEqual(conversation.record.title,conversation.record.customerName);
    await api(`/api/conversations/${conversation.id}/messages`,orderToken,{text:'请按刚才沟通的配置制作订单',clientMessageId:crypto.randomUUID()});
    assert.ok((await api('/api/conversations',service)).conversations.some(item=>item.id===conversation.id));
    assert.ok((await api('/api/staff/notifications',service)).notifications.some(item=>item.title==='客户订单消息'&&item.orderId===order.id));
    await api('/api/staff/presence',secondService,{action:'offline'});
  });

  await check('客服完成初步审核并向上提交后只能进入订单审核员',async()=>{
    await action('accept',service);
    await action('handoff',service,{dealPrice:680000,quotedPrice:680000,quoteVerified:true,files});
    assert.equal(order.handoffStatus,'pending_review');
    await action('approve',service,{},403);
    assert.ok((await api('/api/staff/notifications',reviewer)).notifications.some(item=>item.title==='待订单审核'&&item.orderId===order.id));
    await api(`/api/staff/orders/${order.id}/messages`,reviewer,{text:'越权联系客户',files:[],requestId:crypto.randomUUID()},403);
  });

  await check('审核员可退回客服补充，也可通过后直接递交超管',async()=>{
    await action('reject',reviewer,{},400);
    await action('reject',reviewer,{note:'请补充设备交付范围说明'});
    assert.equal(order.handoffStatus,'rejected');
    assert.ok((await api('/api/staff/notifications',service)).notifications.some(item=>item.title==='订单审核退回'&&item.orderId===order.id));
    await action('handoff',service,{dealPrice:680000,quotedPrice:680000,quoteVerified:true,files:[],note:'已补充说明'});
    await action('approve',reviewer,{note:'订单资料审核通过'});
    assert.equal(order.handoffStatus,'pending_fulfillment');
    assert.equal(order.status,'confirmed');
    assert.ok((await api('/api/staff/notifications',admin)).notifications.some(item=>item.title==='待履约处理'&&item.orderId===order.id));
  });

  await check('超级管理员查看全部痕迹并完成排产到发货',async()=>{
    assert.ok((await api('/api/staff/orders',admin)).orders.some(item=>item.id===order.id));
    await action('schedule_production',admin,{note:'进入生产计划 P-001'});
    assert.equal(order.handoffStatus,'production_scheduled');
    assert.equal(order.status,'preparing');
    await action('complete_production',admin,{note:'整机生产与质检完成'});
    assert.equal(order.handoffStatus,'ready_delivery');
    await action('ship',admin,{note:'物流单号 QA20261030001'});
    assert.equal(order.handoffStatus,'shipped');
    assert.equal(order.status,'shipped');
    assert.ok((await api('/api/customer/records',customer)).records.some(item=>item.id===order.id&&item.status==='shipped'));
  });

  await check('客服代建订单归客户本人，库存路径可推进到上门提货',async()=>{
    order=(await api('/api/staff/orders',service,{requestId:crypto.randomUUID(),customerName:'客户甲',customerPhone:'13911112222',productId:product.id,quantity:1,dealPrice:720000,quotedPrice:720000,urgency:'normal',notes:'客户在客服会话中确认自提',files})).order;
    assert.equal(order.handoffStatus,'in_handoff');
    assert.ok((await api('/api/customer/records',customer)).records.some(item=>item.id===order.id));
    await action('handoff',service,{dealPrice:720000,quotedPrice:720000,quoteVerified:true,files:[]});
    await action('approve',reviewer,{note:'审核通过'});
    await action('allocate_inventory',admin,{note:'调取长沙仓现货'});
    assert.equal(order.handoffStatus,'inventory_allocated');
    await action('confirm_inventory',admin,{note:'库存锁定并完成出库检查'});
    await action('pickup_ready',admin,{note:'长沙仓 2 号门可提货'});
    assert.equal(order.handoffStatus,'pickup_ready');
    assert.equal(order.status,'pickup_ready');
  });

  await check('超级管理员可以冻结和恢复客户账号但不删除历史记录',async()=>{
    const account=(await api('/api/customer/accounts',admin)).customers.find(item=>item.id===customerId);
    assert.ok(account?.active);
    await api(`/api/customer/accounts/${customerId}`,admin,{active:false});
    await api('/api/customer/me',customer,undefined,401);
    await api('/api/customer/login',null,{phone:'13911112222',password},401);
    await api(`/api/customer/accounts/${customerId}`,admin,{active:true});
    const restored=await api('/api/customer/login',null,{phone:'13911112222',password});
    assert.ok(restored.token);
    assert.ok((await api('/api/customer/records',restored.token)).records.length>=2);
  });

  await check('审计日志保留客服、审核和履约全过程',async()=>{
    const events=(await api('/api/staff/audit?orderNumber='+encodeURIComponent(order.number),admin)).events;
    for(const actionName of ['订单handoff','订单approve','订单allocate_inventory','订单confirm_inventory','订单pickup_ready']) assert.ok(events.some(item=>item.action===actionName),actionName);
  });
}

/* 验收只使用全新隔离数据库，结束时关闭本脚本持有的 Java/MySQL 进程。 */
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await platform.close();
  fs.writeFileSync(path.join(qa,'report.json'),JSON.stringify({ok:!process.exitCode,checks,finishedAt:new Date().toISOString()},null,2));
  console.log(`REPORT=${path.join(qa,'report.json')}`);
});
