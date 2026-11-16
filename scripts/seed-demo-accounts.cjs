'use strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8790';
const DEMO_ACCOUNTS = Object.freeze({
  admin: Object.freeze({ username: 'demo.admin', name: '演示超级管理员', password: 'SanyForge-Admin-2026!', role: 'admin' }),
  service: Object.freeze({ username: 'demo.service', name: '演示在线客服', password: 'SanyForge-Service-2026!', role: 'service' }),
  reviewer: Object.freeze({ username: 'demo.reviewer', name: '演示订单审核员', password: 'SanyForge-Review-2026!', role: 'reviewer' }),
  customer: Object.freeze({ phone: '13800000001', password: 'SanyForge-Customer-2026!' })
});

/* 公开演示密码只能写入全新本机库，禁止连接局域网或线上实例。 */
function localBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value);
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !localHosts.has(url.hostname) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('演示账号只允许写入 http://127.0.0.1、http://localhost 或 http://[::1] 的根地址。');
  }
  return url.origin;
}

async function api(baseUrl, route, token, body, fetchImpl) {
  const response = await fetchImpl(baseUrl + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${route}: ${response.status} 服务返回了非 JSON 内容。`); }
  if (!response.ok) throw new Error(`${route}: ${response.status} ${result.error || result.message || 'request failed'}`);
  return result;
}

async function seedDemoAccounts({ baseUrl = DEFAULT_BASE_URL, apply = false, fetchImpl = globalThis.fetch } = {}) {
  if (!apply) throw new Error('必须显式添加 --apply，确认向全新本机数据库创建公开演示账号。');
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 版本不支持 fetch，请使用 Node.js 18 或以上版本。');
  const base = localBaseUrl(baseUrl);
  const bootstrap = await api(base, '/api/bootstrap', null, undefined, fetchImpl);
  if (bootstrap.setupNeeded !== true) {
    throw new Error('目标数据库不是空库，已拒绝写入公开演示账号；请勿对现有业务实例执行此命令。');
  }

  const admin = await api(base, '/api/setup', null, {
    username: DEMO_ACCOUNTS.admin.username,
    name: DEMO_ACCOUNTS.admin.name,
    password: DEMO_ACCOUNTS.admin.password
  }, fetchImpl);
  if (!admin.token) throw new Error('超级管理员创建后未返回登录令牌。');

  for (const account of [DEMO_ACCOUNTS.service, DEMO_ACCOUNTS.reviewer]) {
    await api(base, '/api/staff/users', admin.token, {
      username: account.username,
      name: account.name,
      password: account.password,
      roles: [account.role]
    }, fetchImpl);
  }
  await api(base, '/api/customer/register', null, {
    phone: DEMO_ACCOUNTS.customer.phone,
    password: DEMO_ACCOUNTS.customer.password,
    repeat: DEMO_ACCOUNTS.customer.password
  }, fetchImpl);

  /* 创建后逐一重新登录，避免只写入成功但凭据或岗位不可用。 */
  for (const account of [DEMO_ACCOUNTS.admin, DEMO_ACCOUNTS.service, DEMO_ACCOUNTS.reviewer]) {
    const session = await api(base, '/api/login', null, {
      username: account.username,
      password: account.password,
      role: account.role
    }, fetchImpl);
    if (!session.token || session.user?.role !== account.role) throw new Error(`${account.username} 登录或岗位验证失败。`);
  }
  const customer = await api(base, '/api/customer/login', null, {
    phone: DEMO_ACCOUNTS.customer.phone,
    password: DEMO_ACCOUNTS.customer.password
  }, fetchImpl);
  if (!customer.token) throw new Error('演示客户账号登录验证失败。');

  return {
    baseUrl: base,
    staff: [DEMO_ACCOUNTS.admin, DEMO_ACCOUNTS.service, DEMO_ACCOUNTS.reviewer].map(({ username, name, role }) => ({ username, name, role })),
    customer: { phone: DEMO_ACCOUNTS.customer.phone }
  };
}

async function main() {
  const urlArgument = process.argv.find(argument => argument.startsWith('--url='));
  const result = await seedDemoAccounts({
    baseUrl: urlArgument ? urlArgument.slice('--url='.length) : DEFAULT_BASE_URL,
    apply: process.argv.includes('--apply')
  });
  console.log(JSON.stringify({ ...result, message: '演示账号已创建并验证，密码见 README.md。' }, null, 2));
}

module.exports = { DEFAULT_BASE_URL, DEMO_ACCOUNTS, localBaseUrl, seedDemoAccounts };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
