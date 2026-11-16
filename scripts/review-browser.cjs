'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createPlatform } = require('../server/platform.cjs');
(async () => {
  const root = path.resolve(__dirname,'..'), out = path.join(root,'.qa/review-20261026/browser');
  fs.mkdirSync(out,{recursive:true});
  const platform = createPlatform({root,dataDir:fs.mkdtempSync(path.join(out,'business-'))});
  const url = await platform.start(0); let browser;
  const report = {at:new Date().toISOString(),checks:[],errors:[],screenshots:[]};
  const check=(name)=>{ report.checks.push({name,pass:true}); console.log('PASS '+name); };
  async function api(endpoint, body, token) {
    const res=await fetch(url+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    assert.equal(res.status,200);return res.json();
  }
  try {
    browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
    const customer=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const staff=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const page=await staff.newPage(), client=await customer.newPage();
    for(const p of [page,client]) p.on('pageerror',e=>report.errors.push(e.message));
    await client.goto(url+'/?workspace=customer#catalog');
    await client.locator('#catalogSearch').waitFor();
    await client.screenshot({path:path.join(out,'catalog.png'),fullPage:true});report.screenshots.push('catalog.png');check('真实客户目录加载与截图');
    const modelKeys=await client.evaluate(()=>Object.keys(window.Forge3D.models));
    assert.equal(modelKeys.length,9);
    for(const key of modelKeys) {
      const result=await client.evaluate(async modelKey=>{
        const host=document.createElement('div');host.style.cssText='position:fixed;top:100px;left:40px;width:600px;height:400px;z-index:10000;background:white';document.body.append(host);
        try {
          const viewer=window.Forge3D.mount(host,modelKey);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const canvas=host.querySelector('canvas');
          return {mounted:!!viewer,canvas:!!canvas,width:canvas?.width||0,height:canvas?.height||0,fallback:!!host.querySelector('.m3d-fallback')};
        } finally {window.Forge3D.unmount();host.remove();}
      },key);
      assert.ok(result.mounted&&result.canvas&&result.width>0&&result.height>0&&!result.fallback,`模型 ${key} 未实际渲染`);check(`真实 WebGL 模型挂载与释放：${key}`);
    }
    const products=(await api('/api/products')).products;
    const order=await api('/api/orders',{productId:products.find(p=>!p.exhibitOnly).id,mode:'buy',quantity:1,contact:'界面验收',phone:'13800000000',address:'测试省测试市测试区隔离演示地址',date:'2099-01-01',files:[]});
    await page.goto(url+'/?workspace=staff#work');
    await page.locator('[data-access="continue"]').click();
    await page.locator('[data-action="auth-mode"][data-mode="register"]').click();
    if (await page.locator('[data-access="continue"]').isVisible()) await page.locator('[data-access="continue"]').click();
    const register=page.locator('[data-form="register"]');
    await register.locator('[name="username"]').fill('browser.admin');
    await register.locator('[name="name"]').fill('隔离验收管理员');
    await register.locator('[name="role"]').selectOption('admin');
    await register.locator('[name="password"]').fill('Browser-test-only-2026!');
    await register.locator('[name="repeat"]').fill('Browser-test-only-2026!');
    await register.locator('button[type="submit"]').click();
    // 登录仪式若要求欢迎确认，操作真实按钮，不注入登录令牌。
    await page.locator('[data-access="enter"]').click();
    await page.locator('.sidebar [data-tab="followups"]').waitFor({timeout:20000});check('真实注册并进入工作人员工作台');
    await page.locator('.sidebar [data-tab="followups"]').click();
    await page.locator('[data-action="followup-new"]').click();
    const create=page.locator('[data-form="followup-create"]');
    await create.locator('[name="target"]').selectOption(`order:${order.order.id}`);
    await create.locator('[name="dueAt"]').fill('2099-01-01T10:00');
    await create.locator('[name="action"]').fill('确认配置 <img src=x onerror=alert(1)>');
    await create.locator('button[type="submit"]').click();
    await page.locator('#workBody').getByText('确认配置 <img src=x onerror=alert(1)>',{exact:true}).waitFor();
    assert.equal(await page.locator('#workBody img[src="x"]').count(),0);check('跟进创建、列表刷新及文本转义');
    await page.screenshot({path:path.join(out,'followups-desktop.png'),fullPage:true});report.screenshots.push('followups-desktop.png');
    await page.locator('[data-action="followup-detail"]').click();
    const complete=page.locator('[data-form="followup-complete"]');
    await complete.locator('[name="note"]').fill('已沟通配置，待客户书面确认。');
    await complete.locator('button[type="submit"]').click();
    await page.locator('#modal').waitFor({state:'hidden'});
    await page.locator('[data-action="followup-filter"][data-value="done"]').click();
    await page.locator('#workBody').getByText('结果：已沟通配置，待客户书面确认。',{exact:true}).waitFor();check('完成跟进及已完成筛选');
    for(const [width,height] of [[1440,900],[390,844],[844,390]]) {
      await page.setViewportSize({width,height});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      assert.equal(overflow,false,`跟进页面溢出 ${width}`);
      const name=`followups-${width}.png`;await page.screenshot({path:path.join(out,name),fullPage:true});report.screenshots.push(name);check(`跟进布局 ${width}×${height} 无横向溢出`);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.sidebar [data-tab="followup-design"]').click();
    await page.getByText('原型来源方：SDMC-IT',{exact:true}).waitFor();check('菜单内设计说明可访问');
    await page.screenshot({path:path.join(out,'design.png'),fullPage:true});report.screenshots.push('design.png');
    await client.goto(url+'/?workspace=customer#work');
    await client.getByText('这是客户窗口',{exact:true}).waitFor();assert.equal(await client.locator('.sidebar').count(),0);check('客户浏览器会话不继承员工权限');
    await page.locator('[data-action="logout"]').click();
    await page.locator('[data-access="continue"]').click();
    await page.locator('[data-form="login"]').waitFor();check('退出清理工作台');
    assert.equal(report.errors.length,0);check('实际页面运行无未捕获 JavaScript 异常');
  } catch(e) { report.failure=e.message;console.error(e.stack);process.exitCode=1; }
  finally { if(browser) await browser.close();await platform.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); }
})();
