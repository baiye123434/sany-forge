'use strict';
const fs = require('node:fs');
const path = require('node:path');

/* 连接配置只接受单一明确源地址，避免账号凭据被重定向到嵌入凭据或任意子路径。 */
function normalizeServiceUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('中心服务地址不能为空。');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('中心服务地址不是有效 URL。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    throw new Error('中心服务地址必须是 HTTPS 源地址，或本机 HTTP 地址；不能带账号、密码、路径或查询参数。');
  }
  return url.origin;
}
function readConnection({ env, appDir, executableDir, isolated }) {
  if (isolated) return null;
  if (env.SANY_SERVICE_URL) return normalizeServiceUrl(env.SANY_SERVICE_URL);
  const folder = env.PORTABLE_EXECUTABLE_DIR || executableDir || appDir;
  const file = path.join(folder, '客服连接配置.json');
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(key => key !== 'serviceUrl')) throw new Error('客服连接配置.json 仅支持 serviceUrl 字段。');
  return normalizeServiceUrl(config.serviceUrl);
}
function isServicePage(input, origin) {
  try {
    const url = new URL(input);
    return url.origin === origin && !url.username && !url.password &&
      url.pathname === '/staff.html' && url.search === '?client=employee';
  } catch { return false; }
}
module.exports = { normalizeServiceUrl, readConnection, isServicePage };
