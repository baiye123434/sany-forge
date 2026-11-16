'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist/request-id.js'), 'utf8');

function load(provider) {
  const window = { crypto: provider };
  vm.runInNewContext(source, { window, Uint8Array, Date, Math }, { filename: 'request-id.js' });
  return window.SanyRequestId;
}

test('请求编号在安全上下文中优先使用浏览器原生 UUID', () => {
  const runtime = load({ randomUUID: () => 'native-request-id' });
  assert.equal(runtime.create(), 'native-request-id');
});

test('局域网 HTTP 无 randomUUID 时仍生成合规且不同的 UUID v4', () => {
  let serial = 0;
  const runtime = load({ getRandomValues(bytes) { for (let index = 0; index < bytes.length; index++) bytes[index] = serial + index; serial++; return bytes; } });
  const first = runtime.create(), second = runtime.create();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(second, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

test('客户与员工页面先加载编号兼容层，业务脚本不再直接调用 randomUUID', () => {
  for (const file of ['dist/index.html', 'dist/staff.html', 'dist/index-2.4-archive.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.indexOf('request-id.js') > html.indexOf('version.js'), file);
    const firstConsumer = Math.min(...['project-service.js', 'customer-service.js', 'staff-app.js', 'commerce.js'].map(name => html.indexOf(name)).filter(index => index >= 0));
    assert.ok(html.indexOf('request-id.js') < firstConsumer, file);
  }
  for (const file of ['customer-service.js', 'project-service.js', 'followup-service.js', 'staff-app.js', 'commerce.js']) {
    const script = fs.readFileSync(path.join(root, 'dist', file), 'utf8');
    assert.doesNotMatch(script, /crypto\.randomUUID\s*\(/, file);
    assert.match(script, /SanyRequestId\.create\s*\(/, file);
  }
});
