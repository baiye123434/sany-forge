'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* 显式门禁只允许调用为本轮验收启动的回环服务；每次创建独立账号，不清空数据库。 */
const url = process.env.SANY_TEST_URL;
if (process.env.SANY_TEST_RUN !== 'isolated' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url || '')) {
  throw new Error('需设置 SANY_TEST_RUN=isolated 和隔离 Java/MySQL 服务的 SANY_TEST_URL。');
}
const tag = crypto.randomBytes(5).toString('hex');
const password = `Services-${crypto.randomUUID()}`;
const phone = `138${String(crypto.randomInt(10000000, 99999998))}`;
const phone2 = String(BigInt(phone) + 1n);
const material = { name: '服务回归材料.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=' };

test('Java/MySQL 客户工程客服与跟进真实 HTTP 回归', { timeout: 180000 }, async t => {
  let admin, staff, reviewer, otherStaff, customer, another, product, secret, normal, conversation, support, plan;
  async function api(path, { method = 'GET', body, token, expected = 200, headers = {} } = {}) {
    const response = await fetch(url + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  }
  const post = (path, body, token, expected = 200) => api(path, { method: 'POST', body, token, expected });
  const staffUser = role => post('/api/register', { username: `qs.${role}.${tag}`, name: `隔离服务回归 ${role}`, password, repeat: password, role: role === 'other' ? 'service' : role });
  const projectBody = (extra = {}) => ({ title: `隔离工程 ${tag}`, contact: '虚构回归客户', phone, confidential: true, items: [{ productId: product.id, quantity: 2 }], customerType: 'enterprise', ...extra });
  const review = async (status, token = reviewer.token, extra = {}) => {
    normal.project = (await post(`/api/projects/${normal.project.id}/review`, { revision: normal.project.revision, status, note: `回归 ${status}`, ...extra }, token)).project;
  };

  await t.test('确认 Java/MySQL 服务并创建独立角色客户和测试设备', async () => {
    const health = await api('/api/health');
    assert.equal(health.storage, 'mysql'); assert.equal(health.runtime, 'java');
    admin = await staffUser('admin'); staff = await staffUser('service'); reviewer = await staffUser('reviewer'); otherStaff = await staffUser('other');
    customer = await post('/api/customer/register', { phone, password, repeat: password });
    another = await post('/api/customer/register', { phone: phone2, password, repeat: password });
    product = (await post('/api/admin/products', { code: `QS-${tag}`, name: `隔离服务测试设备 ${tag}`, category: '测试设备', specs: [] }, admin.token)).product;
    assert.ok(product.id); assert.ok(customer.token); assert.equal(customer.customer.password, undefined); assert.equal(customer.customer.role, undefined);
    assert.equal((await api('/api/me', { token: staff.token })).user.id, staff.user.id);
  });

  await t.test('客户账号手机号归一化重复校验及令牌域隔离', async () => {
    await post('/api/customer/register', { phone: `+86 ${phone.slice(0,3)}-${phone.slice(3)}`, password, repeat: password }, undefined, 409);
    await post('/api/customer/login', { phone, password: 'incorrect' }, undefined, 401);
    await post('/api/customer/register', { phone: 'bad', password, repeat: password }, undefined, 400);
    await post('/api/customer/register', { phone: String(BigInt(phone) + 2n), password: 'short', repeat: 'short' }, undefined, 400);
    await api('/api/customer/me', { token: staff.token, expected: 401 });
    await api('/api/admin/users', { token: customer.token, expected: 401 });
    await api('/api/customer/accounts', { token: staff.token, expected: 403 });
    await api('/api/customer/after-sales', { expected: 401 });
    assert.deepEqual((await api('/api/customer/after-sales', { token: customer.token })).tickets, []);
    assert.equal((await post('/api/customer/login', { phone, password })).customer.id, customer.customer.id);
  });

  await t.test('工程创建材料约束账号归属电话查询和加密回执', async () => {
    await post('/api/projects', projectBody(), undefined, 401);
    await post('/api/projects', projectBody(), staff.token, 401);
    await post('/api/projects', projectBody({ customerType: null }), customer.token, 400);
    await post('/api/projects', projectBody({ customerType: 'admin' }), customer.token, 400);
    await post('/api/projects', projectBody({ files: [material] }), customer.token, 400);
    await post('/api/projects', projectBody({ items: [] }), customer.token, 400);
    await post('/api/projects', projectBody({ items: [{ productId: product.id, quantity: 0 }] }), customer.token, 400);
    await post('/api/projects', projectBody({ items: Array(51).fill({ productId: product.id, quantity: 1 }) }), customer.token, 400);
    await post('/api/projects', projectBody({ items: [{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 1 }] }), customer.token, 400);
    secret = await post('/api/projects', projectBody(), customer.token);
    normal = await post('/api/projects', projectBody({ confidential: false, files: [material], title: `普通工程 ${tag}`, phone: `+86 ${phone}` }), customer.token);
    const other = await post('/api/projects', projectBody({ phone: phone2 }), another.token);
    assert.match(secret.project.number, /^PR-\d{8}-\d{4}$/); assert.equal(secret.project.secretHash, undefined);
    assert.equal(secret.project.customerId, customer.customer.id); assert.equal(secret.project.customerType, 'enterprise');
    const own = (await api('/api/customer/records', { token: customer.token })).records;
    assert.deepEqual(own.filter(row => [secret.project.id, normal.project.id, other.project.id].includes(row.id)).map(row => row.id).sort(), [secret.project.id, normal.project.id].sort());
    await post('/api/customer/record', { kind: 'project', id: secret.project.id }, another.token, 403);
    await api(`/api/projects/${secret.project.id}`, { token: other.token, expected: 403 });
    const summary = await post('/api/guest/phone-projects', { phone: `0086${phone}` });
    assert.equal(summary.projects.filter(row => [secret.project.id, normal.project.id].includes(row.id)).length, 2);
    for (const item of summary.projects) for (const field of ['files','notes','phone','contact','token','accessKey','secretHash']) assert.equal(item[field], undefined);
    const reopened = await post('/api/guest/phone-project', { phone, projectId: secret.project.number });
    assert.equal(reopened.project.id, secret.project.id);
    await api(`/api/projects/${normal.project.id}`, { token: reopened.token, expected: 403 });
    const restored = await post('/api/guest/access', { key: secret.accessKey });
    assert.equal(restored.project.id, secret.project.id);
    const tampered = Buffer.from(secret.accessKey, 'base64url'); tampered[30] ^= 1;
    await post('/api/guest/access', { key: tampered.toString('base64url') }, undefined, 401);
    await post('/api/projects/lookup', { projectId: secret.project.number, phone, code: secret.accessCode });
    await post('/api/projects/lookup', { projectId: secret.project.number, phone, code: 'wrong' }, undefined, 401);
  });

  await t.test('工程审核补充闭环角色限制及同修订并发冲突', async () => {
    await post(`/api/projects/${normal.project.id}/review`, { revision: 1, status: 'reviewing', note: '服务人员不能审核' }, staff.token, 403);
    await post(`/api/projects/${normal.project.id}/review`, { revision: 1, status: 'accepted', note: '不能跳步' }, reviewer.token, 409);
    await review('needs_info');
    await post(`/api/projects/${normal.project.id}/supplement`, { revision: 2, notes: '后台不能代填' }, admin.token, 403);
    await post(`/api/projects/${normal.project.id}/supplement`, { revision: 1, notes: '旧版本' }, normal.token, 409);
    normal.project = (await post(`/api/projects/${normal.project.id}/supplement`, { revision: 2, notes: '补充设备数量', items: [{ productId: product.id, quantity: 3 }], files: [material] }, normal.token)).project;
    assert.equal(normal.project.status, 'submitted'); assert.equal(normal.project.files.length, 2);
    const responses = await Promise.all([1, 2].map(() => fetch(url + `/api/projects/${normal.project.id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewer.token}` },
      body: JSON.stringify({ revision: normal.project.revision, status: 'reviewing', note: '并发审核' }), signal: AbortSignal.timeout(15000)
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200,409]); await Promise.all(responses.map(response => response.arrayBuffer()));
    normal.project = (await api(`/api/projects/${normal.project.id}`, { token: normal.token })).project;
    await review('accepted'); await review('closed');
    assert.equal(normal.project.history.length, 6); assert.equal(normal.project.status, 'closed');
    await post(`/api/projects/${secret.project.id}/review`, { revision: 1, status: 'needs_info', note: '保密禁附件', files: [material] }, reviewer.token, 400);
  });

  await t.test('业务客服卡片幂等附件权限及双方未读已读', async () => {
    conversation = (await post('/api/conversations', { kind: 'project', recordId: normal.project.id }, normal.token)).conversation;
    assert.equal((await post('/api/conversations', { kind: 'project', recordId: normal.project.number }, staff.token)).conversation.id, conversation.id);
    await post('/api/conversations', { kind: 'project', recordId: normal.project.id }, reviewer.token, 403);
    const path = `/api/conversations/${conversation.id}`;
    await api(path, { token: secret.token, expected: 403 });
    const data = { clientMessageId: 'first', text: '请查看工程材料', files: [material], sendCard: true };
    const message = (await post(path + '/messages', data, normal.token)).message;
    assert.equal((await post(path + '/messages', data, normal.token)).message.id, message.id);
    assert.equal(message.card.recordId, normal.project.id); assert.equal(message.actorId, undefined); assert.equal(message.clientMessageId, undefined);
    const download = await fetch(url + '/api/files/' + message.files[0].id, { headers: { Authorization: `Bearer ${normal.token}` } });
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(material.data, 'base64'));
    await api('/api/files/' + message.files[0].id, { token: secret.token, expected: 403 });
    await api('/api/files/' + message.files[0].id, { token: reviewer.token, expected: 403 });
    await post(path + '/messages', { clientMessageId: 'fake-card', text: '伪造记录', recordId: secret.project.id }, normal.token, 400);
    assert.equal((await api('/api/conversations/unread', { token: staff.token })).conversations.find(row => row.recordId === normal.project.id).unread, 1);
    await post(path + '/read', { seq: 1 }, staff.token);
    assert.equal((await api('/api/conversations/unread', { token: staff.token })).conversations.some(row => row.recordId === normal.project.id), false);
    await post(path + '/messages', { clientMessageId: 'staff-reply', text: '资料已收到' }, staff.token);
    assert.equal((await api('/api/customer/notifications', { token: customer.token })).records.find(row => row.id === normal.project.id).unread, 1);
    assert.equal((await api('/api/customer/notifications', { token: another.token })).records.some(row => row.id === normal.project.id), false);
    await post(path + '/read', { seq: 2 }, normal.token); await post(path + '/read', { seq: 0 }, normal.token);
    assert.equal((await api('/api/customer/notifications', { token: customer.token })).records.find(row => row.id === normal.project.id).unread, 0);
    await post(path + '/read', { seq: 99999 }, normal.token, 400);
    const protectedChat = (await post('/api/conversations', { kind: 'project', recordId: secret.project.id }, secret.token)).conversation;
    await post(`/api/conversations/${protectedChat.id}/messages`, { clientMessageId: 'no-attachment', files: [material], text: '保密禁附件' }, staff.token, 400);
  });

  await t.test('业务消息超过两百条时分页游标不漏消息', async () => {
    const path = `/api/conversations/${conversation.id}`;
    for (let index=0; index<203; index++) await post(path + '/messages', { clientMessageId: `page-${index}`, text: `分页测试 ${index}` }, staff.token);
    const first = await api(path + '?after=0', { token: normal.token });
    assert.equal(first.messages.length, 200); assert.equal(first.latestSeq, 200); assert.equal(first.hasMore, true);
    const last = await api(path + '?after=' + first.latestSeq, { token: normal.token });
    assert.equal(last.messages.length, 5); assert.equal(last.latestSeq, 205); assert.equal(last.hasMore, false);
    assert.equal(new Set([...first.messages,...last.messages].map(message => message.seq)).size, 205);
    await api(path + '?after=-1', { token: normal.token, expected: 400 });
    await post(path + '/read', { seq: last.latestSeq }, normal.token);
  });

  await t.test('通用客服归属幂等和已读通知与业务客服独立', async () => {
    support = (await post('/api/customer/chat', {}, customer.token)).chat;
    assert.equal((await post('/api/customer/chat', {}, customer.token)).chat.id, support.id);
    const path = `/api/customer/chats/${support.id}`;
    await api(path + '/messages', { token: another.token, expected: 403 });
    await api(path + '/messages', { token: reviewer.token, expected: 403 });
    const data = { text: '通用设备咨询', requestId: 'support-first' };
    const duplicate = await Promise.all([post(path + '/messages', data, customer.token), post(path + '/messages', data, customer.token)]);
    assert.equal(duplicate[0].message.id, duplicate[1].message.id);
    await post(path + '/messages', { ...data, text: '同标识不同内容' }, customer.token, 409);
    await post(path + '/messages', { text: '服务人员回复', requestId: 'support-reply' }, staff.token);
    assert.equal((await api(path + '/messages', { token: customer.token })).messages.length, 2);
    assert.equal((await api('/api/customer/notifications', { token: customer.token })).supportUnread, 1);
    await post(path + '/read', { seq: 2 }, customer.token); await post(path + '/read', { seq: 0 }, customer.token);
    await post(path + '/read', {}, customer.token, 400);
    assert.equal((await api('/api/customer/notifications', { token: customer.token })).supportUnread, 0);
    assert.equal((await api('/api/customer/chats', { token: staff.token })).chats.find(chat => chat.id === support.id).unread, 1);
    await post(path + '/read', { seq: 2 }, staff.token);
    assert.equal((await api('/api/customer/chats', { token: staff.token })).chats.find(chat => chat.id === support.id).unread, 0);
  });

  await t.test('跟进创建改派完成幂等权限和并发修订', async () => {
    const data = { kind: 'project', recordId: normal.project.id, ownerId: staff.user.id, action: '确认设备交付方案', dueAt: '2099-01-01T00:00:00.000Z', priority: 'normal', requestId: `plan-${tag}` };
    await post('/api/followups', data, reviewer.token, 403); await post('/api/followups', data, otherStaff.token, 403);
    await post('/api/followups', { ...data, requestId: 'bad-date', dueAt: '2099-02-30T00:00:00.000Z' }, admin.token, 400);
    await post('/api/followups', { ...data, requestId: 'bad-priority', priority: 'critical' }, admin.token, 400);
    plan = (await post('/api/followups', data, admin.token)).task;
    assert.equal(plan.requestHash, undefined); assert.equal(plan.requestId, undefined);
    assert.equal((await post('/api/followups', data, admin.token)).task.id, plan.id);
    await post('/api/followups', { ...data, action: '改动后的内容' }, admin.token, 409);
    assert.ok((await api('/api/followups', { token: reviewer.token })).tasks.some(task => task.id === plan.id));
    await post(`/api/followups/${plan.id}/complete`, { revision: 1, note: '非负责人' }, otherStaff.token, 403);
    plan = (await post(`/api/followups/${plan.id}/reschedule`, { revision: 1, ownerId: otherStaff.user.id, dueAt: '2099-02-01T00:00:00.000Z', note: '调整负责人' }, admin.token)).task;
    await post(`/api/followups/${plan.id}/complete`, { revision: 2, note: '旧负责人' }, staff.token, 403);
    await post(`/api/followups/${plan.id}/complete`, { revision: 1, note: '旧修订' }, otherStaff.token, 409);
    const responses = await Promise.all([1,2].map(() => fetch(url + `/api/followups/${plan.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherStaff.token}` },
      body: JSON.stringify({ revision: 2, note: '客户已确认' }), signal: AbortSignal.timeout(15000)
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200,409]); await Promise.all(responses.map(response => response.arrayBuffer()));
    plan = (await api('/api/followups', { token: admin.token })).tasks.find(task => task.id === plan.id);
    assert.equal(plan.status, 'done'); assert.equal(plan.history.length, 3);
    assert.equal((await api(`/api/projects/${normal.project.id}`, { token: normal.token })).project.status, 'closed');
    await post(`/api/followups/${plan.id}/complete`, { revision: 3, note: '重复完成' }, otherStaff.token, 409);
  });

  await t.test('修改密码停用和注销均撤销对应客户会话', async () => {
    const newPassword = `Changed-${crypto.randomUUID()}`;
    await post('/api/customer/password', { currentPassword: 'wrong', password: newPassword, repeat: newPassword }, customer.token, 401);
    await post('/api/customer/password', { currentPassword: password, password: newPassword, repeat: newPassword }, customer.token);
    await api('/api/customer/me', { token: customer.token, expected: 401 });
    customer = await post('/api/customer/login', { phone, password: newPassword });
    await post('/api/customer/accounts/' + customer.customer.id, { active: false }, admin.token);
    await api('/api/customer/me', { token: customer.token, expected: 401 });
    await post('/api/customer/accounts/' + customer.customer.id, { active: true }, admin.token);
    customer = await post('/api/customer/login', { phone, password: newPassword });
    assert.equal((await api(`/api/customer/chats/${support.id}/messages`, { token: customer.token })).messages.length, 2);
    await post('/api/customer/logout', {}, customer.token);
    await api('/api/customer/me', { token: customer.token, expected: 401 });
    await api('/api/projects', { token: another.token, expected: 401 });
  });
});
