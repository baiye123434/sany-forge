'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = [path.join(root, 'node_modules', 'electron', 'dist'), path.join(root, '.desktop-reference')]
  .find(dir => fs.existsSync(path.join(dir, 'electron.exe')));
const runtime = path.join(root, '.desktop-dev');
const executable = path.join(runtime, 'electron.exe');
if (!source) throw new Error('未找到 Electron 运行库，请先运行 npm install，再在联网环境运行 npm run electron:install；也可直接使用交付的便携版软件。');
const oldPackage = path.join(source, 'resources', 'app.asar');
/* 解包参考库含原版 app.asar；另建开发运行库并排除旧包，保留参考库和旧版软件完整不动。 */
if (!fs.existsSync(executable)) {
  fs.cpSync(source, runtime, { recursive: true, force: false, filter: file => file !== oldPackage });
}
if (fs.existsSync(path.join(runtime, 'resources', 'app.asar'))) throw new Error('开发运行库包含旧 app.asar。为保护现有文件，已停止启动，请使用正式便携版。');
const child = spawn(executable, [root, ...process.argv.slice(2)], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code || 0; });
