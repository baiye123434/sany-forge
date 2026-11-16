'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const { app, BrowserWindow, Menu, Tray, clipboard, powerMonitor, shell, session, dialog, screen } = require('electron');
const { createPlatform } = require('../server/java-platform.cjs');
const { readConnection, isServicePage } = require('./service-address.cjs');

const verifyRequested = process.argv.includes('--verify-startup');
const verifyExtraWindowRequested = verifyRequested && process.argv.includes('--verify-extra-window');
const verifyRoot = verifyRequested && process.env.SANY_VERIFY_ROOT ? path.resolve(process.env.SANY_VERIFY_ROOT) : null;
const verifyOutput = verifyRequested && process.env.SANY_VERIFY_OUTPUT ? path.resolve(process.env.SANY_VERIFY_OUTPUT) : null;
/* 成品验收只允许使用脚本标记的独立目录，错误参数不能回退到用户真实业务库。 */
if (verifyRequested) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(path.join(verifyRoot || '', 'verify-root.json'), 'utf8')); } catch {}
  const relative = verifyRoot && verifyOutput ? path.relative(verifyRoot, verifyOutput) : null;
  if (!verifyRoot || !verifyOutput || !path.isAbsolute(process.env.SANY_VERIFY_ROOT || '') ||
      !path.isAbsolute(process.env.SANY_VERIFY_OUTPUT || '') || !relative || relative.startsWith('..') ||
      path.isAbsolute(relative) || marker?.purpose !== 'sany-forge-packaged-qa' || marker?.root !== verifyRoot) {
    throw new Error('成品验收必须由 scripts/verify-packaged.cjs 提供独立目录、标记文件及报告路径。');
  }
  if (process.env.SANY_MYSQL_URL) throw new Error('成品验收不允许连接外部 MySQL。');
}
const interactionQaRequested = process.argv.includes('--interaction-qa');
const qaParent = path.resolve(__dirname, '..', '.qa');
const interactionQaRoot = interactionQaRequested && process.env.SANY_INTERACTION_QA_ROOT
  ? path.resolve(process.env.SANY_INTERACTION_QA_ROOT) : null;
if (interactionQaRequested && (!interactionQaRoot || !interactionQaRoot.toLowerCase().startsWith(`${qaParent.toLowerCase()}${path.sep}`))) {
  throw new Error('交互验收目录必须是当前项目 .qa 内的独立子目录。');
}
const isolatedRoot = verifyOutput ? path.join(verifyRoot, 'desktop-test-profile') : interactionQaRoot;
app.setPath('userData', isolatedRoot || path.join(app.getPath('appData'), 'sany-forge-service-desktop'));
/* 桌面缓存独立，业务数据库继续复用原 Java/MySQL 目录，不能因拆分客户端生成另一套订单。 */
const dataDir = isolatedRoot ? path.join(isolatedRoot, 'business-data') :
  process.env.SANY_PLATFORM_DATA || path.join(app.getPath('appData'), 'sany-forge-platform-java');
let ownedPlatform, serviceUrl, primaryWindow, startupReport, shutdownPromise, browserSession, tray;
let closing = false, allowQuit = false, pendingWindowRequests = 0;
const serviceWindows = new Set();
const cameraGrantedWindows = new WeakSet();
const cameraPromptWindows = new WeakSet();
const windowClosePending = new WeakSet();
const windowCloseAllowed = new WeakSet();
const topmostReleaseTimers = new WeakMap();
const rendererErrors = [];
const partition = 'persist:sany-service';
function sameOrigin(input) {
  try { const url = new URL(input); return url.origin === serviceUrl && !url.username && !url.password; } catch { return false; }
}
function health(url) {
  return new Promise(resolve => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(`${url}/api/health`, { timeout: 5000 }, response => {
      let content = '';
      if (response.statusCode !== 200) { response.resume(); resolve(null); return; }
      response.on('data', chunk => { content += chunk; if (content.length > 10000) request.destroy(); });
      response.on('end', () => { try { resolve(JSON.parse(content)); } catch { resolve(null); } });
      response.on('error', () => resolve(null));
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}
async function ensureService() {
  const remote = readConnection({ env: process.env, appDir: app.getAppPath(), executableDir: path.dirname(process.execPath), isolated: Boolean(isolatedRoot) });
  const matches = value => value?.ok === true && value.app === 'sany-service-platform' && value.version === app.getVersion() &&
    value.storage === 'mysql' && value.runtime === 'java';
  /* 中心服务模式不会回退本机数据库，确保断线后不产生分叉订单。HTTPS 保持系统证书校验。 */
  if (remote) {
    if (!matches(await health(remote))) throw new Error(`无法连接 ${remote} 的 ${app.getVersion()} Java/MySQL 服务。请检查网络、证书或服务器版本；未启动本地数据库。`);
    return remote;
  }
  const defaultUrl = 'http://127.0.0.1:8790';
  if (!isolatedRoot) {
    const existing = await health(defaultUrl);
    if (matches(existing)) return defaultUrl;
    if (existing) throw new Error(`8790 端口上的服务不是当前 ${app.getVersion()} 版本，请先正常关闭旧版本。`);
  }
  const platform = createPlatform({ root: app.getAppPath(), dataDir, packaged: app.isPackaged,
    resourcesPath: process.resourcesPath, exposeLan: !isolatedRoot });
  ownedPlatform = platform;
  try { return await platform.start(isolatedRoot ? 0 : 8790); }
  catch (error) {
    await platform.close();
    if (ownedPlatform === platform) ownedPlatform = null;
    if (!isolatedRoot && error.code === 'EADDRINUSE' && matches(await health(defaultUrl))) return defaultUrl;
    throw new Error(`Java/MySQL 本地服务启动失败：${error.message}`);
  }
}
function openWeb(kind) {
  if (!serviceUrl || verifyOutput) return;
  const url = kind === 'customer' ? `${serviceUrl}/?workspace=customer#catalog` : `${serviceUrl}/staff.html`;
  void shell.openExternal(url).catch(error => dialog.showErrorBox('网页打开失败', error.message));
}
function isPrivateIpv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}
function mobileAccessUrls() {
  if (!serviceUrl || isolatedRoot) return [];
  const current = new URL(serviceUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname);
  if (!local) return [`${current.origin}/?workspace=customer#catalog`];
  const virtualAdapter = /vmware|virtual|vethernet|hyper-v|virtualbox|docker|wsl|vpn|radmin|tailscale|loopback/i;
  const port = current.port || (current.protocol === 'https:' ? '443' : '80');
  return [...new Set(Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => {
    if (virtualAdapter.test(name)) return [];
    return (entries || []).filter(info => (info.family === 'IPv4' || info.family === 4) && !info.internal &&
      isPrivateIpv4(info.address)).map(info => `http://${info.address}:${port}/?workspace=customer#catalog`);
  }))];
}
async function showMobileAccess() {
  if (verifyOutput || interactionQaRoot) return;
  const urls = mobileAccessUrls();
  const detail = urls.length ? `${urls.join('\r\n')}\r\n\r\n其他电脑或手机须与本机连接同一局域网。关闭所有窗口后服务仍在托盘运行；本机睡眠时无法访问，唤醒后请重新获取地址。` :
    '暂未找到可用的 Wi-Fi 或有线局域网 IPv4 地址。请先让两台电脑连接同一网络，再重新打开此菜单。';
  const result = await dialog.showMessageBox({ type: urls.length ? 'info' : 'warning', title: '客户网页局域网地址',
    message: urls.length ? '在其他电脑或手机浏览器输入以下地址：' : '当前没有可用的客户网页局域网地址', detail,
    buttons: urls.length ? ['复制首选地址', '关闭'] : ['关闭'], defaultId: 0, cancelId: urls.length ? 1 : 0 });
  if (urls.length && result.response === 0) clipboard?.writeText?.(urls[0]);
}
async function checkServiceAfterResume() {
  if (closing || !serviceUrl) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await health(serviceUrl)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const message = '电脑唤醒后本地服务在 30 秒内未恢复。请退出并重新启动员工工作台。';
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'desktop-lifecycle.log'), `${new Date().toISOString()} ${message}\n`); } catch {}
  if (!verifyOutput && !interactionQaRoot) dialog.showErrorBox('手机访问服务恢复失败', message);
}
function openAllowedExternal(input) {
  if (verifyOutput) return;
  try {
    const url = new URL(input);
    if (sameOrigin(input) && !url.username && !url.password &&
      ((url.pathname === '/staff.html' && !url.search) || (url.pathname === '/' && url.search === '?workspace=customer'))) {
      void shell.openExternal(url.href).catch(() => {});
    } else if (url.protocol === 'https:' && ['www.sanygroup.com', 'm.sanygroup.com', 'www.sany.com.cn', 'cos-www.sanygroup.com'].includes(url.hostname)) {
      void shell.openExternal(url.href).catch(() => {});
    }
  } catch {}
}
function configureSession() {
  if (browserSession) return browserSession;
  browserSession = session.fromPartition(partition);
  const ownerWindow = webContents => [...serviceWindows].find(window => window.webContents === webContents && !window.isDestroyed());
  const validWindow = webContents => {
    const window = ownerWindow(webContents);
    return window && !webContents.isDestroyed() && isServicePage(webContents.getURL(), serviceUrl) ? window : null;
  };
  browserSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
    const window = validWindow(webContents);
    return Boolean(!isolatedRoot && window && cameraGrantedWindows.has(window) && permission === 'media' && sameOrigin(origin) && details.mediaType === 'video' && details.isMainFrame === true);
  });
  browserSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const window = validWindow(webContents);
    if (isolatedRoot || permission !== 'media' || !window || !isServicePage(details.requestingUrl, serviceUrl) ||
        details.isMainFrame !== true || !details.mediaTypes?.length || !details.mediaTypes.every(type => type === 'video') || cameraPromptWindows.has(window)) return callback(false);
    if (cameraGrantedWindows.has(window)) return callback(true);
    try {
      cameraPromptWindows.add(window);
      const result = await dialog.showMessageBox(window, { type: 'question', title: '允许账号验证使用摄像头？',
        message: '摄像头仅用于当前员工账号的人脸验证。', buttons: ['允许本次使用', '拒绝'], defaultId: 1, cancelId: 1, noLink: true });
      if (result.response === 0 && validWindow(webContents) === window) cameraGrantedWindows.add(window);
      callback(cameraGrantedWindows.has(window));
    } catch { callback(false); }
    finally { cameraPromptWindows.delete(window); }
  });
  browserSession.on('will-download', (event, item, webContents) => {
    const url = item.getURL();
    if (!validWindow(webContents) || (!sameOrigin(url) && !url.startsWith(`blob:${serviceUrl}/`))) return event.preventDefault();
    item.setSaveDialogOptions({ title: '保存订单业务资料', defaultPath: path.basename(item.getFilename()) });
  });
  return browserSession;
}
function windowGeometry() {
  let workArea = { x: 0, y: 0, width: 1440, height: 900 };
  try { workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch {}
  /* 尺寸始终收在 Windows 可用工作区内，给任务栏和窗口阴影留边；小屏时同步降低最小尺寸。 */
  const width = Math.max(640, Math.min(1440, workArea.width - Math.min(48, Math.max(0, workArea.width - 640))));
  const height = Math.max(500, Math.min(960, workArea.height - Math.min(48, Math.max(0, workArea.height - 500))));
  return { width, height, minWidth: Math.min(760, width), minHeight: Math.min(520, height),
    x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 2) };
}
function focusWindow(window = primaryWindow, { temporarilyTopmost = false } = {}) {
  if (verifyOutput || interactionQaRoot || closing || !window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  if (temporarilyTopmost) {
    window.setAlwaysOnTop(true, 'floating');
    const previous = topmostReleaseTimers.get(window);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      topmostReleaseTimers.delete(window);
      if (!window.isDestroyed()) window.setAlwaysOnTop(false);
    }, 1500);
    topmostReleaseTimers.set(window, timer);
  }
  window.focus();
}
function loadingPage() {
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="color-scheme" content="light"><title>三一匠造正在启动</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#eef0ec;color:#18211b;font-family:"Microsoft YaHei UI",sans-serif}.box{text-align:center}.mark{font-size:28px;font-weight:800;letter-spacing:.12em}.line{width:240px;height:3px;margin:28px auto 18px;background:#d4d9d3;overflow:hidden}.line:after{content:"";display:block;width:45%;height:100%;background:#c8202f;animation:move 1.1s ease-in-out infinite alternate}.hint{color:#687069;font-size:14px}@keyframes move{to{transform:translateX(125%)}}</style><body><div class="box"><div class="mark">三一匠造</div><div class="line"></div><div class="hint">正在启动 Java/MySQL 服务，请稍候…</div></div></body></html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}
async function createWindow({ loading = false } = {}) {
  const title = `三一匠造 · 员工工作台 ${app.getVersion()}`;
  const window = new BrowserWindow({ title, ...windowGeometry(),
    show: Boolean(interactionQaRoot), alwaysOnTop: false, resizable: true, maximizable: true, fullscreenable: true,
    autoHideMenuBar: false, backgroundColor: '#eef0ec', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { session: configureSession(), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  serviceWindows.add(window); primaryWindow ||= window;
  /* 桌面端只承载固定员工入口，岗位由服务端授权；任意弹窗和 webview 均被阻止。 */
  window.webContents.setWindowOpenHandler(({ url }) => { openAllowedExternal(url); return { action: 'deny' }; });
  const guardNavigation = (event, url) => { if (!isServicePage(url, serviceUrl)) { event.preventDefault(); openAllowedExternal(url); } };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  /* 一次 Esc 仅退出全屏，按住产生的重复事件不继续关闭业务弹窗。 */
  let fullScreenEscapeHeld = false;
  window.on('blur', () => { fullScreenEscapeHeld = false; });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      if (input.type === 'keyUp') { if (fullScreenEscapeHeld) event.preventDefault(); fullScreenEscapeHeld = false; return; }
      if (input.type !== 'keyDown') return;
      if (fullScreenEscapeHeld && input.isAutoRepeat) return event.preventDefault();
      fullScreenEscapeHeld = false;
      if (!window.isFullScreen()) return;
      event.preventDefault(); fullScreenEscapeHeld = true;
      if (!input.isAutoRepeat) window.setFullScreen(false);
    } else if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault(); if (!input.isAutoRepeat) window.setFullScreen(!window.isFullScreen());
    }
  });
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title); });
  window.webContents.on('console-message', details => { if (details.level === 'error') rendererErrors.push(details.message); });
  /* 先收到后台下线回执再销毁窗口，避免共享服务仍把正常退出的客服当作在线候选。 */
  window.on('focus', () => { primaryWindow = window; });
  window.on('close', event => {
    if (allowQuit || windowCloseAllowed.has(window)) return;
    event.preventDefault(); void closeEmployeeWindow(window);
  });
  window.on('closed', () => {
    const topmostTimer = topmostReleaseTimers.get(window);
    if (topmostTimer) { clearTimeout(topmostTimer); topmostReleaseTimers.delete(window); }
    serviceWindows.delete(window);
    if (primaryWindow === window) primaryWindow = [...serviceWindows].at(-1) || null;
  });
  await window.loadURL(loading ? loadingPage() : `${serviceUrl}/staff.html?client=employee`);
  if (!verifyOutput) focusWindow(window, { temporarilyTopmost: true });
  return window;
}
async function loadEmployeeWindow(window) {
  if (!window || window.isDestroyed()) return;
  await window.loadURL(`${serviceUrl}/staff.html?client=employee`);
  focusWindow(window);
}
function configureMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '员工工作台', submenu: [
      { label: '新建员工登录窗口', accelerator: 'CmdOrCtrl+N', click: () => { if (serviceUrl && !closing) void createWindow(); else pendingWindowRequests++; } },
      { type: 'separator' },
      { label: '打开客户网页', accelerator: 'CmdOrCtrl+1', click: () => openWeb('customer') },
      { label: '打开员工 Web 后台', accelerator: 'CmdOrCtrl+2', click: () => openWeb('staff') },
      { label: '客户网页局域网地址', accelerator: 'CmdOrCtrl+3', click: () => { void showMobileAccess(); } },
      { type: 'separator' }, { label: '退出员工客户端', click: () => app.quit() }
    ] },
    { label: '查看', submenu: [{ label: '刷新', role: 'reload' }, { label: '切换全屏', role: 'togglefullscreen' }] }
  ]));
}
function openEmployeeFromBackground() {
  if (closing) return;
  const existing = [...serviceWindows].at(-1);
  if (existing) { focusWindow(existing); return; }
  if (serviceUrl) void createWindow();
  else pendingWindowRequests++;
}
function configureTray() {
  if (!Tray || isolatedRoot || tray) return;
  tray = new Tray(path.join(app.getAppPath(), 'desktop', 'icon.ico'));
  tray.setToolTip('三一匠造员工工作台 · 客户网站后台运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开员工工作台', click: openEmployeeFromBackground },
    { label: '客户网页局域网地址', click: () => { void showMobileAccess(); } },
    { label: '打开客户网页', click: () => openWeb('customer') },
    { type: 'separator' },
    { label: '退出并停止本机服务', click: () => app.quit() }
  ]));
  tray.on('double-click', openEmployeeFromBackground);
}
function persistStartupReport() { fs.mkdirSync(path.dirname(verifyOutput), { recursive: true }); fs.writeFileSync(verifyOutput, JSON.stringify(startupReport, null, 2)); }
async function writeStartupReport() {
  const windows = [...serviceWindows];
  const reports = await Promise.all(windows.map(async window => {
    const page = await window.webContents.executeJavaScript(`({ client: new URL(location.href).searchParams.get('client'),
      bodyText: document.body.innerText, hasOpener: !!window.opener, hasNode: typeof process !== 'undefined' || typeof require !== 'undefined' })`);
    return { title: window.getTitle(), url: window.webContents.getURL(), partition, alwaysOnTop: window.isAlwaysOnTop(),
      loaded: !window.webContents.isLoading() && page.client === 'employee' && isServicePage(window.webContents.getURL(), serviceUrl),
      versionVisible: page.bodyText.includes(app.getVersion()), hasOpener: page.hasOpener, hasNode: page.hasNode };
  }));
  const lock = JSON.parse(fs.readFileSync(path.join(dataDir, 'java-platform.lock'), 'utf8'));
  startupReport = { version: app.getVersion(), packaged: app.isPackaged,
    loaded: reports.length > 0 && reports.every(report => report.loaded && report.versionVisible), windowCount: BrowserWindow.getAllWindows().length,
    windows: { service: reports[0], employees: reports },
    rendererErrors, electron: process.versions.electron, health: await health(serviceUrl), isolatedDataDir: dataDir, serviceUrl,
    desktopPid: process.pid, executable: process.execPath, resourcesPath: process.resourcesPath,
    ownedProcesses: lock.children, shutdown: { completed: false } };
  persistStartupReport(); app.quit();
}
function startupFailure(error) {
  startupReport = { version: app.getVersion(), packaged: app.isPackaged, loaded: false, error: error.message,
    desktopPid: process.pid, executable: process.execPath, resourcesPath: process.resourcesPath,
    isolatedDataDir: dataDir, serviceUrl, shutdown: { completed: false } };
  persistStartupReport();
}
/* 只关闭本次拥有的 Java/MySQL，连接中心服务或复用既有服务时不终止服务器。 */
async function closeOwnedPlatform() {
  let closeError;
  try { await ownedPlatform?.close(); } catch (error) { closeError = error.message; }
  ownedPlatform = null;
  if (verifyOutput && startupReport) {
    const remaining = (startupReport.ownedProcesses || []).filter(item => { try { process.kill(item.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } });
    const lockReleased = !fs.existsSync(path.join(dataDir, 'java-platform.lock'));
    const serviceStopped = !serviceUrl || !(await health(serviceUrl));
    startupReport.shutdown = { completed: !closeError && !remaining.length && lockReleased && serviceStopped,
      lockReleased, serviceStopped, remaining, ...(closeError ? { error: closeError } : {}) };
    persistStartupReport();
  }
}
async function settlePresence(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !isServicePage(window.webContents.getURL(), serviceUrl)) return { offlineConfirmed: true, notApplicable: true };
  let timer;
  try {
    const result = await Promise.race([
      window.webContents.executeJavaScript('(async()=>{ if(typeof window.SanyStaffBeforeClose!=="function") throw new Error("客服页面尚未提供下线回执"); return await window.SanyStaffBeforeClose(); })()'),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('下线确认超过4秒，后台将按90秒心跳租期收敛在线状态。')), 4000); })
    ]);
    return result?.offlineConfirmed === true ? result : { offlineConfirmed: false, error: '未收到有效的客服下线回执。' };
  } catch (error) { return { offlineConfirmed: false, error: error.message }; }
  finally { clearTimeout(timer); }
}
async function closeEmployeeWindow(window) {
  if (!window || window.isDestroyed() || windowClosePending.has(window)) return;
  windowClosePending.add(window);
  const presence = await settlePresence(window);
  if (!presence.offlineConfirmed) {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'desktop-lifecycle.log'), `${new Date().toISOString()} ${presence.error}\n`); } catch {}
  }
  windowCloseAllowed.add(window);
  windowClosePending.delete(window);
  window.close();
}
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  shutdownPromise = (async () => {
    const presences = await Promise.all([...serviceWindows].map(window => settlePresence(window)));
    if (startupReport) startupReport.presenceShutdown = presences;
    for (const presence of presences) if (!presence.offlineConfirmed) {
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'desktop-lifecycle.log'), `${new Date().toISOString()} ${presence.error}\n`); } catch {}
    }
    await closeOwnedPlatform();
  })().catch(error => { if (!verifyOutput) dialog.showErrorBox('客服退出处理异常', error.message); })
    .finally(() => { allowQuit = true; app.quit(); });
  return shutdownPromise;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (verifyOutput || interactionQaRoot || closing) return;
    if (!serviceUrl) { pendingWindowRequests++; focusWindow(); return; }
    void createWindow();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('cn.sany.forge.service.java'); configureMenu();
    try { configureTray(); } catch (error) { dialog.showErrorBox('后台托盘启动失败', `${error.message}\n关闭最后一个窗口时程序将正常退出。`); }
    powerMonitor?.on?.('resume', () => { void checkServiceAfterResume(); });
    if (verifyOutput) {
      const timer = setInterval(() => {
        if (!closing && fs.existsSync(path.join(verifyRoot, 'request-shutdown'))) { startupFailure(new Error('成品验收超时，正在正常关闭。')); app.quit(); }
      }, 300); timer.unref();
    }
    try {
      const initialWindow = await createWindow({ loading: true });
      serviceUrl = await ensureService(); await loadEmployeeWindow(initialWindow);
      while (pendingWindowRequests > 0) { pendingWindowRequests--; await createWindow(); }
      if (verifyExtraWindowRequested) await createWindow();
      if (verifyOutput) setTimeout(() => { void writeStartupReport().catch(error => { startupFailure(error); app.quit(); }); }, 2500);
    } catch (error) {
      if (verifyOutput) startupFailure(error); else dialog.showErrorBox('客服工作台启动失败', error.message);
      app.quit();
    }
  });
}
app.on('before-quit', event => {
  if (allowQuit) return;
  event.preventDefault(); void shutdown();
});
/* 正常模式关闭全部员工窗口后保留托盘和客户网站；验收模式或托盘失败时仍按原行为退出。 */
app.on('window-all-closed', () => { if (isolatedRoot || !tray) app.quit(); });
