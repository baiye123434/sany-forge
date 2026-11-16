'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* 此回归只针对显式启动的隔离 MySQL 服务。通过环境开关避免误向日常数据提交测试订单。 */
const url = process.env.SANY_TEST_URL;
if (process.env.SANY_TEST_RUN !== 'isolated' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url || '')) {
  throw new Error('需设置 SANY_TEST_RUN=isolated 和隔离 Java 服务的 SANY_TEST_URL。');
}
const tag = crypto.randomBytes(4).toString('hex');
const password = `Regression-${crypto.randomUUID()}`;
const phone = `139${String(Date.now()).slice(-8)}`;
const files = [{ name: '隔离验收材料.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=' }];

test('Java/MySQL 全流程业务契约及权限回归', async t => {
  let admin, worker, reviewer, workerId, reviewerId, product, order, otherOrder, ticket, customerAccount, customer, otherCustomer;
  async function api(path, { method = 'GET', body, token, expected = 200, headers = {} } = {}) {
    const response = await fetch(url + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  }
  const post = (path, body, token, expected = 200) => api(path, { method: 'POST', body, token, expected });
  const orderStep = async (status, extra = {}) => {
    order = (await post(`/api/orders/${order.id}/transition`, { revision: order.revision, status, note: `验证 ${status}`, files, ...extra }, worker)).order;
  };
  const ticketStep = async (status, token = worker, extra = {}) => {
    ticket = (await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status, note: `验证 ${status}`, files, ...extra }, token)).ticket;
  };

  await t.test('服务确认为 MySQL 后端并创建隔离角色和客户', async () => {
    assert.equal((await api('/api/health')).storage, 'mysql');
    const user = await post('/api/register', { username: `qa.admin.${tag}`, name: '隔离测试管理员', password, repeat: password, role: 'admin' });
    admin = user.token;
    workerId = (await post('/api/admin/users', { username: `qa.worker.${tag}`, name: '隔离测试工程师', password, role: 'service' }, admin)).user.id;
    reviewerId = (await post('/api/admin/users', { username: `qa.reviewer.${tag}`, name: '隔离测试审核员', password, role: 'reviewer' }, admin)).user.id;
    worker = (await post('/api/login', { username: `qa.worker.${tag}`, password })).token;
    reviewer = (await post('/api/login', { username: `qa.reviewer.${tag}`, password })).token;
    customerAccount = (await post('/api/customer/register', { phone, password, repeat: password })).token;
    await post('/api/customer/register', { phone, password, repeat: password }, undefined, 409);
    await post('/api/customer/register', { phone: `+86 ${phone}`, password, repeat: password }, undefined, 409);
    await api('/api/admin/users', { token: worker, expected: 403 });
    await api('/api/admin/products', { token: reviewer, expected: 403 });
    assert.ok((await api('/api/staff', { token: reviewer })).users.some(row => row.id === workerId));
    await post('/api/admin/users', { username: `qa.worker.${tag}`, name: '重复账号', password, role: 'service' }, admin, 409);
    await post('/api/admin/users', { username: `qa.space.${tag}`, name: '空格密码测试', password: ` ${password} `, role: 'service' }, admin);
    assert.ok((await post('/api/login', { username: `qa.space.${tag}`, password: ` ${password} ` })).token);
    await post('/api/login', { username: `qa.space.${tag}`, password }, undefined, 401);
  });

  await t.test('商品照片单独公开，私有材料入口拒绝商品照片', async () => {
    const uploaded = await post('/api/admin/product-images', files[0], admin);
    const image = await fetch(url + uploaded.image);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(files[0].data, 'base64'));
    await api(`/api/files/${uploaded.file.id}`, { token: admin, expected: 404 });
    await post('/api/admin/product-images', { name: 'wrong.pdf', data: Buffer.from('%PDF-1.4 fixture').toString('base64') }, admin, 400);
    const data = { code: `QA-${tag}`, name: 'Java 隔离测试设备', category: '自动化测试', image: uploaded.image,
      specs: [{ name: '用途', value: '隔离测试', unit: '' }], referencePrice: { buyMin: 1.5, buyMax: 2, source: '自动化测试夹具' } };
    product = (await post('/api/admin/products', data, admin)).product;
    assert.equal(product.referencePrice.buyMin, 1.5);
    await post('/api/admin/products', { ...data, image: 'assets/../server/platform.cjs' }, admin, 400);
    await post('/api/admin/products', { ...data, specs: [null] }, admin, 400);
    await post('/api/admin/products', { ...data, referencePrice: { buyMin: '1', buyMax: 2, source: '错误类型' } }, admin, 400);
    product = (await api('/api/admin/products', { method: 'PATCH', token: admin, body: { ...product, name: 'Java 隔离测试设备已编辑' } })).product;
  });

  await t.test('保留教学模型，下单必须登录客户且信息完整', async () => {
    const catalog = (await api('/api/products')).products;
    const exhibit = catalog.find(row => row.exhibitOnly);
    assert.ok(exhibit);
    await post('/api/orders', { productId: exhibit.id }, customerAccount, 400);
    const data = { productId: product.id, mode: 'rent', quantity: 2, duration: 6, contact: '虚构测试客户', phone,
      address: '湖南省长沙市虚构测试区测试路 301 号', date: '2099-01-01', customerType: 'personal' };
    await post('/api/orders', data, undefined, 401);
    await post('/api/orders', data, worker, 401);
    await post('/api/orders', { ...data, address: '长沙' }, customerAccount, 400);
    await post('/api/orders', { ...data, phone: 'invalid' }, customerAccount, 400);
    await post('/api/orders', { ...data, customerType: null }, customerAccount, 400);
    await post('/api/orders', { ...data, date: '2026-02-30' }, customerAccount, 400);
    const first = await post('/api/orders', data, customerAccount);
    order = first.order; customer = first.token;
    assert.equal(order.secretHash, undefined);
    assert.match(order.number, /^SO-\d{8}-\d{4,}$/);
    const second = await post('/api/orders', { ...data, mode: 'buy' }, customerAccount);
    otherOrder = second.order; otherCustomer = second.token;
    assert.notEqual(otherOrder.number, order.number);
    assert.equal(Number(otherOrder.number.split('-').at(-1)), Number(order.number.split('-').at(-1)) + 1);
    await api(`/api/orders/${order.id}`, { token: otherCustomer, expected: 403 });
    await api('/api/orders', { token: customer, expected: 403 });
    assert.ok((await post('/api/guest/lookup', { orderId: order.number, phone, code: first.accessCode })).token);
    await post('/api/guest/lookup', { orderId: order.id, phone, code: 'wrong' }, undefined, 401);
    const phoneList = (await post('/api/guest/phone-orders', { phone: `+86 ${phone}` })).orders;
    assert.deepEqual(new Set(phoneList.map(row => row.id)), new Set([order.id, otherOrder.id]));
    for (const row of phoneList) for (const key of ['phone', 'contact', 'address', 'history', 'secretHash', 'token']) assert.equal(row[key], undefined);
    const phoneOpened = await post('/api/guest/phone-order', { phone: `0086${phone}`, orderId: order.number });
    await api(`/api/orders/${otherOrder.id}`, { token: phoneOpened.token, expected: 403 });
    await post('/api/guest/phone-order', { phone: '13800000000', orderId: order.id }, undefined, 401);
  });

  await t.test('跳步、越权、空附件与旧修订均拒绝，失败不修改订单', async () => {
    const path = `/api/orders/${order.id}/transition`;
    await post(path, { revision: order.revision, status: 'shipped', note: '跳步', files }, worker, 409);
    await post(path, { revision: order.revision, status: 'confirmed', amount: 100, note: '客户越权', files }, customer, 403);
    await post(path, { revision: order.revision, status: 'confirmed', amount: 100, note: '缺材料', files: [] }, worker, 400);
    await post(path, { revision: order.revision, status: 'confirmed', amount: -1, note: '坏报价', files }, worker, 400);
    await post(path, { revision: 1.9, status: 'confirmed', amount: 100, note: '小数修订号', files }, worker, 409);
    await post(path, { revision: order.revision, status: 'confirmed', amount: 100, note: '假后缀', files: [{ ...files[0], name: 'file.html' }] }, worker, 400);
    assert.equal((await api(`/api/orders/${order.id}`, { token: customer })).order.revision, 1);
    await orderStep('confirmed', { amount: 480000.5 });
    assert.equal(order.quote.amount, 480000.5);
    await post(path, { revision: 1, status: 'preparing', note: '旧版本', files }, worker, 409);
    await orderStep('preparing');
    await orderStep('shipped', { carrier: '虚构测试承运方', tracking: `TEST-${tag}` });
    const attachment = order.history.at(-1).files[0];
    await api(`/api/files/${attachment.id}`, { token: otherCustomer, expected: 403 });
    const download = await fetch(url + `/api/files/${attachment.id}`, { headers: { Authorization: `Bearer ${customer}` } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(files[0].data, 'base64'));
    await post(`/api/orders/${order.id}/confirm`, { revision: order.revision, confirmed: true, note: '员工代收货', files }, worker, 403);
    order = (await post(`/api/orders/${order.id}/confirm`, { revision: order.revision, confirmed: true, note: '客户确认收货', files }, customer)).order;
    assert.equal(order.status, 'delivered');
  });

  await t.test('售后归属、派单与独立审核完整闭环', async () => {
    const data = { orderId: order.id, contact: '虚构测试客户', phone, address: order.address, issue: '测试液压故障', urgency: 'urgent', files };
    await post('/api/tickets', { ...data, orderId: otherOrder.id }, otherCustomer, 400);
    await post('/api/tickets', data, otherCustomer, 403);
    ticket = (await post('/api/tickets', data, customer)).ticket;
    await api(`/api/tickets/${ticket.id}`, { token: otherCustomer, expected: 403 });
    await ticketStep('assigned', admin, { assignee: workerId });
    await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status: 'in_progress', note: '非指派', files }, admin, 403);
    await post(`/api/tickets/${ticket.id}/transition`, { revision: ticket.revision, status: 'pending_review', note: '跳过维修', files }, worker, 409);
    await ticketStep('in_progress');
    await ticketStep('pending_review');
    await post(`/api/tickets/${ticket.id}/review`, { revision: ticket.revision, decision: 'approve', note: '工程师自审', files }, worker, 403);
    const review = async decision => {
      ticket = (await post(`/api/tickets/${ticket.id}/review`, { revision: ticket.revision, decision, note: `审核 ${decision}`, files }, reviewer)).ticket;
    };
    await review('reject'); assert.equal(ticket.status, 'in_progress');
    await ticketStep('pending_review');
    await review('approve'); assert.equal(ticket.status, 'awaiting_customer');
    await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'accept', note: '员工代验收', files }, admin, 403);
    ticket = (await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'return', note: '客户退回检查', files }, customer)).ticket;
    await ticketStep('pending_review'); await review('approve');
    ticket = (await post(`/api/tickets/${ticket.id}/accept`, { revision: ticket.revision, decision: 'accept', note: '复测通过', files }, customer)).ticket;
    assert.equal(ticket.status, 'closed');
    assert.ok(ticket.history.every(event => event.files.length > 0));
  });

  await t.test('并发旧版本只有一次成功且历史不重复', async () => {
    const responses = await Promise.all([1, 2].map(() => fetch(url + `/api/orders/${otherOrder.id}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker}` },
      body: JSON.stringify({ revision: otherOrder.revision, status: 'confirmed', amount: 6000, note: '并发确认', files })
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    await Promise.all(responses.map(response => response.json()));
    otherOrder = (await api(`/api/orders/${otherOrder.id}`, { token: otherCustomer })).order;
    assert.equal(otherOrder.revision, 2);
    assert.equal(otherOrder.history.length, 2);
  });

  await t.test('商品下架和软删除保留历史快照，密码更新撤销旧会话', async () => {
    await api('/api/admin/products', { method: 'PATCH', token: admin, body: { ...product, published: false } });
    assert.equal((await api('/api/products')).products.some(row => row.id === product.id), false);
    await api(`/api/admin/products/${product.id}`, { method: 'DELETE', token: admin, body: {} });
    assert.equal((await api(`/api/orders/${order.id}`, { token: customer })).order.product.name, 'Java 隔离测试设备已编辑');
    assert.equal((await api(`/api/tickets/${ticket.id}`, { token: customer })).ticket.status, 'closed');
    await api(`/api/admin/users/${reviewerId}`, { method: 'PATCH', token: admin, body: { password: `${password}-new` } });
    await api('/api/me', { token: reviewer, expected: 401 });
    reviewer = (await post('/api/login', { username: `qa.reviewer.${tag}`, password: `${password}-new` })).token;
    await api(`/api/admin/users/${reviewerId}`, { method: 'PATCH', token: admin, body: { active: false } });
    await api('/api/me', { token: reviewer, expected: 401 });
    const adminUser = (await api('/api/me', { token: admin })).user;
    await api(`/api/admin/users/${adminUser.id}`, { method: 'PATCH', token: admin, body: { active: false }, expected: 400 });
    const events = (await api('/api/admin/audit', { token: admin })).events;
    assert.ok(events.some(event => event.target === ticket.id && event.action.includes('closed')));
    assert.ok((await api('/api/stats', { token: admin })).orders >= 2);
  });
  console.log(JSON.stringify({ suite: 'business-regression', result: 'passed', productId: product.id,
    orderId: order.id, secondOrderId: otherOrder.id, ticketId: ticket.id, workerId, reviewerId }));
});
