'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/* 仅接受用户明确指定的旧资料目录，不推断或扫描 APPDATA。
 * SQLite 以只读连接和读事务取得一致快照，输出以 wx 创建，绝不覆盖已有文件。 */
function exportLegacy(dataDir, output) {
  const source = fs.realpathSync(dataDir);
  if (!fs.statSync(source).isDirectory()) throw new Error('旧资料路径必须是目录。');
  const target = path.resolve(output);
  const targetParent = fs.realpathSync(path.dirname(target));
  const resolvedTarget = path.join(targetParent, path.basename(target));
  const relative = path.relative(source, resolvedTarget);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('输出必须位于旧资料目录之外，防止改动源目录。');
  }
  if (fs.existsSync(resolvedTarget)) throw new Error('输出文件已存在，请指定新的 --out 路径。');
  const database = path.join(source, 'platform.sqlite');
  const keyFile = path.join(source, 'face.key');
  if (!fs.statSync(database).isFile() || !fs.statSync(keyFile).isFile()) throw new Error('缺少旧数据库或密钥文件。');
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('旧密钥长度必须为 32 字节，不能自动重建。');
  const db = new DatabaseSync(database, { readOnly: true });
  let fd;
  let inTransaction = false;
  const counts = { records: 0, files: 0, audit: 0, documentSequences: 0 };
  try {
    db.exec('PRAGMA query_only=ON; BEGIN;');
    inTransaction = true;
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('旧数据库完整性检查失败。');
    for (const table of ['records', 'files', 'audit']) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
    fd = fs.openSync(resolvedTarget, 'wx', 0o600);
    const write = value => fs.writeSync(fd, value, null, 'utf8');
    write(`{"format":"sany-forge-legacy-v1","exportedAt":${JSON.stringify(new Date().toISOString())},"faceKey":${JSON.stringify(key.toString('base64'))}`);
    const rows = (name, sql, transform = row => row) => {
      write(`,${JSON.stringify(name)}:[`);
      let first = true;
      for (const row of db.prepare(sql).iterate()) {
        write((first ? '' : ',') + JSON.stringify(transform(row)));
        first = false;
        counts[name]++;
      }
      write(']');
    };
    rows('records', 'SELECT kind,id,body FROM records ORDER BY kind,id', row => {
      const body = JSON.parse(row.body);
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.id !== row.id) throw new Error('旧记录标识与内容不一致，已停止导出。');
      return { kind: row.kind, id: row.id, body };
    });
    rows('files', 'SELECT id,owner_kind,owner_id,name,mime,bytes,created_at FROM files ORDER BY id', row => ({
      id: row.id, owner_kind: row.owner_kind, owner_id: row.owner_id, name: row.name, mime: row.mime,
      data: Buffer.from(row.bytes).toString('base64'), created_at: row.created_at
    }));
    rows('audit', 'SELECT id,actor,action,target,at,detail FROM audit ORDER BY id');
    const sequenceExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get('document_sequences');
    if (sequenceExists) rows('documentSequences', 'SELECT prefix,day,value FROM document_sequences ORDER BY prefix,day');
    else write(',"documentSequences":[]');
    if (!key.equals(fs.readFileSync(keyFile))) throw new Error('导出期间旧密钥发生变化，请关闭旧服务后重试。');
    write('}');
    fs.fsyncSync(fd);
    db.exec('COMMIT');
    inTransaction = false;
    return counts;
  } finally {
    if (inTransaction) { try { db.exec('ROLLBACK'); } catch {} }
    if (fd !== undefined) fs.closeSync(fd);
    db.close();
  }
}

if (require.main === module) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('导出工具需要 Node.js 24 或更高版本。');
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--data-dir' || args[2] !== '--out') {
      throw new Error('用法：node scripts/export-legacy.cjs --data-dir "旧资料目录" --out "新导出文件.json"');
    }
    console.log(JSON.stringify(exportLegacy(args[1], args[3])));
  } catch {
    // JSON/SQLite 原始异常可能附带记录片段，因此失败也不输出身份、凭证或记录正文。
    console.error('导出失败：请检查 Node.js 24、显式参数、源数据库和 32 字节密钥。输出若已生成可能不完整，请使用新路径重试。');
    process.exitCode = 1;
  }
}

module.exports = { exportLegacy };
