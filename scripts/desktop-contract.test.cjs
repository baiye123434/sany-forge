'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { normalizeServiceUrl, isServicePage } = require('../desktop/service-address.cjs');
const { platformLockStatus, resolveManagedMysqlPort } = require('../server/java-platform.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const source = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
const customerSource = fs.readFileSync(path.join(root, 'dist/customer-service.js'), 'utf8');
const staffSource = fs.readFileSync(path.join(root, 'dist/staff-app.js'), 'utf8');
const projectSource = fs.readFileSync(path.join(root, 'dist/project-service.js'), 'utf8');
const staffStyles = fs.readFileSync(path.join(root, 'dist/staff-app.css'), 'utf8');
const customerTheme = fs.readFileSync(path.join(root, 'dist/arknights.css'), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

/* 使用真实主入口与内存中的 Electron/服务替身验证窗口安全和所有权；不访问日常数据库。 */
async function harness(options = {}) {
  const windows = [], external = [], writes = new Map(), timers = [], errors = [];
  const state = { starts: 0, closes: 0, prompts: 0, menu: [], trayMenu: [], clipboard: [], paths: {}, closeSteps: [] };
  const qaRoot = path.join(root, '.qa', 'desktop-contract');
  const output = path.join(qaRoot, 'verify.json');
  const serviceUrl = options.remote || (options.verify ? 'http://127.0.0.1:49871' : 'http://127.0.0.1:8790');
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, getVersion: () => version, getPath: () => qaRoot, getAppPath: () => root,
    setPath: (key, value) => { state.paths[key] = value; }, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), setAppUserModelId: () => {},
    quit: () => app.emit('before-quit', { preventDefault() {} }) });
  const sessions = new Map();
  const session = { fromPartition(name) {
    if (!sessions.has(name)) {
      const s = new EventEmitter(); s.name = name;
      s.setPermissionCheckHandler = callback => { s.check = callback; };
      s.setPermissionRequestHandler = callback => { s.request = callback; };
      sessions.set(name, s);
    }
    return sessions.get(name);
  } };
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter(w => !w.destroyed); }
    constructor(settings) {
      super(); this.options = settings; this.title = settings.title; this.showCount = 0;
      this.alwaysOnTop = settings.alwaysOnTop;
      this.urls = []; if (state.windowConstructedAtStarts === undefined) state.windowConstructedAtStarts = state.starts;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { session: settings.webPreferences.session, getURL: () => this.url,
        isDestroyed: () => !!this.destroyed, isLoading: () => false,
        setWindowOpenHandler: callback => { this.popup = callback; },
        executeJavaScript: async script => {
          if (script.includes('SanyStaffBeforeClose')) {
            state.closeSteps.push('request-offline');
            if (options.pendingOffline) return new Promise(resolve => { state.confirmOffline = () => { state.closeSteps.push('offline-confirmed'); resolve({ offlineConfirmed: true }); }; });
            state.closeSteps.push('offline-confirmed'); return { offlineConfirmed: true };
          }
          return { client: 'employee', bodyText: `员工工作台 ${version}`, hasOpener: false, hasNode: false };
        } });
      windows.push(this);
    }
    async loadURL(url) { this.url = url; this.urls.push(url); }
    getTitle() { return this.title; } setTitle(value) { this.title = value; }
    isDestroyed() { return !!this.destroyed; } isMinimized() { return false; } restore() {}
    show() { this.showCount++; } focus() { this.emit('focus'); } isFullScreen() { return !!this.fullscreen; }
    setAlwaysOnTop(value, level) { this.alwaysOnTop = value; this.alwaysOnTopLevel = level; }
    isAlwaysOnTop() { return !!this.alwaysOnTop; }
    setFullScreen(value) { this.fullscreen = value; }
    close() { const e = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', e); if(e.prevented)return; this.destroyed = true; this.emit('closed'); if (!BrowserWindow.getAllWindows().length) app.emit('window-all-closed'); }
  }
  class Tray extends EventEmitter {
    constructor(icon) { super(); state.trayIcon = icon; }
    setToolTip(value) { state.trayToolTip = value; }
    setContextMenu(value) { state.trayMenu = value; }
  }
  const powerMonitor = new EventEmitter();
  const http = { get(url, settings, callback) {
    const request = new EventEmitter(); request.destroy = () => {};
    queueMicrotask(() => {
      if (options.unreachable || (!options.remote && !options.reuse && (!state.starts || state.closes))) return request.emit('error', new Error('offline'));
      const response = new EventEmitter(); response.statusCode = 200; response.resume = () => {};
      callback(response);
      response.emit('data', JSON.stringify({ ok: true, app: 'sany-service-platform', version: options.wrongVersion ? '3.5.1' : version, runtime: 'java', storage: 'mysql' }));
      response.emit('end');
    });
    return request;
  } };
  const mockFs = { existsSync: file => String(file).endsWith('java-platform.lock') && state.starts > state.closes,
    mkdirSync() {}, writeFileSync: (file, content) => writes.set(file, content),
    readFileSync: file => String(file).endsWith('verify-root.json') ? JSON.stringify({ purpose: 'sany-forge-packaged-qa', root: qaRoot }) : JSON.stringify({ children: [] }) };
  const env = options.verify ? { SANY_VERIFY_ROOT: qaRoot, SANY_VERIFY_OUTPUT: output } : {};
  if (options.remote) env.SANY_SERVICE_URL = options.remote;
  if (options.qaRoot) env.SANY_INTERACTION_QA_ROOT = options.qaRoot;
  const processMock = { argv: ['electron', ...(options.verify ? ['--verify-startup', ...(options.verifyExtra ? ['--verify-extra-window'] : [])] : options.qaRoot ? ['--interaction-qa'] : [])],
    env, versions: { electron: '44.7.2' }, pid: 100, execPath: '/fake/electron.exe', resourcesPath: '/fake/resources',
    kill() { const e = new Error('exited'); e.code = 'ESRCH'; throw e; } };
  const electron = { app, BrowserWindow, Tray, powerMonitor, session, Menu: { buildFromTemplate: x => x, setApplicationMenu: x => { state.menu = x; } },
    clipboard: { writeText: value => state.clipboard.push(value) },
    screen: { getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1366, height: 728 } }) },
    shell: { openExternal: async url => { external.push(url); } },
    dialog: { showErrorBox: (...args) => errors.push(args), showMessageBox: async () => { state.prompts++; return { response: options.consent === false ? 1 : 0 }; } } };
  const requireMock = name => {
    if (name === 'electron') return electron;
    if (name === 'node:os') return { networkInterfaces: () => ({ WLAN: [{ family: 'IPv4', internal: false, address: '192.168.10.25' }],
      'VMware Network Adapter': [{ family: 'IPv4', internal: false, address: '192.168.40.1' }] }) };
    if (name === 'node:http' || name === 'node:https') return http;
    if (name === 'node:fs') return mockFs;
    if (name === './service-address.cjs') return { isServicePage, readConnection: ({ env, isolated }) => isolated || !env.SANY_SERVICE_URL ? null : normalizeServiceUrl(env.SANY_SERVICE_URL) };
    if (name === '../server/java-platform.cjs') return { createPlatform: settings => {
      state.platformSettings = settings;
      return { start: async () => { state.starts++; return serviceUrl; }, close: async () => { state.closes++; state.closeSteps.push('service-closed'); } };
    } };
    return require(name);
  };
  vm.runInNewContext(source, { require: requireMock, __dirname: path.join(root, 'desktop'), process: processMock, URL, console,
    setTimeout: callback => { timers.push(callback); return 1; }, clearTimeout() {}, setInterval: () => ({ unref() {} }) }, { filename: 'desktop/main.cjs' });
  await tick();
  return { app, state, windows, external, writes, timers, errors, output, serviceUrl,
    menu: label => state.menu[0].submenu.find(item => item.label === label),
    trayMenu: label => state.trayMenu.find(item => item.label === label) };
}
const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
const permission = async (window, extra = {}, type = 'media') => new Promise(resolve => window.webContents.session.request(window.webContents, type, resolve,
  { requestingUrl: window.url, isMainFrame: true, mediaTypes: ['video'], ...extra }));

test('窗口适配 Windows 工作区，启动短暂置顶后降级并支持多开', async () => {
  const h = await harness(); const w = h.windows[0];
  assert.equal(h.windows.length, 1); assert.equal(w.url, `${h.serviceUrl}/staff.html?client=employee`);
  assert.equal(h.state.windowConstructedAtStarts, 0); assert.equal(w.options.show, false); assert.equal(w.options.alwaysOnTop, false);
  assert.deepEqual({ width: w.options.width, height: w.options.height, x: w.options.x, y: w.options.y }, { width: 1318, height: 680, x: 24, y: 24 });
  assert.equal(w.options.minWidth, 760); assert.equal(w.options.minHeight, 520);
  assert.equal(w.options.resizable, true); assert.equal(w.options.maximizable, true); assert.equal(w.options.fullscreenable, true);
  assert.equal(w.isAlwaysOnTop(), true); h.timers[0](); assert.equal(w.isAlwaysOnTop(), false);
  assert.match(w.urls[0], /^data:text\/html/); assert.equal(w.urls[1], `${h.serviceUrl}/staff.html?client=employee`);
  assert.equal(w.options.webPreferences.nodeIntegration, false); assert.equal(w.options.webPreferences.contextIsolation, true); assert.equal(w.options.webPreferences.sandbox, true);
  h.menu('打开客户网页').click(); h.menu('打开员工 Web 后台').click(); await tick();
  assert.deepEqual(h.external, [`${h.serviceUrl}/?workspace=customer#catalog`, `${h.serviceUrl}/staff.html`]);
  h.menu('客户网页局域网地址').click(); await tick();
  assert.deepEqual(h.state.clipboard, ['http://192.168.10.25:8790/?workspace=customer#catalog']);
  assert.equal(h.state.platformSettings.exposeLan, true);
  assert.match(h.state.trayToolTip, /客户网站后台运行中/);
  h.app.emit('second-instance'); await tick(); assert.equal(h.windows.length, 2);
  h.menu('新建员工登录窗口').click(); await tick(); assert.equal(h.windows.length, 3);
  assert.ok(h.windows.every(window => window.url === `${h.serviceUrl}/staff.html?client=employee`));
  assert.equal(h.state.starts, 1);
});
test('任意外域、后台、额外查询参数不能在客服窗口打开', async () => {
  const h = await harness(), w = h.windows[0];
  for (const url of ['https://evil.example/', `${h.serviceUrl}/staff.html`, `${h.serviceUrl}/staff.html?client=employee&admin=1`, `${h.serviceUrl}/api/stats`]) {
    const e = event(); w.webContents.emit('will-navigate', e, url); assert.equal(e.prevented, true);
    assert.equal(w.popup({ url }).action, 'deny');
  }
  assert.equal(h.external.includes('https://evil.example/'), false);
  const e = event(); w.webContents.emit('will-navigate', e, `${h.serviceUrl}/staff.html?client=employee#orders`); assert.equal(e.prevented, false);
});
test('摄像头只允许客服固定页面主框架视频并要求明确同意', async () => {
  const h = await harness(), w = h.windows[0];
  assert.equal(await permission(w, { isMainFrame: false }), false);
  assert.equal(await permission(w, { mediaTypes: ['audio', 'video'] }), false);
  assert.equal(await permission(w, { requestingUrl: 'https://evil.example/' }), false);
  assert.equal(w.webContents.session.check(null, 'media', h.serviceUrl, { mediaType: 'video', isMainFrame: true }), false);
  assert.equal(h.state.prompts, 0); assert.equal(await permission(w), true); assert.equal(h.state.prompts, 1);
  const denied = await harness({ consent: false }); assert.equal(await permission(denied.windows[0]), false);
});
test('下载仅接受客服窗口同源或同源 Blob', async () => {
  const h = await harness(), w = h.windows[0];
  for (const [url, expected] of [[`${h.serviceUrl}/api/files/file`, false], [`blob:${h.serviceUrl}/id`, false], ['https://evil.example/file', true]]) {
    const e = event(); w.webContents.session.emit('will-download', e, { getURL: () => url, getFilename: () => '合同.pdf', setSaveDialogOptions() {} }, w.webContents);
    assert.equal(e.prevented, expected);
  }
});
test('关闭员工窗口后托盘保持客户网站，显式退出才停止自有服务', async () => {
  const local = await harness(); local.app.emit('second-instance'); await tick();
  local.windows[0].close(); await tick();
  assert.equal(local.windows.filter(window => !window.destroyed).length, 1); assert.equal(local.state.closes, 0);
  local.windows[1].close(); await tick(); assert.equal(local.state.closes, 0);
  local.trayMenu('打开员工工作台').click(); await tick(); assert.equal(local.windows.filter(window => !window.destroyed).length, 1);
  local.windows.at(-1).close(); await tick(); assert.equal(local.state.closes, 0);
  local.trayMenu('退出并停止本机服务').click(); await tick(); assert.equal(local.state.closes, 1);
  for (const options of [{ reuse: true }, { remote: 'https://service.example' }]) {
    const h = await harness(options); h.windows[0].close(); await tick();
    assert.equal(h.state.starts, options.reuse || options.remote ? 0 : 1);
    assert.equal(h.state.closes, 0);
    h.trayMenu('退出并停止本机服务').click(); await tick(); assert.equal(h.state.closes, 0);
  }
});
test('中心连接失败或版本不匹配时不会建立本地分叉数据库', async () => {
  for (const options of [{ remote: 'https://service.example', unreachable: true }, { remote: 'https://service.example', wrongVersion: true }]) {
    const h = await harness(options); assert.equal(h.state.starts, 0); assert.equal(h.windows.length, 1); assert.match(h.windows[0].urls[0], /^data:text\/html/); assert.equal(h.errors.length, 1);
  }
});
test('窗口关闭先等待下线回执并保留服务，托盘退出才释放自有服务', async () => {
  const h = await harness({ pendingOffline: true }); h.windows[0].close(); await tick();
  assert.equal(h.windows[0].isDestroyed(), false); assert.equal(h.state.closes, 0);
  assert.deepEqual(h.state.closeSteps, ['request-offline']);
  h.state.confirmOffline(); await tick();
  assert.deepEqual(h.state.closeSteps, ['request-offline','offline-confirmed']); assert.equal(h.state.closes, 0);
  h.trayMenu('退出并停止本机服务').click(); await tick();
  assert.deepEqual(h.state.closeSteps, ['request-offline','offline-confirmed','service-closed']);
});
test('成品验收可建两个隐藏员工窗口、无 Node 能力，隔离资料且完成关闭回执', async () => {
  const h = await harness({ verify: true, verifyExtra: true }); assert.equal(h.windows.length, 2); assert.ok(h.windows.every(window => window.showCount === 0));
  assert.ok(h.windows.every(window => window.options.show === false && window.options.alwaysOnTop === false));
  assert.equal(await permission(h.windows[0]), false); h.timers[0](); await tick();
  const report = JSON.parse(h.writes.get(h.output));
  assert.equal(report.loaded, true); assert.equal(report.windowCount, 2); assert.equal(report.windows.service.hasNode, false);
  assert.equal(report.windows.employees.length, 2); assert.ok(report.windows.employees.every(window => !window.alwaysOnTop && !window.hasNode));
  assert.equal(report.shutdown.completed, true); assert.equal(h.state.closes, 1);
});
test('交互验收不能覆盖日常目录或 .qa 根目录', async () => {
  await assert.rejects(harness({ qaRoot: path.join(root, 'normal') }), /交互验收目录/);
  await assert.rejects(harness({ qaRoot: path.join(root, '.qa') }), /交互验收目录/);
});
test('服务配置仅允许 HTTPS 源地址或本机 HTTP，拒绝凭据/子路径/参数', () => {
  for (const url of ['http://127.0.0.1:8790/', 'http://localhost:8790', 'http://[::1]:8790', 'https://service.example/']) assert.equal(normalizeServiceUrl(url), new URL(url).origin);
  for (const url of ['http://service.example', 'https://user:password@service.example', 'https://service.example/path', 'https://service.example/?x=1', 'file:///C:/Windows', 'javascript:alert(1)']) assert.throws(() => normalizeServiceUrl(url));
});
test('只接管所有进程均已退出或 PID 已被其他程序复用的完整陈旧锁', () => {
  const record = JSON.stringify({ token: '20a69c4b-a3d6-4af8-ae6c-466b4a04baa2', pid: 23740,
    executable: 'C:\\app\\三一匠造员工工作台.exe', at: '2026-10-30T15:40:04.646Z',
    children: [{ pid: 5200, executable: 'C:\\runtime\\mysqld.exe' },
      { pid: 20624, executable: 'C:\\runtime\\java.exe' }, { pid: 1560, executable: 'C:\\runtime\\mysqld.exe' }] });
  const stale = platformLockStatus(record, () => false);
  assert.equal(stale.recoverable, true); assert.equal(stale.reason, 'stale');
  assert.deepEqual(stale.pids, [23740, 5200, 20624, 1560]);
  const active = platformLockStatus(record, pid => pid === 20624);
  assert.equal(active.recoverable, false); assert.equal(active.reason, 'active'); assert.deepEqual(active.activePids, [20624]);
  const reused = platformLockStatus(record, pid => pid === 20624 ? 'ChatGPT.exe' : false);
  assert.equal(reused.recoverable, true); assert.deepEqual(reused.reusedPids, [20624]);
  const matching = platformLockStatus(record, pid => pid === 20624 ? 'java.exe' : false);
  assert.equal(matching.recoverable, false); assert.deepEqual(matching.activePids, [20624]);
  for (const invalid of ['', '{', '{}', JSON.stringify({ token: 'short', pid: 1, children: [] }),
    JSON.stringify({ token: '20a69c4b-a3d6-4af8-ae6c-466b4a04baa2', pid: 1, children: [{ pid: 0 }] })]) {
    assert.equal(platformLockStatus(invalid, () => false).recoverable, false);
  }
});
test('自管 MySQL 默认使用固定端口并严格校验覆盖值', () => {
  assert.equal(resolveManagedMysqlPort(), 33307);
  assert.equal(resolveManagedMysqlPort('34007'), 34007);
  for (const invalid of ['', '0', '65536', '33007.5', 'invalid']) {
    assert.throws(() => resolveManagedMysqlPort(invalid), /端口无效/);
  }
});
test('客户登录每次使用空表单且不接受浏览器保存凭据回填', () => {
  const start = customerSource.indexOf('function authHTML()');
  const end = customerSource.indexOf('function accountRecords', start);
  const authSource = customerSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(authSource, /data-cu-form="auth" autocomplete="off"/);
  assert.match(authSource, /name="phone"[^>]+autocomplete="off"/);
  assert.match(authSource, /name="password"[^>]+autocomplete="new-password"/);
  assert.doesNotMatch(authSource, /current-password/);
  assert.match(authSource, /function prepareAuthForm\(\)/);
  assert.match(authSource, /form\.reset\(\)/);
  assert.match(authSource, /form\.dataset\.userEdited/);
});
test('客户与客服三类聊天均提供文件、粘贴图片和回车发送，品牌标志透明反白', () => {
  for (const script of [customerSource, staffSource, projectSource]) {
    assert.match(script, /addEventListener\('paste'/);
    assert.match(script, /event\.key\s*={2,3}\s*'Enter'|event\.key!=='Enter'/);
    assert.match(script, /event\.shiftKey/);
    assert.match(script, /粘贴图片/);
  }
  assert.match(staffSource, /api\/conversations/);
  assert.match(staffSource, /client-order/);
  assert.match(staffSource, /conversationChanged=fresh\.some/);
  assert.match(staffSource, /location\.hash==='#messages'&&conversationChanged\)await route\(\)/);
  assert.match(staffStyles, /\.brand img\{[^}]*filter:brightness\(0\) invert\(1\)/);
  assert.doesNotMatch(staffStyles.match(/\.brand img\{[^}]*\}/)?.[0] || '', /background|padding/);
  const customerBrand = customerTheme.match(/\.topbar \.brand img\s*\{[^}]*\}/)?.[0] || '';
  assert.match(customerBrand, /background:\s*transparent/);
  assert.match(customerBrand, /filter:\s*brightness\(0\) invert\(1\)/);
  assert.doesNotMatch(customerBrand, /background:\s*#f6f7f2|padding:\s*[1-9]/);
});
test('客服聊天按客户身份分组且不重复混入订单留痕，客服操作明确初审与向上提交', () => {
  const messagesView = staffSource.match(/async function messagesView\(\)\{[\s\S]*?\n\s*async function selectChat/)?.[0] || '';
  assert.match(messagesView, /\['customer','在线咨询'\],\['client-order','订单沟通'\]/);
  assert.match(messagesView, /c\.record\?\.customerName\|\|c\.record\?\.customerPhone/);
  assert.doesNotMatch(messagesView, /orders\.map\(/);
  assert.match(staffSource, /\['accept','初步审核'\]/);
  assert.match(staffSource, /\['handoff','向上提交订单与材料'\]/);
  assert.match(staffStyles, /\.conversation-group/);
  assert.match(staffStyles, /\.message-notices/);
});
