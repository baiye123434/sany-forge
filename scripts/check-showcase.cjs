const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname,'..');
const dir = path.resolve(root,'../匠造智服_参赛展示资料包');
const qa = path.join(root,'.qa/showcase');
fs.mkdirSync(qa,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const report={pages:[],slides:0,steps:0,errors};
 try{
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.html'))){
   await page.goto(pathToFileURL(path.join(dir,file)).href);
   const result=await page.evaluate(()=>({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,signature:document.body.innerText.includes('报告来源方:SDMC-IT'),links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>!/^https?:|^#/.test(h))}));
   for(const link of result.links)if(!fs.existsSync(path.join(dir,link.split('#')[0])))throw Error('Broken link '+file+' '+link);
   if(result.overflow||!result.signature)throw Error('Invalid page '+file);
   await page.screenshot({path:path.join(qa,file+'.png'),fullPage:true});
   report.pages.push({file,title:result.title,pass:true});
  }
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  await page.locator('#present').click();
  for(let i=0;i<12;i++){
   if(await page.locator('.slide.current').count()!==1)throw Error('Slide visibility');
   await page.screenshot({path:path.join(qa,`slide-${i+1}.png`),fullPage:true});
   report.slides++;
   if(i<11)await page.locator('#next').click();
  }
  if(!await page.locator('#next').isDisabled())throw Error('Slide upper bound');
  await page.locator('#notes').click();
  if(await page.locator('.slide.current details').getAttribute('open')===null)throw Error('Notes');
  await page.keyboard.press('Escape');
  if(await page.locator('body.slide-mode').count())throw Error('Escape');
  await page.goto(pathToFileURL(path.join(dir,'双端协同演示.html')).href);
  for(let i=0;i<12;i++){
    if((await page.locator('#stepCount').innerText())!==`${i+1} / 12`)throw Error('Step count');
    if(!(await page.locator('#client').innerText())||!(await page.locator('#staff').innerText()))throw Error('Missing step content');
    report.steps++;
    if(i<11)await page.locator('#forward').click();
  }
  if(!await page.locator('#forward').isDisabled())throw Error('Step upper bound');
  await page.locator('#reset').click();
  if(!await page.locator('#back').isDisabled())throw Error('Step reset');
  await page.locator('#stepnav button').nth(9).click();
  if((await page.locator('#stepTitle').innerText())!=='独立审核')throw Error('Direct step');
  await page.locator('#design summary').click();
  await page.screenshot({path:path.join(qa,'interactive.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const file of ['index.html','双端协同演示.html','系统设计说明.html']){
   await page.goto(pathToFileURL(path.join(dir,file)).href);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow '+file);
  }
  await page.screenshot({path:path.join(qa,'mobile.png'),fullPage:true});
  if(errors.length)throw Error(errors.join(';'));
  fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
