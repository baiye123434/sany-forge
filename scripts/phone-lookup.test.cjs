'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPlatform } = require('../server/platform.cjs');
const root = path.resolve(__dirname, '..');

/* 使用隔离库和虚构电话测试本机演示入口，不修改用户已有订单或员工资料。 */
test('电话查询：同号多单、格式归一、单单授权、重启恢复与查询限流', async t => {
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, '.qa', 'phone-test-'));
  let platform = createPlatform({ root, dataDir }), url = await platform.start(0);
  t.after(() => platform.close());
  const api = async (endpoint, body, token, expected = 200, headers = {}) => {
    if (!token && body !== undefined && ['/api/orders','/api/projects'].includes(endpoint)) token = await require('./customer-fixture.cjs')(url);
    const response = await fetch(url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${endpoint}: ${JSON.stringify(result)}`);
    return result;
  };
  const product = (await api('/api/products')).products.find(item => !item.exhibitOnly);
  const orderData = { productId: product.id, mode: 'buy', quantity: 1, contact: '电话查询测试甲方', phone: '13800003221', address: '湖南省长沙市虚构测试区验收路 321 号', date: '2099-01-01' };
  const first = await api('/api/orders', orderData);
  const second = await api('/api/orders', { ...orderData, phone: '+86 138-0000-3221', mode: 'rent', duration: 3 });
  const other = await api('/api/orders', { ...orderData, phone: '13800003222' });

  await t.test('完整电话显示同号购买和租赁，不泄露列表以外的私有字段', async () => {
    for (const phone of ['13800003221', '+86 138-0000-3221', '008613800003221']) {
      const { orders } = await api('/api/guest/phone-orders', { phone });
      assert.deepEqual(new Set(orders.map(order => order.id)), new Set([first.order.id, second.order.id]));
      for (const order of orders) {
        for (const key of ['phone', 'contact', 'address', 'notes', 'history', 'files', 'secretHash', 'accessKey', 'token']) assert.equal(order[key], undefined);
      }
      assert.deepEqual(new Set(orders.map(order => order.mode)), new Set(['buy', 'rent']));
    }
    assert.deepEqual((await api('/api/guest/phone-orders', { phone: '00003221' })).orders, []);
    assert.deepEqual((await api('/api/guest/phone-orders', { phone: '13800003229' })).orders, []);
    for (const phone of ['', '13800', 'abcdef', null]) await api('/api/guest/phone-orders', { phone }, undefined, 400);
  });
  await t.test('电话仅打开匹配的订单，令牌不能越权到同号另一单或后台', async () => {
    await api('/api/guest/phone-order', { phone: orderData.phone, orderId: other.order.id }, undefined, 401);
    await api('/api/guest/phone-order', { phone: orderData.phone, orderId: 'SO-missing' }, undefined, 401);
    const opened = await api('/api/guest/phone-order', { phone: orderData.phone, orderId: first.order.number });
    assert.equal(opened.order.id, first.order.id);
    assert.ok(opened.token); assert.equal(opened.order.secretHash, undefined);
    assert.equal((await api(`/api/orders/${first.order.id}`, undefined, opened.token)).order.id, first.order.id);
    await api(`/api/orders/${second.order.id}`, undefined, opened.token, 403);
    await api(`/api/orders/${other.order.id}`, undefined, opened.token, 403);
    await api('/api/admin/users', undefined, opened.token, 403);
    const chat = await api('/api/conversations', { kind: 'order', recordId: first.order.id }, opened.token);
    assert.equal(chat.conversation.recordId, first.order.id);
    await api('/api/conversations', { kind: 'order', recordId: second.order.id }, opened.token, 403);
    await api('/api/guest/lookup', { orderId: first.order.id, phone: orderData.phone, code: first.accessCode });
    await api('/api/guest/phone-orders', { phone: orderData.phone }, undefined, 403, { Origin: 'https://untrusted.example' });
  });
  await t.test('服务重启后仍可按电话查询，不依赖浏览器存储或旧链接', async () => {
    await platform.close(); platform = createPlatform({ root, dataDir }); url = await platform.start(0);
    const list = await api('/api/guest/phone-orders', { phone: orderData.phone });
    assert.equal(list.orders.length, 2);
    const result = await api('/api/guest/phone-order', { phone: orderData.phone, orderId: second.order.id });
    assert.equal(result.order.mode, 'rent');
    assert.ok(result.token);
  });
  await t.test('一分钟内最多六十次电话查询，不影响原有带凭证查询', async () => {
    /* 上一子测试在新服务上已经执行两次电话请求，此处准确补齐本轮额度。 */
    for (let count = 2; count < 60; count++) await api('/api/guest/phone-orders', { phone: '13800003229' });
    await api('/api/guest/phone-orders', { phone: orderData.phone }, undefined, 429);
    await api('/api/guest/phone-order', { phone: orderData.phone, orderId: first.order.id }, undefined, 429);
    await api('/api/guest/lookup', { orderId: first.order.id, phone: orderData.phone, code: first.accessCode });
  });
  console.log(`电话查询测试隔离目录：${dataDir}`);
});
