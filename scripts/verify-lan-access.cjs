'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createPlatform } = require('../server/java-platform.cjs');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const qaRoot = path.join(root, '.qa', `局域网访问验收-${Date.now()}`);
const dataDir = path.join(qaRoot, 'business-data');
const reportPath = path.join(qaRoot, 'lan-access-report.json');
const virtualAdapter = /vmware|virtual|vethernet|hyper-v|virtualbox|docker|wsl|vpn|radmin|tailscale|loopback/i;
const report = { qaRoot, dataDir, reportPath, startedAt: new Date().toISOString(), candidates: [], ok: false };
let platform;

function isPrivateIpv4(address) {
  const parts = String(address).split('.').map(Number);
  return parts.length === 4 && parts.every(value => Number.isInteger(value) && value >= 0 && value <= 255) &&
    (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
}
function candidates() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => {
    if (virtualAdapter.test(name)) return [];
    return (entries || []).filter(info => (info.family === 'IPv4' || info.family === 4) && !info.internal &&
      isPrivateIpv4(info.address)).map(info => ({ interface: name, address: info.address }));
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function health(url) {
  // 直接使用 Node HTTP，不读取开发机代理变量，确保请求真实到达局域网网卡。
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/api/health`, { timeout: 5000, agent: false }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 10000) request.destroy(new Error('健康接口响应过大。')); });
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('局域网健康检查超时。')));
    request.on('error', reject);
  });
}
function save() {
  fs.mkdirSync(qaRoot, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function main() {
  for (const name of ['SANY_MYSQL_URL', 'SANY_DB_USER', 'SANY_DB_PASSWORD']) delete process.env[name];
  fs.mkdirSync(dataDir, { recursive: true });
  report.candidates = candidates();
  assert.ok(report.candidates.length, '没有检测到可用于手机访问的物理局域网 IPv4 地址。');
  platform = createPlatform({ root, dataDir, exposeLan: true });
  report.loopbackUrl = await platform.start(0);
  report.loopbackHealth = await health(report.loopbackUrl);
  const port = new URL(report.loopbackUrl).port;
  for (const item of report.candidates) {
    const url = `http://${item.address}:${port}`;
    try {
      report.lanHealth = await health(url);
      report.lanUrl = url;
      break;
    } catch (error) {
      item.error = error.message;
    }
  }
  assert.ok(report.lanUrl, '服务仅能通过本机回环地址访问，未成功监听物理局域网地址。');
  assert.deepEqual(report.lanHealth, report.loopbackHealth);
  assert.deepEqual(report.lanHealth, { ok: true, app: 'sany-service-platform', version: pkg.version, storage: 'mysql', runtime: 'java' });
  const lock = JSON.parse(fs.readFileSync(path.join(dataDir, 'java-platform.lock'), 'utf8'));
  report.ownedProcesses = lock.children;
  report.ok = true;
}

main().catch(error => { report.error = error.stack || error.message; process.exitCode = 1; }).finally(async () => {
  try { await platform?.close(); } catch (error) { report.closeError = error.message; process.exitCode = 1; }
  await new Promise(resolve => setTimeout(resolve, 500));
  report.remainingPids = (report.ownedProcesses || []).map(item => item.pid).filter(alive);
  if (report.remainingPids.length) { report.ok = false; report.error = `验收后仍有进程存活：${report.remainingPids.join(',')}`; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`局域网访问验收${report.ok ? '通过' : '失败'}：${reportPath}`);
});
