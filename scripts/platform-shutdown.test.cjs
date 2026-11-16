'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createPlatform } = require('../server/platform.cjs');

/* 复现浏览器预连接：TCP 已建立但没有完整 HTTP 请求，不能让退出无限等待。 */
test('关闭服务可收回未完成的预连接，并允许隔离数据库重新打开', async () => {
  const root = path.resolve(__dirname, '..');
  const dataDir = fs.mkdtempSync(path.join(root, '.qa', 'shutdown-test-'));
  const platform = createPlatform({ root, dataDir });
  const url = new URL(await platform.start(0));
  const socket = net.connect(Number(url.port), url.hostname);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.on('error', () => {});
  socket.write('GET /api/health HTTP/1.1\r\n');
  let deadline;
  try {
    const closing = platform.close();
    assert.equal(platform.close(), closing, '重复关闭共用同一个收尾过程');
    await Promise.race([closing, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('服务未在限定时间内关闭')), 4000); })]);
  } finally { clearTimeout(deadline); socket.destroy(); await platform.close(); }
  const restarted = createPlatform({ root, dataDir });
  try {
    const address = await restarted.start(0);
    assert.equal((await (await fetch(address + '/api/health')).json()).ok, true);
  } finally { await restarted.close(); }
});
