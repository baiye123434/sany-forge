# 三一匠造设备销售客服订单交接与数据审核数字化平台

技术版本 3.7.3，Java 17 + Spring Boot + MySQL 8，Electron 员工工作台。现有五张数据库表结构不变；客服、审核、履约字段保存在原 order JSON 中，文件和审计沿用原 files 与 audit。

## 入口与岗位

- 员工 EXE：登录页只提供在线客服、订单审核员或超级管理员岗位，再验证账号密码与岗位授权。
- 员工 Web：`http://127.0.0.1:8790/staff.html`，保留浏览器登录入口。
- 客户网站：本机可用 `http://127.0.0.1:8790/?workspace=customer#catalog`；手机与电脑连接同一局域网后，从员工客户端“手机访问地址”菜单复制当前地址。

首次空库可在员工 EXE 初始化超级管理员。员工可提交注册申请，账号默认停用，须由超级管理员核验并启用；任何岗位都不能通过注册自行获得权限。service 为在线客服，reviewer 为订单审核员，admin 为超级管理员。只有客服可以与客户聊天、答疑洽谈和提交订单材料；审核员只审批客服递交的工单；超级管理员查看全程痕迹、冻结账号、调岗并负责生产履约。

## 业务流程

客户咨询或下单 → 已打卡在线客服接待、答疑和洽谈 → 客服提交订单及相关材料 → 订单审核员通过或带理由退回 → 超级管理员选择生产排产或调取库存 → 确认生产/库存就绪 → 发货或通知上门提货。无人在线时消息和订单可靠排队；异常、转派、材料、消息、审核和履约操作全部留痕。

客户端 IndexedDB 队列按账号和岗位保存未同步动作，requestId 去重、revision 拒绝覆盖并发变化；遇到冲突需人工刷新处理。默认静音，只播放用户导入的本地音频副本，移除了旧按钮合成音，不访问游戏文件。

## 本机启动与中心服务

运行 `npm run web` 启动原 Java/MySQL 本机服务。默认业务目录 `%APPDATA%/sany-forge-platform-java`。员工 EXE 内置相同服务；关闭全部员工窗口后保留托盘和客户网站，只有从托盘明确选择“退出并停止本机服务”才关闭 Java/MySQL。电脑真正进入睡眠时无法提供网站，唤醒后会复检服务并可重新获取当前地址。

多电脑必须连接同一中心服务。客服支持环境变量 `SANY_SERVICE_URL` 或 EXE 旁 `客服连接配置.json` 的 `serviceUrl`；非本机地址要求 HTTPS，服务身份与版本须匹配。失败不会回退创建另一套本地库。

## 源码构建

需要 Node.js、完整 JDK 17 或以上、Maven。分别设置 JAVA_HOME 和 MAVEN_HOME，不要将裁剪运行时 runtime/java 当编译器。

```powershell
npm install
npm run electron:install
npm run check
npm run java:build
npm run test:desktop
npm run sync
node scripts/electron-build.cjs
node scripts/verify-release.cjs
node scripts/verify-packaged.cjs
```

Electron 桌面运行库按需下载，不随源码重复保存；仅运行 Web 或使用交付 EXE 时无需执行 `npm run electron:install`。

Java 构建可用 MAVEN_REPO_LOCAL 指定缓存。若本机默认 Maven 镜像不可用，可显式设置 MAVEN_SETTINGS 为可用 settings.xml；项目提供 config/maven-central.xml。不得依赖本机 .qa 的临时绝对路径。

正常启动版和便携版位于 `release/service-3.7.3`；白板电脑使用 `release/service-3.7.3-offline-installer` 中的离线安装包。安装器内置 Java、MySQL、Electron 与 Microsoft VC++ 运行库，并添加仅限 `LocalSubnet` 的 8790/TCP 入站规则。真实 EXE 必须与同目录的 `resources` 一起保留，不能单独复制。验收使用 `.qa` 独立业务库，不能向真实业务数据库创建测试订单。

## 需求与证据

正式 PRD 在上一级参赛材料目录，含三级编号标题和可点击目录。当前验收证据见上一级交付校验说明。本轮不声称任意扫描报价单的 OCR 核验、审计抵御数据库最高权限篡改或全部 Windows 新机实装均已验证。

