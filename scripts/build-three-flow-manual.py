from pathlib import Path
from datetime import datetime
from html import escape
import json, base64, re, zipfile

root=Path(__file__).resolve().parents[2]
pack=root/'匠造智服_参赛展示资料包'
shots=pack/'三业务流截图'
data=json.loads((shots/'步骤与验证.json').read_text(encoding='utf-8'))
for step in data['steps']:
    step['browser']='客户端 · Microsoft Edge' if step['browser'].startswith(('A','客户端')) else '工作人员端 · Google Chrome'
    step['title']=step['title'].replace('切换到 B：','切换到工作人员端：').replace('切回 A：','返回客户端：')

assert data.get('passed') and not data['errors']
for index,step in enumerate(data['steps'],1):
    image=base64.b64encode((shots/step['file']).read_bytes()).decode()
    marks=[]
    for n,box in enumerate(step['boxes'],1):
        x,y,w,h=[round(box[k],1) for k in ['x','y','w','h']]
        # Annotation is a separate SVG layer. The captured image remains unchanged.
        marks.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#f13242" stroke-width="3"/><rect x="{x}" y="{max(0,y-22)}" width="24" height="22" fill="#f13242"/><text x="{x+12}" y="{max(0,y-22)+16}" text-anchor="middle" fill="white" font-family="Arial" font-size="15" font-weight="bold">{n}</text>')
    annotated=step['file'].replace('.png','-红框.svg')
    (shots/annotated).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000" viewBox="0 0 1440 1000"><title>{escape(step["title"])}</title><image width="1440" height="1000" href="data:image/png;base64,{image}"/>'+''.join(marks)+'</svg>',encoding='utf-8')
    step['annotated']=annotated

def flow(values):
    return '<div class="flowchart">'+'<b class="arrow">→</b>'.join('<span>'+escape(v)+'</span>' for v in values)+'</div>'
summaries={
'购买流':('buy','从询价到客户签收',['待受理','已确认报价','备货中','待收货','已交付'],'客户选择购买 → 工作人员受理并报价 → 备货发运 → 客户签收。报价由工作人员录入，不代表已经付款。'),
'租赁流':('rent','按租期申请，按订单交付',['待受理','已确认报价','备货中','待收货','已交付'],'客户选择租赁并填写租期 → 工作人员分类受理 → 报价与发运 → 客户签收。本次演示租期为3个月。已交付只代表设备交付，尚未覆盖续租、归还验机及租金结算。'),
'售后流':('after','报修、维修、审核、验收',['待受理','待工程师接单','维修处理中','待材料审核','待客户验收','已完成'],'从已交付订单申请售后 → 管理员派单 → 指定工程师处理 → 另一名审核人员审核 → 客户验收。审核不通过或客户退回时，回到维修处理中。')}

css='''
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:78px}body{margin:0;background:#f0f3ed;color:#1d302a;font:16px/1.75 "Microsoft YaHei",sans-serif}header{background:#20352c;color:white;padding:16px 5%;display:flex;justify-content:space-between;gap:20px;align-items:center}header a{color:#e9efdc;text-decoration:none}main{max-width:1180px;margin:auto;padding:26px 28px 65px}.meta{font-size:12px;color:#637269;border-bottom:1px solid #c9d3c6;padding-bottom:13px}h1{font-size:38px;line-height:1.3;margin:24px 0 12px}h2{font-size:27px;margin:5px 0 14px}h3{font-size:20px;margin:12px 0}.intro{font-size:18px;max-width:940px}.toolbar{position:sticky;top:0;z-index:10;background:#f0f3edf5;border-block:1px solid #cbd6c7;display:flex;flex-wrap:wrap;gap:10px;padding:12px 0;margin:22px 0}.toolbar a,.toolbar button{background:white;border:1px solid #a6b6a9;padding:7px 14px;color:#203a2d;font:inherit;text-decoration:none;cursor:pointer}.toolbar a.active{background:#e5ef40;border-color:#bac525;font-weight:bold}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{padding:20px 24px;background:white;border-top:3px solid #304d3d}.pill{display:inline-block;padding:2px 10px;background:#edf1e8;font-size:13px;font-weight:bold}.switch{background:#e9f0fc;color:#28507a}.client{background:#e7efb8;color:#3a4d1a}.note{padding:14px 20px;border-left:4px solid #758c75;background:#e5eadf;margin:18px 0}.warn{border-left-color:#b18a2d;background:#f4efde}.muted{color:#617166;font-size:14px}.chapter{margin-top:55px}.flowchart{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:20px 0}.flowchart span{background:#fff;border:1px solid #bbcbb8;border-bottom:3px solid #446a4b;padding:9px 13px;font-size:14px}.arrow{color:#667b63}.step{background:#fff;border:1px solid #c6d1c2;margin:24px 0;padding:22px;scroll-margin-top:85px}.step h3{margin:10px 0;font-size:22px}.step p{margin:8px 0}.expected{color:#31583e}.shot{display:block;width:100%;height:auto;border:1px solid #b6c2b2;cursor:zoom-in;margin-top:16px}.caption{font-size:12px;color:#617166}.stepindex{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 16px}.stepindex a{font-size:13px;color:#345b40;text-decoration:none}.flowhead{padding:25px;background:#e5ebdf;border-top:4px solid #2b4736}details{background:#e8eee2;padding:14px 18px;margin:18px 0}summary{cursor:pointer;font-weight:bold}footer{padding:22px 5%;border-top:1px solid #bfccba;font-size:12px;color:#5c6c60}dialog{width:96vw;max-width:none;height:95vh;padding:15px;background:#f5f7f0;border:1px solid #a7bba2}dialog::backdrop{background:#000b}dialog img{width:100%;height:auto}dialog button{position:sticky;top:0;float:right;padding:8px 18px;background:#243e30;color:white;border:0;cursor:pointer}a:focus-visible,button:focus-visible{outline:3px solid #bd8833;outline-offset:3px}body.compact .step .shot,body.compact .step .caption{display:none}@media(max-width:750px){main{padding:20px 14px}.grid,.stepindex{grid-template-columns:1fr}.step{padding:14px}h1{font-size:29px}header{font-size:13px}.flowchart{gap:5px}.flowchart span{padding:6px 8px}.toolbar{gap:5px}.toolbar a,.toolbar button{font-size:13px;padding:5px 8px}}@media print{@page{size:A4;margin:12mm}header,.toolbar,dialog,.stepindex,.noprint{display:none!important}body{background:white;font-size:10pt}main{padding:0;max-width:none}h1{font-size:25pt}h2{font-size:20pt}.chapter{break-before:page;margin-top:0}.step{break-before:page;break-inside:avoid;margin:0;border:0;padding:0}.step h3{font-size:15pt}.step .shot{display:block!important;width:100%;max-height:205mm;object-fit:contain}.step .caption{display:block!important}.step p{font-size:10pt;margin:6px 0}.flowhead,.panel{break-inside:avoid}.toolbar{position:static}footer{padding:8px 0}.note{font-size:10pt}}
'''
meta='<div class="meta">生成时间：'+datetime.now().strftime('%Y-%m-%d %H:%M')+'　｜　数据截至时间：2026-10-27　｜　报告对象：三一匠造 · 三条业务流操作手册</div>'
intro='''<h1>三线协同 · 双端实操手册</h1><p class="intro">购买流、租赁流、售后流。按“客户端提交 → 工作人员端处理 → 客户端确认”顺序阅读；红框标出关键字段、状态和消息提醒。</p>
<nav class="toolbar"><a href="#buy" class="active" aria-current="location">01 购买流</a><a href="#rent">02 租赁流</a><a href="#after">03 售后流</a><button id="compact">收起／展开截图</button><button onclick="window.print()">打印／保存PDF</button></nav>
<div class="grid"><div class="panel"><span class="pill client">客户端 · Microsoft Edge</span><h3>客户入口</h3><p>设备租购、订单与售后。使用自己的客户手机号账号登录；所有申请都关联当前客户。</p><p>点击右上角头像进入登录；登录成功回到原页面。</p></div><div class="panel"><span class="pill switch">工作人员端 · Google Chrome</span><h3>工作人员入口</h3><p>服务工作台 → 售中订单跟进／售后维保工单。管理员受理派单，工程师维修，另一名审核人员审核。</p><p>切换岗位时退出当前工作账号，再登录目标岗位账号。</p></div></div>
<h2 style="margin-top:30px">开始前准备</h2><ol><li>启动网页版服务，在Edge打开客户端，在Chrome打开工作人员端。不要把两个入口放在同一浏览器的同一会话里替代本手册的双浏览器演示。</li><li>准备客户、管理员、服务工程师和审核员四类演示账号。手册不提供密码，使用自己设置的演示账号。</li><li>准备可上传的演示证明材料。报价、交付、维修和审核按表单要求填写说明与材料，勿使用真实敏感资料。</li><li>先完成购买或租赁签收，再从已交付订单发起售后。保持同一单据编号，避免切错记录。</li></ol>
<div class="note"><b>消息与刷新规则：</b>发送方发完消息，接收方先保持聊天窗口关闭，才便于展示未读红点。点击红点或“联系客服”打开对应会话并阅读，红点随后消除。状态处理后使用刷新记录／刷新数据或重新打开详情；聊天与未读提醒自动同步。</div>
<p class="muted">各页面可能用不同简写：工作端“待收货”对应客户端“已发运”，“待工程师接单”对应“已派单”，“维修处理中”对应“维修中”，“待材料审核”对应“待审核”。它们是同一状态的不同展示名称。</p>'''

chapters=[]
for flowname,(key,subtitle,states,desc) in summaries.items():
    rows=[(i,s) for i,s in enumerate(data['steps'],1) if s['flow']==flowname]
    toc='<details><summary>本流程步骤目录（'+str(len(rows))+'步）</summary><div class="stepindex">'+''.join(f'<a href="#step{i}">{local:02d}. {escape(s["title"])}</a>' for local,(i,s) in enumerate(rows,1))+'</div></details>'
    chapter=f'<section class="chapter" id="{key}"><div class="flowhead"><h2>{flowname}｜{subtitle}</h2><p>{desc}</p>{flow(states)}</div>{toc}'
    if key=='after':chapter+='<div class="note warn">售后聊天复用原订单会话，所以同一条客服消息可能同时提醒“购买订单”和“售后订单”。这不是重复报修；打开该会话阅读后，两处提醒同步更新。</div>'
    for local,(i,s) in enumerate(rows,1):
        cls='client' if s['browser'].startswith('客户端') else 'switch'
        chapter+=f'<article class="step" id="step{i}"><span class="pill {cls}">{escape(s["browser"])}</span><span class="pill">{flowname} · {local:02d}/{len(rows):02d}</span><h3>{escape(s["title"])}</h3><p><b>操作：</b>{escape(s["instruction"])}</p><p class="expected"><b>预期结果：</b>{escape(s["expected"])}</p><img class="shot" loading="lazy" src="三业务流截图/{s["annotated"]}" alt="{escape(s["title"])}，红框标注关键位置" tabindex="0"><p class="caption">图 {i:02d} · {escape(s["browser"])} · 红框为关注位置，点击图片可放大。</p></article>'
    chapters.append(chapter+'</section>')
appendix='''<section class="chapter" id="appendix"><h2>常见情况与演示核对</h2><details open><summary>没有看到小红点</summary><p>确认对方已发出新消息，且当前接收端没有打开并读完该会话。保持窗口可见，等待自动同步；刷新后再次核对账号和业务编号。已读后红点消失是正常结果。</p></details><details open><summary>客户看不到工作人员更新的状态</summary><p>点击刷新记录或重新进入详情；工作端确认表单已经提交成功，不只是填写了内容。操作失败时，查看表单或弹窗错误提示。</p></details><details open><summary>不能报修或没有维修处理按钮</summary><p>售后只能从已交付订单申请；维修进度由被派单的工程师提交；审核需要另一名管理员或审核员；最后验收由订单客户完成。</p></details><details open><summary>三条业务线演示完成标准</summary><p>购买：报价、备货、发运、客户签收。租赁：记录租期并完成本次交付。售后：派单、处理、独立审核、客户验收。每条主线均展示双向消息、双方红点以及读完消除。</p></details><h3>截图与验证说明</h3><p>本次使用已安装的Microsoft Edge和Google Chrome两个独立浏览器程序，在隔离的演示实例中实际提交订单、发送消息和推进状态。所有53张截图来自这次执行；红框是叠加的说明标记，未修改业务内容。</p><p>管理员、工程师、审核员为不同账号；工作端在各阶段切换对应会话。截图中的客户、地址、金额、故障、上传材料均为演示内容，不构成真实交易或维修证明。截图页面是浏览器内容区，不含浏览器工具栏。</p><p>本次三条业务线运行成功，前端未捕获未处理异常。租赁归还与结算、真实收款不在本次已实现范围内；审核退回及客户退回路径在流程说明中列出，本次截图展示通过路径。</p></section>'''
script='''<script>const flowLinks=[...document.querySelectorAll('.toolbar a[href^="#"]')];function selectFlow(id){flowLinks.forEach(a=>{const active=a.hash==='#'+id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')})}let scrollPending=false;function syncFlow(){scrollPending=false;const chapters=['buy','rent','after'].map(id=>document.getElementById(id));let id='buy';for(const chapter of chapters){if(chapter.getBoundingClientRect().top<=150)id=chapter.id}selectFlow(id)}flowLinks.forEach(a=>a.addEventListener('click',()=>{selectFlow(a.hash.slice(1))}));window.addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(syncFlow)}},{passive:true});window.addEventListener('hashchange',()=>{if(['#buy','#rent','#after'].includes(location.hash))selectFlow(location.hash.slice(1))});if(['#buy','#rent','#after'].includes(location.hash))selectFlow(location.hash.slice(1));const zoom=document.querySelector('#zoom'),large=zoom.querySelector('img');document.querySelectorAll('.shot').forEach(img=>{const open=()=>{large.src=img.src;large.alt=img.alt;zoom.showModal()};img.addEventListener('click',open);img.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();open()}})});document.querySelector('#zoomClose').onclick=()=>zoom.close();document.querySelector('#compact').onclick=()=>document.body.classList.toggle('compact');</script>'''
html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三线协同 · 双端实操手册</title><style>'+css+'</style></head><body><header><strong>三一匠造工程装备全流程交付与服务协同平台 / 操作手册</strong><a href="index.html">返回参赛展示稿</a></header><main>'+meta+intro+''.join(chapters)+appendix+'</main><footer>报告来源方:SDMC-IT</footer><dialog id="zoom"><button id="zoomClose">关闭大图</button><img alt="截图大图"></dialog>'+script+'</body></html>'
# Embed raster screenshots for portable single-file viewing.
for step in data['steps']:
    png=shots/step['annotated'].replace('.svg','.png')
    assert png.exists(), 'Render annotation SVGs to PNG before building the portable manual.'
    uri='data:image/png;base64,'+base64.b64encode(png.read_bytes()).decode()
    html=html.replace('src="三业务流截图/'+step['annotated']+'"','src="'+uri+'"')
html=html.replace('loading="lazy"','loading="eager"')
assert html.count('src="data:image/png;base64,')==53
(pack/'系统操作手册.html').write_text(html,encoding='utf-8')
(pack/'三条业务流操作手册.html').write_text(html,encoding='utf-8')
# Keep delivery evidence free of credentials. Data store and sessions remain outside the package.
assert all((shots/s['annotated']).exists() for s in data['steps'])
assert len(re.findall(r'class="shot"',html))==53
assert len(re.findall(r'<article class="step"',html))==53
assert len({s['file'] for s in data['steps']})==53
for flowname in summaries:
    rows=[s for s in data['steps'] if s['flow']==flowname]
    assert any('红点消除' in s['title'] for s in rows)
    assert any('工作端出现未读红点' in s['title'] for s in rows)
    assert any('页签与联系客服出现红点' in s['title'] for s in rows)
print('PASS: 53个步骤、53张红框截图、三条业务流的双方红点与已读消除完整')
archive=root/'三条业务流操作手册_含红框截图.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    z.write(pack/'三条业务流操作手册.html','三条业务流操作手册.html')
    # The return-to-showcase link works in the standalone package as well.
    for file in pack.glob('*.html'):z.write(file,file.name) if file.name!='三条业务流操作手册.html' else None
    z.write(pack/'style.css','style.css')
    for file in pack.glob('*.png'):z.write(file,file.name)
    for file in shots.iterdir():
        if file.suffix in ['.png','.svg','.json']:z.write(file,'三业务流截图/'+file.name)
print('DELIVERED: '+str(archive))
