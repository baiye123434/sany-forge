"""生成参赛技术说明；标题使用三级自动编号，目录用书签超链接避免空白域。"""
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '参赛材料' / '三一匠造V3技术设计与部署说明.docx'
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin = sec.bottom_margin = Inches(.65)
sec.left_margin = sec.right_margin = Inches(.75)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3']:
    style = doc.styles[name]
    style.font.name = 'Calibri'
    style.font.color.rgb = RGBColor(0, 0, 0)
    style._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), '微软雅黑')
normal = doc.styles['Normal']
normal.font.size = Pt(11)
normal.paragraph_format.line_spacing = 1.15
normal.paragraph_format.space_after = Pt(6)
for level, size in [(1, 17), (2, 13), (3, 11.5)]:
    st = doc.styles[f'Heading {level}']
    st.font.size = Pt(size)
    st.font.bold = True
    st.paragraph_format.space_before = Pt(10)
    st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.keep_with_next = True

# Word 原生多级编号，正文标题不靠手打数字伪装标题层级。
numbering = doc.part.numbering_part.element
abstract = OxmlElement('w:abstractNum'); abstract.set(qn('w:abstractNumId'), '50')
multi = OxmlElement('w:multiLevelType'); multi.set(qn('w:val'), 'multilevel'); abstract.append(multi)
for level in range(3):
    lv = OxmlElement('w:lvl'); lv.set(qn('w:ilvl'), str(level))
    for tag, val in [('start','1'),('numFmt','decimal'),('lvlText','.'.join(f'%{i+1}' for i in range(level+1))),('suff','space'),('pStyle',f'Heading{level+1}')]:
        el = OxmlElement('w:'+tag); el.set(qn('w:val'), val); lv.append(el)
    abstract.append(lv)
numbering.append(abstract)
num = OxmlElement('w:num'); num.set(qn('w:numId'),'50')
aid = OxmlElement('w:abstractNumId'); aid.set(qn('w:val'),'50'); num.append(aid); numbering.append(num)

headings, counters = [], [0,0,0]
pending_page = False
def p(text, bold=False):
    para = doc.add_paragraph()
    para.add_run(text).bold = bold
    return para
def h(text, level=1):
    global pending_page
    counters[level-1] += 1
    for i in range(level,3): counters[i] = 0
    para = doc.add_heading(text, level)
    if pending_page:
        para.paragraph_format.page_break_before = True
        pending_page = False
    np = OxmlElement('w:numPr')
    il = OxmlElement('w:ilvl'); il.set(qn('w:val'), str(level-1)); np.append(il)
    ni = OxmlElement('w:numId'); ni.set(qn('w:val'),'50'); np.append(ni)
    para._p.get_or_add_pPr().append(np)
    bookmark = 'section_'+str(len(headings)+1)
    start = OxmlElement('w:bookmarkStart'); start.set(qn('w:id'), str(len(headings)+1)); start.set(qn('w:name'),bookmark)
    end = OxmlElement('w:bookmarkEnd'); end.set(qn('w:id'),str(len(headings)+1))
    para._p.insert(1,start); para._p.append(end)
    headings.append((level, '.'.join(str(i) for i in counters[:level])+' '+text, bookmark))
    return para
def page():
    global pending_page
    pending_page = True
def code(text):
    para = p(text)
    para.paragraph_format.space_after = Pt(7)
    for r in para.runs: r.font.name='Consolas'; r.font.size=Pt(9.5)
def table(headers, rows, widths):
    t=doc.add_table(rows=1, cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    for cell, value, width in zip(t.rows[0].cells,headers,widths): cell.text=value; cell.width=Inches(width)
    for values in rows:
        cells=t.add_row().cells
        for cell,value,width in zip(cells,values,widths): cell.text=str(value); cell.width=Inches(width)
    pr=t._tbl.tblPr
    borders=OxmlElement('w:tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        x=OxmlElement('w:'+side); x.set(qn('w:val'),'single'); x.set(qn('w:sz'),'4'); x.set(qn('w:color'),'D9D9D9'); borders.append(x)
    pr.append(borders)
    for ri,row in enumerate(t.rows):
        trPr=row._tr.get_or_add_trPr()
        if ri==0: trPr.append(OxmlElement('w:tblHeader'))
        trPr.append(OxmlElement('w:cantSplit'))
        for ci,cell in enumerate(row.cells):
            cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cp=cell._tc.get_or_add_tcPr(); margins=OxmlElement('w:tcMar')
            for side in ['top','left','bottom','right']:
                el=OxmlElement('w:'+side); el.set(qn('w:w'),'95'); el.set(qn('w:type'),'dxa'); margins.append(el)
            cp.append(margins)
            if ri==0:
                shade=OxmlElement('w:shd'); shade.set(qn('w:fill'),'E8EDF0'); cp.append(shade)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(2); para.paragraph_format.line_spacing=1.08
                for run in para.runs: run.font.size=Pt(10); run.bold=ri==0
    p('')

doc.add_paragraph('三一匠造 V3', 'Title')
doc.add_paragraph('技术设计与部署说明', 'Subtitle')
p('软件设计 AI 辅助开发赛项   |   Java MySQL 迁移版   |   2026年10月29日')
p('本版在 V3 现有界面和业务流程基础上，将业务后端迁移至 Java 17、Spring Boot 和 MySQL 8。客户、工作人员和管理员通过原有入口协同处理设备租购、工程需求、交付与售后，业务数据保存在独立的本机 MySQL 库。')
p('本材料用于赛前训练、技术说明和运行交接。正式比赛按现场给定任务完成；携带源码、预制程序、依赖缓存及 AI 工具的可用范围，以组委会现场要求为准。')
toc_title=doc.add_paragraph('目录')
toc_title.runs[0].bold=True
toc_placeholder=doc.add_paragraph()

page(); h('参赛要求与交付范围'); h('正式规程',2); h('评分与提交内容',3)
p('指南规定为 2 人团体赛，连续 2 小时完成现场给定的三一工业场景任务。开发语言以 Java 为主，前端支持 Vue、HTML、JavaScript，数据库为 MySQL。指南列举 Spring Boot、MyBatis、Vue 等框架；本版采用 Spring Boot 和 Spring JDBC，前端沿用 HTML 与 JavaScript。')
table(['评分模块','分值','本项目对应材料'],[
 ['需求分析与架构设计','20','功能范围、业务流程、数据库结构、接口规划'],
 ['提示词与 AI 代码生成','30','分模块迁移任务、提示词迭代说明、Java 源码和 SQL'],
 ['代码调试与优化','25','异常处理、权限、并发修订、附件校验、实际测试'],
 ['应用集成','25','可运行程序、完整源码、部署说明、项目总结']],[1.7,.5,4.8])
p('截止时提交代码、文档和程序包。指南没有规定必须制作 PPT、固定展示页数、上传文件名或预制作品携带许可。本包中的展示网页和历史操作截图属于辅助材料。')
h('迁移范围',2); h('保留的业务与界面',3)
p('保留设备目录与九类教学模型、客户账号、租购申请、工程需求、业务和通用客服、消息未读、订单交付、售后派单与维修、独立审核、客户验收、跟进任务、产品和员工管理、角色权限、内容发布、监控及备份恢复。V3 原有人脸挑战协议保留。')
p('交付仍为 Windows 双窗口程序；Electron 与 Node.js 仅承担窗口及进程启动，业务规则与数据库操作由 Java 执行。内部技术版本为 3.5.1，交付名称沿用 V3。')
p('规程依据：湖南三一工业职业技术学院“工匠杯”职业技能大赛决赛竞赛指南(V6)(3)(1).pdf，第2至4页；封面日期为2026年10月31日。')

page(); h('系统与数据库设计'); h('组件职责',2); h('请求与数据流',3)
p('客户窗口或工作人员窗口 → 原 HTML 与 JavaScript 界面 → 本机 HTTP 接口 → Java 路由及公共校验 → Spring JDBC 事务 → MySQL InnoDB。附件下载先校验岗位或业务归属；静态目录仅提供 dist 内资源。')
table(['组件','实现位置','职责'],[
 ['窗口与启动','desktop 及 server/java-platform.cjs','隔离双窗口、启动自管 MySQL 与 Java、正常退出'],
 ['公共业务','Core 与 WebController','认证、scrypt、加密、单号、事务、HTTP与静态资源'],
 ['业务模块','BusinessRoutes 等路由类','订单、售后、客户、工程、客服、跟进和管理'],
 ['材料校验','MaterialFiles','类型与扩展名、DOCX目录及CRC、压缩限制']],[1.1,2.3,3.6])
h('持久化结构',2); h('数据表与一致性',3)
table(['表','关键字段','作用'],[
 ['records','kind + id 主键，body JSON','保留原业务对象、状态与历史，减少旧数据迁移损失'],
 ['files','id，owner_kind，owner_id，bytes','保存材料二进制及归属；归属组合索引'],
 ['audit','自增 id，actor，action，at','记录操作者、动作、时间与目标'],
 ['document_sequences','prefix + day 主键，value','按上海日期持久化单号流水'],
 ['mutation_lock','id=1','跨实例串行化路由事务，避免修订号并发覆盖']],[1.5,2.5,3.0])
p('初始化 SQL 为 java-server/src/main/resources/schema.sql。数据库使用 utf8mb4 和区分大小写的排序规则。每个 API 在事务开始取得锁；状态变化再次检查 revision，不一致返回 HTTP 409。该策略优先保证本机演示一致性，高并发部署时需按业务记录拆分锁。')

page(); h('业务流程与接口约定'); h('核心闭环',2); h('租购与售后',3)
p('租购：客户登录并提交 → 工作人员确认报价 → 备货 → 发运 → 客户上传材料并确认收货。租赁同时记录租期；本版不新增归还验机或结算。')
p('售后：已交付订单报修 → 派单 → 工程师处理 → 提交完工材料 → 另一人员独立审核 → 客户验收 → 关闭。审核或验收退回均返回处理中；处理人员不能审核本人处理的工单。')
h('接口兼容',2); h('现有前端直接调用 Java',3)
table(['接口分组','路径示例','关键规则'],[
 ['账号','/api/login、/api/customer/login','员工和客户会话独立，停用及改密撤销会话'],
 ['订单与售后','/api/orders、/api/tickets','状态机、材料必填、revision 冲突和客户归属'],
 ['工程和会话','/api/projects、/api/conversations','保密工程禁附件、双方已读游标、消息幂等'],
 ['客户与跟进','/api/customer/chats、/api/followups','增量消息每页最多200条，任务角色与修订校验'],
 ['后台管理','/api/admin/tools/*','权限、发布、统计、备份预览和恢复'],
 ['健康','/api/health','storage=mysql，runtime=java，version=3.5.1']],[1.1,2.9,3.0])
p('成功和失败响应沿用 V3 字段；错误返回 {error: 中文说明}，按情况使用 400、401、403、404、409、413、415、429。文件通过受控下载响应返回，不能凭文件编号绕过归属检查。')
p('上传每批最多4份、每份4MB。支持 PNG、JPEG、WebP、PDF、DOCX；DOCX 检查中央目录、本地头、CRC、解压上限、危险条目及宏，不把普通 ZIP 当 Word 材料。')

page(); h('AI 开发与调试记录'); h('本次实际开发方法',2); h('迁移任务的约束',3)
p('本次任务先读取 V3 的服务源码和原测试，明确每个模块的路径、字段、状态机和公共依赖。向 AI 分模块提供原源码、统一 Java 接口约定以及“保留前端契约、业务必须用 Java 实现”的要求，再进行编译、单元测试和真实 MySQL 联调。')
table(['发现的问题','修正内容','验证方式'],[
 ['Java密码处理误裁剪空格','校验后仍以原始字符串执行 scrypt','含首尾空格密码注册登录回归'],
 ['小数修订号被转为整数','按有限数字精确比较 revision','revision=1.9 拒绝并返回409'],
 ['多线程可能覆盖同一修订','事务获取数据库锁后校验并写入','并发两请求分别200与409'],
 ['MySQL中文目录无法启动','Windows短路径或校验后的目录连接','中文源码目录独立启动和重启'],
 ['旧Node回执格式需兼容','保留HKDF SHA256和AES GCM布局','固定Node回执向量在Java中解密']],[1.7,2.9,2.4])
h('现场提示词模板',2); h('按给定题目迭代',3)
p('模板：请依据以下现场题目拆分用户角色、功能、状态变化和验收条件。采用赛场提供的 Java、框架与 MySQL 版本，先给表结构、接口字段和最小可运行流程；列出未明确的规则，不编造需求。随后按模块生成代码，提供失败路径、权限与并发用例。')
p('调试模板：以下是实际输入、响应、日志和相关源码。先定位根因，再给最小修复；解释影响范围，补能复现问题的测试，不把未经运行的结果写成通过。保留每轮提示词、采用的修改及真实测试输出。')
p('上述模板用于赛前练习；实际赛场 AI 工具、题目与操作记录应按当场事实补充，不能把本次迁移过程冒充现场两小时开发记录。')

page(); h('验证结果与已知边界'); h('已执行的检查',2); h('测试证据',3)
table(['验证项目','结果','证据或范围'],[
 ['Java单元测试','通过','MaterialFiles 11项、ServiceRoutes 5项、LegacyImporter 9项'],
 ['真实MySQL接口回归','通过','业务8项、服务10项、管理9项；合计27项，含3个父测试'],
 ['浏览器交互','通过','15项；客户注册聊天、员工登录和菜单、两端会话隔离'],
 ['响应布局','通过','390、844、1440像素目录无横向溢出'],
 ['Windows发布核验','以交付报告为准','真实启动、资源SHA256、子进程退出与旧数据导入结果']],[1.6,1.0,4.4])
p('接口回归连接真实 Spring Boot 和 MySQL 8.0.46。覆盖购买、租赁交付、售后退回重修、审核验收、材料归属、消息分页和幂等、通知已读、权限配置、内容发布、备份恢复及恢复后全部会话失效。测试只使用隔离账号和数据库。')
h('实际边界',2); h('现场演示口径',3)
p('本版是本地参赛演示系统。未连接三一真实业务系统、支付系统、库存或物流服务，不宣称实际成交、维修业绩或经试点验证的效率收益。租赁归还验机、结算和完整 L2C 未覆盖。')
p('V3 自由注册和联系电话查询的演示行为予以保留；服务仅监听本机回环地址。它们不是公网客户身份核验方案。人脸协议通过合成向量验证，未宣称真人活体或第二台物理电脑兼容性已验收。')
p('原参赛展示资料中的53张操作截图沿用V3界面说明，不等同于本次Java/MySQL测试证据。本次新增测试脚本与结果位于源码/java-server及交付校验说明。')

page(); h('运行部署与项目总结'); h('Windows展开版与便携版',2); h('启动与数据目录',3)
p('本机日常使用根目录的Windows图标入口，它直接启动展开版真实EXE，速度快且不会显示命令窗口；换机演示可使用便携版。Java、MySQL和Electron均随成品提供，正常运行不执行编译或下载依赖。真实EXE必须与同目录resources一起保留，不能单独复制。首次启动需初始化数据目录，后续直接复用本机资料。菜单可新建多个工作人员窗口。关闭最后一个窗口时，程序关闭自己启动的Java与MySQL。')
p('业务资料：%APPDATA%\\sany-forge-platform-java。窗口缓存：%APPDATA%\\sany-forge-platform-java-desktop。MySQL dataDir/mysql，凭证由启动器随机生成并保存在独立资料目录。不要把旧 SQLite 目录直接覆盖到新目录。')
h('源码运行与环境',2); h('开发和外部数据库',3)
code('npm run web\nnode server/java-platform.cjs')
p('源码运行要求 Node.js 24 作为启动器，并准备源码/runtime 下的 java、mysql-current、server 组件。重新编译使用 JDK 17 或更高版本及 Maven；设置 JAVA_HOME、MAVEN_HOME 后运行 npm test、npm run java:build。桌面重建需 npm install 获取 Electron 构建依赖和运行库；已有本地参考运行库可作回退。')
p('如使用赛场 MySQL，配置 SANY_MYSQL_URL、SANY_DB_USER、SANY_DB_PASSWORD，创建独立数据库后启动；后端自动执行非破坏性建表 SQL。不要把数据库密码写入源码或截图。旧数据可通过显式导出工具和 Java --import-legacy 导入空库，先停止旧服务及目标Java服务，具体步骤见交付使用说明。')
h('两小时训练安排',2); h('按评分点检查成果',3)
p('建议用前20分钟完成需求、表结构与接口约定；第20至65分钟生成并打通主流程；第65至95分钟处理错误、权限、附件与边界；最后25分钟复测、整理部署说明和项目总结，按现场要求提交。两人分工及允许的交流范围以现场说明为准。')
p('本次迁移的成果是：用 Java/MySQL 承担完整 V3 业务，在保留界面交互的同时补齐真实数据库验证、启动管理、SQL 与交付材料。现场应优先保证题目核心流程和评分证据，再安排装饰与扩展功能。')

# 静态目录链接有确定目标，无需读者刷新 Word 域才能看到目录。
for level,label,bookmark in headings:
    if level==3: continue
    para=OxmlElement('w:p'); pp=OxmlElement('w:pPr')
    ind=OxmlElement('w:ind'); ind.set(qn('w:left'),str((level-1)*260)); pp.append(ind)
    spacing=OxmlElement('w:spacing'); spacing.set(qn('w:after'),'20'); spacing.set(qn('w:line'),'240'); spacing.set(qn('w:lineRule'),'auto'); pp.append(spacing); para.append(pp)
    link=OxmlElement('w:hyperlink'); link.set(qn('w:anchor'),bookmark)
    run=OxmlElement('w:r'); rp=OxmlElement('w:rPr'); color=OxmlElement('w:color');color.set(qn('w:val'),'1A4D73');rp.append(color)
    sz=OxmlElement('w:sz');sz.set(qn('w:val'),'20');rp.append(sz);run.append(rp)
    tx=OxmlElement('w:t');tx.text=label;run.append(tx);link.append(run);para.append(link)
    toc_placeholder._p.addprevious(para)
toc_placeholder._element.getparent().remove(toc_placeholder._element)
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('第 ')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld)
footer.add_run(' 页')
doc.core_properties.title='三一匠造V3技术设计与部署说明'
doc.core_properties.subject='AI辅助开发参赛准备与Java MySQL迁移交付'
doc.core_properties.author=''
OUT.parent.mkdir(parents=True,exist_ok=True)
doc.save(OUT)
print(OUT)
print('段落',len(doc.paragraphs),'表格',len(doc.tables),'目录书签',len(headings))
