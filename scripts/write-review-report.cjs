'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.qa/review-20261026');
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(qa,file),'utf8'));}catch{return fallback;}};
const inv=read('inventory.json'),map=read('content-map.json'),browser=read('browser/report.json'),portable=read('new-portable/report.json'),old=read('original-portable-clean/report.json');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/release-manifest.json'),'utf8'));
const buildLog=fs.readFileSync(path.join(qa,'build-final.log'),'utf8');
const syntaxCount=buildLog.match(/语法检查通过：(\d+) 个脚本/)?.[1] || '待确认';
const stamp=new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const phases=[
 ['售前需求','目录、分类、参数来源、3D 教学、工程清单与保密资料规则已具备。','线索来源、客户档案、决策链、预算、商机阶段、方案与多版本报价未建立。','增加客户/联系人/商机实体；工程需求合格后转商机，保持来源关联。','同一客户多联系人、同一商机多次报价与丢单原因可追踪。'],
 ['销售跟进','原有客服按单据沟通；3.5.0 新增负责人、下次行动、期限、结果、改派改期和逾期列表。','仍没有独立销售岗位、公海分配、线索转化、阶段退出条件和自动通知。','跟进是本轮已实现能力；下一步补商机阶段、失单原因、团队范围及交接规则。','负责人离职可改派；重试不重复；旧版本冲突；客户不可查看内部记录。'],
 ['售中交付','申请→工作人员确认报价→备货→发运→客户收货；资料、物流及历史保留。','报价只有总额；无客户报价接受、合同/税运条款、设备序列号、分批交付和拒收/退换货。','先分离报价、订单、发运批次、资产及交付验收；多设备按行管理。','两台设备分两次发货、部分拒收、改单与取消均有合法分支，历史报价不被覆盖。'],
 ['租赁运营','下单区分购买/租赁，记录月数。','没有租期起止、押金、计费周期、续租、回收、退租检查和结算。','把租赁合同和交接/归还做成独立流程，避免租单签收后业务即结束。','提前退租、逾期归还、损坏赔偿可按已确认规则解释；金额不能虚构。'],
 ['售后服务','报修→派单→处理→独立审核→客户验收；审核退回及客户退回重修均有覆盖。','无资产/质保权益、排班技能、到场时刻、SLA、备件/工时、费用、周期保养和满意度。','先补设备资产及服务等级，再建派工预约、维修作业项与备件工时，最后周期保养与回访。','同一设备跨订单服务历史可查；首响/到场/修复计时及暂停恢复能复算。']
];
const risks=[
 ['P0（联网前）','已验证','自由注册可自选管理员；仅电话号码可获取订单访问。','server/platform.cjs 注册与 phone-order 路由；现有测试明确保留演示契约。','部署到多人网络时将失去可靠身份与最小授权边界。','增加部署模式、管理员邀请制、客户身份验证与角色/组织数据范围。本轮未擅自替换演示入口。'],
 ['P0（业务化前）','已验证','人脸挑战接收客户端提交的特征向量和转头值。','server/platform.cjs checkFaceProof；dist/face-auth.js。','不能将教学协议测试解释成专业活体认证。','保留教学说明；商业身份方案需独立验证，真人摄像头本轮未验收。'],
 ['P1','已验证','工程需求 accepted/closed 不自动形成订单或商机。','server/project-service.cjs review 状态机，无关联订单字段。','售前与交付断链，无法计算可信转化率。','客户/商机/报价/订单明确外键；转换动作必须保留项目源头与每条设备清单。'],
 ['P1','已验证','订单报价由工作人员录入单个 amount，缺少报价版本及客户接受证据。','server/platform.cjs 订单 confirmed 分支。','金额范围、税运和报价生效条件不清晰。','独立报价头/行、有效期、含税运规则、版本与接受记录；未核实价格继续留空。'],
 ['P1','已验证','订单只保存一种产品快照与数量；没有单机资产或分批交付。','order.product / quantity / delivery；ticket.orderId。','多台设备的发运、质保与维修无法精确到单机。','建立资产编号、序列号、发运明细和验收行；不能把产品型号等同于设备资产。'],
 ['P1','已验证','租赁流程缺少归还和结算。','订单 mode、duration 字段与交付状态机。','收货后无法管理占用周期、回收状态与费用差异。','明确合同规则后建设续租、归还检查、停租与结算，不在本轮猜测计算规则。'],
 ['P1','已验证','全量业务列表向三类员工开放。','GET /api/orders、tickets、projects；ownOrder / ownRecord。','角色级限制不等于区域、团队或客户归属隔离。','增加组织、所有者和授权范围；后台与导出统一使用数据范围条件。'],
 ['P1','已验证','服务端 JSON 记录全量加载，多处扫描；消息嵌在会话记录中。','records(kind,id,body)；all(kind)；conversation.messages。','数据增长后的查询成本和同步数据库阻塞风险；尚无生产规模压测证据。','将订单行、任务、消息独立表化；分页、索引、迁移版本及监控。不要据现有小样本推断容量。'],
 ['P1','已验证','桌面仅连接本机服务，没有多端同步、远程部署和离线冲突处理。','server.listen 回环地址；desktop/main.cjs 本机服务管理。','手机页面适配不等于手机可连接当前电脑，跨电脑资料相互独立。','先确定单机比赛还是多人部署；后者需中心服务、TLS、认证、备份和同步设计。'],
 ['P2','已修正','缺统一跟进计划与待办。','新增 server/followup-service.cjs 与 dist/followup-service.js。','原先沟通结果与下次行动易遗漏。','3.5.0 已提供计划、负责人、逾期、结果、改期/改派、审计与内置说明。'],
 ['P2','已修正','界面宣称重置人脸后重新录入，但实际允许密码直接登录。','dist/platform.js 员工列表、账号管理文案。','演示操作与说明不一致。','已改为“未录入·密码登录”“重置后改为密码登录”。'],
 ['P2','已修正','作品说明为 3.0.0，启动路径与当前版本不一致。','作品说明.md、启动说明、同步生成软件版.cmd。','答辩与交付易打开错误版本。','同步到 3.5.0；README 保留历史变更并明确区分。'],
 ['P2','已验证','历史 2.4 页面与脚本仍在 dist，并随软件打包。','index-2.4-archive.html、app.js、commerce.js、style.css 未进入当前主入口。','增加理解和维护成本，旧页面可能造成误用。','后续归档到非发布目录，先核验历史演示需求再移动；本轮保留原件。']
];
const plan=[
 ['本轮完成','跟进闭环与交付一致性','跟进任务、权限、幂等、revision、结果留痕、内置设计说明；修正错误文案；构建新版。','148 项自动测试；20 项真实浏览器检查；便携成品启动及资源指纹。'],
 ['下一阶段 P1','售前到订单贯通','客户、联系人、商机、需求合格判定、方案、报价版本与客户接受、合同、项目转订单。','来源单据可追溯；不允许跳过批准的报价；失单必须记录原因。'],
 ['下一阶段 P1','交付及租赁闭环','设备资产、交付行、出库/运输/到货/安装培训、异常签收；租赁起止、续租、退租。','分批交付与客户拒收测试；同一台设备不会被重复占用；账款规则待业务确认。'],
 ['随后 P1','专业售后','服务协议、质保、技能/排班/预约、SLA、工时、备件领退、维修费用、预防保养。','维修资产关联完整；独立审核保留；SLA 暂停规则、时区和工作日历可复核。'],
 ['上线门槛 P0','身份、部署和运维','演示/正式模式分离、身份验证、组织数据权限、HTTPS、备份恢复演练、数据库迁移和审计保留策略。','未登录、越权、跨客户、账号停用、备份恢复及异常断电测试；按批准的部署方案验收。']
];
const metrics=[
 ['跟进待办/逾期（已实现）','records.kind=followup；负责人关联 user。','创建时验证关联单据；UTC 存储；不从聊天猜测或自动生成。','open 为待办；open 且 dueAt<asOf 为逾期；按任务条数，不按订单去重。'],
 ['我的待办（已实现）','followup.ownerId；当前员工身份。','管理员改派保留前后负责人；停用员工提示异常。','status=open 且 ownerId=当前用户；卡片不受列表关键词筛选影响。'],
 ['销售转化率（待建）','未来 lead/opportunity/quote/order 关联。','明确去重客户与商机；保留创建、合格、赢单/失单时刻。','按同一创建批次或阶段批次计算，分母与观察窗需确认；现有订单数不能代替转化率。'],
 ['按期交付率（待建）','未来承诺交付日期、交付行及客户验收事件。','保留原承诺与获批变更；明确分批和拒收归属。','按台数/交付行/订单三者选定口径；按期验收数÷到期应交付数，当前不报告数值。'],
 ['服务 SLA 达标率（待建）','未来服务协议、报修、首次响应、到场、修复和暂停事件。','工作日历、时区、暂停原因与多次重开规则先确定。','按相同服务级别和到期批次分别统计；不能把跟进未逾期率当 SLA。'],
 ['一次修复率（待建）','资产、故障类别、工单关闭及再次报修事件。','设备序列号归一、重复报修合并、观察期经业务确认。','在约定观察期内未发生同故障返修的合格工单÷合格完工工单；当前资产数据不足。']
];
const evidence=[
 ['基线自动化','132/132 通过','原有 13 个测试文件；先遇 spawn EPERM，改用 Node 单进程模式成功。'],
 ['改进后自动化','148/148 通过','增加 11 项后端集成与 5 项界面测试（Node 统计含父测试）；标准 npm test 在构建阶段再次通过。'],
 ['语法和版本','通过',`最终构建检查 ${syntaxCount} 个脚本，软件及依赖锁版本一致。`],
 ['真实 Edge',`${browser.checks?.length||0} 项通过${browser.failure?'，另有失败待处理':''}`,'九类 WebGL 模型、注册、跟进创建与完成、文本转义、三档布局、说明入口、客户隔离和退出；采用减少动态设置。'],
 ['原始便携程序',old.loaded?'3.4.4 实际启动通过':'未取得通过回执','双窗口、版本、独立会话、SQLite 健康与渲染错误检查。'],
 ['新版便携程序',portable.loaded?'3.5.0 实际启动通过':'等待最终回执','应为 packaged=true，双端 loaded=true，isolatedSessions=true，rendererErrors 为空。'],
 ['资源一致性',`${Object.keys(manifest.files).length} 项资源${buildLog.includes('同步核验通过')?'打包校验通过':'等待打包校验'}`,'网页、服务端与桌面入口的 SHA-256 与 app.asar 对照。'],
 ['目录资料','561 产品 / 24 主类 / 119 子类','24 款无结构化参数；本地图片路径无缺失；目录与原采集指纹一致，非今日官网全量认证。'],
 ['图像及人脸资源','572 张位图验证通过；9 项模型资源指纹通过','图像文件解码/完整性与离线人脸模型验证，不代表产品参数真实或真人活体验收。']
];
const fileRole=f=>f.startsWith('server/')?'业务服务 / 数据与权限':f.startsWith('desktop/')?'桌面窗口 / 服务生命周期':f.startsWith('scripts/')?'检查 / 测试 / 构建与素材工具':/models|model3d/.test(f)?'程序化三维教学':/catalog.*json/.test(f)?'产品快照 / 采集审计':/test/.test(f)?'测试':f.startsWith('dist/')?'界面 / 交互 / 样式 / 数据': '说明 / 配置 / 启动';
const rootRel='sany-forge-ui-optimized/.qa/review-20261026/';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三一匠造项目评估与改进报告</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f0;color:#222b2a;font:15px/1.75 "Microsoft YaHei",sans-serif}main{max-width:1220px;margin:auto;padding:32px 24px}header{color:#626b68;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:18px}h1{font-size:28px;margin:24px 0 8px}h2{font-size:22px;margin:36px 0 14px}h3{font-size:17px}a{color:#205d58}nav{display:flex;gap:16px;flex-wrap:wrap;padding:16px 0;position:sticky;top:0;background:#f5f5f0;border-bottom:1px solid #ccc;z-index:2}.lead{border-left:5px solid #346e60;padding:16px 24px;background:#e8ede8}.risk{border-left:5px solid #a5612e;padding:12px 22px;background:#f4eadf}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:22px 0}.stats div{border-top:2px solid #346e60;padding:12px 0}.stats strong{display:block;font-size:25px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #d6dcd7;min-width:120px}th{background:#e7ebe6}tr[data-file]{font-size:12px}code{overflow-wrap:anywhere}details{margin:18px 0;padding:16px;border:1px solid #ccd3cd}summary{cursor:pointer;font-weight:600}input{width:100%;padding:12px;font:inherit;margin:12px 0;background:white;border:1px solid #aaa}figure{margin:18px 0}img{max-width:100%;border:1px solid #ccc}footer{padding:24px 0;border-top:1px solid #ccc;margin-top:36px}small{color:#626b68}@media(max-width:700px){main{padding:18px 14px}.stats{grid-template-columns:1fr 1fr}h1{font-size:23px}nav{position:static}table{min-width:800px}}@media print{nav,input{display:none}details{break-inside:avoid}body{background:white}}</style><main>
<header>生成时间：${esc(stamp)}（北京时间）<br>数据截至时间：2026-10-26；产品目录快照截至 2026-10-20<br>报告对象：三一匠造工程装备租购与售后服务平台，3.4.4 基线与 3.5.0 改进版</header>
<h1>项目全量评估与改进报告</h1><nav><a href="#decision">决策结论</a><a href="#business">业务对标</a><a href="#risk">风险证据</a><a href="#delivery">本轮交付</a><a href="#tests">测试复跑</a><a href="#metrics">指标口径</a><a href="#files">文件地图</a></nav>
<section id="decision"><h2>结论：可作为参赛业务演示，尚不能直接承担商业运营</h2><div class="lead"><p><strong>已验证：</strong>项目是 Electron 桌面壳 + 本机 Node.js HTTP 服务 + SQLite，网页和软件共用界面与业务代码。交付状态、维修派工、独立审核、客户验收、材料归属与并发版本控制已经形成可测试的闭环。</p><p><strong>评价：</strong>强项在工业展示和售中/售后证据链；弱项在售前商业管理、租赁全周期、资产级服务和运营基础设施。应优先补业务关联与责任机制，继续增加动效的收益低于补齐这些能力。此为基于代码及流程的定性判断，不是市场排名或专业测评打分。</p><p><strong>本轮改进：</strong>新增全流程跟进工作台，明确负责人、下次行动、时间及结果；保留既有交付和审核边界。该能力是贯穿现有单据的任务管理，不宣称已实现完整 CRM。</p></div><div class="risk"><strong>主要风险：</strong>演示注册可自选管理员、电话查询不等于身份验证；若直接开放网络将存在明显身份风险。当前仅本机部署，未作为公网商业系统验收。</div></section>
<div class="stats"><div><strong>132 → 148</strong>自动测试项</div><div><strong>${browser.checks?.length||0}</strong>真实浏览器检查</div><div><strong>561 + 9</strong>目录产品 + 教学模型</div><div><strong>3.5.0</strong>改进版</div></div>
<section id="business"><h2>专业业务流程对照</h2><p>Microsoft Dynamics 365 Sales 将线索资格判断、商机、报价、订单和开票串联；报价可多次修订。Field Service 进一步区分排程、派工、现场执行、复核以及费用/库存处理。Salesforce Manufacturing 的销售协议和预测用于长期供货管理。这些能力作为对标方向，不能理解为所有比赛作品必须一次实现全部商业产品功能。</p>${table(['环节','项目已有能力','主要缺口','建议改进','验收方式'],phases)}<p>参考：<a href="https://learn.microsoft.com/en-us/dynamics365/sales/nurture-sales-from-lead-order-sales">Dynamics 365 销售流程</a>；<a href="https://learn.microsoft.com/en-us/dynamics365/sales/sales-transactions">报价、订单与发票</a>；<a href="https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-status-booking-status">现场服务工单生命周期</a>；<a href="https://learn.microsoft.com/en-us/dynamics365/field-service/agreements-overview">周期服务协议</a>；<a href="https://trailhead.salesforce.com/content/learn/modules/manufacturing-cloud-basics/track-sales-with-agreement-terms">Salesforce 制造业销售协议与预测</a>。</p></section>
<section id="risk"><h2>发现、影响与处理优先级</h2><p>P0 表示正式联网/商业化前的门槛，不表示目前本机比赛必须立即重构；P1 为下一阶段核心业务建设；P2 为体验及维护改进。“待建”不等于测试失败。</p>${table(['优先级','证据状态','发现','代码证据','影响','处理建议'],risks)}</section>
<section id="delivery"><h2>已经落地的改进与后续顺序</h2>${table(['阶段','目标','具体范围','验收标准'],plan)}<p>新增文件：server/followup-service.cjs、dist/followup-service.js；主要接线：server/platform.cjs、dist/platform.js、dist/index.html。新增跟进记录独立存储，不修改既有订单状态机；创建幂等键按创建人隔离，修改核对 revision，所有处理保留事件与审计。</p><p><strong>入口：</strong>工作人员登录 → 服务工作台 → 全流程跟进。菜单中的“全流程跟进功能设计说明”包含价值、背景、角色、流程、字段、三层取数口径、权限、异常与边界，并固定落款。</p><p><strong>版本关系：</strong>3.4.4 原程序保留；3.5.0 使用同一正常业务资料目录，运行前应关闭旧版，不能同时启动两个版本。老版本不会展示新增跟进记录。出现问题时关闭新版本、恢复完整备份并使用旧版；涉及新记录的回退保留策略需先确认。</p><figure><img src="${rootRel}browser/followups-desktop.png" alt="全流程跟进真实界面截图"><figcaption>实际隔离验收界面；文字中的 HTML 测试内容作为普通文本显示，用于验证转义。</figcaption></figure></section>
<section id="tests"><h2>测试、运行与复跑证据</h2>${table(['项目','结果','说明'],evidence)}<p>边界：没有第二台物理电脑、真人摄像头、真实业务数据、手机实体设备、商业活体认证、断电恢复或生产规模负载验收；本轮未重新评定所有动效的主观观感。UI 单元测试的模拟 DOM 与 Edge 实际操作分开记录。</p><p>第一次标准测试因环境子进程限制报 spawn EPERM；单进程复跑通过，随后构建阶段使用标准命令再次通过。第一次浏览器脚本未先点击登录开场按钮，等待隐藏表单超时；按真实入口修正后复跑。Electron 初次启动受到工作区 ACL 环境限制，使用隔离配置重新启动成功。首次打包停在 PNG 图标转换工具阶段，本轮停止该构建并将已有图标转换为标准 ICO 后重新构建，未修改品牌图形。这些失败不能省略，也不能误列为业务断言失败。</p><p>证据：<a href="${rootRel}tests-round1.log">改进后单进程日志</a> · <a href="${rootRel}build-final.log">标准测试、构建及打包校验日志</a> · <a href="${rootRel}browser/report.json">Edge 检查记录</a> · <a href="${rootRel}original-portable-clean/report.json">原版启动记录</a> · <a href="${rootRel}new-portable/report.json">新版启动记录</a> · <a href="${rootRel}images.json">位图完整性记录</a></p></section>
<section id="metrics"><h2>指标的源头、生成逻辑与汇总口径</h2>${table(['指标','数据源头','清洗/生成逻辑','查询/汇总口径'],metrics)}<p>现有 /api/stats 中 pendingOrders 仅统计 submitted，openTickets 为非 closed，pendingReview 为 pending_review；它们是状态存量，不是今日新增、按期交付率、成交率或收入。没有合同/收款凭证时，不将报价金额当作收入。</p></section>
<section id="files"><h2>全量盘点范围与文件地图</h2><p>初始工程目录盘点 ${Object.values(inv.summary||{}).reduce((s,x)=>s+x.files,0).toLocaleString()} 个文件，无读取错误：其中自有文本 70 个（含本轮盘点脚本，原有 69 个）、依赖 7,373 个、运行库 149 个、资产 577 个、vendor 12 个、其他二进制 3 个。所有盘点文件读取并计算 SHA-256，自有文本进行完整内容扫描、结构提取和关键业务精读；这不等同于人工逐行审阅全部第三方代码，也不等同于反编译全部二进制。后续新增文件和测试输出不算入初始基线。</p><p>盘点排除新生成的 .qa、release 及版本控制目录；根目录另有启动 HTML、预览图、复刻提示词和原始便携程序，启动入口已核对，便携程序已实跑。复刻提示词描述的是早期纯前端数字工场，与当前服务平台架构不一致，不能作为当前实现说明；旧预览图也不是 3.5.0 跟进界面。数据库使用通用 records、files 和 audit；应用层对象包括用户、产品覆盖、订单、工单、工程需求、会话及新增跟进。附件存 SQLite BLOB，业务对象多为 JSON。</p><p>主入口 dist/index.html 引用 30 个 JS/CSS 资源，路径均存在；旧 app.js、commerce.js、style.css 和 index-2.4-archive.html 不属于当前主入口。3D 为程序化教学模型，不能当成厂商 CAD 或真实设备遥测。</p><details><summary>展开逐文件结构索引</summary><label for="fileSearch">按路径或职责筛选</label><input id="fileSearch" placeholder="例如 server、models、test"><div class="scroll"><table id="fileTable"><thead><tr><th>文件</th><th>职责</th><th>行数</th><th>函数/测试索引（摘要）</th></tr></thead><tbody>${(map.modules||[]).map(m=>`<tr data-file><td>${esc(m.path)}</td><td>${esc(fileRole(m.path))}</td><td>${m.lines}</td><td>${esc((m.functions||m.tests||m.jsonShape?.keys||[]).slice(0,12).join('、')||'样式、静态数据或说明；完整结构见 JSON')}</td></tr>`).join('')}</tbody></table></div></details><p><a href="${rootRel}inventory.json">完整文件指纹清单</a> · <a href="${rootRel}content-map.json">文本结构与资源索引</a>。修改前自有文本备份位于 .qa/review-20261026/baseline；这是代码审阅备份，不是日常业务数据的恢复备份。</p></section>
<section><h2>需要业务确认的设计事项</h2><ul><li>主用户是经销商销售、厂家直营、租赁公司还是企业设备管理方；当前 service 同时承担售中与售后，独立销售/调度/仓库/财务角色尚未定义。</li><li>租赁计费按月、按天或按工时，税费/运输/押金/退租/赔偿如何约定；不能由演示软件自行猜测。</li><li>客户接受报价、合同生效、发货放行、交付验收的责任人与证据要求。</li><li>服务 SLA 的首响、到场、修复时限与暂停条件、服务区域、工作日历和质保起算点。</li><li>单机比赛还是多用户部署、移动端是否要离线操作、备份保留和恢复目标。</li></ul></section>
<footer>报告来源方:SDMC-IT</footer></main><script>document.getElementById('fileSearch').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('[data-file]').forEach(r=>{r.hidden=!r.textContent.toLowerCase().includes(q)})});</script></html>`;
fs.writeFileSync(path.resolve(root,'../项目全量评估与改进报告.html'),html);
const description=`生成时间：${stamp}（北京时间）\n数据截至时间：2026-10-26；产品目录快照截至 2026-10-20\n报告对象：三一匠造 3.5.0 参赛作品\n\n# 三一匠造 · 工程装备租购与售后服务平台\n\n作品采用 Electron 桌面客户端、本机 Node.js 服务与 SQLite，浏览器可访问同一服务。当前定位为本地参赛演示，不是三一官方销售或售后系统，不收取款项。\n\n## 主要流程\n\n1. 客户浏览设备、提交购买/租赁申请或工程需求。目录包含 561 款产品与 9 类教学模型；缺失参数不虚构。\n2. 工作人员沟通需求、记录实际报价，完成备货和发运；客户确认收货。\n3. 客户报修，工程师受派处理，由另一位有权限的人员独立审核，最后客户验收；退回重修保留历史。\n4. 新增全流程跟进，可关联工程需求、订单和工单，记录负责人、下次行动、截止时间与结果；允许改派改期，保留原因。\n\n## 角色与边界\n\n管理员可维护产品、员工和分配跟进；服务人员处理业务和本人跟进；审核员核对材料、只读跟进；客户不能访问内部跟进。所有员工仍沿用当前系统的全量业务可见范围，未实现组织/区域数据隔离。\n\n本机演示允许自由注册并选择岗位；未录入人脸的账号使用密码登录，已录入的仍需摄像头验证。重置人脸后改为密码登录。电话查询不是身份验证，不可直接用于公网业务。无专业活体认证；真人摄像头和第二台电脑需另行验收。\n\n跟进完成不代表报价接受、合同生效、发货或维修验收。商机、报价版本、合同、设备资产、库存、收款、租赁归还结算及 SLA 均未实现。\n\n## 启动和演示\n\n运行参赛作品根目录的 三一匠造-3.5.0-服务平台-Windows便携版.exe。旧 3.4.4 程序保留；新版运行前关闭旧版。不同电脑资料不自动同步。开发网页版使用 Node.js 24 执行 npm run web。\n\n演示路线：设备选型 → 工程需求/租购申请 → 员工工作台 → 全流程跟进 → 报价备货发运 → 客户签收 → 报修处理 → 独立审核 → 客户验收。全流程跟进功能设计说明位于系统菜单内。\n\n## 本轮验证\n\n原有 132 项自动测试通过；新增后 148 项通过并在构建时使用标准命令复跑；真实浏览器完成 ${browser.checks?.length||0} 项检查。原版成品启动${old.loaded?'通过':'待确认'}，新版成品启动${portable.loaded?'通过':'待最终确认'}。完整证据与未覆盖项见根目录 HTML 评估报告。\n\n报告来源方:SDMC-IT\n`;
fs.writeFileSync(path.join(root,'作品说明.md'),description);
console.log('已生成 HTML 评估报告并同步作品说明。');
