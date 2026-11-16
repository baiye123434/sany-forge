'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
// 只在显式指定的隔离 Java 服务上录入合成资料，不读取日常业务数据库。
if(process.env.SANY_TEST_RUN!=='isolated'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SANY_TEST_URL||''))throw Error('请指定隔离服务 SANY_TEST_URL 和 SANY_TEST_RUN=isolated');
const url=process.env.SANY_TEST_URL,out=path.resolve(__dirname,'../../.qa/java-browser');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const report={at:new Date().toISOString(),checks:[],errors:[],screenshots:[]},password='Browser-V3-test-only!';
 const username='browser.'+crypto.randomBytes(5).toString('hex');
 const register=await fetch(url+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,name:'Java界面验收',password,repeat:password,role:'admin'})});assert.equal(register.status,200);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const customer=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),staff=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const client=await customer.newPage(),work=await staff.newPage();
 for(const p of [client,work])p.on('pageerror',e=>report.errors.push(e.message));
 const check=name=>{report.checks.push(name);console.log('PASS '+name);};
 const shot=async(page,name)=>{await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});report.screenshots.push(name+'.png');};
 try{
  await client.goto(url+'/?workspace=customer#catalog');await client.locator('#catalogSearch').waitFor();
  assert.ok(await client.locator('#catalogSearch').isVisible());await shot(client,'catalog');check('原客户设备目录加载');
  assert.equal(await client.evaluate(()=>Object.keys(window.Forge3D.models).length),9);check('九类教学模型脚本保留');
  for(const [width,height]of [[390,844],[844,390],[1440,900]]){await client.setViewportSize({width,height});assert.equal(await client.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await shot(client,'catalog-'+width);check('设备目录无横向溢出 '+width);}
  await client.goto(url+'/?workspace=customer#account');await client.locator('[data-cu="register"]').click();
  const cf=client.locator('[data-cu-form="auth"]'),phone='18'+String(Date.now()).slice(-9);
  await cf.locator('[name="phone"]').fill(phone);await cf.locator('[name="password"]').fill(password);await cf.locator('[name="repeat"]').fill(password);await cf.locator('[type="submit"]').click();
  await client.locator('[data-cu-form="auth"]').waitFor({state:'detached'});await shot(client,'customer-account');check('真实页面注册客户并载入账号');
  await client.locator('[data-cu="chat"]').first().click();const message=client.locator('[data-cu-form="message"]');await message.waitFor();await message.locator('[name="text"]').fill('Java接口联调消息 <script>仅作文本</script>');await message.locator('[type="submit"]').click();
  await client.locator('.cu-message p').filter({hasText:'Java接口联调消息'}).waitFor();assert.equal(await client.locator('.cu-message script').count(),0);await shot(client,'customer-chat');check('真实客户客服发送与文本转义');
  await work.goto(url+'/?workspace=staff#work');
  const next=work.locator('[data-access="continue"]');await next.waitFor({timeout:20000});await next.click();
  const form=work.locator('[data-form="login"]');await form.waitFor();await form.locator('[name="username"]').fill(username);await form.locator('[name="password"]').fill(password);await form.locator('[type="submit"]').click();
  const enter=work.locator('[data-access="enter"]');await enter.waitFor({timeout:20000});await enter.click();await work.locator('#workBody').waitFor();check('真实员工密码登录和欢迎界面');
  await shot(work,'staff-dashboard');
  const tabs=await work.locator('.sidebar [data-tab]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab));
  for(const tab of tabs){const button=work.locator('.sidebar [data-tab="'+tab+'"]');await button.click();await work.locator('#workBody').waitFor();await work.waitForTimeout(150);assert.ok((await work.locator('#workBody').innerText()).trim().length>0);check('工作人员菜单加载 '+tab);}
  await shot(work,'staff-last-menu');
  await client.locator('[data-cu="close"]').click();await client.goto(url+'/?workspace=customer#work');await client.getByText('这是客户窗口',{exact:true}).waitFor();assert.equal(await client.locator('.sidebar').count(),0);check('客户窗口不继承员工登录');
  assert.deepEqual(report.errors,[]);check('浏览器没有未捕获脚本异常');
 }catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})();
