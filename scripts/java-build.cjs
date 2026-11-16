'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'test';
if (!['test', 'package'].includes(mode)) throw new Error('仅支持 test 或 package 构建任务。');
const executable = name => process.platform === 'win32' ? `${name}.exe` : name;
const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
function distributionHomes(parent, binary) {
  const homes = [parent];
  try {
    // 下载工具会保留带版本号的顶层目录，因此同时检查父目录及其第一层子目录。
    homes.push(...fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(parent, entry.name)));
  } catch { /* 未下载本地工具时继续检查环境变量与 PATH。 */ }
  return homes.filter(home => isFile(path.join(home, 'bin', binary)));
}

/* 交付不固定开发者电脑路径：优先使用显式环境变量，其次项目工具目录与 PATH。 */
function javaHome() {
  const candidates = [process.env.JAVA_HOME, path.join(root, '.build-tools', 'java'),
    ...distributionHomes(path.join(root, '.build-tools', 'jdk-dist'), executable('java')), path.join(root, 'runtime', 'java'),
    ...pathDirs.filter(dir => isFile(path.join(dir, executable('javac')))).map(dir => path.dirname(dir))].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const java = path.join(candidate, 'bin', executable('java'));
    if (!isFile(java) || !isFile(path.join(candidate, 'bin', executable('javac')))) continue;
    const result = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true, shell: false });
    const match = `${result.stdout || ''}\n${result.stderr || ''}`.match(/(?:openjdk|java)\s+version\s+"(\d+)/i);
    if (result.status === 0 && Number(match?.[1]) >= 17) return path.resolve(candidate);
  }
  throw new Error('未找到 JDK 17 或更高版本。请安装完整 JDK 并设置 JAVA_HOME；随软件的运行时不一定包含编译器。');
}
function maven() {
  const name = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const candidates = [process.env.MAVEN_HOME, process.env.M2_HOME, path.join(root, '.build-tools', 'maven'),
    ...distributionHomes(path.join(root, '.build-tools', 'maven-dist'), name)]
    .filter(Boolean).map(dir => path.join(dir, 'bin', name));
  candidates.push(...pathDirs.map(dir => path.join(dir, name)));
  const found = candidates.find(isFile);
  if (!found) throw new Error('未找到 Maven。请安装 Maven 并设置 MAVEN_HOME，或将其 bin 目录加入 PATH。');
  return path.resolve(found);
}

const jdk = javaHome();
const mvn = maven();
const env = { ...process.env, JAVA_HOME: jdk, PATH: path.join(jdk, 'bin') + path.delimiter + (process.env.PATH || '') };
const args = ['--batch-mode', '-f', path.join(root, 'java-server', 'pom.xml')];
/* 显式指定本项目仓库配置，不改写用户或 Maven 安装目录中的全局设置。 */
if (process.env.MAVEN_SETTINGS) {
  const settings = path.resolve(process.env.MAVEN_SETTINGS);
  if (!isFile(settings)) throw new Error('MAVEN_SETTINGS 必须指向已存在的 Maven settings XML 文件。');
  args.push('-s', settings);
}
if (process.env.MAVEN_REPO_LOCAL) args.push(`-Dmaven.repo.local=${path.resolve(process.env.MAVEN_REPO_LOCAL)}`);
args.push(mode);
let result;
if (process.platform === 'win32') {
  // Windows 批处理由 cmd 执行；参数统一引用并拒绝可展开字符，避免路径被解释成命令。
  const quote = value => {
    if (/["\r\n%]/.test(value)) throw new Error('构建工具路径或参数含不支持的字符。');
    return `"${value}"`;
  };
  const command = `"${[mvn, ...args].map(quote).join(' ')}"`;
  result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false, windowsVerbatimArguments: true
  });
} else result = spawnSync(mvn, args, { cwd: root, env, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (mode === 'package') {
  const built = path.join(root, 'java-server', 'target', 'sany-forge-server.jar');
  if (!isFile(built)) throw new Error('Maven 未生成目标 Java 服务 JAR。');
  const destination = path.join(root, 'runtime', 'server', 'sany-forge-server.jar');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(built, destination);
  console.log('Java 测试与打包完成，服务 JAR 已同步至 runtime/server。');
}
