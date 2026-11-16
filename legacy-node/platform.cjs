'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { isDocx } = require('./document-files.cjs');
const { createProjectService, referencePrice } = require('./project-service.cjs');
const { createCustomerService } = require('./customer-service.cjs');
const { createFollowupService } = require('./followup-service.cjs');
const { createAdminTools } = require('./admin-tools.cjs');
const {createNumbering}=require('./document-numbering.cjs');
const VERSION = '3.5.0';
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function text(value, max = 200, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('请完整填写必填内容，并检查长度。');
  return value.trim();
}
function integer(value, min, max) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) fail('数字超出允许范围。'); return n; }
function phone(value) { const v = text(value, 30); if (!/^[+\d()\s-]{6,30}$/.test(v) || v.replace(/\D/g, '').length < 6) fail('请填写有效联系电话。'); return v; }
/* 只统一书写格式，不做尾号或模糊匹配；大陆手机号的 +86 / 0086 与国内写法等价，座机保留区号。 */
function phoneKey(value) { return String(value || '').replace(/[()\s-]/g, '').replace(/^(?:\+?86|0086)(1[3-9]\d{9})$/, '$1'); }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('日期无效。');
  return value;
}
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  text(password, 200);
  if (password.length < 10) fail('密码至少 10 位。');
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [salt, digest] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 32), Buffer.from(digest, 'hex'));
}
function descriptor(input) {
  if (!Array.isArray(input) || input.length !== 128 || input.some(n => !Number.isFinite(n) || Math.abs(n) > 3)) fail('人脸特征无效，请重新识别。');
  return input;
}
const distance = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
const roles = ['admin', 'service', 'reviewer'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream' };

function createPlatform(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const dataDir = options.dataDir || process.env.SANY_PLATFORM_DATA || path.join(process.env.APPDATA || root, 'sany-forge-platform');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner_kind TEXT, owner_id TEXT, name TEXT, mime TEXT, bytes BLOB, created_at TEXT);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, at TEXT, detail TEXT);`);
  const get = (kind, key) => { const r = db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, key); return r ? JSON.parse(r.body) : null; };
  const all = kind => db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(r => JSON.parse(r.body));
  const put = (kind, value) => db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value));
  const audit = (actor, action, target, detail = '') => db.prepare('INSERT INTO audit(actor,action,target,at,detail) VALUES(?,?,?,?,?)').run(actor, action, target, now(), detail);
  function atomic(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  const documentNumber=createNumbering(db);
  const keyPath = path.join(dataDir, 'face.key');
  /* 网页与软件可能同时启动；只允许首次创建密钥，竞争失败时读取已创建的那份，绝不覆盖。 */
  try { fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const faceKey = fs.readFileSync(keyPath);
  if (faceKey.length !== 32) throw new Error('本机人脸密钥损坏，请保留数据目录并联系维护人员。');
  function encrypt(data) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', faceKey, iv); const content = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]); return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${content.toString('base64')}`; }
  function decrypt(value) { const [iv, tag, content] = value.split(':'); const decipher = crypto.createDecipheriv('aes-256-gcm', faceKey, Buffer.from(iv, 'hex')); decipher.setAuthTag(Buffer.from(tag, 'hex')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(content, 'base64')), decipher.final()]).toString()); }
  const sessions = new Map(), challenges = new Map(), failures = new Map();
  let phoneQueries = { count: 0, until: 0 };
  /* 手机号不等于身份验证：此入口仅用于回环地址上的参赛演示。
   * 限制连续查询只用于防止误操作或批量枚举，不能替代上线前的短信/客户身份验证。 */
  function checkPhoneQuery() {
    if (phoneQueries.until <= Date.now()) phoneQueries = { count: 0, until: Date.now() + 60_000 };
    if (++phoneQueries.count > 60) fail('电话查询过于频繁，请稍后再试。', 429);
  }
  /* 密码、停用和人脸重置都要撤销既有会话与待验证挑战，避免旧挑战继续换取权限。 */
  function revokeUser(userId) {
    for (const [token, item] of sessions) if (item.userId === userId) sessions.delete(token);
    for (const [token, item] of challenges) if (item.userId === userId) challenges.delete(token);
  }
  function expireMemory() {
    const time = Date.now();
    for (const collection of [sessions, challenges]) for (const [token, item] of collection) if (item.expires <= time) collection.delete(token);
    for (const [username, item] of failures) if (item.until <= time) failures.delete(username);
  }
  const publicUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, active: user.active, faceEnrolled: !!user.face, capabilities: adminTools.capabilities(user.role), createdAt: user.createdAt });
  function sessionFor(user, enrollOnly = false) { const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id, enrollOnly, expires: Date.now() + 8 * 3600_000 }); return { token, user: publicUser(user), enrollOnly }; }
  function guestSession(recordId, kind = 'order') { const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { [kind === 'project' ? 'projectId' : 'orderId']: recordId, expires: Date.now() + 8 * 3600_000 }); return token; }
  function auth(req, allowed, allowEnroll = false) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { sessions.delete(token); fail('请先登录，或使用订单查询凭证。', 401); }
    if (session.orderId || session.projectId) { if (allowed) fail('没有此操作权限。', 403); return { ...session, actor: '客户' }; }
    const user = get('user', session.userId);
    if (!user?.active || (session.enrollOnly && !allowEnroll)) fail('请先完成人脸录入与验证。', 403);
    if (allowed && !allowed.includes(user.role)) fail('当前账号没有此操作权限。', 403);
    adminTools.enforce(req,user);
    return { ...session, user, actor: user.name };
  }
  function ownOrder(req, orderId) { const access = auth(req); if (access.projectId || (access.orderId && access.orderId !== orderId)) fail('不能访问其他订单。', 403); return access; }
  function cleanOrder(order) { const { secretHash, ...rest } = order; return rest; }
  function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(path.join(root, 'dist', file), 'utf8')); } catch { return fallback; } }
  function products() {
    const catalog = loadJson('catalog.json', { products: [] });
    const legacy = loadJson('legacy-models.json', []);
    const source = Array.isArray(catalog) ? catalog : catalog.products || [];
    const normalizeCode = value => String(value || '').replace(/\s+/g, '').toUpperCase();
    const models = new Map(legacy.map(p => [normalizeCode(p.code), p.modelKey]));
    const map = new Map([...source.map(p => ({ ...p, modelKey: models.get(normalizeCode(p.code)) || null })), ...legacy]
      .map(p => [String(p.id), { ...p, published: true, deleted: false, custom: false }]));
    for (const override of all('product')) map.set(override.id, { ...map.get(override.id), ...override });
    return [...map.values()];
  }
  const publicProducts = () => products().filter(p => p.published && !p.deleted);
  function addFiles(incoming, kind, ownerId, required = true) {
    if (!Array.isArray(incoming) || incoming.length > 4 || (required && !incoming.length)) fail('此状态变更需要提交材料，最多 4 个文件。');
    return incoming.map(file => {
      if (!file || typeof file !== 'object' || Array.isArray(file)) fail('材料文件格式无效。');
      const name = text(file.name, 150);
      /* 下载会保留原文件名，所以必须同时限制 Windows 文件名与后缀。
       * 仅验证魔数会让“图片内容 + .html/.docm 名称”被错误交给浏览器或宏文档程序打开。 */
      if (/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) fail('文件名不能包含路径、控制字符或系统保留名称。');
      const fileTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      const expectedMime = fileTypes[path.extname(name).toLowerCase()];
      if (!expectedMime) fail('文件扩展名仅支持 .docx、.pdf、.jpg、.jpeg、.png 或 .webp。');
      if (typeof file.data !== 'string' || file.data.length > 5_600_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) fail('材料文件无效或超过 4 MB。');
      const bytes = Buffer.from(file.data, 'base64');
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) fail('每份材料限 4 MB。');
      let mime;
      if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
      else if (bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
      else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
      else if (isDocx(bytes, name)) mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else fail('请上传 JPG、PNG、WebP、PDF 或有效的 DOCX 文档；不支持旧 DOC、宏文档及普通压缩包。');
      if (mime !== expectedMime) fail('文件内容与扩展名不一致，请使用原始文件，勿直接修改后缀。');
      const fileId = id('MAT');
      db.prepare('INSERT INTO files(id,owner_kind,owner_id,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?)').run(fileId, kind, ownerId, name, mime, bytes, now());
      return { id: fileId, name, mime, size: bytes.length, at: now() };
    });
  }
  function transition(record, status, access, note, files, extra = {}) {
    const event = { id: id('EV'), from: record.status, to: status, actor: access.actor, actorId: access.user?.id || 'customer', role: access.user?.role || 'customer', note, files, at: now() };
    return { ...record, ...extra, status, revision: record.revision + 1, updatedAt: now(), history: [...record.history, event] };
  }
  function revision(record, body) { if (record.revision !== body.revision) fail('记录已被更新，请刷新后再操作。', 409); }
  function challenge(user, enroll) {
    const token = crypto.randomBytes(24).toString('hex');
    const turns = crypto.randomInt(2) ? ['left', 'right'] : ['right', 'left'];
    challenges.set(token, { userId: user.id, authVersion: user.authVersion || 0, enroll, turns, expires: Date.now() + 120_000 });
    return { challenge: token, turns, enroll, expiresIn: 120, user: publicUser(user) };
  }
  function checkFaceProof(body, item) {
    if (!Array.isArray(body.samples) || body.samples.length !== 3) fail('请按提示完成正面及两次转头采集。');
    const samples = body.samples.map(sample => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) fail('人脸采集格式无效。');
      return { vector: descriptor(sample.descriptor), yaw: Number(sample.yaw) };
    });
    if (samples.some(s => !Number.isFinite(s.yaw)) || Math.abs(samples[0].yaw) > .14) fail('正面采集不合格，请重新识别。');
    item.turns.forEach((turn, index) => {
      const yaw = samples[index + 1].yaw;
      if ((turn === 'left' && yaw > -.17) || (turn === 'right' && yaw < .17)) fail('转头动作未完成，请重新识别。');
      if (distance(samples[0].vector, samples[index + 1].vector) > .5) fail('采集期间检测到身份不一致。');
    });
    return samples[0].vector;
  }
  const projectService = createProjectService({ documentNumber, get, all, put, atomic, audit, auth, guestSession, publicProducts, addFiles, transition, revision, fail, text, integer, phone, phoneKey, checkPhoneQuery, hash, now, id, faceKey, getCustomer: req => customerService.customer(req), customerType: value => customerService.customerType(value) });
  const customerService = createCustomerService({get,all,put,atomic,audit,auth,fail,text,phoneKey,passwordHash,verifyPassword,now,id,receipt: projectService.receipt});
  const followupService = createFollowupService({ documentNumber, get, all, put, atomic, audit, auth, fail, text, now, id, revision, hash });
  const adminTools=createAdminTools({db,dataDir,get,put,auth,atomic,audit,fail,now,revoke:()=>{sessions.clear();challenges.clear();customerService.revokeAll();}});
  async function route(req, res, url, body) {
    const p = url.pathname;
    const toolResult=await adminTools.route(req,url,body);if(toolResult!==undefined)return toolResult;
    const customerResult = await customerService.route(req, url, body);
    if (customerResult !== undefined) return customerResult;
    const followupResult = await followupService.route(req, url, body);
    if (followupResult !== undefined) return followupResult;
    const projectResult = await projectService.route(req, url, body);
    if (projectResult !== undefined) return projectResult;
    if (p === '/api/health') return { ok: true, app: 'sany-service-platform', version: VERSION, storage: 'sqlite' };
    if (p === '/api/bootstrap') return { version: VERSION, setupNeeded: !all('user').length, catalog: loadJson('catalog-audit.json', {}), roles };
    if (p === '/api/products' && req.method === 'GET') return { products: publicProducts() };
    if (p === '/api/setup' && req.method === 'POST') return atomic(() => {
      if (all('user').length) fail('管理账号已经初始化。', 409);
      const username = text(body.username, 40); if (!/^[\w.-]{3,40}$/.test(username)) fail('账号使用 3–40 位字母、数字、下划线或点。');
      const user = { id: id('USR'), username, name: text(body.name, 40), password: passwordHash(body.password), role: 'admin', active: true, face: null, createdAt: now() };
      put('user', user); audit(user.name, '创建首位管理员', user.id);
      return challenge(user, true);
    });
    /* 自由注册（本机演示）：任何访客可直接创建账号并立即登录，无需人脸录入。 */
    if (p === '/api/register' && req.method === 'POST') return atomic(() => {
      const username = text(body.username, 40);
      if (!/^[\w.-]{3,40}$/.test(username)) fail('账号使用 3–40 位字母、数字、下划线或点。');
      if (body.password !== body.repeat) fail('两次输入的密码不一致。');
      if (all('user').some(u => u.username === username)) fail('该账号已被注册，请换一个账号名。', 409);
      const role = roles.includes(body.role) ? body.role : 'service';
      const user = { id: id('USR'), username, name: text(body.name, 40), password: passwordHash(body.password), role, active: true, face: null, createdAt: now() };
      put('user', user); audit(user.name, '自由注册（本机演示）', user.id);
      return sessionFor(user);
    });
    if (p === '/api/login' && req.method === 'POST') {
      const username = text(body.username, 40);
      const attempt = failures.get(username);
      if (attempt && attempt.until > Date.now() && attempt.count >= 5) fail('连续失败过多，请 5 分钟后再试。', 429);
      const user = all('user').find(u => u.username === username);
      if (!user?.active || !verifyPassword(body.password, user.password)) {
        failures.set(username, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 300_000 });
        fail('账号或密码不正确。', 401);
      }
      failures.delete(username);
      /* 未录入人脸的账号（含自由注册账号）直接发会话，跳过人脸核验，方便演示。 */
      if (!user.face) { audit(user.name, '账号密码验证通过（未录入人脸，免核验）', user.id); return sessionFor(user); }
      return challenge(user, !user.face);
    }
    if (p === '/api/face/verify' && req.method === 'POST') {
      const item = challenges.get(body.challenge);
      challenges.delete(body.challenge);
      if (!item || item.expires < Date.now()) fail('识别挑战已失效，请重新输入账号密码。', 401);
      const user = get('user', item.userId);
      if (!user?.active) fail('账号不可用。', 403);
      if ((user.authVersion || 0) !== item.authVersion || item.enroll !== !user.face) fail('账号验证信息已更新，请重新输入账号密码。', 401);
      const vector = checkFaceProof(body, item);
      if (item.enroll) {
        if (body.consent !== true) fail('录入人脸前需要同意本机存储特征。');
        user.face = encrypt(vector); user.authVersion = (user.authVersion || 0) + 1;
        put('user', user); revokeUser(user.id); audit(user.name, '录入本机人脸特征', user.id);
      } else if (!user.face || distance(vector, decrypt(user.face)) > .48) {
        audit(user.name, '人脸比对失败', user.id); fail('人脸与当前账号不匹配，请重新登录。', 401);
      }
      audit(user.name, '账号及人脸验证通过', user.id);
      return sessionFor(user);
    }
    if (p === '/api/me') return { user: publicUser(auth(req, roles).user) };
    if (p === '/api/logout' && req.method === 'POST') { sessions.delete(String(req.headers.authorization || '').replace(/^Bearer /, '')); return { ok: true }; }
    if (p === '/api/orders' && req.method === 'POST') return atomic(() => {
      customerService.customer(req);
      const product = publicProducts().find(v => v.id === body.productId);
      if (!product) fail('产品已下架，请重新选择。', 404);
      if (product.exhibitOnly) fail('教学模型不作为商品下单，请在官网产品目录选择对应设备。');
      if (!['buy', 'rent'].includes(body.mode)) fail('请选择购买或租赁。');
      const accessCode = crypto.randomBytes(12).toString('base64url');
      const order = {
        id: id('SO'), number: projectService.number('SO'), productId: product.id, product: { code: product.code, name: product.name, image: product.image, category: product.category, referencePrice: product.referencePrice || null },
        customerId: customerService.customer(req).id, customerType: customerService.customerType(body.customerType),
        mode: body.mode, quantity: integer(body.quantity, 1, 999), contact: text(body.contact, 40), phone: phone(body.phone),
        address: text(body.address, 300), date: date(body.date), duration: body.mode === 'rent' ? integer(body.duration, 1, 120) : null,
        plan: body.mode === 'buy' ? text(body.plan || '待商议', 60) : '', notes: text(body.notes || '', 2000, false),
        status: 'submitted', revision: 1, secretHash: hash(accessCode), createdAt: now(), updatedAt: now(),
        history: [{ id: id('EV'), from: null, to: 'submitted', actor: '客户', role: 'customer', note: '已提交租购申请，等待工作人员联系确认。', files: [], at: now() }]
      };
      if (order.address.length < 8) fail('请填写包含省市区及详细地点的完整收货地址。');
      if (order.date < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })) fail('计划日期不能早于今天。');
      order.files = order.attachments = addFiles(body.files || [], 'order', order.id, false);
      order.history[0].files = order.files;
      put('order', order); audit('客户', '提交租购申请', order.id);
      return { ...projectService.receipt(order, 'order'), accessCode };
    });
    if (p === '/api/guest/phone-orders' && req.method === 'POST') {
      checkPhoneQuery();
      const key = phoneKey(phone(body.phone));
      const orders = all('order').filter(order => phoneKey(order.phone) === key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map(order => ({
          id: order.id, number: order.number || order.id, product: { code: order.product.code, name: order.product.name, image: order.product.image },
          mode: order.mode, quantity: order.quantity, status: order.status, createdAt: order.createdAt
        }));
      return { orders };
    }
    if (p === '/api/guest/phone-order' && req.method === 'POST') {
      checkPhoneQuery();
      const key = phoneKey(phone(body.phone)), order = projectService.lookup('order', text(body.orderId, 100));
      if (!order || phoneKey(order.phone) !== key) fail('联系电话与订单不匹配，请重新查询。', 401);
      audit('客户', '通过联系电话打开订单（本机演示）', order.id);
      /* 每次仅授权选中的一单，不能用同一会话遍历其他订单、工程工单或后台。 */
      return { order: cleanOrder(order), token: guestSession(order.id) };
    }
    if (p === '/api/guest/lookup' && req.method === 'POST') {
      const order = projectService.lookup('order', text(body.orderId, 100));
      if (!order || order.phone !== body.phone || typeof body.code !== 'string' || hash(body.code) !== order.secretHash) fail('订单号、电话或查询凭证不匹配。', 401);
      return projectService.receipt(order, 'order');
    }
    if (p === '/api/orders' && req.method === 'GET') { auth(req, roles); return { orders: all('order').map(cleanOrder) }; }
    const orderMatch = p.match(/^\/api\/orders\/([\w-]+)(?:\/(transition|confirm))?$/);
    if (orderMatch) {
      const order = projectService.lookup('order', orderMatch[1]); if (!order) fail('订单不存在。', 404);
      const access = ownOrder(req, order.id);
      if (req.method === 'GET') return { order: cleanOrder(order), tickets: all('ticket').filter(t => t.orderId === order.id) };
      if (req.method === 'POST') return atomic(() => {
        revision(order, body);
        const note = text(body.note, 2000);
        let next, files, extra = {};
        if (orderMatch[2] === 'confirm') {
          if (!access.orderId || order.status !== 'shipped' || body.confirmed !== true) fail('只有订单客户可确认收货。', 403);
          next = 'delivered'; files = addFiles(body.files, 'order', order.id);
        } else {
          auth(req, ['admin', 'service']);
          const transitions = { submitted: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['shipped'] };
          next = body.status; if (!transitions[order.status]?.includes(next)) fail('不能跳过订单处理步骤。', 409);
          files = addFiles(body.files, 'order', order.id);
          if (next === 'confirmed') {
            const amount = Number(body.amount);
            if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12 || Math.abs(amount * 100 - Math.round(amount * 100)) > .001) fail('请填写有效的实际报价，最多两位小数。');
            extra.quote = { amount, currency: 'CNY', note: '工作人员录入，尚不构成付款凭证' };
          }
          if (next === 'shipped') extra.delivery = { carrier: text(body.carrier, 100), tracking: text(body.tracking, 100) };
        }
        const updated = transition(order, next, access, note, files, extra); put('order', updated); audit(access.actor, `订单 ${order.status} → ${next}`, order.id);
        return { order: cleanOrder(updated) };
      });
    }
    if (p === '/api/tickets' && req.method === 'GET') { auth(req, roles); return { tickets: all('ticket') }; }
    if (p === '/api/tickets' && req.method === 'POST') return atomic(() => {
      const order = get('order', text(body.orderId, 100)); if (!order) fail('请先查询有效订单。', 404);
      const access = ownOrder(req, order.id);
      if (!access.orderId) fail('请从订单客户入口提交报修。', 403);
      if (order.status !== 'delivered') fail('设备收货后才能创建维保工单。');
      const ticket = { id: id('WO'), number: documentNumber('WO'), orderId: order.id, product: order.product, contact: text(body.contact, 40), phone: phone(body.phone),
        address: text(body.address, 300), issue: text(body.issue, 2000), urgency: ['normal', 'urgent'].includes(body.urgency) ? body.urgency : 'normal',
        status: 'submitted', assignee: null, revision: 1, createdAt: now(), updatedAt: now(), history: [] };
      const files = addFiles(body.files || [], 'ticket', ticket.id, false);
      ticket.history.push({ id: id('EV'), from: null, to: 'submitted', actor: '客户', role: 'customer', note: ticket.issue, files, at: now() });
      put('ticket', ticket); audit('客户', '提交维保工单', ticket.id); return { ticket };
    });
    const ticketMatch = p.match(/^\/api\/tickets\/([\w-]+)(?:\/(transition|review|accept))?$/);
    if (ticketMatch) {
      const ticket = get('ticket', ticketMatch[1]); if (!ticket) fail('工单不存在。', 404);
      const access = ownOrder(req, ticket.orderId);
      if (req.method === 'GET') return { ticket };
      if (req.method === 'POST') return atomic(() => {
        revision(ticket, body);
        const note = text(body.note, 2000), files = addFiles(body.files, 'ticket', ticket.id);
        let next, extra = {};
        if (ticketMatch[2] === 'review') {
          auth(req, ['admin', 'reviewer']);
          if (ticket.status !== 'pending_review') fail('此工单尚未提交审核。', 409);
          if (ticket.assignee === access.user.id || ticket.completedBy === access.user.id) fail('不能审核自己处理的工单。', 403);
          if (!['approve', 'reject'].includes(body.decision)) fail('请选择审核结果。');
          next = body.decision === 'approve' ? 'awaiting_customer' : 'in_progress';
          extra.reviewer = access.user.id;
        } else if (ticketMatch[2] === 'accept') {
          if (!access.orderId || ticket.status !== 'awaiting_customer') fail('只有客户可以完成验收。', 403);
          if (!['accept', 'return'].includes(body.decision)) fail('请选择验收结果。');
          next = body.decision === 'accept' ? 'closed' : 'in_progress';
        } else {
          auth(req, ['admin', 'service']);
          if (ticket.status === 'submitted' && body.status === 'assigned') {
            const assignee = get('user', body.assignee);
            if (!assignee?.active || assignee.role !== 'service') fail('请选择在用的售后服务账号。');
            next = 'assigned'; extra.assignee = assignee.id; extra.assigneeName = assignee.name;
          } else {
            if (access.user.id !== ticket.assignee) fail('只有被指派的服务人员可以提交处理进度。', 403);
            const nextMap = { assigned: 'in_progress', in_progress: 'pending_review' };
            next = nextMap[ticket.status]; if (!next || body.status !== next) fail('不能跳过维修处理步骤。', 409);
            if (next === 'pending_review') extra.completedBy = access.user.id;
          }
        }
        const updated = transition(ticket, next, access, note, files, extra); put('ticket', updated); audit(access.actor, `工单 ${ticket.status} → ${next}`, ticket.id);
        return { ticket: updated };
      });
    }
    if (p === '/api/staff') { auth(req, roles); return { users: all('user').filter(u => u.active).map(publicUser) }; }
    if (p === '/api/admin/users') {
      const access = auth(req, ['admin']);
      if (req.method === 'GET') return { users: all('user').map(publicUser) };
      if (req.method === 'POST') return atomic(() => {
        const username = text(body.username, 40);
        if (!/^[\w.-]{3,40}$/.test(username)) fail('账号格式不正确。');
        if (all('user').some(u => u.username === username)) fail('账号已存在。', 409);
        if (!roles.includes(body.role)) fail('请选择账号角色。');
        const user = { id: id('USR'), username, name: text(body.name, 40), role: body.role, password: passwordHash(body.password), active: true, face: null, createdAt: now() };
        put('user', user); audit(access.actor, '创建员工账号', user.id); return { user: publicUser(user) };
      });
    }
    const userMatch = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (userMatch && req.method === 'PATCH') {
      const access = auth(req, ['admin']), user = get('user', userMatch[1]); if (!user) fail('账号不存在。', 404);
      if (user.id === access.user.id && body.active === false) fail('不能停用当前账号。');
      if (user.role === 'admin' && body.active === false && all('user').filter(u => u.active && u.role === 'admin').length <= 1) fail('至少保留一位在用管理员。');
      if (typeof body.active === 'boolean') user.active = body.active;
      if (body.resetFace === true) { if (user.id === access.user.id) fail('不能在当前会话重置自己的人脸。'); user.face = null; }
      if (body.password) user.password = passwordHash(body.password);
      user.authVersion = (user.authVersion || 0) + 1;
      put('user', user); revokeUser(user.id);
      audit(access.actor, '更新账号 / 重置身份验证', user.id); return { user: publicUser(user) };
    }
    /* 商品照片单独入库，不接收任意文件路径，也不与私有工单材料共用公开读取入口。 */
    if (p === '/api/admin/product-images' && req.method === 'POST') return atomic(() => {
      const access = auth(req, ['admin']);
      const [file] = addFiles([{ name: body.name, data: body.data }], 'product-image', id('IMAGE'));
      if (!file.mime.startsWith('image/')) fail('商品照片只支持 JPG、PNG 或 WebP。');
      audit(access.actor, '上传产品图片', file.id);
      return { image: `/api/product-images/${file.id}`, file };
    });
    const imageMatch = p.match(/^\/api\/product-images\/([\w-]+)$/);
    if (imageMatch && req.method === 'GET') {
      const file = db.prepare('SELECT * FROM files WHERE id=? AND owner_kind=?').get(imageMatch[1], 'product-image');
      if (!file) fail('产品图片不存在。', 404);
      res.writeHead(200, { 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(file.bytes)); return null;
    }
    if (p === '/api/admin/products') {
      const access = auth(req, ['admin']);
      if (req.method === 'GET') return { products: products(), catalog: loadJson('catalog-audit.json', {}) };
      if (req.method === 'POST' || req.method === 'PATCH') {
        const existing = body.id && products().find(p => p.id === body.id);
        if (req.method === 'PATCH' && !existing) fail('产品不存在。', 404);
        const product = { ...existing, id: existing?.id || id('CUSTOM'), code: text(body.code, 100), name: text(body.name, 150), category: text(body.category, 80),
          subcategory: text(body.subcategory || '', 80, false), summary: text(body.summary || '', 2000, false), published: body.published !== false,
          deleted: false, custom: existing?.custom ?? true, updatedAt: now(), modelKey: existing?.modelKey || null };
        const specs = body.specs || []; if (!Array.isArray(specs) || specs.length > 50) fail('参数最多 50 项。');
        product.specs = specs.map(s => {
          if (!s || typeof s !== 'object' || s.value === undefined || s.value === null) fail('产品参数格式无效。');
          return { name: text(s.name, 100), value: text(String(s.value), 200), unit: text(s.unit || '', 30, false) };
        });
        if (body.image) {
          text(body.image, 300);
          const uploaded = body.image.match(/^\/api\/product-images\/([\w-]+)$/);
          const asset = /^assets\/[\w./-]+$/.test(body.image) && !body.image.split('/').includes('..');
          if (!asset && !uploaded) fail('请选择本地产品图片或上传新照片。');
          if (uploaded && !db.prepare('SELECT id FROM files WHERE id=? AND owner_kind=?').get(uploaded[1], 'product-image')) fail('上传图片不存在。');
        }
        product.image = body.image || existing?.image || 'assets/brand/sany-user-reference.png';
        product.sourceUrl = existing?.sourceUrl || '';
        if (Object.hasOwn(body, 'referencePrice')) product.referencePrice = referencePrice(body.referencePrice, fail, text, now);
        put('product', product); audit(access.actor, existing ? '编辑产品' : '新增产品', product.id); return { product };
      }
    }
    const productMatch = p.match(/^\/api\/admin\/products\/([\w-]+)$/);
    if (productMatch && req.method === 'DELETE') {
      const access = auth(req, ['admin']), product = products().find(p => p.id === productMatch[1]);
      if (!product) fail('产品不存在。', 404);
      put('product', { ...product, deleted: true, published: false, updatedAt: now() }); audit(access.actor, '移除在售产品（保留订单历史）', product.id);
      return { ok: true };
    }
    if (p === '/api/admin/audit') { auth(req, ['admin', 'reviewer']); return { events: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all() }; }
    if (p === '/api/stats') {
      auth(req, roles); const orders = all('order'), tickets = all('ticket'), projects = all('project');
      return { products: publicProducts().length, pendingOrders: orders.filter(o => o.status === 'submitted').length,
        openTickets: tickets.filter(t => t.status !== 'closed').length, pendingReview: tickets.filter(t => t.status === 'pending_review').length,
        orders: orders.length, tickets: tickets.length, projects: projects.length,
        pendingProjects: projects.filter(project => ['submitted', 'reviewing'].includes(project.status)).length, conversations: all('conversation').length };
    }
    const fileMatch = p.match(/^\/api\/files\/([\w-]+)$/);
    if (fileMatch && req.method === 'GET') {
      const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileMatch[1]); if (!file) fail('材料不存在。', 404);
      if (!['order', 'ticket', 'project', 'conversation'].includes(file.owner_kind)) fail('材料不存在。', 404);
      if (file.owner_kind === 'project') projectService.ownRecord(req, 'project', file.owner_id);
      else if (file.owner_kind === 'conversation') projectService.conversationAccess(req, file.owner_id);
      else {
        const orderId = file.owner_kind === 'order' ? file.owner_id : get('ticket', file.owner_id)?.orderId;
        ownOrder(req, orderId);
      }
      res.writeHead(200, { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(file.bytes)); return null;
    }
    fail('接口不存在。', 404);
  }

  /* 服务只监听本机；拒绝跨站写入及未知 Host，材料下载仍进行角色与订单归属检查。 */
  const server = http.createServer(async (req, res) => {
    adminTools.metrics.requests++;
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) fail('请求来源无效。', 403);
      const origin = `http://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) fail('不允许跨站请求。', 403);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      expireMemory();
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (!['GET', 'HEAD'].includes(req.method)) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('请求必须使用 JSON。', 415);
          const chunks = []; let length = 0;
          for await (const chunk of req) { length += chunk.length; if (length > 24 * 1024 * 1024) fail('提交内容过大。', 413); chunks.push(chunk); }
          try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail('JSON 内容无效。'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON 内容必须是对象。');
        }
        const result = await route(req, res, url, body);
        if (result !== null) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result)); }
      } else {
        const dist = path.join(root, 'dist'), requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const file = path.resolve(dist, `.${requested}`);
        if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail('页面不存在。', 404);
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        const stream = fs.createReadStream(file);
        stream.on('error', error => { console.error(error); res.destroy(); });
        stream.pipe(res);
      }
    } catch (error) {
      if(!error.status||error.status>=500)adminTools.metrics.errors++;
      if (!res.headersSent) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error.status ? error.message : '本地服务处理失败，请检查数据目录和运行日志。' })); }
      if (!error.status) console.error(error);
    }
  });
  let closePromise;
  return {
    start: (port = 8790) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); }),
    close: () => closePromise ||= new Promise(resolve => {
      /* Chromium 可能保留尚未发送请求的预连接，单靠 closeIdleConnections 不一定能结束它。
       * 先给正在传输的响应 1.5 秒收尾，再关闭余下连接；业务数据库仍在 server.close 回调中关闭。 */
      const drainTimer = setTimeout(() => server.closeAllConnections(), 1500);
      drainTimer.unref?.();
      server.close(() => { clearTimeout(drainTimer); db.close(); resolve(); });
      server.closeIdleConnections();
    }),
    dataDir
  };
}
module.exports = { createPlatform };
if (require.main === module) {
  const platform = createPlatform();
  platform.start(Number(process.env.SANY_PLATFORM_PORT || 8790)).then(url => console.log(`三一匠造 ${VERSION} 本地服务：${url}`)).catch(error => {
    console.error(`本地服务启动失败：${error.message}`);
    platform.close().then(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => platform.close().then(() => process.exit()));
}
