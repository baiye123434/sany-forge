'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createPlatform } = require('../server/platform.cjs');

/* 本测试只使用隔离数据库与合成人脸向量验证服务协议，不代表真人摄像头或商用活体检测验收。 */
const root = path.resolve(__dirname, '..');
const password = 'Test-only-pass-301!';
const vector = Array.from({ length: 128 }, (_, index) => .01 + index / 5000);
const files = [{ name: '测试材料.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=' }];
const proof = challenge => ({
  challenge: challenge.challenge, consent: true,
  samples: [0, ...challenge.turns.map(turn => turn === 'left' ? -.22 : .22)].map(yaw => ({ descriptor: vector, yaw }))
});
test('服务平台：独立数据库全流程与权限集成验收', async t => {
  const qaRoot = path.join(root, '.qa');
  fs.mkdirSync(qaRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(qaRoot, 'platform-test-'));
  let platform = createPlatform({ root, dataDir });
  let url = await platform.start(0);
  let admin, worker, reviewer, workerId, reviewerId, product, order, secondOrder, ticket, customer, customer2, accessCode;
  t.after(async () => { await platform.close(); });
  async function api(endpoint, { method = 'GET', body, token, expected = 200, headers = {} } = {}) {
    if (!token && method === 'POST' && ['/api/orders','/api/projects'].includes(endpoint)) token = await require('./customer-fixture.cjs')(url);
    const response = await fetch(url + endpoint, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}`);
    return result;
  }
  async function login(username, chosenPassword = password) {
    const challenge = await api('/api/login', { method: 'POST', body: { username, password: chosenPassword } });
    /* 当前演示契约：未录入人脸的账号直接登录；已录入账号仍须通过挑战。 */
    if (challenge.user.faceEnrolled === false) {
      assert.ok(challenge.token, '未录入人脸的演示账号应取得密码登录会话');
      assert.equal(challenge.challenge, undefined);
      assert.equal(challenge.enrollOnly, false);
      return challenge;
    }
    assert.equal(challenge.token, undefined, '已录入人脸的账号不能仅凭密码取得后台令牌');
    assert.equal(challenge.enroll, false);
    return api('/api/face/verify', { method: 'POST', body: proof(challenge) });
  }
  const post = (endpoint, body, token, expected = 200) => api(endpoint, { method: 'POST', body, token, expected });
  const orderStep = async (status, extra = {}) => {
    const response = await post(`/api/orders/${order.id}/transition`, { revision: order.revision, status, note: `测试：${status}`, files, ...extra }, worker);
    order = response.order;
  };
  const ticketStep = async (status, token = worker, extra = {}) => {
    const response = await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status, note: `测试：${status}`, files, ...extra }, token);
    ticket = response.ticket;
  };
  await t.test('空库无默认账号、无模拟订单；首次设置必须完成人脸挑战', async () => {
    assert.equal((await api('/api/bootstrap')).setupNeeded, true);
    await api('/api/orders', { expected: 401 });
    const challenge = await post('/api/setup', { username: 'admin.test', name: '测试管理员', password });
    assert.equal(challenge.enroll, true);
    assert.equal(challenge.token, undefined);
    admin = (await post('/api/face/verify', proof(challenge))).token;
    await post('/api/face/verify', proof(challenge), undefined, 401);
    assert.equal((await api('/api/orders', { token: admin })).orders.length, 0);
    assert.equal((await api('/api/tickets', { token: admin })).tickets.length, 0);
    await post('/api/setup', { username: 'another', name: '再次初始化', password }, undefined, 409);
  });
  await t.test('请求格式、跨站来源与弱密码拒绝', async () => {
    await post('/api/login', null, undefined, 400);
    await post('/api/login', [], undefined, 400);
    await api('/api/login', { method: 'POST', body: {}, expected: 403, headers: { Origin: 'https://untrusted.invalid' } });
    await post('/api/admin/users', { username: 'weak.test', name: '弱密码', password: '123456', role: 'service' }, admin, 400);
    for (let attempt = 0; attempt < 5; attempt++) await post('/api/login', { username: 'locked.missing', password }, undefined, 401);
    await post('/api/login', { username: 'locked.missing', password }, undefined, 429);
    const adminUser = (await api('/api/me', { token: admin })).user;
    await api(`/api/admin/users/${adminUser.id}`, { method: 'PATCH', token: admin, body: { active: false }, expected: 400 });
  });
  await t.test('保留原版九类教学模型，但不冒充官网商品接单', async () => {
    const exhibits = (await api('/api/products')).products.filter(p => p.exhibitOnly);
    assert.equal(exhibits.length, 9);
    assert.equal(new Set(exhibits.map(p => p.modelKey)).size, 9);
    await post('/api/orders', { productId: exhibits[0].id }, undefined, 400);
  });
  await t.test('新员工密码直登；已录入员工必须人脸验证；错误人脸拒绝', async () => {
    workerId = (await post('/api/admin/users', { username: 'worker.test', name: '测试服务工程师', password, role: 'service' }, admin)).user.id;
    reviewerId = (await post('/api/admin/users', { username: 'reviewer.test', name: '测试审核员', password, role: 'reviewer' }, admin)).user.id;
    /* 模拟从旧版本保留人脸的员工：只在本次隔离库复用合成管理员特征，
     * 不通过已取消的首次员工登录录入流程；继续覆盖人脸挑战和重置撤销。 */
    const inspection = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    try {
      const users = inspection.prepare("SELECT body FROM records WHERE kind='user'").all().map(row => JSON.parse(row.body));
      const enrolledAdmin = users.find(user => user.username === 'admin.test');
      const reviewerUser = users.find(user => user.id === reviewerId);
      assert.ok(enrolledAdmin.face, '夹具必须使用初始化产生的加密合成特征');
      inspection.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify({ ...reviewerUser, face: enrolledAdmin.face }), 'user', reviewerId);
    } finally { inspection.close(); }
    worker = (await login('worker.test')).token;
    reviewer = (await login('reviewer.test')).token;
    assert.equal((await api('/api/me', { token: worker })).user.faceEnrolled, false);
    assert.equal((await api('/api/me', { token: reviewer })).user.faceEnrolled, true);
    const challenge = await post('/api/login', { username: 'reviewer.test', password });
    const wrongProof = proof(challenge);
    wrongProof.samples.forEach(sample => { sample.descriptor = vector.map(value => value + .2); });
    await post('/api/face/verify', wrongProof, undefined, 401);
    await api('/api/admin/users', { token: worker, expected: 403 });
    await api('/api/admin/products', { token: reviewer, expected: 403 });
  });
  await t.test('照片上传隔离、商品新增编辑及私有资料路径防护', async () => {
    const uploaded = await post('/api/admin/product-images', files[0], admin);
    const imageResponse = await fetch(url + uploaded.image);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    await api(`/api/files/${uploaded.file.id}`, { token: admin, expected: 404 });
    await post('/api/admin/product-images', { name: 'test.pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') }, admin, 400);
    const data = { code: 'QA-301', name: '隔离测试设备', category: '测试目录', summary: '仅测试库内商品', image: uploaded.image, specs: [{ name: '用途', value: '自动化测试', unit: '' }] };
    product = (await post('/api/admin/products', data, admin)).product;
    await post('/api/admin/products', { ...data, image: 'assets/../server/platform.cjs' }, admin, 400);
    await post('/api/admin/products', { ...data, specs: [null] }, admin, 400);
    product = (await api('/api/admin/products', { method: 'PATCH', body: { ...product, name: '隔离测试设备已编辑' }, token: admin })).product;
    assert.equal(product.modelKey, null);
  });
  await t.test('下单必须有联系方式与详细地址；查询凭证只授予对应订单', async () => {
    const orderData = { productId: product.id, mode: 'rent', quantity: 2, duration: 6, contact: '测试客户', phone: '13800000000', address: '湖南省长沙市测试区测试路 301 号', date: '2099-01-01', notes: '仅自动化验证' };
    await post('/api/orders', { ...orderData, address: '长沙' }, undefined, 400);
    await post('/api/orders', { ...orderData, phone: 'invalid' }, undefined, 400);
    const response = await post('/api/orders', orderData);
    ({ order, accessCode } = response); customer = response.token;
    assert.equal(order.secretHash, undefined);
    const response2 = await post('/api/orders', { ...orderData, mode: 'buy' });
    secondOrder = response2.order; customer2 = response2.token;
    await api(`/api/orders/${order.id}`, { token: customer2, expected: 403 });
    await api('/api/orders', { token: customer, expected: 403 });
    const lookup = await post('/api/guest/lookup', { orderId: order.id, phone: order.phone, code: accessCode });
    assert.ok(lookup.token);
    await post('/api/guest/lookup', { orderId: order.id, phone: order.phone, code: 'wrong' }, undefined, 401);
  });
  await t.test('订单禁止跳步、客户不能处理后台状态、变更必须材料', async () => {
    const endpoint = `/api/orders/${order.id}/transition`;
    await post(endpoint, { revision: order.revision, status: 'shipped', note: '跳步', files }, worker, 409);
    await post(endpoint, { revision: order.revision, status: 'confirmed', amount: 100, note: '客户操作', files }, customer, 403);
    await post(endpoint, { revision: order.revision, status: 'confirmed', amount: 100, note: '无材料', files: [] }, worker, 400);
    await post(endpoint, { revision: order.revision, status: 'confirmed', amount: 100, note: '坏附件', files: [null] }, worker, 400);
    assert.equal((await api(`/api/orders/${order.id}`, { token: customer })).order.revision, 1);
    await orderStep('confirmed', { amount: 480000.50 });
    assert.equal(order.quote.amount, 480000.50);
    await post(endpoint, { revision: 1, status: 'preparing', note: '旧版本', files }, worker, 409);
  });
  await t.test('确认、备货、运输、客户收货闭环；材料按订单隔离', async () => {
    await orderStep('preparing');
    await orderStep('shipped', { carrier: '测试承运方', tracking: 'TEST-SHIP-301' });
    const material = order.history.at(-1).files[0];
    await api(`/api/files/${material.id}`, { token: customer2, expected: 403 });
    assert.equal((await fetch(`${url}/api/files/${material.id}`, { headers: { Authorization: `Bearer ${customer}` } })).status, 200);
    await post(`/api/orders/${order.id}/confirm`, { revision: order.revision, confirmed: true, note: '冒充收货', files }, worker, 403);
    order = (await post(`/api/orders/${order.id}/confirm`, { revision: order.revision, confirmed: true, note: '已核对设备并收货', files }, customer)).order;
    assert.equal(order.status, 'delivered');
  });
  await t.test('未交付订单不能报修；报修归属校验及派单规则', async () => {
    const data = { orderId: order.id, contact: '测试客户', phone: order.phone, address: order.address, issue: '测试液压系统异常', urgency: 'urgent', files };
    await post('/api/tickets', { ...data, orderId: secondOrder.id }, customer2, 400);
    await post('/api/tickets', data, customer2, 403);
    ticket = (await post('/api/tickets', data, customer)).ticket;
    await api(`/api/tickets/${ticket.id}`, { token: customer2, expected: 403 });
    await ticketStep('assigned', admin, { assignee: workerId });
    await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status: 'in_progress', note: '非指派人员', files }, admin, 403);
    await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status: 'pending_review', note: '跳过处理', files }, worker, 409);
  });
  await t.test('维修到审核；缺材料拒绝；售后人员不能自行审核', async () => {
    await ticketStep('in_progress');
    await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status: 'pending_review', note: '缺少完工证据', files: [] }, worker, 400);
    await ticketStep('pending_review');
    await post(`/api/tickets/${ticket.id}/review`, { revision: ticket.revision, decision: 'approve', note: '自审', files }, worker, 403);
    /* 防御性分支：即使日后人员被升为审核角色，仍不能审核自己已处理的工单。 */
    const inspection = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    try {
      const row = JSON.parse(inspection.prepare('SELECT body FROM records WHERE kind=? AND id=?').get('user', workerId).body);
      inspection.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify({ ...row, role: 'reviewer' }), 'user', workerId);
      const denied = await post(`/api/tickets/${ticket.id}/review`, { revision: ticket.revision, decision: 'approve', note: '角色变更后自审', files }, worker, 403);
      assert.match(denied.error, /不能审核自己/);
      inspection.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify(row), 'user', workerId);
    } finally { inspection.close(); }
  });
  await t.test('审核退回、补修复审；客户可退回重修并最终验收', async () => {
    const review = async decision => {
      ticket = (await post(`/api/tickets/${ticket.id}/review`, { revision: ticket.revision, decision, note: `审核：${decision}`, files }, reviewer)).ticket;
    };
    await review('reject'); assert.equal(ticket.status, 'in_progress');
    await ticketStep('pending_review');
    await review('approve'); assert.equal(ticket.status, 'awaiting_customer');
    await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'accept', note: '员工代验收', files }, admin, 403);
    ticket = (await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'return', note: '客户要求再次检查', files }, customer)).ticket;
    await ticketStep('pending_review');
    await review('approve');
    ticket = (await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'accept', note: '现场复测通过', files }, customer)).ticket;
    assert.equal(ticket.status, 'closed');
    assert.ok(ticket.history.every(event => event.files.length > 0));
    assert.equal((await api('/api/stats', { token: admin })).openTickets, 0);
  });
  await t.test('商品下架和软删除不破坏旧订单与工单快照', async () => {
    product = (await api('/api/admin/products', { method: 'PATCH', token: admin, body: { ...product, published: false } })).product;
    assert.equal((await api('/api/products')).products.some(p => p.id === product.id), false);
    await api(`/api/admin/products/${product.id}`, { method: 'DELETE', body: {}, token: admin });
    const historical = (await api(`/api/orders/${order.id}`, { token: customer })).order;
    assert.equal(historical.product.name, '隔离测试设备已编辑');
    assert.equal((await api(`/api/tickets/${ticket.id}`, { token: customer })).ticket.status, 'closed');
  });
  await t.test('并发处理同一版本时仅一个成功，另一个收到冲突；不会重复写材料', async () => {
    const endpoint = `${url}/api/orders/${secondOrder.id}/transition`;
    const body = JSON.stringify({ revision: secondOrder.revision, status: 'confirmed', note: '并发确认测试', amount: 6000, files });
    const responses = await Promise.all([1, 2].map(() => fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker}` }, body
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    await Promise.all(responses.map(response => response.json()));
    const persisted = (await api(`/api/orders/${secondOrder.id}`, { token: customer2 })).order;
    assert.equal(persisted.revision, 2);
    assert.equal(persisted.history.length, 2);
    const inspection = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    try { assert.equal(inspection.prepare('SELECT count(*) AS count FROM files WHERE owner_id=?').get(secondOrder.id).count, 1); }
    finally { inspection.close(); }
  });
  await t.test('密码重置、人脸重置、停用会撤销会话和未完成挑战', async () => {
    const pending = await post('/api/login', { username: 'reviewer.test', password });
    await api(`/api/admin/users/${reviewerId}`, { method: 'PATCH', token: admin, body: { password: `${password}new` } });
    await post('/api/face/verify', proof(pending), undefined, 401);
    await api('/api/me', { token: reviewer, expected: 401 });
    reviewer = (await login('reviewer.test', `${password}new`)).token;
    const pendingReset = await post('/api/login', { username: 'reviewer.test', password: `${password}new` });
    await api(`/api/admin/users/${reviewerId}`, { method: 'PATCH', token: admin, body: { resetFace: true } });
    await post('/api/face/verify', proof(pendingReset), undefined, 401);
    await api('/api/me', { token: reviewer, expected: 401 });
    const resetLogin = await login('reviewer.test', `${password}new`);
    assert.equal(resetLogin.user.faceEnrolled, false);
    reviewer = resetLogin.token;
    await api(`/api/admin/users/${reviewerId}`, { method: 'PATCH', token: admin, body: { active: false } });
    await api('/api/me', { token: reviewer, expected: 401 });
    await post('/api/login', { username: 'reviewer.test', password: `${password}new` }, undefined, 401);
  });
  await t.test('服务重启后业务与材料仍在，旧会话失效，查询凭证可恢复订单', async () => {
    await platform.close();
    platform = createPlatform({ root, dataDir }); url = await platform.start(0);
    assert.equal((await api('/api/bootstrap')).setupNeeded, false);
    await api('/api/me', { token: admin, expected: 401 });
    const restored = await post('/api/guest/lookup', { orderId: order.id, phone: order.phone, code: accessCode });
    assert.equal(restored.order.status, 'delivered');
    customer = restored.token;
    assert.equal((await api(`/api/tickets/${ticket.id}`, { token: customer })).ticket.status, 'closed');
    admin = (await login('admin.test')).token;
    const events = (await api('/api/admin/audit', { token: admin })).events;
    assert.ok(events.some(event => event.action.includes('录入本机人脸')));
    assert.ok(events.some(event => event.action.includes('closed')));
    const inspection = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    try {
      const users = inspection.prepare("SELECT body FROM records WHERE kind='user'").all();
      for (const { body } of users) {
        const user = JSON.parse(body);
        assert.equal(user.password.includes(password), false);
        if (user.face) { assert.equal(user.face.startsWith('['), false); assert.equal(user.face.split(':').length, 3); }
      }
    } finally { inspection.close(); }
  });
  console.log(`测试使用隔离资料目录（保留便于审查）：${dataDir}`);
});
