'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * 在 Node VM 中加载未经改写的生产 platform.js，以最小 DOM / HTTP 替身测试事件委托与接口合约。
 * 不控制浏览器、不接触生产数据、不向生产代码加入测试令牌或登录后门。
 * 摄像头函数仅是测试替身：此套测试不表示真人识别或可视化浏览器验收通过。
 */
const source = fs.readFileSync(path.resolve(__dirname, '../dist/platform.js'), 'utf8');
const catalogSource = fs.readFileSync(path.resolve(__dirname, '../dist/catalog-navigation.js'), 'utf8');
const regionSource = fs.readFileSync(path.resolve(__dirname, '../dist/china-regions.js'), 'utf8');
const version = require('../package.json').version;
const clone = value => JSON.parse(JSON.stringify(value));
const photo = { name: '现场材料.png', size: 10, type: 'image/png', data: 'iVBORw0KGgo=' };
const product = { id: 'official-1', code: 'SY-TEST', name: '测试设备', category: '挖掘机', subcategory: '小型', summary: '官方参数示例', image: 'assets/products/excavator.jpg', specs: [{ name: '重量', value: '1000', unit: 'kg' }], sourceUrl: 'https://www.sanygroup.com/product/1', modelKey: null, published: true };
const actor = role => ({ id: `USR-${role}`, name: `${role} 测试人员`, username: `${role}.test`, role, active: true, faceEnrolled: true });
const orderFixture = () => ({
  id: 'SO-test', productId: product.id, product: clone(product), mode: 'buy', quantity: 2, contact: '测试客户', phone: '13800000000',
  address: '湖南省长沙市测试区测试路 3 号', date: '2099-01-01', plan: '待商议', status: 'submitted', revision: 1,
  createdAt: '2026-10-20T01:00:00Z', history: [{ to: 'submitted', actor: '客户', role: 'customer', note: '测试申请', files: [], at: '2026-10-20T01:00:00Z' }]
});
const ticketFixture = () => ({
  id: 'WO-test', orderId: 'SO-test', product: clone(product), contact: '测试客户', phone: '13800000000', address: '湖南省长沙市测试路 3 号',
  issue: '测试故障', urgency: 'normal', status: 'submitted', assignee: null, revision: 1, createdAt: '2026-10-20T01:00:00Z',
  history: [{ to: 'submitted', actor: '客户', role: 'customer', note: '故障描述', files: [], at: '2026-10-20T01:00:00Z' }]
});
async function harness(settings = {}) {
  const requests = [], nodes = new Map(), actionNodes = new Set(), listeners = new Map(), windowListeners = new Map(), timers = new Map();
  const fixture = {
    user: actor(settings.role || 'admin'), setupNeeded: settings.setupNeeded ?? false,
    products: [clone(product)], orders: [orderFixture()], tickets: [ticketFixture()],
    users: ['admin', 'service', 'reviewer'].map(actor), events: [], ...clone(settings.fixture || {})
  };
  const storage = (initial, key) => {
    const values = new Map(Object.entries(initial || {}));
    return {
      getItem(name) { if (settings[`${key}ReadError`]) throw new Error('Storage disabled'); return values.get(name) ?? null; },
      setItem(name, value) { if (settings[`${key}WriteError`]) throw new Error('Storage quota exceeded'); values.set(name, String(value)); },
      removeItem(name) { values.delete(name); }
    };
  };
  const sessionStorage = storage(settings.role ? { 'sany-staff': 'STAFF-token' } : {}, 'session');
  const localStorage = storage(settings.localStorage, 'local');
  class Element {
    constructor(id = '', owner = null) {
      this.id = id; this.owner = owner; this.dataset = {}; this.attributes = {}; this.textContent = ''; this._html = '';
      this.disabled = false; this.checked = false; this.open = false; this.isConnected = true; this.value = '';
      this.events = new Map();
      const classes = new Set();
      this.classList = { add: v => classes.add(v), remove: v => classes.delete(v), toggle: (v, enabled) => enabled ? classes.add(v) : classes.delete(v) };
    }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
      this._html = html;
      for (const [key, element] of nodes) if (element !== this && this.contains(element)) { element.isConnected = false; nodes.delete(key); }
      for (const element of actionNodes) if (this.contains(element)) actionNodes.delete(element);
      /*
       * 仅解析事件委托需要的 id、data-* 与无障碍属性，不实现布局或浏览器行为。
       * 因此可核对真实按钮、选中状态及接口调用，但仍不能代替浏览器视觉验收。
       */
      for (const match of html.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)) {
        const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
        if (!attributes.id && !attributes['data-action']) continue;
        const element = new Element(attributes.id || '', this);
        element.attributes = attributes;
        element.disabled = /\sdisabled(?:\s|$)/.test(match[1]);
        for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) element.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
        if (attributes.id) nodes.set(attributes.id, element);
        if (attributes['data-action']) actionNodes.add(element);
      }
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    matches(selector) { return selector === ':hover' ? !!this.hovered : selector === '[data-action]' ? !!this.dataset.action : selector.startsWith('#') && this.id === selector.slice(1); }
    closest(selector) { return this.matches(selector) ? this : this.owner?.closest(selector) || null; }
    contains(element) { for (let current = element; current; current = current.owner) if (current === this) return true; return false; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.get('close')?.({}); }
    scrollIntoView() {}
    click() {}
  }
  for (const id of ['main', 'modal', 'modalContent', 'identity', 'toast', 'releaseVersion']) nodes.set(id, new Element(id));
  if (settings.bootOpen) { const screen = new Element('bootScreen'); screen.open = true; if (settings.bootComplete) screen.dataset.assemblyComplete = 'true'; nodes.set('bootScreen', screen); }
  const navs = ['catalog', 'customer', 'work', 'admin'].map(nav => { const element = new Element(); element.dataset.nav = nav; return element; });
  const document = {
    hidden: !!settings.hidden,
    querySelector(selector) {
      if (selector === '.boot-screen[open]') return nodes.get('bootScreen')?.open ? nodes.get('bootScreen') : null;
      if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
      if (selector === '.catalog-tools [data-action="models"]') return [...actionNodes].filter(element => element.dataset.action === 'models').at(-1) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-nav]') return navs;
      const action = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];
      return action ? [...actionNodes].filter(element => element.dataset.action === action) : [];
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    createElement() { return new Element(); }
  };
  const response = (result, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(result), blob: async () => new Blob(['test']) });
  async function fetchMock(endpoint, options = {}) {
    const request = { path: endpoint, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined, token: options.headers?.Authorization || '' };
    requests.push(request);
    if (settings.respond) {
      const custom = await settings.respond(request, fixture);
      if (custom) return response(custom.result || {}, custom.status || 200);
    }
    const { path: route, method, body } = request;
    if (route === '/api/bootstrap') return response({ version, setupNeeded: fixture.setupNeeded, roles: ['admin', 'service', 'reviewer'] });
    if (route === '/api/me') return response({ user: fixture.user });
    if (route === '/api/products') return response({ products: fixture.products });
    if (route === '/api/stats') return response({ pendingOrders: 1, openTickets: 1, pendingReview: 1, orders: 1, tickets: 1, products: 1 });
    if (route === '/api/staff' || (route === '/api/admin/users' && method === 'GET')) return response({ users: fixture.users });
    if (route === '/api/admin/audit') return response({ events: fixture.events });
    if (route === '/api/orders' && method === 'GET') return response({ orders: fixture.orders });
    if (route === '/api/tickets' && method === 'GET') return response({ tickets: fixture.tickets });
    if (route === '/api/guest/lookup') return response({ order: fixture.orders[0], token: 'GUEST-token' });
    if (route === '/api/guest/phone-orders') return response({ orders: fixture.orders });
    if (route === '/api/guest/phone-order') return response({ order: fixture.orders.find(order => order.id === body.orderId), token: 'PHONE-token' });
    if (route === '/api/register') { fixture.setupNeeded = false; return response({ token: 'REGISTER-token', user: fixture.user, enrollOnly: false }); }
    if (route === '/api/login') {
      fixture.setupNeeded = false;
      /* 默认替身代表已录入人脸的账号：密码通过后进入人脸挑战；未录入人脸的直发会话用 settings.respond 覆盖。 */
      return response({ challenge: 'challenge-test', enroll: false, turns: ['left', 'right'], expiresIn: 120, user: fixture.user });
    }
    if (route === '/api/face/verify') return response({ token: 'VERIFIED-token', user: fixture.user, enrollOnly: false });
    if (route === '/api/logout') return response({ ok: true });
    if (route === '/api/admin/product-images') return response({ image: '/api/product-images/MAT-test' });
    if (route === '/api/admin/products') {
      if (method === 'GET') return response({ products: fixture.products });
      return response({ product: { ...body, id: body.id || 'CUSTOM-test' } });
    }
    if (route.startsWith('/api/admin/products/') && method === 'DELETE') return response({ ok: true });
    if (route === '/api/admin/users' && method === 'POST') return response({ user: { ...body, id: 'USR-new' } });
    if (route.startsWith('/api/admin/users/') && method === 'PATCH') return response({ user: fixture.users[1] });
    if (route === '/api/orders' && method === 'POST') return response({ order: { ...fixture.orders[0], ...body }, accessCode: 'only-once-receipt', token: 'GUEST-token' });
    const order = route.match(/^\/api\/orders\/([^/]+)(?:\/(transition|confirm))?$/);
    if (order) {
      const value = fixture.orders.find(item => item.id === order[1]);
      if (method === 'POST') { value.status = order[2] === 'confirm' ? 'delivered' : body.status; value.revision++; }
      return response({ order: value, tickets: fixture.tickets });
    }
    if (route === '/api/tickets' && method === 'POST') return response({ ticket: fixture.tickets[0] });
    const ticket = route.match(/^\/api\/tickets\/([^/]+)(?:\/(transition|review|accept))?$/);
    if (ticket) {
      const value = fixture.tickets.find(item => item.id === ticket[1]);
      if (method === 'POST') { value.status = ticket[2] === 'transition' ? body.status : ticket[2] === 'review' ? 'awaiting_customer' : 'closed'; value.revision++; }
      return response({ ticket: value });
    }
    throw new Error(`测试未实现接口：${method} ${route}`);
  }
  const location = { protocol: 'http:', hash: settings.route || '#catalog', search: settings.search || '', pathname: '/', origin: 'http://127.0.0.1:8790' };
  const stopCalls = [], authCalls = [], modelCalls = [], projectCalls = [], clipboard = [];
  const window = {
    addEventListener(name, callback) { windowListeners.set(name, callback); }, scrollTo() {},
    matchMedia() { return { matches: !!settings.reducedMotion, addEventListener() {} }; },
    Forge3D: { unmount() {}, mount(host, modelKey) { modelCalls.push(modelKey); return { setAnimate() {}, setAutoRotate() {} }; } },
    SanyFace: {
      stop() { stopCalls.push(true); },
      async authenticate(challenge, options) { authCalls.push({ challenge, options }); return { samples: [], consent: options.consent }; }
    }
  };
  window.history = { replaceState(_data, _title, url) { location.hash = '#' + url.split('#')[1]; } };
  /* 此处只验证主界面与独立项目模块的接线；项目模块本体在 project-ui.test.cjs 单独执行。 */
  if (settings.projectBridge) window.SanyProjects = { create() { return Object.fromEntries(['stop', 'renderProjectPage', 'renderStaffProjects', 'renderStaffChat', 'openChat', 'handleAccessLink'].map(name => [name, (...args) => { projectCalls.push({ name, args }); return Promise.resolve(); }])); } };
  class FakeFormData { constructor(form) { return Object.entries(form.data)[Symbol.iterator](); } }
  class FakeFileReader {
    readAsDataURL(file) { this.result = `data:${file.type};base64,${file.data}`; queueMicrotask(() => this.onload()); }
  }
  const context = { setInterval:()=>0, clearInterval:()=>{}, document, window, location, sessionStorage, localStorage, fetch: fetchMock, FormData: FakeFormData, FileReader: FakeFileReader,
    URL, Blob, console, navigator: { clipboard: { writeText: async value => clipboard.push(value) } },
    /* 长计时由测试显式推进，轮播暂停/恢复可确定性验证，不等待真实六秒。 */
    setTimeout: (callback, delay = 0) => {
      if (delay === 0) return setImmediate(callback);
      const handle = { callback, delay }; timers.set(handle, handle); return handle;
    },
    clearTimeout: handle => { if (handle && !timers.delete(handle)) clearImmediate(handle); },
    requestAnimationFrame: callback => callback() };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: 'production-catalog-navigation.js' });
  vm.runInContext(regionSource, context, { filename: 'production-china-regions.js' });
  vm.runInContext(source, context, { filename: 'production-platform.js' });
  const settle = async () => { for (let tick = 0; tick < 8; tick++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return {
    nodes, requests, fixture, sessionStorage, localStorage, stopCalls, authCalls, modelCalls, projectCalls, clipboard, location, settle, window,
    actions: action => [...actionNodes].filter(element => element.dataset.action === action),
    hasListener: name => listeners.has(name),
    timerCount: delay => [...timers.values()].filter(timer => timer.delay === delay).length,
    async tickTimer(delay) { const timer = [...timers.values()].find(item => item.delay === delay); assert.ok(timer, `没有 ${delay}ms 计时器`); timers.delete(timer); timer.callback(); await settle(); },
    async visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.({}); await settle(); },
    async event(name, id, extra = {}) { let prevented = false; const target = nodes.get(id); if (name === 'pointerover' && target) target.hovered = true; if (name === 'pointerout' && target) target.hovered = false; listeners.get(name)?.({ target, relatedTarget: null, preventDefault() { prevented = true; }, ...extra }); await settle(); return prevented; },
    html: id => nodes.get(id)?.innerHTML || '',
    async click(action, dataset = {}) { const element = new Element(); element.dataset = { action, ...dataset }; await listeners.get('click')({ target: element }); await settle(); return element; },
    async navigate(hash) { location.hash = hash; windowListeners.get('hashchange')(); await settle(); },
    async change(name, value, id = '') { listeners.get('change')({ target: { name, value, id } }); await settle(); },
    async input(id, value) { const element = nodes.get(id) || new Element(id); element.value = value; listeners.get('input')({ target: element }); await settle(); },
    async submit(kind, data, { dataset = {}, materialFiles = [], productFiles = [], valid = true } = {}) {
      const error = new Element(), submit = new Element(), form = new Element();
      form.dataset = { form: kind, ...dataset }; form.data = data;
      form.elements = { materials: { files: materialFiles }, productImage: { files: productFiles } };
      form.reportValidity = () => valid;
      form.closest = selector => selector === 'form[data-form]' ? form : null;
      form.querySelector = selector => selector === '.form-error' ? error : selector === 'button[type="submit"]' ? submit : null;
      await listeners.get('submit')({ target: form, preventDefault() {} }); await settle();
      return { form, error, submit };
    }
  };
}

test('目录与详情：转义产品文本、无模型标注、租购必填字段、地址联动与切换', async () => {
  const app = await harness({ fixture: { products: [{ ...product, name: '<script>unsafe</script>' }] } });
  assert.match(app.html('productGrid'), /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(app.html('productGrid'), /暂无 3D 模型/);
  await app.click('product', { id: product.id });
  assert.match(app.html('modalContent'), /暂无 3D 模型/);
  await app.click('buy', { id: product.id, mode: 'rent' });
  const html = app.html('modalContent');
  for (const name of ['contact', 'phone', 'addressProvince', 'addressCity', 'addressCounty', 'addressDetail', 'duration']) assert.match(html, new RegExp(`name="${name}"[^>]*required`));
  assert.match(html, /value="430000"[^>]*>湖南省/);
  await app.change('addressProvince', '430000', 'addressProvince');
  assert.match(app.html('addressCity'), /value="430100"[^>]*>长沙市/);
  await app.change('addressCity', '430100', 'addressCity');
  assert.match(app.html('addressCounty'), /value="430102"[^>]*>芙蓉区/);
  await app.change('mode', 'buy');
  assert.match(app.html('modeOptions'), /name="plan"/);
});
test('下单：发送完整联系人地址与数值字段，成功后展示一次性凭证', async () => {
  const app = await harness();
  await app.click('buy', { id: product.id });
  const result = await app.submit('purchase', { mode: 'rent', quantity: '2', duration: '6', contact: '张三', phone: '13800000000', addressProvince: '430000', addressCity: '430100', addressCounty: '430102', addressDetail: '测试路 3 号', date: '2099-01-01' }, { dataset: { product: product.id } });
  const sent = app.requests.find(request => request.path === '/api/orders' && request.method === 'POST');
  assert.equal(sent.body.quantity, 2); assert.equal(sent.body.duration, 6); assert.equal(sent.body.productId, product.id);
  assert.equal(sent.body.address, '湖南省长沙市芙蓉区测试路 3 号');
  for (const key of ['addressProvince', 'addressCity', 'addressCounty', 'addressDetail']) assert.equal(sent.body[key], undefined);
  assert.match(app.html('modalContent'), /only-once-receipt/);
  assert.equal(result.submit.disabled, false);
});
test('自由注册：页签切换、重复密码拦截、注册成功直接进入工作区且不调用人脸', async () => {
  const app = await harness({ route: '#admin' });
  assert.match(app.html('main'), /账号登录/);
  assert.match(app.html('main'), /自由注册/);
  await app.click('auth-mode', { mode: 'register' });
  assert.match(app.html('main'), /创建演示账号/);
  assert.match(app.html('main'), /data-form="register"/);
  const bad = await app.submit('register', { username: 'demo.admin', name: '演示管理员', password: 'Long-pass-301', repeat: 'mismatch', role: 'admin' });
  assert.match(bad.error.textContent, /不一致/);
  assert.equal(app.requests.some(request => request.path === '/api/register'), false);
  await app.submit('register', { username: 'demo.admin', name: '演示管理员', password: 'Long-pass-301', repeat: 'Long-pass-301', role: 'admin' });
  const sent = app.requests.find(request => request.path === '/api/register');
  assert.equal(sent.method, 'POST'); assert.equal(sent.body.role, 'admin');
  assert.equal(app.sessionStorage.getItem('sany-staff'), 'REGISTER-token');
  assert.match(app.html('main'), /操作审计/);
  assert.equal(app.nodes.get('modal').open, false);
  assert.equal(app.authCalls.length, 0);
});
test('登录：未录入人脸的账号密码通过后直接发会话，已录入人脸仍进入采集弹窗', async () => {
  const plain = await harness({ route: '#admin', respond: async request => {
    if (request.path === '/api/login') return { result: { token: 'PLAIN-token', user: actor('admin'), enrollOnly: false } };
    return null;
  } });
  await plain.submit('login', { username: 'demo.admin', password: 'Long-pass-301' });
  assert.equal(plain.sessionStorage.getItem('sany-staff'), 'PLAIN-token');
  assert.equal(plain.authCalls.length, 0);
  assert.match(plain.html('main'), /操作审计/);
  const faced = await harness({ route: '#admin' });
  await faced.submit('login', { username: 'faced.admin', password: 'Long-pass-301' });
  assert.match(faced.html('modalContent'), /本人人脸核验/);
  assert.equal(faced.sessionStorage.getItem('sany-staff'), null);
  await faced.click('start-face');
  assert.equal(faced.authCalls.length, 0);
  faced.nodes.get('faceConsent').checked = true;
  await faced.click('start-face');
  assert.equal(faced.authCalls.length, 1);
  assert.equal(faced.sessionStorage.getItem('sany-staff'), 'VERIFIED-token');
  assert.match(faced.html('main'), /操作审计/);
  assert.equal(faced.nodes.get('modal').open, false);
});
test('角色视图：服务工程师不能打开管理功能，审核员没有产品和员工维护入口', async () => {
  const service = await harness({ route: '#admin', role: 'service' });
  assert.match(service.html('main'), /此账号是服务工程师/);
  assert.equal(service.requests.some(request => request.path === '/api/admin/products'), false);
  const reviewer = await harness({ route: '#admin', role: 'reviewer' });
  assert.match(reviewer.html('main'), /操作审计/);
  assert.doesNotMatch(reviewer.html('main'), /data-tab="products"|data-tab="users"/);
});
test('客户查询与收货：查询字段去空白，客户凭证与证明材料发送给正确接口', async () => {
  const order = { ...orderFixture(), status: 'shipped' };
  const app = await harness({ route: '#customer', fixture: { orders: [order] } });
  await app.submit('lookup', { orderId: ' SO-test ', phone: ' 13800000000 ', code: ' receipt ' });
  const lookup = app.requests.find(request => request.path === '/api/guest/lookup');
  assert.deepEqual(lookup.body, { orderId: 'SO-test', phone: '13800000000', code: 'receipt' });
  assert.match(app.html('modalContent'), /data-form="order-confirm"/);
  await app.submit('order-confirm', { note: '现场签收', confirmed: 'on' }, { materialFiles: [photo] });
  const sent = app.requests.find(request => request.path.endsWith('/confirm'));
  assert.equal(sent.token, 'Bearer GUEST-token'); assert.equal(sent.body.confirmed, true);
  assert.equal(sent.body.revision, 1); assert.equal(sent.body.files[0].name, photo.name);
  assert.match(app.html('modalContent'), /提交维保报修/);
});
test('售后接单表单与独立审核按钮符合角色及状态，上传材料携带当前revision', async () => {
  const ticket = { ...ticketFixture(), status: 'assigned', assignee: 'USR-service', assigneeName: '服务人员' };
  const app = await harness({ route: '#work', role: 'service', fixture: { tickets: [ticket] } });
  await app.click('staff-ticket', { id: ticket.id });
  assert.match(app.html('modalContent'), /value="in_progress"/);
  assert.match(app.html('modalContent'), /name="materials"[^>]*required/);
  await app.submit('ticket-transition', { status: 'in_progress', note: '已到达现场' }, { materialFiles: [photo] });
  const sent = app.requests.find(request => request.path === '/api/tickets/WO-test/transition');
  assert.equal(sent.body.revision, 1); assert.equal(sent.body.files.length, 1); assert.equal(sent.token, 'Bearer STAFF-token');
  assert.match(app.html('modalContent'), /value="pending_review"/);
  const reviewer = await harness({ route: '#admin', role: 'reviewer', fixture: { tickets: [{ ...ticket, status: 'pending_review' }] } });
  await reviewer.click('staff-ticket', { id: ticket.id });
  assert.match(reviewer.html('modalContent'), /data-form="ticket-review"/);
  const selfReview = await harness({ route: '#admin', role: 'reviewer', fixture: { tickets: [{ ...ticket, status: 'pending_review', completedBy: 'USR-reviewer' }] } });
  await selfReview.click('staff-ticket', { id: ticket.id });
  assert.doesNotMatch(selfReview.html('modalContent'), /data-form="ticket-review"/);
  assert.match(selfReview.html('modalContent'), /另一位管理员或审核员/);
});
test('管理员产品新增：先上传照片再保存参数；删除走可恢复接口；账号变更为布尔值', async () => {
  const app = await harness({ route: '#admin', role: 'admin' });
  await app.click('work-tab', { tab: 'products' });
  await app.click('new-product');
  await app.submit('product-edit', { code: 'CUSTOM-1', name: '新增设备', category: '测试类', subcategory: '', summary: '真实说明', published: 'true', specText: '重量 | 1000 | kg' }, { productFiles: [photo] });
  const upload = app.requests.findIndex(request => request.path === '/api/admin/product-images');
  const save = app.requests.findIndex(request => request.path === '/api/admin/products' && request.method === 'POST');
  assert.ok(upload >= 0 && save > upload);
  assert.deepEqual(app.requests[save].body.specs, [{ name: '重量', value: '1000', unit: 'kg' }]);
  assert.equal(app.requests[save].body.image, '/api/product-images/MAT-test');
  assert.equal(app.requests[save].body.published, true);
  await app.click('remove-product', { id: product.id });
  assert.match(app.html('modalContent'), /可恢复的软移除/);
  await app.submit('product-remove', {}, { dataset: { id: product.id } });
  assert.ok(app.requests.some(request => request.path === '/api/admin/products/official-1' && request.method === 'DELETE'));
  await app.click('work-tab', { tab: 'users' });
  await app.click('edit-user', { id: 'USR-service' });
  await app.submit('user-edit', { active: 'false', password: '', resetFace: 'on' }, { dataset: { id: 'USR-service' } });
  assert.deepEqual(app.requests.find(request => request.path === '/api/admin/users/USR-service').body, { active: false, resetFace: true });
});
test('表单接口失败保留输入、展示错误且恢复提交按钮', async () => {
  const app = await harness({ respond: request => request.path === '/api/orders' && request.method === 'POST' ? { status: 400, result: { error: '请填写有效联系电话。' } } : null });
  await app.click('buy', { id: product.id });
  const result = await app.submit('purchase', { mode: 'buy', quantity: '1', phone: 'bad', addressProvince: '430000', addressCity: '430100', addressCounty: '430102', addressDetail: '测试路 3 号' }, { dataset: { product: product.id } });
  assert.equal(result.error.textContent, '请填写有效联系电话。');
  assert.equal(result.submit.disabled, false); assert.equal(result.form.dataset.busy, 'false');
  assert.match(app.html('modalContent'), /填写租购申请/);
});
test('回归：凭证本地保存失败仍展示已成功创建的订单，避免提示重复下单', async () => {
  const app = await harness({ localWriteError: true });
  await app.click('buy', { id: product.id });
  await app.submit('purchase', { mode: 'buy', quantity: '1', remember: 'on', addressProvince: '430000', addressCity: '430100', addressCounty: '430102', addressDetail: '测试路 3 号' }, { dataset: { product: product.id } });
  assert.match(app.html('modalContent'), /only-once-receipt/);
  assert.equal(app.requests.filter(request => request.path === '/api/orders' && request.method === 'POST').length, 1);
});
test('回归：退出时即使服务不可达，也必须清除本地员工凭证', async () => {
  const app = await harness({ route: '#work', role: 'service', respond: request => request.path === '/api/logout' ? { status: 503, result: { error: '服务暂不可用' } } : null });
  await app.click('logout');
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.doesNotMatch(app.html('identity'), /service 测试人员/);
});
test('回归：工作区身份过期后返回登录界面，不保留失效的操作区', async () => {
  let expired = false;
  const app = await harness({ route: '#work', role: 'service', respond: request => expired && request.path === '/api/stats' ? { status: 401, result: { error: '请先登录' } } : null });
  expired = true;
  await app.click('refresh-work');
  assert.match(app.html('main'), /登录服务工作区/);
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
});
test('回归：取消人脸弹窗后迟到的验证响应不能自动登录', async () => {
  let finishVerification;
  const app = await harness({ route: '#admin', respond: request =>
    request.path === '/api/face/verify' ? new Promise(resolve => { finishVerification = resolve; }) : null });
  await app.submit('login', { username: 'admin.test', password: 'Long-pass-301' });
  app.nodes.get('faceConsent').checked = true;
  const pending = app.click('start-face');
  await app.settle();
  assert.equal(typeof finishVerification, 'function');
  await app.click('close');
  finishVerification({ result: { token: 'DELAYED-token', user: actor('admin'), enrollOnly: false } });
  await pending;
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.doesNotMatch(app.html('identity'), /admin 测试人员/);
});

/* 以下合成目录仅存在于隔离 VM，不写入正式产品 JSON 或业务数据库。 */
function browsingFixture() {
  return [
    { ...product, id: 'plain-small', code: 'PLAIN-S', category: '土石方机械', subcategory: '小型挖掘机' },
    { ...product, id: 'official-excavator', code: 'MODEL-EX', category: '土石方机械', subcategory: '中型挖掘机', modelKey: 'excavator' },
    { ...product, id: 'official-crane', code: 'MODEL-CR', category: '起重机', subcategory: '汽车起重机', modelKey: 'crane' },
    { ...product, id: 'legacy-parts', code: 'HYDRAULICS', category: '原版 9 类模型', subcategory: '液压核心部件', modelKey: 'hydraulics', exhibitOnly: true },
    { ...product, id: 'legacy-excavator', code: 'TEACH-EX', category: '原版 9 类模型', subcategory: '原版挖掘教学', modelKey: 'excavator', exhibitOnly: true }
  ];
}
function gridIds(app) {
  return [...app.html('productGrid').matchAll(/data-action="product" data-id="([^"]+)"/g)].map(match => match[1]);
}
function gridBuyIds(app) {
  return [...app.html('productGrid').matchAll(/data-action="buy" data-id="([^"]+)"/g)].map(match => match[1]);
}
test('目录回归：旧教学占位卡不混入商品，所有可见商品都有租购入口', async () => {
  const products = browsingFixture(), original = clone(products);
  const app = await harness({ fixture: { products, orders: [], tickets: [], users: [] } });
  assert.deepEqual(gridIds(app), ['official-excavator', 'official-crane', 'plain-small']);
  assert.deepEqual(gridBuyIds(app), gridIds(app));
  assert.doesNotMatch(app.html('productGrid'), /legacy-parts|legacy-excavator|查看 3D 与作业/);
  assert.match(app.nodes.get('resultCount').textContent, /有 3D 优先/);
  await app.change('', 'catalog', 'catalogSort');
  assert.deepEqual(gridIds(app), ['plain-small', 'official-excavator', 'official-crane']);
  assert.deepEqual(gridBuyIds(app), gridIds(app));
  assert.match(app.nodes.get('resultCount').textContent, /原目录顺序/);
  await app.change('', 'model', 'catalogSort');
  assert.equal(gridIds(app)[0], 'official-excavator');
  assert.deepEqual(app.fixture.products, original);
  assert.equal(app.requests.every(request => request.method === 'GET'), true);
  assert.deepEqual(app.fixture.orders, []); assert.deepEqual(app.fixture.tickets, []); assert.deepEqual(app.fixture.users, []);
});
test('大类导航：官方分类与子类联动，切换大类和重置均清除旧筛选，模型入口独立可用', async () => {
  const app = await harness({ fixture: { products: browsingFixture() } });
  assert.match(app.html('categoryChips'), /挖掘类/);
  assert.doesNotMatch(app.html('categoryChips'), /零件类/);
  await app.click('browse-group', { group: 'excavation' });
  assert.deepEqual(gridIds(app), ['official-excavator', 'plain-small']);
  assert.match(app.html('categoryFilter'), /土石方机械/);
  assert.doesNotMatch(app.html('categoryFilter'), /起重机/);
  assert.equal(app.actions('browse-group').find(chip => chip.dataset.group === 'excavation').getAttribute('aria-pressed'), 'true');
  await app.change('', '土石方机械', 'categoryFilter');
  assert.doesNotMatch(app.html('subcategoryFilter'), /原版挖掘教学/);
  await app.change('', '小型挖掘机', 'subcategoryFilter');
  assert.deepEqual(gridIds(app), ['plain-small']);
  await app.input('catalogSearch', '不存在的设备');
  assert.match(app.html('productGrid'), /没有找到对应设备/);
  await app.click('browse-group', { group: 'lifting' });
  assert.equal(app.nodes.get('catalogSearch').value, '');
  assert.deepEqual(gridIds(app), ['official-crane']);
  assert.doesNotMatch(app.html('categoryFilter'), /土石方机械/);
  assert.doesNotMatch(app.html('subcategoryFilter'), /小型挖掘机/);
  await app.change('', 'catalog', 'catalogSort');
  await app.input('catalogSearch', '仍然无结果');
  await app.click('reset-filters');
  assert.equal(gridIds(app).length, 3);
  assert.equal(gridIds(app)[0], 'official-excavator');
  assert.match(app.nodes.get('resultCount').textContent, /全部装备.*有 3D 优先.*第 1 \/ 1 页/);
  assert.equal(app.actions('browse-group').find(chip => chip.dataset.group === '').getAttribute('aria-pressed'), 'true');
  await app.click('browse-group', { group: 'lifting' });
  await app.click('models');
  assert.deepEqual(gridIds(app), ['official-excavator', 'official-crane']);
  assert.deepEqual(gridBuyIds(app), gridIds(app));
  assert.match(app.nodes.get('resultCount').textContent, /全部装备.*可租购 3D 设备/);
});
test('首屏轮播：只展示可租购商品，上一款下一款圆点及键盘打开正确设备', async () => {
  const app = await harness({ fixture: { products: browsingFixture() } });
  assert.equal(app.actions('hero-dot').length, 2);
  assert.match(app.html('heroSlide'), /MODEL-EX/);
  assert.doesNotMatch(app.html('heroSlide'), /TEACH-EX|HYDRAULICS/);
  assert.equal(app.timerCount(6000), 1);
  await app.click('hero-next');
  assert.match(app.html('heroSlide'), /MODEL-CR/);
  assert.equal(app.actions('hero-dot').find(dot => dot.dataset.index === '1').getAttribute('aria-current'), 'true');
  const target = app.actions('hero-open').at(-1);
  assert.equal(target.dataset.id, 'official-crane');
  await app.click('hero-open', { id: target.dataset.id });
  assert.match(app.html('modalContent'), /MODEL-CR/);
  assert.equal(app.modelCalls.at(-1), 'crane');
  assert.equal(app.timerCount(6000), 0);
  await app.click('close');
  assert.equal(app.timerCount(6000), 1);
  await app.click('hero-prev');
  assert.match(app.html('heroSlide'), /MODEL-EX/);
  await app.click('hero-prev');
  assert.match(app.html('heroSlide'), /MODEL-CR/);
  await app.click('hero-dot', { index: '0' });
  assert.match(app.html('heroSlide'), /MODEL-EX/);
  assert.equal(await app.event('keydown', 'heroCarousel', { key: 'End' }), true);
  assert.match(app.html('heroSlide'), /MODEL-CR/);
  assert.equal(await app.event('keydown', 'heroCarousel', { key: 'Home' }), true);
  assert.match(app.html('heroSlide'), /MODEL-EX/);
  await app.tickTimer(6000);
  assert.match(app.html('heroSlide'), /MODEL-CR/);
  assert.equal(app.timerCount(6000), 1);
});
test('轮播体验：移除暂停按钮，空格锁定、悬停、键盘焦点、隐藏页面和离开目录时停止自动播放', async () => {
  const app = await harness({ fixture: { products: browsingFixture() } });
  assert.equal(app.actions('hero-pause').length, 0);
  assert.equal(app.nodes.has('heroPause'), false);
  await app.event('keydown', 'heroCarousel', { key: ' ' });
  assert.equal(app.timerCount(6000), 0);
  assert.equal(app.nodes.get('heroCarousel').dataset.playback, 'paused');
  await app.event('keydown', 'heroCarousel', { key: ' ' });
  assert.equal(app.timerCount(6000), 1);
  await app.event('pointerover', 'heroCarousel');
  assert.equal(app.timerCount(6000), 0);
  await app.event('pointerout', 'heroCarousel');
  assert.equal(app.timerCount(6000), 1);
  await app.event('focusin', 'heroCarousel');
  assert.equal(app.timerCount(6000), 0);
  await app.event('focusout', 'heroCarousel');
  assert.equal(app.timerCount(6000), 1);
  await app.visibility(true);
  assert.equal(app.timerCount(6000), 0);
  await app.visibility(false);
  assert.equal(app.timerCount(6000), 1);
  await app.navigate('#customer');
  assert.equal(app.timerCount(6000), 0);
  const reduced = await harness({ reducedMotion: true, fixture: { products: browsingFixture() } });
  assert.equal(reduced.timerCount(6000), 0);
  assert.equal(reduced.nodes.get('heroCarousel').dataset.playback, 'paused');
});
test('轮播边界：空目录没有失效轮播按钮，无模型产品回退展示且单张不自动播放', async () => {
  const empty = await harness({ fixture: { products: [] } });
  assert.match(empty.html('main'), /暂无上架设备/);
  assert.equal(empty.actions('hero-open').length, 0);
  assert.equal(empty.actions('hero-next').length, 0);
  assert.equal(empty.actions('hero-dot').length, 0);
  assert.equal(empty.timerCount(6000), 0);
  const single = await harness();
  assert.match(single.html('heroSlide'), /SY-TEST/);
  assert.match(single.html('heroSlide'), /查看设备/);
  assert.doesNotMatch(single.html('heroSlide'), /可体验 3D 作业/);
  assert.equal(single.actions('hero-next')[0].disabled, true);
  assert.equal(single.actions('hero-prev')[0].disabled, true);
  assert.equal(single.timerCount(6000), 0);
});

test('3.2 订单资料：Word 文件随租购提交，危险后缀在读取前拦截', async () => {
  const app = await harness();
  await app.click('buy', { id: product.id });
  assert.match(app.html('modalContent'), /工程资料 \/ 需求文件/);
  assert.match(app.html('modalContent'), /\.docx/);
  const payload = { mode: 'buy', quantity: '1', contact: '测试', phone: '13800000000', addressProvince: '430000', addressCity: '430100', addressCounty: '430102', addressDetail: '测试路 3 号', date: '2099-01-01', plan: '待商议', notes: '' };
  await app.submit('purchase', payload, { dataset: { product: product.id }, materialFiles: [{ ...photo, name: '需求说明.docx' }] });
  const request = app.requests.find(item => item.path === '/api/orders' && item.method === 'POST');
  assert.deepEqual(request.body.files, [{ name: '需求说明.docx', data: photo.data }]);
  const count = app.requests.filter(item => item.path === '/api/orders' && item.method === 'POST').length;
  const invalid = await app.submit('purchase', payload, { dataset: { product: product.id }, materialFiles: [{ ...photo, name: '资料.exe' }] });
  assert.match(invalid.error.textContent, /请使用 .docx/);
  assert.equal(app.requests.filter(item => item.path === '/api/orders' && item.method === 'POST').length, count);
});

test('3.2 参考价：未报价不造数，有来源价格显示和后台数值传递一致', async () => {
  const price = { buyMin: 300000, buyMax: 350000, rentMonthlyMin: 9000, rentMonthlyMax: 12000, source: '测试报价单 <非官方>', updatedAt: '2026-10-20T10:00:00Z' };
  const customer = await harness({ fixture: { products: [{ ...product, referencePrice: price }] } });
  assert.match(customer.html('productGrid'), /300,000–350,000/);
  await customer.click('product', { id: product.id });
  assert.match(customer.html('modalContent'), /测试报价单 &lt;非官方&gt;/);
  const emptyPrice = await harness();
  assert.match(emptyPrice.html('productGrid'), /待询价/);
  assert.doesNotMatch(emptyPrice.html('productGrid'), /¥ 0/);
  const admin = await harness({ route: '#admin', role: 'admin' });
  await admin.click('edit-product', { id: product.id });
  assert.match(admin.html('modalContent'), /价格来源与适用配置/);
  await admin.submit('product-edit', { ...product, published: 'true', specText: '', buyMin: '300000', buyMax: '350000', rentMonthlyMin: '', rentMonthlyMax: '', priceSource: '测试报价单' }, { dataset: { id: product.id } });
  const request = admin.requests.find(item => item.path === '/api/admin/products' && item.method === 'PATCH');
  assert.deepEqual(request.body.referencePrice, { buyMin: 300000, buyMax: 350000, rentMonthlyMin: null, rentMonthlyMax: null, source: '测试报价单' });
});

test('3.2 加密链接与客服：主界面展示编号、不渲染密钥，链接解析与会话绑定正确', async () => {
  const app = await harness({ projectBridge: true, respond: request => request.path === '/api/orders' && request.method === 'POST'
    ? { result: { order: { ...orderFixture(), number: 'SO-20261020-TEST' }, accessCode: 'old-code', accessKey: 'encrypted-test-key', token: 'GUEST-token' } } : null });
  await app.submit('purchase', { mode: 'buy', quantity: '1', notes: '', addressProvince: '430000', addressCity: '430100', addressCounty: '430102', addressDetail: '测试路 3 号' }, { dataset: { product: product.id } });
  assert.match(app.html('modalContent'), /SO-20261020-TEST/);
  assert.doesNotMatch(app.html('modalContent'), /encrypted-test-key/);
  await app.click('copy-order-link');
  assert.equal(app.clipboard[0], 'http://127.0.0.1:8790/?workspace=customer#receipt=encrypted-test-key');
  await app.click('receipt-chat', { id: 'SO-test' });
  assert.deepEqual(clone(app.projectCalls.at(-1)), { name: 'openChat', args: ['order', 'SO-test', 'GUEST-token', true] });
  await app.submit('access-link', { accessLink: 'http://127.0.0.1:8790/?workspace=customer#receipt=encrypted-test-key' });
  assert.deepEqual(clone(app.projectCalls.at(-1)), { name: 'handleAccessLink', args: ['encrypted-test-key'] });
  const link = await harness({ route: '#receipt=encrypted-test-key', projectBridge: true });
  assert.equal(link.location.hash, '#customer');
  assert.ok(link.projectCalls.some(call => call.name === 'handleAccessLink' && call.args[0] === 'encrypted-test-key'));
});

test('3.2 独立客户窗口：即使已有员工存储也不读取后台身份', async () => {
  const client = await harness({ search: '?workspace=customer', role: 'admin', route: '#work', projectBridge: true });
  assert.match(client.html('main'), /这是客户窗口/);
  assert.ok(!client.requests.some(request => ['/api/me', '/api/stats', '/api/orders', '/api/admin/users'].includes(request.path)));
  assert.match(client.html('identity'), /客户窗口/);
  assert.doesNotMatch(client.html('identity'), /admin 测试人员/);
  await client.navigate('#projects');
  assert.ok(client.projectCalls.some(call => call.name === 'renderProjectPage'));
});

test('3.2.1 电话入口只需号码，同号订单可选并使用单单令牌联系客服', async () => {
  const app = await harness({ route: '#customer', projectBridge: true });
  const form = app.html('main').match(/<form data-form="phone-lookup">([\s\S]*?)<\/form>/)[1];
  assert.match(form, /name="phone"/);
  assert.doesNotMatch(form, /name="(?:code|orderId|accessLink)"/);
  assert.match(app.html('main'), /未接入短信验证码/);
  await app.submit('phone-lookup', { phone: ' 13800000000 ' });
  assert.deepEqual(app.requests.find(request => request.path === '/api/guest/phone-orders').body, { phone: '13800000000' });
  assert.match(app.html('phoneOrderResults'), /找到 1 笔订单/);
  assert.match(app.html('phoneOrderResults'), /SO-test/);
  await app.click('phone-order', { id: 'SO-test' });
  assert.deepEqual(app.requests.find(request => request.path === '/api/guest/phone-order').body, { phone: '13800000000', orderId: 'SO-test' });
  assert.ok(app.requests.some(request => request.path === '/api/orders/SO-test' && request.token === 'Bearer PHONE-token'));
  await app.click('order-chat');
  assert.deepEqual(clone(app.projectCalls.at(-1)), { name: 'openChat', args: ['order', 'SO-test', 'PHONE-token', true] });
});

test('3.2.1 改号码清空结果，空结果和请求失败不保留上次订单', async () => {
  let mode = 'found';
  const app = await harness({ route: '#customer', respond: request => request.path !== '/api/guest/phone-orders' ? null :
    mode === 'empty' ? { result: { orders: [] } } : mode === 'fail' ? { status: 429, result: { error: '电话查询过于频繁，请稍后再试。' } } : null });
  await app.submit('phone-lookup', { phone: '13800000000' });
  await app.input('orderLookupPhone', '13800000001');
  assert.equal(app.html('phoneOrderResults'), '');
  await app.click('phone-order', { id: 'SO-test' });
  assert.ok(!app.requests.some(request => request.path === '/api/guest/phone-order'));
  mode = 'empty'; await app.submit('phone-lookup', { phone: '13800000001' });
  assert.match(app.html('phoneOrderResults'), /没有找到对应订单/);
  mode = 'fail'; const result = await app.submit('phone-lookup', { phone: '13800000001' });
  assert.equal(app.html('phoneOrderResults'), '');
  assert.match(result.error.textContent, /过于频繁/);
  assert.equal(result.submit.disabled, false);
});

test('3.2.1 查询期间改号或离开页面，迟到列表不能恢复旧结果', async () => {
  for (const action of ['edit', 'leave']) {
    let resolveRequest, started;
    const ready = new Promise(resolve => { started = resolve; });
    const app = await harness({ route: '#customer', respond: request => request.path === '/api/guest/phone-orders' ?
      new Promise(resolve => { resolveRequest = resolve; started(); }) : null });
    const pending = app.submit('phone-lookup', { phone: '13800000000' });
    await ready;
    if (action === 'edit') await app.input('orderLookupPhone', '13800000001');
    else await app.navigate('#catalog');
    resolveRequest({ result: { orders: [orderFixture()] } });
    await pending;
    assert.equal(app.html('phoneOrderResults'), '');
    await app.click('phone-order', { id: 'SO-test' });
    assert.ok(!app.requests.some(request => request.path === '/api/guest/phone-order'));
  }
});

test('3.2.1 打开电话订单期间离开页面，迟到令牌不能弹出详情', async () => {
  let resolveRequest, started;
  const ready = new Promise(resolve => { started = resolve; });
  const app = await harness({ route: '#customer', respond: request => request.path === '/api/guest/phone-order' ?
    new Promise(resolve => { resolveRequest = resolve; started(); }) : null });
  await app.submit('phone-lookup', { phone: '13800000000' });
  const pending = app.click('phone-order', { id: 'SO-test' });
  await ready; await app.navigate('#catalog');
  resolveRequest({ result: { order: orderFixture(), token: 'LATE-token' } });
  await pending;
  assert.equal(app.nodes.get('modal').open, false);
  assert.ok(!app.requests.some(request => request.token === 'Bearer LATE-token'));
});

test('3.4.3 退出立即回登录：慢注销不阻塞清凭证，重进工作和管理入口仍需登录', async () => {
  let finishLogout;
  const app = await harness({ route: '#work', search: '?workspace=staff', role: 'service', respond: request => request.path === '/api/logout' ? new Promise(resolve => { finishLogout = resolve; }) : null });
  const pending = app.click('logout');
  await app.settle();
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.equal(app.location.hash, '#work');
  assert.match(app.html('main'), /登录服务工作区/);
  assert.doesNotMatch(app.html('main'), /今日工作概览|测试客户/);
  await app.navigate('#admin');
  assert.match(app.html('main'), /登录服务工作区/);
  await app.navigate('#work');
  assert.match(app.html('main'), /登录服务工作区/);
  finishLogout({ result: { ok: true } }); await pending;
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.match(app.html('main'), /登录服务工作区/);
});

test('3.4.3 退出使迟到订单详情失效，不重新打开包含客户资料的弹窗', async () => {
  let finishOrder;
  const app = await harness({ route: '#work', role: 'service', respond: request => request.path === '/api/orders/SO-test' ? new Promise(resolve => { finishOrder = resolve; }) : null });
  const pending = app.click('staff-order', { id: 'SO-test' });
  await app.settle(); await app.click('logout');
  finishOrder({ result: { order: orderFixture(), tickets: [ticketFixture()] } }); await pending;
  assert.equal(app.nodes.get('modal').open, false);
  assert.equal(app.html('modalContent'), '');
  assert.match(app.html('main'), /登录服务工作区/);
});

test('3.4.3 重新切入工作人员窗口复核真实会话，服务端撤销后清空工作区', async () => {
  let expired = false;
  const app = await harness({ route: '#work', role: 'admin', respond: request => expired && request.path === '/api/me' ? { status: 401, result: { error: '会话已撤销' } } : null });
  assert.equal(await app.window.SanyStaffSession.ensure(), true);
  expired = true;
  assert.equal(await app.window.SanyStaffSession.ensure(), false);
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.match(app.html('main'), /登录服务工作区/);
  assert.doesNotMatch(app.html('main'), /今日工作概览|测试客户/);
  const customer = await harness({ route: '#catalog', search: '?workspace=customer', role: 'admin' });
  assert.equal(await customer.window.SanyStaffSession.ensure(), false);
  assert.equal(customer.location.hash, '#catalog');
  assert.ok(!customer.requests.some(request => request.path === '/api/me'));
});

test('3.4.3 会话校验并发合并，校验途中退出后迟到身份不能重新登录', async () => {
  let hold = false, finishCheck;
  const app = await harness({ route: '#work', role: 'service', respond: request => hold && request.path === '/api/me' ? new Promise(resolve => { finishCheck = resolve; }) : null });
  hold = true;
  const before = app.requests.filter(request => request.path === '/api/me').length;
  const first = app.window.SanyStaffSession.ensure(), second = app.window.SanyStaffSession.ensure();
  await app.settle();
  assert.equal(app.requests.filter(request => request.path === '/api/me').length, before + 1);
  await app.click('logout');
  finishCheck({ result: { user: actor('service') } });
  assert.equal(await first, false); assert.equal(await second, false);
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.match(app.html('main'), /登录服务工作区/);
});

test('3.4.3 会话校验超时回登录，超时后的成功响应不能恢复旧身份', async () => {
  let hold = false, finishCheck;
  const app = await harness({ route: '#work', role: 'service', respond: request => hold && request.path === '/api/me' ? new Promise(resolve => { finishCheck = resolve; }) : null });
  hold = true;
  const pending = app.window.SanyStaffSession.ensure(); await app.settle();
  await app.tickTimer(3500);
  assert.equal(await pending, false);
  assert.match(app.html('main'), /登录服务工作区/);
  finishCheck({ result: { user: actor('service') } }); await app.settle();
  assert.equal(app.sessionStorage.getItem('sany-staff'), null);
  assert.doesNotMatch(app.html('identity'), /service 测试人员/);
});

test('3.4.3 轮播补查实际悬停，并在双窗口退场期间暂停、恢复后重计时', async () => {
  const app = await harness({ fixture: { products: browsingFixture() } });
  const hero = app.nodes.get('heroCarousel');
  hero.hovered = true;
  await app.visibility(false);
  assert.equal(app.timerCount(6000), 0);
  assert.equal(hero.dataset.playback, 'paused');
  hero.hovered = false; await app.event('pointerout', 'heroCarousel');
  assert.equal(app.timerCount(6000), 1);
  await app.event('sany:workspace-transition', 'heroCarousel');
  assert.equal(app.timerCount(6000), 0);
  await app.event('sany:workspace-ready', 'heroCarousel');
  assert.equal(app.timerCount(6000), 1);
});

test('3.4.3 首屏开屏绘制期间预取数据但不铺设目录，绘制完成或关闭后释放且移除监听', async () => {
  for (const event of ['sany:boot-assembled', 'sany:boot-close']) {
    const app = await harness({ bootOpen: true });
    assert.ok(app.requests.some(request => request.path === '/api/products'));
    assert.equal(app.nodes.has('productGrid'), false);
    assert.equal(app.timerCount(3000), 1);
    await app.event(event, 'bootScreen');
    assert.match(app.html('productGrid'), /SY-TEST/);
    assert.equal(app.timerCount(3000), 0);
    assert.equal(app.hasListener('sany:boot-assembled'), false);
    assert.equal(app.hasListener('sany:boot-close'), false);
  }
});

test('3.4.3 开屏等待路由被新页面取代后，只提交最新内容，不遗留计时器或监听', async () => {
  const app = await harness({ bootOpen: true });
  await app.navigate('#customer');
  assert.equal(app.timerCount(3000), 1);
  await app.event('sany:boot-assembled', 'bootScreen');
  assert.equal(app.nodes.has('productGrid'), false);
  assert.match(app.html('main'), /orderLookupPhone/);
  assert.equal(app.timerCount(3000), 0);
  assert.equal(app.hasListener('sany:boot-assembled'), false);
});

test('3.4.3 开屏缺失事件三秒兜底，已完成、后台与减少动态均不阻塞路由', async () => {
  const fallback = await harness({ bootOpen: true });
  await fallback.tickTimer(3000);
  assert.match(fallback.html('productGrid'), /SY-TEST/);
  assert.equal(fallback.hasListener('sany:boot-close'), false);
  for (const settings of [{}, { bootOpen: true, bootComplete: true }, { bootOpen: true, hidden: true }, { bootOpen: true, reducedMotion: true }]) {
    const app = await harness(settings);
    assert.match(app.html('productGrid'), /SY-TEST/);
    assert.equal(app.timerCount(3000), 0);
    assert.equal(app.hasListener('sany:boot-assembled'), false);
  }
});

test('售中订单类型筛选与状态条件组合', async () => {
  const orders = [
    { ...orderFixture(), id: 'SO-buy-check', mode: 'buy' },
    { ...orderFixture(), id: 'SO-rent-check', mode: 'rent', duration: 6 },
    { ...orderFixture(), id: 'SO-rent-delivered', mode: 'rent', duration: 12, status: 'delivered' }
  ];
  const app = await harness({ route: '#work', role: 'service', fixture: { orders } });
  await app.click('work-tab', { tab: 'orders' });
  assert.match(app.html('workList'), /订单类型/);
  await app.click('work-order-mode', { mode: 'buy' });
  assert.match(app.html('workList'), /SO-buy-check/);
  assert.doesNotMatch(app.html('workList'), /SO-rent-/);
  await app.click('work-order-mode', { mode: 'rent' });
  assert.match(app.html('workList'), /租期 6 个月/);
  assert.doesNotMatch(app.html('workList'), /SO-buy-check/);
  await app.click('work-filter', { filter: 'delivered' });
  assert.match(app.html('workList'), /SO-rent-delivered/);
  assert.doesNotMatch(app.html('workList'), /SO-rent-check/);
});
