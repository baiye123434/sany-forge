'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：node scripts/verify-packaged.cjs [已构建的 Windows 便携版.exe]');
  console.log('只验收既有成品；复制到 .qa/成品验收… 中文目录，隔离 APPDATA、TEMP 与业务库，连续启动两次并验证正常退出。');
  process.exit(0);
}
if (process.platform !== 'win32' || args.length > 1) throw new Error('此脚本仅用于 Windows，最多接受一个既有便携版 exe 路径。');
const originalExe = path.resolve(args[0] || path.join(root, pkg.build.directories.output, `三一匠造-${pkg.version}-员工工作台-Windows便携版.exe`));
if (!/\.exe$/i.test(originalExe) || !fs.statSync(originalExe).isFile()) throw new Error('请指定已经构建完成的 Windows 便携版 exe。');
const qaRoot = path.join(root, '.qa', `成品验收-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
const copiedExe = path.join(qaRoot, path.basename(originalExe));
const dataDir = path.join(qaRoot, 'desktop-test-profile', 'business-data');
const lockPath = path.join(dataDir, 'java-platform.lock');
const resultPath = path.join(qaRoot, 'packaged-report.json');
const result = { version: pkg.version, originalExe, copiedExe, qaRoot, startedAt: new Date().toISOString(), runs: [], ok: false };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
async function hash(file) {
  const value = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
function saveResult() { fs.writeFileSync(resultPath, JSON.stringify(result, null, 2)); }

/* 仅在本项目全新的 .qa 子目录中写入测试文件；不删除失败现场，不读取或改写日常业务库。 */
async function main() {
  fs.mkdirSync(qaRoot, { recursive: true });
  fs.writeFileSync(path.join(qaRoot, 'verify-root.json'), JSON.stringify({ purpose: 'sany-forge-packaged-qa', root: qaRoot }), { flag: 'wx' });
  for (const folder of ['应用数据', '本地数据', '临时解压']) fs.mkdirSync(path.join(qaRoot, folder));
  fs.copyFileSync(originalExe, copiedExe, fs.constants.COPYFILE_EXCL);
  result.exeSha256 = await hash(originalExe);
  assert.equal(await hash(copiedExe), result.exeSha256, '中文目录中的 exe 副本必须与原成品一致。');
  const credentials = path.join(dataDir, 'db-credentials.json');
  let firstCredentialsHash;
  for (let run = 1; run <= 2; run++) {
    const reportPath = path.join(qaRoot, `startup-${run}.json`);
    const env = { ...process.env, APPDATA: path.join(qaRoot, '应用数据'), LOCALAPPDATA: path.join(qaRoot, '本地数据'),
      TEMP: path.join(qaRoot, '临时解压'), TMP: path.join(qaRoot, '临时解压'),
      SANY_VERIFY_ROOT: qaRoot, SANY_VERIFY_OUTPUT: reportPath, SANY_PLATFORM_DATA: dataDir };
    for (const key of ['SANY_MYSQL_URL', 'SANY_DB_USER', 'SANY_DB_PASSWORD', 'SANY_INTERACTION_QA_ROOT',
      'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_FILE', 'SANY_SERVICE_URL']) delete env[key];
    const tracked = new Set();
    const track = () => {
      const lock = readJson(lockPath), report = readJson(reportPath);
      if (Number.isInteger(lock?.pid)) tracked.add(lock.pid);
      for (const item of lock?.children || []) if (Number.isInteger(item.pid)) tracked.add(item.pid);
      if (Number.isInteger(report?.desktopPid)) tracked.add(report.desktopPid);
      for (const item of report?.ownedProcesses || []) if (Number.isInteger(item.pid)) tracked.add(item.pid);
      return report;
    };
    console.log(`第 ${run} 次成品验收：中文 exe 路径、双员工窗口、独立 Java/MySQL、正常退出。`);
    const child = spawn(copiedExe, ['--verify-startup', '--verify-extra-window'], { cwd: qaRoot, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = false, exitCode = null, spawnError;
    child.on('error', error => { spawnError = error; exited = true; });
    child.on('exit', code => { exitCode = code; exited = true; });
    for (const [stream, label] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      fs.appendFileSync(path.join(qaRoot, `portable-${run}-${label}.log`), chunk);
    });
    let report, timedOut = false;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      report = track();
      if (spawnError) throw spawnError;
      if (exited && report?.shutdown?.completed && [...tracked].every(pid => !alive(pid))) break;
      if (exited && report?.error && [...tracked].every(pid => !alive(pid))) break;
      if (exited && !report && !tracked.size) throw new Error(`便携版退出但没有生成报告，退出码 ${exitCode}；请查看本次 portable 日志。`);
      await delay(250);
    }
    if (Date.now() >= deadline) {
      timedOut = true;
      /* 请求本次隐藏桌面应用走正常关闭流程，不按进程名称终止 Java/MySQL 或全局服务。 */
      fs.writeFileSync(path.join(qaRoot, 'request-shutdown'), new Date().toISOString(), { flag: 'wx' });
      const closeDeadline = Date.now() + 45000;
      while (Date.now() < closeDeadline) {
        report = track();
        if (exited && [...tracked].every(pid => !alive(pid))) break;
        await delay(250);
      }
    }
    report = track();
    const remainingPids = [...tracked].filter(alive);
    const summary = { run, reportPath, exitCode, timedOut, trackedPids: [...tracked], remainingPids, report };
    result.runs.push(summary); saveResult();
    assert.equal(timedOut, false, `成品验收超时；已请求正常关闭，仍存活的本次 PID：${remainingPids.join(', ') || '无'}。`);
    assert.equal(exited, true, '便携版启动进程必须退出。');
    assert.equal(exitCode, 0, '便携版退出码必须为 0。');
    assert.equal(report?.packaged, true, '必须运行真实打包成品。');
    assert.equal(report?.version, pkg.version);
    assert.equal(report?.loaded, true, report?.error || '客服窗口必须加载并显示当前版本。');
    assert.equal(report?.windowCount, 2, '成品验收必须实际打开两个独立员工登录窗口。');
    assert.deepEqual(report?.rendererErrors, []);
    assert.deepEqual(report?.health, { ok: true, app: 'sany-service-platform', version: pkg.version, storage: 'mysql', runtime: 'java' });
    assert.equal(report?.isolatedDataDir, dataDir);
    assert.equal(within(path.join(qaRoot, '临时解压'), report?.resourcesPath || ''), true, '随包运行资源必须从本次中文临时目录加载。');
    assert.equal(within(qaRoot, report?.executable || ''), true);
    assert.match(report?.resourcesPath || '', /[^\x00-\x7f]/, '必须覆盖中文资源路径。');
    assert.equal(report?.ownedProcesses?.filter(item => /java\.exe$/i.test(item.executable)).length, 1);
    assert.ok(report?.ownedProcesses?.some(item => /mysqld\.exe$/i.test(item.executable)), '必须真实启动本次独立 MySQL。');
    for (const kind of ['service']) {
      assert.equal(report?.windows?.[kind]?.loaded, true);
      assert.equal(report?.windows?.[kind]?.versionVisible, true);
      assert.equal(report?.windows?.[kind]?.alwaysOnTop, false);
      assert.equal(report?.windows?.[kind]?.hasOpener, false);
      assert.equal(report?.windows?.[kind]?.hasNode, false);
      assert.equal(new URL(report.windows[kind].url).pathname, '/staff.html');
      assert.equal(new URL(report.windows[kind].url).searchParams.get('client'), 'employee');
    }
    assert.equal(report?.windows?.employees?.length, 2);
    for (const window of report.windows.employees) {
      assert.equal(window.loaded, true); assert.equal(window.versionVisible, true); assert.equal(window.alwaysOnTop, false);
      assert.equal(window.hasOpener, false); assert.equal(window.hasNode, false);
      assert.equal(new URL(window.url).pathname, '/staff.html'); assert.equal(new URL(window.url).searchParams.get('client'), 'employee');
    }
    assert.equal(report?.shutdown?.completed, true);
    assert.equal(report?.shutdown?.lockReleased, true);
    assert.equal(report?.shutdown?.serviceStopped, true);
    assert.deepEqual(remainingPids, [], '本次记录的桌面、Java、MySQL 进程必须全部退出。');
    assert.equal(fs.existsSync(lockPath), false);
    summary.credentialsSha256 = await hash(credentials);
    if (run === 1) firstCredentialsHash = summary.credentialsSha256;
    else assert.equal(summary.credentialsSha256, firstCredentialsHash, '第二次启动必须复用原凭据，不重新初始化或重置密码。');
    summary.passed = true; saveResult();
  }
  result.ok = true;
}
main().catch(error => { result.error = error.message; process.exitCode = 1; console.error(error.stack); }).finally(() => {
  result.finishedAt = new Date().toISOString();
  if (fs.existsSync(qaRoot)) saveResult();
  console.log(`成品验收${result.ok ? '通过' : '失败'}，报告：${resultPath}`);
});
