'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

/* 单色版本只改填色，不重画官方标识；原始红色资料继续保留，便于核对来源与轮廓。 */
test('黑色品牌标识保留全部原始路径和画布，只改变填色', () => {
  const original = fs.readFileSync(path.join(root, 'dist/assets/brand/sany-logo.svg'), 'utf8');
  const mono = fs.readFileSync(path.join(root, 'dist/assets/brand/sany-logo-mono.svg'), 'utf8');
  assert.ok(original.includes('fill:#c6000b'));
  assert.ok(mono.includes('fill:#141513'));
  assert.equal(mono.trim(), original.replace('fill:#c6000b', 'fill:#141513').trim());
});

test('导航、页脚和启动说明统一引用黑色品牌标识', () => {
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, '打开三一装备作品展.html'), 'utf8');
  assert.equal((index.match(/<img[^>]+src="assets\/brand\/sany-logo-mono\.svg"/g) || []).length, 2);
  assert.ok(index.includes('href="assets/brand/sany-logo-mono.svg"'));
  assert.ok(launcher.includes('src="dist/assets/brand/sany-logo-mono.svg"'));
});
