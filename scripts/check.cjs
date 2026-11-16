'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['dist', 'server', 'desktop', 'scripts'].flatMap(dir =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(c?js)$/.test(entry.name))
    .map(entry => path.join(dir, entry.name)));
/* 检查项目自行维护的脚本，不重复扫描已发布的 vendor 压缩库和历史备份。 */
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const pkg = require('../package.json');
const lock = require('../package-lock.json');
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('软件版本与依赖锁不一致。');
console.log(`语法检查通过：${files.length} 个脚本；软件版本 ${pkg.version}。`);
