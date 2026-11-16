'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const outputDir = path.join(root, 'release', `service-${pkg.version}-offline-installer`);
const artifactName = `三一匠造-${pkg.version}-员工工作台-Windows离线安装包.exe`;
const artifactPath = path.join(outputDir, artifactName);
const redist = path.join(root, 'runtime', 'installer', 'vc_redist.x64.exe');
const dependencyCheck = path.join(root, 'runtime', 'installer', 'offline-vc-runtime.ps1');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const requiredFiles = [
  path.join(root, 'dist', 'index.html'),
  path.join(root, 'runtime', 'java', 'bin', 'java.exe'),
  path.join(root, 'runtime', 'mysql-current', 'bin', 'mysqld.exe'),
  path.join(root, 'runtime', 'server', 'sany-forge-server.jar'),
  path.join(root, 'installer', 'vc-runtime.nsh'),
  redist,
  dependencyCheck
];

if (process.platform !== 'win32') throw new Error('离线安装包当前仅支持 Windows x64。');
for (const file of requiredFiles) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`缺少安装包运行资源：${file}`);
}

/* 构建前先执行与安装器相同的校验，避免把损坏或非微软签名的依赖封进成品。 */
const dependencyResult = spawnSync(powershell, [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', dependencyCheck,
  '-RedistributablePath', redist, '-ValidateOnly'
], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
if (dependencyResult.error) throw dependencyResult.error;
if (dependencyResult.status !== 0) {
  throw new Error(`离线依赖校验失败：\n${dependencyResult.stdout || ''}\n${dependencyResult.stderr || ''}`);
}
process.stdout.write(dependencyResult.stdout || '');

const electronCandidates = [path.join(root, 'node_modules', 'electron', 'dist'), path.join(root, '.desktop-reference')];
const electronDist = electronCandidates.find(folder => fs.existsSync(path.join(folder, 'electron.exe')));
const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!electronDist) throw new Error('缺少 Electron 运行库，请先完成 npm install 和 npm run electron:install。');
if (!fs.existsSync(builder)) throw new Error('缺少 electron-builder，请先完成 npm install。');

const buildResult = spawnSync(process.execPath, [
  builder, '--win', 'nsis', '--x64', '--publish', 'never',
  `--config.electronDist=${electronDist}`,
  `--config.directories.output=${path.relative(root, outputDir)}`
], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true, shell: false });
if (buildResult.error) throw buildResult.error;
if (buildResult.status !== 0) process.exit(buildResult.status || 1);
if (!fs.existsSync(artifactPath) || fs.statSync(artifactPath).size < 100 * 1024 * 1024) {
  throw new Error(`离线安装包未生成或体积异常：${artifactPath}`);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex').toUpperCase();
}
function versionOutput(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) throw result.error || new Error(`${executable} 版本检查失败。`);
  return `${result.stdout || ''} ${result.stderr || ''}`.trim().replace(/\s+/g, ' ');
}

const artifactInfo = fs.statSync(artifactPath);
const reportPath = path.join(outputDir, '安装包校验信息.txt');
const mysqlOutput = versionOutput(path.join(root, 'runtime', 'mysql-current', 'bin', 'mysqld.exe'), ['--version']);
const mysqlVersion = mysqlOutput.match(/\bVer\s+\d+\.\d+\.\d+.*$/)?.[0] || mysqlOutput;
const report = [
  `产品：${pkg.productName}`,
  `版本：${pkg.version}`,
  `安装包：${artifactName}`,
  `安装包字节数：${artifactInfo.size}`,
  `安装包 SHA-256：${sha256(artifactPath)}`,
  `内置 Java：${versionOutput(path.join(root, 'runtime', 'java', 'bin', 'java.exe'), ['-version'])}`,
  `内置 MySQL：${mysqlVersion}`,
  `内置 VC++ 运行库：${fs.statSync(redist).size} 字节，SHA-256 ${sha256(redist)}`,
  `构建时间：${new Date().toISOString()}`,
  '支持系统：64 位 Windows 10 / Windows 11',
  '说明：安装器会检查 VC++ x64 v14；已满足则跳过，缺失或过旧则使用包内微软签名程序静默安装。Java、MySQL、Electron 均为应用私有运行时，无需用户预装。'
].join('\r\n') + '\r\n';
fs.writeFileSync(reportPath, `\uFEFF${report}`, 'utf8');
console.log(`离线安装包已生成：${artifactPath}`);
console.log(`校验信息：${reportPath}`);
