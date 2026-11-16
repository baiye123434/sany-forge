'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

/* 显式隔离开关及固定测试端口，避免触碰日常 MySQL 或 APPDATA。
 * 只创建新库/新账号，不执行 DROP 或清库；进程输出保留内存，报告只含检查结果和数量。 */
const project = path.resolve(__dirname, '../..');
const qaRoot = 'D:\\Projects\\sany-forge-v3-qa-20261027';
const dataDir = path.join(qaRoot, 'import-app');
const database = 'sany_import_qa';
const user = 'sany_import_qa';
const mysql = 'D:\\MySQL\\mysql-8.0.29-winx64\\bin\\mysql.exe';
const java = path.join(project, 'runtime/java/bin/java.exe');
const jar = path.join(project, 'runtime/server/sany-forge-server.jar');
const fixturePath = process.env.SANY_IMPORT_FIXTURE;
const rootPassword = process.env.SANY_IMPORT_MYSQL_ROOT_PASSWORD;
const password = crypto.randomBytes(30).toString('base64url');
const checks = [];
const reportFile = path.join(qaRoot, `legacy-import-report-${Date.now()}.json`);
let app;
let reportCounts;

function ensure(value, message) { if (!value) throw new Error(message); }
async function check(name, action) {
  try { await action(); checks.push({ name, passed: true }); console.log('通过：' + name); }
  catch (error) { checks.push({ name, passed: false }); throw error; }
}
function sql(statement, admin = false) {
  const args = ['--protocol=TCP', '--host=127.0.0.1', '--port=33307', '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names', '--user=' + (admin ? 'root' : user)];
  if (!admin) args.push('--database=' + database);
  const child = spawnSync(mysql, args, { input: statement, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, MYSQL_PWD: admin ? rootPassword : password }, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  ensure(child.status === 0, '隔离 MySQL 操作失败，原始输出已脱敏。');
  return child.stdout.trim();
}
function businessDigest() {
  return crypto.createHash('sha256').update(sql(`SELECT kind,id,CAST(body AS CHAR) FROM records ORDER BY kind,id;
    SELECT id,owner_kind,owner_id,name,mime,HEX(bytes),created_at FROM files ORDER BY id;
    SELECT id,actor,action,target,at,detail FROM audit ORDER BY id;
    SELECT prefix,day,value FROM document_sequences ORDER BY prefix,day;`)).digest('hex');
}
function javaEnv() {
  return { ...process.env, SANY_MYSQL_URL: `jdbc:mysql://127.0.0.1:33307/${database}?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false`,
    SANY_DB_USER: user, SANY_DB_PASSWORD: password, SANY_PLATFORM_DATA: dataDir,
    SANY_WEB_ROOT: path.join(project, 'dist'), SANY_PLATFORM_PORT: '0', SANY_MANAGED_PROCESS: '1' };
}
function importProcess() {
  const result = spawnSync(java, ['-Dfile.encoding=UTF-8', '-jar', jar, '--import-legacy=' + fixturePath], {
    cwd: project, env: javaEnv(), windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return { status: result.status, out: result.stdout || '', error: !!result.error };
}
async function startApp() {
  return await new Promise((resolve, reject) => {
    app = spawn(java, ['-Dfile.encoding=UTF-8', '-jar', jar], { cwd: project, env: javaEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', ready = false;
    const timeout = setTimeout(() => reject(new Error('隔离 Java 服务启动超时。')), 45000);
    app.stdout.on('data', bytes => {
      output += bytes.toString('utf8');
      const match = output.match(/SANY_JAVA_READY=(http:\/\/127\.0\.0\.1:\d+)/);
      if (match && !ready) { ready = true; clearTimeout(timeout); resolve(match[1]); }
    });
    app.stderr.on('data', () => {});
    app.on('error', () => { clearTimeout(timeout); reject(new Error('无法启动自包含 Java 运行时。')); });
    app.on('exit', () => { clearTimeout(timeout); if (!ready) reject(new Error('隔离 Java 服务在就绪前退出。')); });
  });
}
async function stopApp() {
  if (!app || app.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { app.kill(); reject(new Error('隔离 Java 服务未能按时优雅退出。')); }, 15000);
    app.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('隔离 Java 服务退出码异常。')); });
    app.stdin.end('SANY_SHUTDOWN\n');
  });
}

(async () => {
  ensure(process.env.SANY_TEST_RUN === 'isolated' && rootPassword && fixturePath && path.isAbsolute(fixturePath), '需要显式隔离开关、测试管理密码和合成快照绝对路径。');
  ensure(fs.existsSync(java) && fs.existsSync(jar), '自包含 Java 或服务 JAR 不存在。');
  ensure(!fs.existsSync(dataDir), '独立导入资料目录已存在，拒绝重用或覆盖。');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  ensure(fixture.format === 'sany-forge-legacy-v1' && fixture.records.length === 10 && fixture.records.some(row => row.id === 'USR-fixture'), '只接受本项目生成的合成验收快照。');
  const key = Buffer.from(fixture.faceKey, 'base64');
  const syntheticPassword = 'legacy-import-test-2026!';
  let base, staffToken, customerToken;
  const api = async (endpoint, body, token, status = 200) => {
    const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    ensure(response.status === status, 'HTTP 验证失败：' + endpoint + '，状态 ' + response.status + '。');
    return await response.json();
  };

  await check('创建仅限本次验收的新库及专用账号', async () => {
    ensure(sql("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='sany_import_qa';", true) === '0', '验收库已存在，拒绝覆盖。');
    ensure(sql("SELECT COUNT(*) FROM mysql.user WHERE User='sany_import_qa';", true) === '0', '验收专用账号已存在，拒绝覆盖。');
    sql(`CREATE DATABASE sany_import_qa CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
      CREATE USER 'sany_import_qa'@'127.0.0.1' IDENTIFIED BY '${password}';
      GRANT ALL PRIVILEGES ON sany_import_qa.* TO 'sany_import_qa'@'127.0.0.1';`, true);
    fs.mkdirSync(dataDir, { recursive: true });
  });
  await check('CLI 导入数量完整且未启动 HTTP', async () => {
    const imported = importProcess();
    ensure(imported.status === 0 && !imported.error && !imported.out.includes('SANY_JAVA_READY='), '独立 CLI 导入失败或意外开启 HTTP。');
    const match = imported.out.match(/SANY_IMPORT_COMPLETE=(\{[^\r\n]+\})/);
    ensure(match, '导入成功计数标识缺失。');
    reportCounts = JSON.parse(match[1]);
    ensure(JSON.stringify(reportCounts) === JSON.stringify({ records: 10, files: 1, audit: 1, documentSequences: 1 }), '导入结果数量不符。');
    const counts = sql('SELECT COUNT(*) FROM records; SELECT COUNT(*) FROM files; SELECT COUNT(*) FROM audit; SELECT COUNT(*) FROM document_sequences;').split(/\r?\n/).map(Number);
    ensure(counts.join(',') === '10,1,1,1', '数据库实际行数不符。');
  });
  await check('原始 32 字节密钥精确恢复', async () => ensure(fs.readFileSync(path.join(dataDir, 'face.key')).equals(key), '迁移密钥不一致。'));
  await check('重复导入被拒绝且业务数据与密钥均不变', async () => {
    const before = businessDigest(), result = importProcess();
    ensure(result.status !== 0 && !result.out.includes('SANY_IMPORT_COMPLETE='), '重复导入未被拒绝。');
    ensure(before === businessDigest() && fs.readFileSync(path.join(dataDir, 'face.key')).equals(key), '重复导入改动了已有内容。');
  });
  await check('自包含 Java 启动真实 MySQL 服务', async () => {
    base = await startApp(); const health = await api('/api/health');
    ensure(health.runtime === 'java' && health.storage === 'mysql', '后端运行时不符。');
  });
  await check('原员工密码及 Node 人脸密文完成验证', async () => {
    const challenge = await api('/api/login', { username: 'legacy_fixture_admin', password: syntheticPassword });
    ensure(challenge.challenge && challenge.enroll === false && challenge.user.faceEnrolled === true, '原员工密码或人脸状态不符。');
    const samples = [0, ...challenge.turns.map(turn => turn === 'left' ? -0.25 : 0.25)].map(yaw => ({ yaw, descriptor: Array(128).fill(0.25) }));
    const verified = await api('/api/face/verify', { challenge: challenge.challenge, samples });
    ensure(verified.token && verified.user.id === 'USR-fixture', '原人脸向量验证失败。'); staffToken = verified.token;
    const wrong = await api('/api/login', { username: 'legacy_fixture_admin', password: syntheticPassword });
    await api('/api/face/verify', { challenge: wrong.challenge, samples: [0, ...wrong.turns.map(turn => turn === 'left' ? -0.25 : 0.25)].map(yaw => ({ yaw, descriptor: Array(128).fill(1) })) }, undefined, 401);
  });
  await check('原客户密码可登录且错误密码被拒绝', async () => {
    const result = await api('/api/customer/login', { phone: '13800009999', password: syntheticPassword });
    ensure(result.token && result.customer.id === 'CUS-fixture', '原客户密码验证失败。'); customerToken = result.token;
    await api('/api/customer/login', { phone: '13800009999', password: 'wrong-password-for-test' }, undefined, 401);
  });
  await check('Node 原回执及重发回执均可访问原记录', async () => {
    const receipt = 'AQABAgMEBQYHCAkKC45JnzCF3WsrxrG5E_OVkrM3-RytU4YmW8gfCPb8dKlyksmHYU3luCIt24lxiBMXCA5rZe8DYCQXOGxaM6kZA66nVDgQpx8VfbmOeQPo5b1kHC7CNb42TUsIVWKUXGunxYHbpnOhVPDFzDg9ARlA2Q';
    const opened = await api('/api/guest/access', { key: receipt });
    ensure(opened.kind === 'project' && opened.project.id === 'PR-old' && !Object.hasOwn(opened.project, 'secretHash'), '原回执无法恢复或泄漏凭证。');
    const again = await api('/api/guest/access', { key: opened.accessKey });
    ensure(again.project.id === 'PR-old', '重新签发回执不可用。');
  });
  await check('原附件内容和 MIME 逐字节保持一致', async () => {
    const response = await fetch(base + '/api/files/MAT-fixture', { headers: { Authorization: 'Bearer ' + staffToken }, signal: AbortSignal.timeout(15000) });
    ensure(response.status === 200 && response.headers.get('content-type') === 'image/png', '原附件访问失败。');
    ensure(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(fixture.files[0].data, 'base64')), '原附件字节发生变化。');
  });
  await check('迁移后新订单沿用原流水并继续递增', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
    const prior = Math.max(0, ...fixture.documentSequences.filter(row => row.prefix === 'SO' && row.day === today).map(row => row.value));
    const body = { productId: 'CUSTOM-fixture', mode: 'buy', quantity: 1, contact: '合成验收客户', phone: '13800009999', address: '湖南省长沙市测试区合成验收路 100 号', date: '2099-01-01', customerType: 'personal' };
    const first = (await api('/api/orders', body, customerToken)).order, second = (await api('/api/orders', body, customerToken)).order;
    ensure(first.number === `SO-${today}-${String(prior + 1).padStart(4, '0')}` && second.number === `SO-${today}-${String(prior + 2).padStart(4, '0')}`, '迁移后单号续接不正确。');
  });
  await check('独立 Java 进程通过管理管道优雅退出', stopApp);
})().catch(error => {
  console.error(error.message || '合成导入验收失败。');
  process.exitCode = 1;
}).finally(async () => {
  try { await stopApp(); } catch { process.exitCode = 1; }
  const report = { test: 'synthetic-legacy-sqlite-to-mysql', generatedAt: new Date().toISOString(),
    realUserDataAccessed: false, runtime: 'bundled-java-17', storage: 'mysql-8.0.29', importedCounts: reportCounts,
    passed: checks.length === 11 && checks.every(item => item.passed) && !process.exitCode, checks };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, report: reportFile }));
});
