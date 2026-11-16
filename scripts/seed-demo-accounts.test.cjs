'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { createPlatform } = require('../server/java-platform.cjs');
const { DEMO_ACCOUNTS, localBaseUrl, seedDemoAccounts } = require('./seed-demo-accounts.cjs');

const root = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function post(baseUrl, route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`);
  return result;
}

test('只允许本机根地址', () => {
  assert.equal(localBaseUrl('http://localhost:8790'), 'http://localhost:8790');
  assert.throws(() => localBaseUrl('http://192.168.1.20:8790'), /只允许写入/);
  assert.throws(() => localBaseUrl('https://example.com'), /只允许写入/);
  assert.throws(() => localBaseUrl('http://127.0.0.1:8790/staff.html'), /只允许写入/);
});

test('在隔离空库创建并验证全部演示账号', { timeout: 180000 }, async () => {
  const dataDir = path.join(root, '.qa', `demo-accounts-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const platform = createPlatform({ root, dataDir, mysqlPort: await freePort() });
  try {
    const baseUrl = await platform.start(0);
    const result = await seedDemoAccounts({ baseUrl, apply: true });
    assert.deepEqual(result.staff.map(account => account.username), ['demo.admin', 'demo.service', 'demo.reviewer']);
    assert.equal(result.customer.phone, DEMO_ACCOUNTS.customer.phone);

    for (const account of [DEMO_ACCOUNTS.admin, DEMO_ACCOUNTS.service, DEMO_ACCOUNTS.reviewer]) {
      const session = await post(baseUrl, '/api/login', {
        username: account.username,
        password: account.password,
        role: account.role
      });
      assert.equal(session.user.role, account.role);
    }
    const customer = await post(baseUrl, '/api/customer/login', {
      phone: DEMO_ACCOUNTS.customer.phone,
      password: DEMO_ACCOUNTS.customer.password
    });
    assert.ok(customer.token);
    await assert.rejects(() => seedDemoAccounts({ baseUrl, apply: true }), /不是空库/);
  } finally {
    await platform.close();
  }
});
