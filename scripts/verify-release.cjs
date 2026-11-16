'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const args = process.argv.slice(2);
if (args.length) throw new Error('当前脚本只执行发布目录核验，不再复制或覆盖交付程序。');
const releaseDir = path.resolve(root, pkg.build.directories.output);
const resources = path.join(releaseDir, 'win-unpacked', 'resources');
const manifestPath = path.join(root, 'dist', 'release-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const hashBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = file => hashBytes(fs.readFileSync(file));
if (manifest.version !== pkg.version || manifest.backend?.runtime !== 'java' || manifest.backend?.storage !== 'mysql' || !manifest.layout) throw new Error('发布清单不是当前 Java/MySQL 版本。');
const buffer = fs.readFileSync(path.join(resources, 'app.asar'));
const header = JSON.parse(buffer.subarray(16, 16 + buffer.readUInt32LE(12)));
const base = 8 + buffer.readUInt32LE(4);
function readPacked(name) {
  let entry = header;
  for (const part of name.split('/')) { entry = entry.files?.[part]; if (!entry) throw new Error(`桌面包缺少启动资源：${name}`); }
  if (entry.unpacked || entry.link || entry.offset === undefined) throw new Error(`启动资源没有纳入 asar 校验：${name}`);
  return buffer.subarray(base + Number(entry.offset), base + Number(entry.offset) + entry.size);
}
function packedNames(node = header, prefix = '') {
  return Object.entries(node.files || {}).flatMap(([name, entry]) => entry.files ? packedNames(entry, prefix + name + '/') : [prefix + name]);
}
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`打包资源不允许包含链接：${file}`);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const allowedAsar = new Set(['package.json']);
const expectedExternal = new Set(['www/release-manifest.json']);
for (const [name, expected] of Object.entries(manifest.files)) {
  const item = manifest.layout[name];
  if (!item || !['asar', 'resources'].includes(item.location) || /(^|\/)\.\.(\/|$)|^[\\/]|:/.test(name + '/' + item.path)) throw new Error('发布清单包含无效的资源路径。');
  const packedBytes = item.location === 'asar' ? readPacked(item.path) : fs.readFileSync(path.join(resources, item.path));
  if (hashBytes(packedBytes) !== expected || hash(path.join(root, name)) !== expected) throw new Error(`源码与成品 SHA-256 不一致：${name}`);
  if (item.location === 'asar') allowedAsar.add(item.path); else expectedExternal.add(item.path);
}
for (const name of packedNames()) if (!allowedAsar.has(name)) throw new Error(`asar 混入未批准的旧后端或其他文件：${name}`);
for (const folder of ['www', 'runtime']) for (const file of filesIn(path.join(resources, folder))) {
  const name = path.relative(resources, file).replaceAll('\\', '/');
  if (!expectedExternal.has(name)) throw new Error(`外部运行资源混入未记录文件：${name}`);
}
if (hash(manifestPath) !== hash(path.join(resources, 'www', 'release-manifest.json'))) throw new Error('打包清单与源码清单不一致。');
const packedPackage = JSON.parse(readPacked('package.json'));
if (packedPackage.version !== manifest.version || packedPackage.main !== 'desktop/main.cjs' || packedPackage.name !== pkg.name || packedPackage.productName !== '三一匠造员工工作台') throw new Error('桌面包版本或员工主入口不一致。');
for (const name of ['server/platform.cjs', 'server/java-platform.cjs']) if (readPacked(name).toString('utf8').includes('node:sqlite')) throw new Error('启动器混入旧 SQLite 业务后端。');
console.log(`Java/MySQL 成品资源核验通过：v${manifest.version}，${Object.keys(manifest.files).length} 个网页、启动器和外部运行资源 SHA-256 全部一致。`);
const portable = path.join(releaseDir, `三一匠造-${manifest.version}-员工工作台-Windows便携版.exe`);
const normalExe = path.join(releaseDir, 'win-unpacked', `${pkg.productName}.exe`);
for (const file of [portable, normalExe]) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 50 * 1024 * 1024) throw new Error(`缺少完整成品：${file}`);
}
function shortcutTarget(shortcut) {
  const script = `$ErrorActionPreference='Stop';$shell=New-Object -ComObject WScript.Shell;$target=$shell.CreateShortcut($env:SANY_SHORTCUT).TargetPath;[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($target))`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, SANY_SHORTCUT: shortcut }, encoding: 'utf8', windowsHide: true, shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows 快捷方式读取失败：${shortcut}\n${result.stderr || ''}`);
  return Buffer.from(result.stdout.trim(), 'base64').toString('utf16le');
}
const normalShortcut = path.join(releaseDir, `${pkg.productName}.lnk`);
const portableShortcut = path.join(releaseDir, `${pkg.productName}-便携版.lnk`);
for (const [shortcut, expected] of [[normalShortcut, normalExe], [portableShortcut, portable]]) {
  if (!fs.existsSync(shortcut) || path.resolve(shortcutTarget(shortcut)).toLowerCase() !== path.resolve(expected).toLowerCase()) {
    throw new Error(`Windows 图标入口没有指向对应 EXE：${shortcut}`);
  }
}
console.log(`正常 EXE 图标入口核验通过：${normalShortcut}`);
console.log(`便携版核验通过：${portable}`);
