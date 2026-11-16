'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const candidates = [path.join(root, 'node_modules', 'electron', 'dist'), path.join(root, '.desktop-reference')];
const electronDist = candidates.find(folder => fs.existsSync(path.join(folder, 'electron.exe')));
if (process.platform !== 'win32') throw new Error('当前仅构建 Windows x64 桌面程序。');
if (!electronDist) throw new Error('缺少 Electron 运行库。先运行 npm install，再运行 npm run electron:install；交付的正常启动版和便携版无需构建依赖。');
const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(builder)) throw new Error('缺少 electron-builder，请先运行 npm install。');
// 优先使用按需下载的 Electron；旧开发缓存只作为已有环境的回退，避免源码默认携带重复运行库。
const result = spawnSync(process.execPath, [builder, '--win', 'portable', '--x64', '--publish', 'never',
  `--config.electronDist=${electronDist}`], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true, shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
/* Windows 快捷方式直达同次构建的真实 EXE，不复制或拆散旁边的 resources 运行库。 */
const pkg = require('../package.json');
const releaseDir = path.resolve(root, pkg.build.directories.output);
const normalExe = path.join(releaseDir, 'win-unpacked', `${pkg.productName}.exe`);
if (!fs.existsSync(normalExe)) throw new Error(`缺少正常启动程序：${normalExe}`);
const portableExe = path.join(releaseDir, `三一匠造-${pkg.version}-员工工作台-Windows便携版.exe`);
if (!fs.existsSync(portableExe)) throw new Error(`缺少便携启动程序：${portableExe}`);
function createShortcut(target, shortcut, description) {
  const script = `$ErrorActionPreference='Stop';$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($env:SANY_SHORTCUT);$link.TargetPath=$env:SANY_TARGET;$link.WorkingDirectory=Split-Path -LiteralPath $env:SANY_TARGET;$link.IconLocation=$env:SANY_TARGET+',0';$link.Description=$env:SANY_DESCRIPTION;$link.WindowStyle=1;$link.Save()`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const shortcutResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    cwd: root, env: { ...process.env, SANY_TARGET: target, SANY_SHORTCUT: shortcut, SANY_DESCRIPTION: description },
    encoding: 'utf8', windowsHide: true, shell: false
  });
  if (shortcutResult.error) throw shortcutResult.error;
  if (shortcutResult.status !== 0 || !fs.existsSync(shortcut)) throw new Error(`Windows 快捷方式生成失败：${shortcut}\n${shortcutResult.stderr || ''}`);
}
const normalShortcut = path.join(releaseDir, `${pkg.productName}.lnk`);
const portableShortcut = path.join(releaseDir, `${pkg.productName}-便携版.lnk`);
createShortcut(normalExe, normalShortcut, '启动三一匠造员工工作台');
createShortcut(portableExe, portableShortcut, '启动三一匠造员工工作台便携版');
console.log(`真实 EXE 与图标入口已同步：${normalExe}；${normalShortcut}；${portableShortcut}`);
