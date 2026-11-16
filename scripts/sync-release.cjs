'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function filesIn(dir) {
  if (!fs.existsSync(dir)) throw new Error(`缺少发布资源目录：${dir}`);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`发布资源不允许包含链接：${file}`);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const required = ['runtime/java/bin/java.exe', 'runtime/mysql-current/bin/mysqld.exe', 'runtime/mysql-current/bin/mysql.exe',
  'runtime/mysql-current/bin/mysqladmin.exe', 'runtime/server/sany-forge-server.jar'];
for (const name of required) if (!fs.existsSync(path.join(root, name))) throw new Error(`缺少 Java/MySQL 发布资源：${name}`);
// 本机保留旧 MySQL 目录供回溯；发布清单只记录当前版本，并映射到成品固定 runtime/mysql 路径。
const runtimeFiles = ['java', 'mysql-current', 'server', 'installer'].flatMap(name => filesIn(path.join(root, 'runtime', name)));
for (const file of runtimeFiles) {
  const name = relative(file);
  if (/\/(?:node_modules|legacy-node|backups|\.data-java)\//i.test(name) || /(?:^|\/)(?:node\.exe|npm(?:\.cmd)?|platform\.sqlite(?:-wal|-shm)?|db-credentials\.json|face\.key|platform\.key)$/i.test(name) || /\.(?:cjs|mjs)$/i.test(name)) {
    throw new Error(`运行资源混入旧 Node 后端或私有业务资料：${name}`);
  }
  if (name.startsWith('runtime/server/') && name !== 'runtime/server/sany-forge-server.jar') throw new Error(`Java 服务目录包含意外文件：${name}`);
}
/* 网页放 www，JRE/MySQL/JAR 放外部 runtime；启动器保留在 asar 中逐项核验。 */
const releaseDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
fs.writeFileSync(path.join(root, 'dist', 'version.js'), `'use strict';\nwindow.SANY_RELEASE = Object.freeze({ version: '${pkg.version}', date: '${releaseDate}' });\n`);
const files = {}, layout = {};
function add(file, location, destination) { const name = relative(file); files[name] = hash(file); layout[name] = { location, path: destination }; }
for (const file of filesIn(path.join(root, 'dist'))) {
  if (path.basename(file) === 'release-manifest.json') continue;
  add(file, 'resources', 'www/' + path.relative(path.join(root, 'dist'), file).replaceAll('\\', '/'));
}
for (const file of runtimeFiles) add(file, 'resources', relative(file).replace(/^runtime\/mysql-current\//, 'runtime/mysql/'));
for (const name of ['server/platform.cjs', 'server/java-platform.cjs', 'desktop/main.cjs', 'desktop/service-address.cjs', 'desktop/icon.png', 'desktop/icon.ico']) {
  add(path.join(root, name), 'asar', name);
}
const manifest = { version: pkg.version, generatedAt: new Date().toISOString(), backend: { runtime: 'java', storage: 'mysql' }, files, layout };
fs.writeFileSync(path.join(root, 'dist', 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Java/MySQL 发布资源已同步：${pkg.version}，${Object.keys(files).length} 个文件，全部记录 SHA-256 与实际打包位置。`);
