'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const VERSION = require('../package.json').version;

/* 锁文件可能在 Windows 强制关机或任务管理器结束进程后遗留。
 * Windows 会复用 PID，因此除存活状态外还要核对进程映像名；PID 已被其他程序占用时按旧进程退出处理。 */
function platformLockStatus(content, inspectProcess) {
  let record;
  try { record = JSON.parse(String(content)); } catch { return { recoverable: false, reason: 'invalid' }; }
  if (!record || typeof record !== 'object' || !/^[A-Za-z0-9-]{16,100}$/.test(record.token || '') ||
      !Number.isInteger(record.pid) || record.pid <= 0 || !Array.isArray(record.children)) {
    return { recoverable: false, reason: 'invalid' };
  }
  const processes = [{ pid: record.pid, executable: record.executable }];
  for (const child of record.children) {
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return { recoverable: false, reason: 'invalid' };
    processes.push({ pid: child.pid, executable: child.executable });
  }
  const unique = [...new Map(processes.map(process => [process.pid, process])).values()];
  const pids = unique.map(process => process.pid);
  let activePids, reusedPids;
  try {
    activePids = [];
    reusedPids = [];
    for (const process of unique) {
      const identity = inspectProcess(process.pid);
      if (!identity) continue;
      if (typeof identity === 'string' && process.executable &&
          path.win32.basename(identity).toLowerCase() !== path.win32.basename(process.executable).toLowerCase()) {
        reusedPids.push(process.pid);
        continue;
      }
      activePids.push(process.pid);
    }
  }
  catch { return { recoverable: false, reason: 'unknown', record, pids }; }
  return { recoverable: activePids.length === 0, reason: activePids.length ? 'active' : 'stale', record, pids, activePids, reusedPids };
}

/* 自管 MySQL 使用稳定端口，方便 Navicat 等本机管理工具保存连接。
 * 只有显式设置 SANY_MYSQL_PORT 时才覆盖默认值，非法配置必须在启动前明确报错。 */
function resolveManagedMysqlPort(value) {
  const port = value === undefined ? 33307 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('自管 MySQL 端口无效，应为 1–65535 的整数。');
  return port;
}

/* 启动器只拥有本次创建的 Java/MySQL 子进程，不注册服务，默认避开系统 MySQL 使用的 3306。
 * 数据目录与旧 SQLite 版本分开；密码只通过私有配置文件、stdin 和环境变量传递。 */
function createPlatform(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const packaged = options.packaged === true || /\.asar(?:[\\/]|$)/i.test(root);
  const resourceRoot = packaged ? path.resolve(options.resourcesPath || process.resourcesPath) : root;
  const runtime = path.join(resourceRoot, 'runtime');
  const mysqlRuntimeBase = path.join(runtime, packaged ? 'mysql' : 'mysql-current');
  const webRoot = packaged ? path.join(resourceRoot, 'www') : path.join(root, 'dist');
  const dataDir = path.resolve(options.dataDir || process.env.SANY_PLATFORM_DATA ||
    path.join(process.env.APPDATA || root, 'sany-forge-platform-java'));
  const binaries = {
    java: path.join(runtime, 'java', 'bin', 'java.exe'),
    mysql: path.join(mysqlRuntimeBase, 'bin', 'mysql.exe'),
    mysqladmin: path.join(mysqlRuntimeBase, 'bin', 'mysqladmin.exe'),
    mysqld: path.join(mysqlRuntimeBase, 'bin', 'mysqld.exe'),
    jar: path.join(runtime, 'server', 'sany-forge-server.jar')
  };
  const mysqlDir = path.join(dataDir, 'mysql');
  const credentialsPath = path.join(dataDir, 'db-credentials.json');
  const lockPath = path.join(dataDir, 'java-platform.lock');
  const logDir = path.join(dataDir, 'logs');
  const runDir = path.join(dataDir, 'run');
  const children = new Set();
  const external = Boolean(process.env.SANY_MYSQL_URL);
  const managedMysqlPort = external ? null : resolveManagedMysqlPort(options.mysqlPort ?? process.env.SANY_MYSQL_PORT);
  const exposeLan = options.exposeLan === true;
  const httpBindAddress = exposeLan ? '0.0.0.0' : '127.0.0.1';
  let credentials, mysqlPort, javaProcess, mysqlProcess, ownedMysqlPid, startPromise, closePromise, closing = false, lockToken;
  let mysqlBasePath = mysqlRuntimeBase, mysqlDataPath = dataDir;
  let mysqlBinaries = { mysqld: binaries.mysqld, mysql: binaries.mysql, mysqladmin: binaries.mysqladmin };

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(promise, timeout) {
    let timer;
    try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); })]); }
    finally { clearTimeout(timer); }
  }
  const alive = state => state && !state.ended && Boolean(state.child.pid);
  const pidAlive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  function processIdentity(pid) {
    if (!pidAlive(pid)) return false;
    if (process.platform !== 'win32') return true;
    const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000
    });
    /* 查询失败时保持保守：仍视为存活，不能因权限或系统工具异常误接管真实数据库。 */
    if (result.status !== 0) return true;
    const line = String(result.stdout || '').trim().split(/\r?\n/).find(Boolean);
    if (!line || /^INFO:/i.test(line)) return false;
    const match = line.match(/^"((?:[^"]|"")+)"/);
    return match ? match[1].replace(/""/g, '"') : true;
  }
  const cancelled = () => { if (closing) throw new Error('平台启动已取消。'); };
  function scrub(value) {
    let result = String(value || '');
    for (const secret of [credentials?.rootPassword, credentials?.appPassword, process.env.SANY_DB_PASSWORD]) {
      if (secret) result = result.split(secret).join('[REDACTED]');
    }
    return result.replace(/((?:password|pwd)\s*[=:]\s*)[^\s;&]+/ig, '$1[REDACTED]');
  }
  function log(name, message) {
    try { fs.appendFileSync(path.join(logDir, name), `[${new Date().toISOString()}] ${scrub(message)}\n`, { mode: 0o600 }); }
    catch { /* 日志写入失败不能隐藏原始进程错误；启动与数据库写入仍各自报告失败。 */ }
  }
  function ownsLock() {
    try { return lockToken && JSON.parse(fs.readFileSync(lockPath, 'utf8')).token === lockToken; }
    catch { return false; }
  }
  function updateLock() {
    if (!ownsLock()) return;
    const processes = [...children].filter(alive).map(state => ({ pid: state.child.pid, executable: state.executable }));
    if (pidAlive(ownedMysqlPid) && !processes.some(item => item.pid === ownedMysqlPid)) processes.push({ pid: ownedMysqlPid, executable: mysqlBinaries.mysqld });
    fs.writeFileSync(lockPath, JSON.stringify({ token: lockToken, pid: process.pid, executable: process.execPath,
      at: new Date().toISOString(), children: processes }), { mode: 0o600 });
  }
  function acquireLock() {
    lockToken = crypto.randomUUID();
    const content = () => JSON.stringify({ token: lockToken, pid: process.pid, executable: process.execPath,
      at: new Date().toISOString(), children: [] });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.writeFileSync(lockPath, content(), { flag: 'wx', mode: 0o600 });
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') { lockToken = undefined; throw error; }
      }
      let original;
      try { original = fs.readFileSync(lockPath, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; lockToken = undefined; throw error; }
      const status = platformLockStatus(original, processIdentity);
      if (!status.recoverable) {
        lockToken = undefined;
        const detail = status.reason === 'active' ? `仍在运行的进程：${status.activePids.join('、')}` : '锁内容损坏或进程状态无法确认';
        const conflict = new Error(`此 Java 数据目录已被另一个启动进程占用（${detail}）。请先正常关闭使用该目录的平台；不要删除数据库或重置密码。`);
        conflict.code = 'EPLATFORMLOCKED';
        throw conflict;
      }
      const staleDir = path.join(logDir, 'stale-locks');
      const staleName = `java-platform-${new Date().toISOString().replace(/[:.]/g, '-')}-${status.record.token}.lock`;
      try {
        fs.mkdirSync(staleDir, { recursive: true });
        // 迁移前再次比对内容，缩小两个启动器同时恢复时误移动新锁的竞争窗口。
        if (fs.readFileSync(lockPath, 'utf8') !== original) continue;
        fs.renameSync(lockPath, path.join(staleDir, staleName));
        log('launcher.log', `已安全接管陈旧启动锁，原锁备份为 logs/stale-locks/${staleName}。`);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EEXIST') continue;
        lockToken = undefined;
        throw error;
      }
    }
    lockToken = undefined;
    const conflict = new Error('启动锁在接管期间持续变化，请稍后重试，未修改数据库。');
    conflict.code = 'EPLATFORMLOCKED';
    throw conflict;
  }
  function mysqlAsciiPath(target) {
    const absolute = path.resolve(target);
    const permitted = [mysqlRuntimeBase, dataDir];
    if (!permitted.some(value => value.toLowerCase() === absolute.toLowerCase())) throw new Error('MySQL 路径别名目标超出本应用范围。');
    if (/^[\x20-\x7e]+$/.test(absolute)) return absolute;
    // MySQL 8.0 的 Windows 参数可能按系统代码页解码；优先只读取得现有 8.3 路径。
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const literal = absolute.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop';$fso=New-Object -ComObject Scripting.FileSystemObject;[Console]::Write($fso.GetFolder('${literal}').ShortPath)`;
    const read = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 });
    const shortPath = String(read.stdout || '').trim();
    if (read.status === 0 && /^[\x20-\x7e]+$/.test(shortPath)) {
      try { if (fs.realpathSync(shortPath).toLowerCase() === fs.realpathSync(absolute).toLowerCase()) return shortPath; } catch { /* 不能解析的短路径不会用于启动。 */ }
    }
    const volume = path.parse(absolute).root;
    if (!/^[A-Za-z]:[\\/]$/.test(volume)) throw new Error('MySQL 中文网络路径无法建立同盘别名，请将应用放在本地磁盘。');
    const parent = path.join(volume, 'SanyForgeV3RuntimeLinks');
    fs.mkdirSync(parent, { recursive: true });
    if (fs.lstatSync(parent).isSymbolicLink() || !fs.lstatSync(parent).isDirectory()) throw new Error('MySQL 别名父目录不是普通目录，已停止启动。');
    const key = crypto.createHash('sha256').update(absolute.toLowerCase()).digest('hex').slice(0, 24);
    const alias = path.join(parent, `app-${key}`);
    let existing;
    try { existing = fs.lstatSync(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      // 只创建指向本应用两个已验证目录的 junction，绝不移动或删除原目录，也不覆盖既有链接。
      try { fs.symlinkSync(absolute, alias, 'junction'); }
      catch (error) { if (error.code !== 'EEXIST') throw new Error(`无法创建 MySQL 中文路径别名：${error.message}`); }
      existing = fs.lstatSync(alias);
    }
    if (!existing.isSymbolicLink() || fs.realpathSync(alias).toLowerCase() !== fs.realpathSync(absolute).toLowerCase()) {
      throw new Error('MySQL 路径别名已指向其他目录，已停止启动且未修改该链接。');
    }
    return alias;
  }
  function mysqlDescendants(state) {
    if (!state?.child.pid || path.basename(state.executable).toLowerCase() !== 'mysqld.exe') return [];
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process -Filter \"ParentProcessId=${state.child.pid} AND Name='mysqld.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`;
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 });
    if (result.status !== 0) return [];
    try {
      const parsed = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '').trim() || '[]');
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const expectedData = path.join(mysqlDataPath, 'mysql').toLowerCase();
      return records.filter(item => Number.isInteger(item.ProcessId) && item.ProcessId > 0 && item.ExecutablePath &&
        fs.realpathSync(item.ExecutablePath).toLowerCase() === fs.realpathSync(state.executable).toLowerCase() &&
        String(item.CommandLine).toLowerCase().includes(`--datadir=${expectedData}`)).map(item => item.ProcessId);
    } catch { return []; }
  }
  async function stopOwnedState(state) {
    if (!state) return;
    // Windows mysqld 会产生同映像的服务子进程；只结束已核对父 PID、映像和本实例 datadir 的子进程。
    const descendants = mysqlDescendants(state);
    if (alive(state)) state.child.kill();
    for (const pid of descendants) if (pidAlive(pid)) {
      log('launcher.log', `精确终止自有 MySQL 服务子进程 ${pid}。`);
      try { process.kill(pid); } catch { /* 已正常退出的进程不再处理。 */ }
    }
    await waitFor(state.done, 5000);
  }
  function launch(executable, args, settings = {}) {
    cancelled();
    const env = { ...process.env, ...settings.env };
    delete env.MYSQL_PWD;
    const child = spawn(executable, args, { cwd: dataDir, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { child, executable, ended: false, tail: '', error: null, result: null };
    state.done = new Promise(resolve => {
      const finish = (code, signal, error) => {
        if (state.ended) return;
        state.ended = true;
        state.error = error || null;
        state.result = { code, signal, error };
        try { updateLock(); } catch { /* 父进程关闭期间锁文件可能已经移交清理。 */ }
        resolve(state.result);
      };
      child.once('error', error => finish(null, null, error));
      child.once('close', (code, signal) => finish(code, signal));
    });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        pending += chunk;
        let next;
        while ((next = pending.indexOf('\n')) >= 0) {
          const line = scrub(pending.slice(0, next)); pending = pending.slice(next + 1);
          state.tail = (state.tail + line + '\n').slice(-8000);
          if (settings.logName) log(settings.logName, line);
        }
        if (pending.length > 65536) { state.tail = (state.tail + scrub(pending)).slice(-8000); pending = ''; }
      });
      stream.on('end', () => {
        if (!pending) return;
        const line = scrub(pending); state.tail = (state.tail + line).slice(-8000);
        if (settings.logName) log(settings.logName, line);
      });
    }
    child.stdin.on('error', () => {});
    children.add(state);
    updateLock();
    return state;
  }
  async function completed(state, timeout, label) {
    const result = await waitFor(state.done, timeout);
    if (!result) {
      await stopOwnedState(state);
      throw new Error(`${label}超时，请检查本机运行日志。`);
    }
    if (result.error || result.code !== 0) throw new Error(`${label}失败：${scrub(result.error?.message || state.tail || `退出码 ${result.code}`)}`);
    return state.tail;
  }
  async function availablePort(preferred = 0, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(preferred, host, () => {
        const port = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(port));
      });
    });
  }
  async function socketReady(port) {
    return new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      let settled = false;
      const done = value => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
      socket.setTimeout(1000);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
  }
  function loadCredentials() {
    if (fs.existsSync(credentialsPath)) {
      const saved = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      if (saved.version !== 1 || !/^[A-Za-z0-9_-]{48,128}$/.test(saved.rootPassword || '') || !/^[A-Za-z0-9_-]{48,128}$/.test(saved.appPassword || '')) {
        throw new Error('自管 MySQL 密码文件格式损坏，请保留原数据目录并恢复原密码文件；启动器不会重置数据库密码。');
      }
      return saved;
    }
    if (fs.existsSync(mysqlDir) && fs.readdirSync(mysqlDir).length) {
      throw new Error('MySQL 数据目录已有内容但缺少 db-credentials.json。请恢复配套密码文件，不能重新初始化或重置现有数据库。');
    }
    const saved = { version: 1, rootPassword: crypto.randomBytes(48).toString('base64url'),
      appPassword: crypto.randomBytes(48).toString('base64url'), phase: 'generated', createdAt: new Date().toISOString() };
    fs.writeFileSync(credentialsPath, JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
    return saved;
  }
  function saveCredentials() {
    const temporary = `${credentialsPath}.${lockToken}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, credentialsPath);
  }
  function credentialPhase(phase) {
    credentials.phase = phase;
    saveCredentials();
  }
  function bundledMysqlVersion() {
    // 读取实际随包二进制版本，避免以后升级 MySQL 时忘记同步硬编码版本号。
    const result = spawnSync(mysqlBinaries.mysqld, ['--version'], {
      cwd: dataDir, encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000
    });
    const match = `${result.stdout || ''} ${result.stderr || ''}`.match(/\bVer\s+(\d+\.\d+\.\d+)\b/);
    if (result.status !== 0 || !match) throw new Error(`无法识别随包 MySQL 版本：${scrub(result.error?.message || result.stderr || 'mysqld --version 失败')}`);
    return match[1];
  }
  function backupBeforeMysqlUpgrade(nextVersion) {
    // 已有库会被新版 mysqld 原位升级；先复制完整库及配套密码，失败时保留原库并阻断启动。
    const backupRoot = path.join(dataDir, 'mysql-runtime-backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    if (fs.lstatSync(backupRoot).isSymbolicLink()) throw new Error('MySQL 升级备份目录是链接，已停止启动以保护业务资料。');
    function fingerprintTree(folder) {
      // 目录名、文件名和内容共同参与指纹，拒绝链接；失败重试只能复用同一份原库的快照。
      const digest = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      function visit(entry, relative) {
        const stat = fs.lstatSync(entry);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`MySQL 资料包含链接或特殊文件，不能做完整备份：${entry}`);
        digest.update(`${stat.isDirectory() ? 'D' : 'F'}\0${relative}\0`);
        if (stat.isDirectory()) {
          for (const name of fs.readdirSync(entry).sort()) visit(path.join(entry, name), path.posix.join(relative, name));
        } else {
          digest.update(`${stat.size}\0`);
          const handle = fs.openSync(entry, 'r');
          try {
            for (;;) {
              const size = fs.readSync(handle, buffer, 0, buffer.length, null);
              if (!size) break;
              digest.update(buffer.subarray(0, size));
            }
          } finally { fs.closeSync(handle); }
        }
      }
      visit(folder, '');
      return digest.digest('hex');
    }
    const sourceSha256 = fingerprintTree(mysqlDir);
    const pending = credentials.pendingMysqlRuntimeBackup;
    if (pending) {
      if (pending.nextVersion !== nextVersion || typeof pending.name !== 'string' ||
          !/^mysql-before-[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9-]+$/.test(pending.name)) {
        throw new Error('上次 MySQL 升级备份记录无效或目标版本已变化，已停止启动；请先检查业务资料。');
      }
      const previous = path.join(backupRoot, pending.name);
      if (!fs.existsSync(previous) || fs.lstatSync(previous).isSymbolicLink() ||
          !fs.existsSync(path.join(previous, 'backup-complete.json')) ||
          !fs.existsSync(path.join(previous, 'mysql', 'mysql.ibd')) ||
          !fs.existsSync(path.join(previous, 'db-credentials.json'))) {
        throw new Error(`上次 MySQL 升级备份不完整，已停止启动；请检查 ${previous}。`);
      }
      const marker = JSON.parse(fs.readFileSync(path.join(previous, 'backup-complete.json'), 'utf8'));
      if (marker.nextVersion !== nextVersion || marker.sourceSha256 !== pending.sourceSha256) {
        throw new Error(`上次 MySQL 升级备份标记无效，已停止启动；请检查 ${previous}。`);
      }
      if (sourceSha256 !== pending.sourceSha256) throw new Error(`上次 MySQL 升级未完成，且数据库内容已变化。为避免使用陈旧备份，已停止启动；请检查 ${previous} 后恢复或人工处理。`);
      const backupSha256 = fingerprintTree(path.join(previous, 'mysql'));
      const credentialsSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(previous, 'db-credentials.json'))).digest('hex');
      if (backupSha256 !== sourceSha256 || credentialsSha256 !== marker.credentialsSha256) {
        throw new Error(`上次 MySQL 升级备份校验失败，已停止启动；请检查 ${previous} 后恢复或人工处理。`);
      }
      log('launcher.log', `复用已完成的 MySQL ${nextVersion} 升级前备份：${previous}`);
      return;
    }
    const label = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const backupName = `mysql-before-${nextVersion}-${label}`;
    const backupDir = path.join(backupRoot, backupName);
    fs.mkdirSync(backupDir);
    try {
      fs.cpSync(mysqlDir, path.join(backupDir, 'mysql'), { recursive: true, dereference: false, preserveTimestamps: true,
        errorOnExist: true, force: false });
      if (fingerprintTree(path.join(backupDir, 'mysql')) !== sourceSha256 || fingerprintTree(mysqlDir) !== sourceSha256) {
        throw new Error('备份或原数据库在复制期间发生变化，校验未通过。');
      }
      const credentialsSha256 = crypto.createHash('sha256').update(fs.readFileSync(credentialsPath)).digest('hex');
      fs.copyFileSync(credentialsPath, path.join(backupDir, 'db-credentials.json'), fs.constants.COPYFILE_EXCL);
      if (crypto.createHash('sha256').update(fs.readFileSync(path.join(backupDir, 'db-credentials.json'))).digest('hex') !== credentialsSha256) {
        throw new Error('备份凭据校验未通过。');
      }
      fs.writeFileSync(path.join(backupDir, 'backup-complete.json'), JSON.stringify({
        sourceVersion: credentials.mysqlRuntimeVersion || 'unknown', nextVersion, sourceSha256, credentialsSha256,
        at: new Date().toISOString()
      }), { flag: 'wx' });
      credentials.pendingMysqlRuntimeBackup = { nextVersion, name: backupName, sourceSha256 };
      saveCredentials();
      log('launcher.log', `MySQL ${nextVersion} 启动前已完成业务库备份：${backupDir}`);
    } catch (error) {
      throw new Error(`MySQL 升级前备份失败，未启动新版数据库。原库未修改；请检查磁盘空间及备份目录 ${backupDir}：${error.message}`);
    }
  }
  async function mysqlCommand(user, password, sql, admin = false, duringClose = false) {
    const config = path.join(mysqlDataPath, 'run', `mysql-client-${crypto.randomUUID()}.cnf`);
    const iniValue = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
    fs.writeFileSync(config, `[client]\nprotocol=TCP\nhost=127.0.0.1\nport=${mysqlPort}\nuser=${iniValue(user)}\npassword=${iniValue(password)}\nconnect-timeout=2\ndefault-character-set=utf8mb4\n`, { flag: 'wx', mode: 0o600 });
    let state;
    try {
      const args = [`--defaults-extra-file=${config}`, '--protocol=TCP', '--host=127.0.0.1', `--port=${mysqlPort}`,
        ...(admin ? ['shutdown'] : ['--batch', '--skip-column-names', '--raw'])];
      // 关闭期间仍须启动一次本机 mysqladmin；其目标被固定为本次拥有的配置端口。
      const wasClosing = closing;
      if (duringClose) closing = false;
      try { state = launch(admin ? mysqlBinaries.mysqladmin : mysqlBinaries.mysql, args, {
        env: { MYSQL_TEST_LOGIN_FILE: path.join(mysqlDataPath, 'run', 'unused-login-path.cnf') }
      }); }
      finally { closing = wasClosing; }
      state.child.stdin.end(admin ? '' : `${sql}\n`);
      return await completed(state, admin ? 10000 : 15000, admin ? 'MySQL 正常关闭' : 'MySQL 配置');
    } finally {
      if (!state || state.ended) { try { fs.unlinkSync(config); } catch { /* 只清理本次创建的临时连接配置。 */ } }
    }
  }
  async function startMysql() {
    mysqlBasePath = mysqlAsciiPath(mysqlRuntimeBase);
    mysqlDataPath = mysqlAsciiPath(dataDir);
    mysqlBinaries = Object.fromEntries(['mysqld', 'mysql', 'mysqladmin'].map(name => [name, path.join(mysqlBasePath, 'bin', `${name}.exe`)]));
    const mysqlRuntimeVersion = bundledMysqlVersion();
    const effectiveDataDir = path.join(mysqlDataPath, 'mysql');
    // MySQL 初始化 sys 视图时会写临时表；中文 TEMP/TMP 在 Windows 可能触发 InnoDB 断言。
    const mysqlTempPath = path.join(mysqlDataPath, 'run', 'mysql-tmp');
    if (fs.lstatSync(runDir).isSymbolicLink() || !fs.lstatSync(runDir).isDirectory()) {
      throw new Error('MySQL 临时目录的父目录不是普通目录，已停止启动。');
    }
    fs.mkdirSync(mysqlTempPath, { recursive: true });
    if (fs.lstatSync(mysqlTempPath).isSymbolicLink() || !fs.lstatSync(mysqlTempPath).isDirectory()) {
      throw new Error('MySQL 临时目录不是普通目录，已停止启动。');
    }
    const mysqlTempEnv = { TEMP: mysqlTempPath, TMP: mysqlTempPath, TMPDIR: mysqlTempPath };
    credentials = loadCredentials();
    fs.mkdirSync(mysqlDir, { recursive: true });
    const existing = fs.readdirSync(mysqlDir);
    if (existing.length && credentials.mysqlRuntimeVersion !== mysqlRuntimeVersion) backupBeforeMysqlUpgrade(mysqlRuntimeVersion);
    if (!existing.length) {
      const initialization = launch(mysqlBinaries.mysqld, ['--no-defaults', '--standalone', '--console', `--basedir=${mysqlBasePath}`, `--datadir=${effectiveDataDir}`,
        `--tmpdir=${mysqlTempPath}`, '--initialize-insecure'], { logName: 'mysql-initialize.log', env: mysqlTempEnv });
      initialization.child.stdin.end();
      await completed(initialization, 120000, '首次 MySQL 初始化');
      credentialPhase('initialized');
    } else if (!fs.existsSync(path.join(mysqlDir, 'mysql.ibd')) && !fs.existsSync(path.join(mysqlDir, 'mysql'))) {
      throw new Error('MySQL 目录包含未完成的初始化内容，已保留原文件。请检查 mysql-initialize.log 后恢复，不会删除目录或重新初始化。');
    }
    cancelled();
    try {
      mysqlPort = await availablePort(managedMysqlPort);
    } catch (error) {
      if (error?.code === 'EADDRINUSE') {
        throw new Error(`自管 MySQL 固定端口 ${managedMysqlPort} 已被占用，请关闭占用程序或设置 SANY_MYSQL_PORT 后重试。`);
      }
      throw new Error(`自管 MySQL 固定端口 ${managedMysqlPort} 不可用：${scrub(error?.message || error)}`);
    }
    /* 首次初始化只有 root@localhost，不能使用 skip-name-resolve 阻断回环登录。
     * 仍只绑定 127.0.0.1；应用账户随后分别建立 localhost 与 127.0.0.1 两个受限主机项。 */
    mysqlProcess = launch(mysqlBinaries.mysqld, ['--no-defaults', '--standalone', '--console', `--basedir=${mysqlBasePath}`, `--datadir=${effectiveDataDir}`, `--tmpdir=${mysqlTempPath}`,
      '--bind-address=127.0.0.1', `--port=${mysqlPort}`, '--mysqlx=0', '--local-infile=0', '--secure-file-priv=NULL',
      '--skip-log-bin', '--max-allowed-packet=32M', '--innodb-buffer-pool-size=64M', '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_0900_ai_ci', `--pid-file=${path.join(effectiveDataDir, 'owned-mysql.pid')}`,
      `--log-error=${path.join(mysqlDataPath, 'logs', 'mysql-error.log')}`], { logName: 'mysql-launch.log', env: mysqlTempEnv });
    mysqlProcess.child.stdin.end();
    const deadline = Date.now() + 60000;
    while (!await socketReady(mysqlPort)) {
      cancelled();
      if (!alive(mysqlProcess)) throw new Error(`自管 MySQL 启动失败：${scrub(mysqlProcess.tail || mysqlProcess.error?.message)}`);
      if (Date.now() > deadline) throw new Error('自管 MySQL 启动等待超过 60 秒。');
      await delay(250);
    }
    const pidText = fs.readFileSync(path.join(mysqlDir, 'owned-mysql.pid'), 'utf8').trim();
    if (!/^[1-9][0-9]*$/.test(pidText)) throw new Error('自有 MySQL PID 文件无效。');
    ownedMysqlPid = Number(pidText);
    if (ownedMysqlPid !== mysqlProcess.child.pid && !mysqlDescendants(mysqlProcess).includes(ownedMysqlPid)) throw new Error('MySQL 服务进程不属于本次启动，已停止后续操作。');
    updateLock();
    let authenticated = false;
    try { await mysqlCommand('root', credentials.rootPassword, 'SELECT 1;'); authenticated = true; }
    catch (error) { if (credentials.phase === 'ready') throw error; }
    if (!authenticated) {
      // 只有本启动器生成且尚未完成安全配置的新库才尝试空密码；不重置已有账户。
      await mysqlCommand('root', '', `ALTER USER 'root'@'localhost' IDENTIFIED BY '${credentials.rootPassword}';`);
      await mysqlCommand('root', credentials.rootPassword, 'SELECT 1;');
    }
    await mysqlCommand('root', credentials.rootPassword,
      `CREATE DATABASE IF NOT EXISTS sany_forge CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n` +
      `CREATE USER IF NOT EXISTS 'sany_forge'@'127.0.0.1' IDENTIFIED BY '${credentials.appPassword}';\n` +
      `CREATE USER IF NOT EXISTS 'sany_forge'@'localhost' IDENTIFIED BY '${credentials.appPassword}';\n` +
      `GRANT ALL PRIVILEGES ON sany_forge.* TO 'sany_forge'@'127.0.0.1';\n` +
      `GRANT ALL PRIVILEGES ON sany_forge.* TO 'sany_forge'@'localhost';`);
    await mysqlCommand('sany_forge', credentials.appPassword, 'USE sany_forge; SELECT 1;');
    credentials.mysqlRuntimeVersion = mysqlRuntimeVersion;
    delete credentials.pendingMysqlRuntimeBackup;
    credentialPhase('ready');
    return { SANY_MYSQL_URL: `jdbc:mysql://127.0.0.1:${mysqlPort}/sany_forge?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false`,
      SANY_DB_USER: 'sany_forge', SANY_DB_PASSWORD: credentials.appPassword };
  }
  function health(url) {
    return new Promise(resolve => {
      const request = http.get(`${url}/api/health`, { timeout: 2000 }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; if (body.length > 10000) request.destroy(); });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        response.on('error', () => resolve(null));
      });
      request.on('error', () => resolve(null));
      request.on('timeout', () => { request.destroy(); resolve(null); });
    });
  }
  async function start(port = 8790) {
    cancelled();
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('平台端口无效。');
    for (const file of [binaries.java, binaries.jar, ...(external ? [] : [binaries.mysqld, binaries.mysql, binaries.mysqladmin])]) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`缺少 Java/MySQL 运行资源：${file}`);
    }
    if (!fs.existsSync(path.join(webRoot, 'index.html'))) throw new Error('缺少网页资源 www/index.html 或 dist/index.html。');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    acquireLock();
    // 对外服务先按最终监听地址占位检测，避免其他网卡已占用端口却误判为可用。
    const httpPort = await availablePort(port, httpBindAddress);
    const db = external ? { SANY_MYSQL_URL: process.env.SANY_MYSQL_URL, SANY_DB_USER: process.env.SANY_DB_USER || 'sany_forge', SANY_DB_PASSWORD: process.env.SANY_DB_PASSWORD || '' } : await startMysql();
    cancelled();
    javaProcess = launch(binaries.java, ['-Xms32m', '-Xmx512m', '-Dfile.encoding=UTF-8', '-jar', binaries.jar], {
      logName: 'java-server.log', env: { ...db, SANY_PLATFORM_DATA: dataDir, SANY_WEB_ROOT: webRoot,
        SANY_PLATFORM_HOST: httpBindAddress, SANY_PLATFORM_PORT: String(httpPort), SANY_MANAGED_PROCESS: '1' }
    });
    const url = `http://127.0.0.1:${httpPort}`;
    const deadline = Date.now() + 60000;
    while (Date.now() <= deadline) {
      cancelled();
      if (!alive(javaProcess)) throw new Error(`Java 服务启动失败：${scrub(javaProcess.tail || javaProcess.error?.message)}`);
      const value = await health(url);
      if (value?.ok === true && value.app === 'sany-service-platform' && value.version === VERSION && value.storage === 'mysql' && value.runtime === 'java') return url;
      await delay(250);
    }
    throw new Error('Java/MySQL 服务健康检查超过 60 秒，请查看 logs/java-server.log。');
  }
  async function terminateOwned(state, graceful) {
    if (!alive(state)) return;
    if (graceful) {
      try { state.child.stdin.end('SANY_SHUTDOWN\n'); } catch { /* Java 已退出时 stdin 可能已关闭。 */ }
      await waitFor(state.done, 12000);
    }
    if (alive(state)) {
      log('launcher.log', `自有子进程 ${state.child.pid} 未按时退出，正在精确终止该子进程。`);
      await stopOwnedState(state);
    }
  }
  async function close() {
    closing = true;
    await terminateOwned(javaProcess, true);
    if (alive(mysqlProcess) && mysqlPort && credentials) {
      try { await mysqlCommand('root', credentials.rootPassword, '', true, true); }
      catch {
        if (credentials.phase !== 'ready') {
          try { await mysqlCommand('root', '', '', true, true); } catch { /* 首次安全配置未结束时尝试无密码正常关闭。 */ }
        }
      }
      await waitFor(mysqlProcess.done, 10000);
      await terminateOwned(mysqlProcess, false);
    }
    for (const child of children) if (alive(child)) await terminateOwned(child, false);
    if (ownsLock() && ![...children].some(alive) && !pidAlive(ownedMysqlPid)) {
      try { fs.unlinkSync(lockPath); } catch { /* 只移除令牌匹配且子进程都已退出的自有锁。 */ }
    }
  }
  return {
    dataDir,
    start(port = 8790) {
      return startPromise ||= start(port).catch(async error => { await (closePromise ||= close()); throw error; });
    },
    close() { return closePromise ||= close(); }
  };
}

function runCli() {
  const platform = createPlatform({ exposeLan: process.env.SANY_LAN_ACCESS === '1' });
  platform.start(Number(process.env.SANY_PLATFORM_PORT || 8790)).then(url => console.log(`三一匠造 ${VERSION} Java/MySQL 服务：${url}`)).catch(error => {
    console.error(`本地服务启动失败：${error.message}`);
    platform.close().finally(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => platform.close().finally(() => process.exit()));
}

module.exports = { createPlatform, runCli, platformLockStatus, resolveManagedMysqlPort };
if (require.main === module) runCli();
