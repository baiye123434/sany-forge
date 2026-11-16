'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* 恢复测试会回滚整个隔离数据库的业务记录，必须在其他 HTTP 回归全部结束后单独运行。
 * 仅允许显式标记的本机测试服务；不连接或清空用户日常数据库，不删除任何备份文件。 */
const url = process.env.SANY_TEST_URL;
if (process.env.SANY_TEST_RUN !== 'isolated' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url || '')) {
  throw new Error('需设置 SANY_TEST_RUN=isolated 和隔离 Java/MySQL 服务的 SANY_TEST_URL。');
}
const tag = crypto.randomBytes(5).toString('hex');
const password = `Admin-regression-${crypto.randomUUID()}`;
const nextPassword = `Admin-updated-${crypto.randomUUID()}`;
const phone = `137${String(crypto.randomInt(10000000, 99999998))}`;
const phone2 = String(BigInt(phone) + 1n);
const material = { name: '备份恢复验证.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=' };

test('Java/MySQL 后台权限内容监控备份与恢复独立验收', { timeout: 120000 }, async t => {
  let admin, staff, customer, lateCustomer, originalPermissions, originalContent, product, before, after, backup, safetyBackup;
  const adminName = `qa.restore.admin.${tag}`, staffName = `qa.restore.staff.${tag}`;
  async function api(path, { method = 'GET', body, token, expected = 200 } = {}) {
    const response = await fetch(url + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  }
  const post = (path, body, token, expected = 200) => api(path, { method: 'POST', body, token, expected });
  const permissions = () => api('/api/admin/tools/permissions', { token: admin.token });
  const savePermissions = value => post('/api/admin/tools/permissions', value, admin.token);
  const saveContent = value => post('/api/admin/tools/content', value, admin.token);
  const projectBody = title => ({ title, contact: '虚构备份测试客户', phone, confidential: false, items: [{ productId: product.id, quantity: 1 }], files: [material] });
  try {
    await t.test('只在隔离 Java/MySQL 服务创建验收账号并读取初始配置', async () => {
      const health = await api('/api/health'); assert.equal(health.runtime, 'java'); assert.equal(health.storage, 'mysql');
      admin = await post('/api/register', { username: adminName, name: '隔离恢复管理员', role: 'admin', password, repeat: password });
      staff = await post('/api/register', { username: staffName, name: '隔离恢复服务人员', role: 'service', password, repeat: password });
      customer = await post('/api/customer/register', { phone, password, repeat: password });
      originalPermissions = structuredClone((await permissions()).config);
      originalContent = structuredClone((await api('/api/admin/tools/content', { token: admin.token })).content);
      product = (await post('/api/admin/products', { code: `BACKUP-${tag}`, name: `隔离恢复测试设备 ${tag}`, category: '测试设备', specs: [] }, admin.token)).product;
      await api('/api/admin/tools/monitor', { expected: 401 });
      await post('/api/admin/tools/backups', {}, staff.token, 403);
    });

    await t.test('MySQL 监控返回真实引擎统计且明确 SQLite WAL 不适用', async () => {
      const monitor = await api('/api/admin/tools/monitor', { token: admin.token });
      assert.equal(monitor.databaseEngine, 'MySQL'); assert.equal(monitor.integrity, 'ok');
      assert.equal(monitor.walApplicable, false); assert.equal(monitor.walBytes, 0);
      assert.equal(monitor.integrityScope, 'connection-and-table-access'); assert.ok(monitor.requests > 0);
      assert.ok(monitor.databaseBytes >= 0); assert.ok(monitor.memoryBytes > 0); assert.ok(Array.isArray(monitor.counts));
    });

    await t.test('岗位开关即时生效旧修订冲突且不能提升审核员客服权限', async () => {
      const config = structuredClone((await permissions()).config); config.roles.service.projects = false;
      const saved = (await savePermissions(config)).config;
      await api('/api/projects', { token: staff.token, expected: 403 });
      assert.equal((await api('/api/me', { token: staff.token })).user.capabilities.projects, false);
      await post('/api/admin/tools/permissions', config, admin.token, 409);
      const invalid = structuredClone(saved); invalid.roles.reviewer.chat = true;
      await post('/api/admin/tools/permissions', invalid, admin.token, 400);
      const enabled = structuredClone(saved); enabled.roles.service.projects = true;
      await savePermissions(enabled); assert.ok(Array.isArray((await api('/api/projects', { token: staff.token })).projects));
    });

    await t.test('首页发布内容和修订校验保留原接口', async () => {
      const current = (await api('/api/admin/tools/content', { token: admin.token })).content;
      const content = { revision: current.revision, title: `恢复前公告 ${tag}`, announcement: '<script>仅作为文本保存</script>', contact: '虚构演示客服', hours: '9:00-18:00', published: true };
      await saveContent(content);
      assert.equal((await api('/api/site-content')).content.title, content.title);
      assert.equal((await api('/api/site-content')).content.announcement, content.announcement);
      await post('/api/admin/tools/content', content, admin.token, 409);
    });

    await t.test('备份快照包含业务附件并拒绝非法编号和错误确认', async () => {
      before = await post('/api/projects', projectBody(`快照前工程 ${tag}`), customer.token);
      backup = (await post('/api/admin/tools/backups', {}, admin.token)).backup;
      assert.equal(backup.format, 'sany-forge-mysql-backup-v1'); assert.ok(backup.size > 0); assert.match(backup.sha256, /^[a-f0-9]{64}$/);
      assert.ok((await api('/api/admin/tools/backups', { token: admin.token })).backups.some(row => row.id === backup.id));
      const preview = await post('/api/admin/tools/restore-preview', { id: backup.id }, admin.token);
      assert.ok(preview.counts.some(row => row.kind === 'project' && row.count > 0));
      await post('/api/admin/tools/restore-preview', { id: '../../fake' }, admin.token, 400);
      await post('/api/admin/tools/restore-preview', { id: `backup-${crypto.randomUUID()}` }, admin.token, 404);
      await post('/api/admin/tools/restore', { id: backup.id, confirm: 'wrong' }, admin.token, 400);
      assert.equal((await api(`/api/projects/${before.project.id}`, { token: before.token })).project.status, 'submitted');
    });

    await t.test('快照后的业务变更账号密码和权限准备分别验证', async () => {
      after = await post('/api/projects', projectBody(`快照后工程 ${tag}`), customer.token);
      await post(`/api/projects/${before.project.id}/review`, { revision: 1, status: 'needs_info', note: '快照后的业务修改' }, admin.token);
      const content = (await api('/api/admin/tools/content', { token: admin.token })).content;
      await saveContent({ ...content, title: `恢复后应消失的公告 ${tag}` });
      await api('/api/admin/users/' + staff.user.id, { method: 'PATCH', token: admin.token, body: { password: nextPassword } });
      lateCustomer = await post('/api/customer/register', { phone: phone2, password, repeat: password });
      const config = structuredClone((await permissions()).config); config.roles.service.projects = false; await savePermissions(config);
      assert.ok(Number(after.project.number.slice(-4)) > Number(before.project.number.slice(-4)));
    });

    await t.test('执行隔离快照恢复自动留安全备份并撤销所有旧会话', async () => {
      assert.ok(backup && before && after && lateCustomer, '必须先完成本测试自己的快照及变更准备');
      const restored = await post('/api/admin/tools/restore', { id: backup.id, confirm: '恢复数据' }, admin.token);
      assert.equal(restored.ok, true); assert.match(restored.safetyBackup, /^backup-/); safetyBackup = restored.safetyBackup;
      await api('/api/me', { token: admin.token, expected: 401 });
      await api('/api/customer/me', { token: customer.token, expected: 401 });
      await api('/api/customer/me', { token: lateCustomer.token, expected: 401 });
      await api(`/api/projects/${before.project.id}`, { token: before.token, expected: 401 });
      assert.equal((await api('/api/site-content')).content.title, `恢复前公告 ${tag}`);
    });

    await t.test('业务和附件回到快照账号权限审计及单号高水位保持当前状态', async () => {
      admin = await post('/api/login', { username: adminName, password });
      staff = await post('/api/login', { username: staffName, password: nextPassword });
      await post('/api/login', { username: staffName, password }, undefined, 401);
      customer = await post('/api/customer/login', { phone, password });
      assert.equal((await post('/api/customer/login', { phone: phone2, password })).customer.id, lateCustomer.customer.id);
      assert.equal((await permissions()).config.roles.service.projects, false);
      await api('/api/projects', { token: staff.token, expected: 403 });
      const restored = await post('/api/customer/record', { kind: 'project', id: before.project.id }, customer.token);
      assert.equal(restored.project.status, 'submitted'); assert.equal(restored.project.revision, 1);
      await api(`/api/projects/${after.project.id}`, { token: admin.token, expected: 404 });
      const file = await fetch(url + '/api/files/' + restored.project.files[0].id, { headers: { Authorization: `Bearer ${restored.token}` } });
      assert.equal(file.status, 200); assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(material.data, 'base64'));
      const next = await post('/api/projects', projectBody(`恢复后新工程 ${tag}`), customer.token);
      assert.ok(Number(next.project.number.slice(-4)) > Number(after.project.number.slice(-4)), '已发出的编号不可因恢复而重用');
      const backups = (await api('/api/admin/tools/backups', { token: admin.token })).backups;
      assert.ok(backups.some(row => row.id === backup.id)); assert.ok(backups.some(row => row.id === safetyBackup));
      const audit = (await api('/api/admin/audit', { token: admin.token })).events;
      assert.ok(audit.some(event => event.action === '恢复业务数据' && event.target === backup.id));
      assert.ok(audit.some(event => event.action === '创建本机备份' && event.target === safetyBackup));
    });
  } finally {
    /* 保留本轮测试数据与安全备份供回查；全局展示内容和岗位开关恢复为测试前的值。 */
    if (originalPermissions || originalContent) {
      admin = await post('/api/login', { username: adminName, password });
      if (originalPermissions) {
        const current = (await permissions()).config;
        await savePermissions({ ...originalPermissions, revision: current.revision });
      }
      if (originalContent) {
        const current = (await api('/api/admin/tools/content', { token: admin.token })).content;
        await saveContent({ ...originalContent, revision: current.revision });
      }
    }
  }
});
