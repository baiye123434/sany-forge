'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { exportLegacy } = require('../../scripts/export-legacy.cjs');

/* 全部旧库由测试现场生成，输出留在本工程的 target 中，不读取 APPDATA。
 * 生成的快照还可供独立空 MySQL 集成测试验证旧密码、人脸密文和回执密钥。 */
const root = path.resolve(__dirname, '../target/legacy-export-qa-' + process.pid);
fs.mkdirSync(root, { recursive: true });
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const at = '2026-10-27T00:00:00.000Z';
const password = 'legacy-import-test-2026!';
const salt = 'a'.repeat(32);
const passwordHash = salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(name, sequence = true) {
  const source = path.join(root, name);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'face.key'), key, { flag: 'wx' });
  const db = new DatabaseSync(path.join(source, 'platform.sqlite'));
  db.exec(`CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id));
    CREATE TABLE files(id TEXT PRIMARY KEY,owner_kind TEXT,owner_id TEXT,name TEXT,mime TEXT,bytes BLOB,created_at TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,target TEXT,at TEXT,detail TEXT);`);
  const iv = Buffer.alloc(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(Array(128).fill(0.25))), cipher.final()]);
  const face = `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('base64')}`;
  const records = [
    ['user', { id: 'USR-fixture', username: 'legacy_fixture_admin', name: '合成导入管理员', password: passwordHash, role: 'admin', active: true, face, createdAt: at }],
    ['customer', { id: 'CUS-fixture', phone: '13800009999', password: passwordHash, active: true, createdAt: at }],
    ['order', { id: 'SO-fixture', number: 'SO-20261027-0004', customerId: 'CUS-fixture', product: { id: 'fixture-product', code: 'FIXTURE', name: '合成设备' }, contact: '合成客户', phone: '13800009999', status: 'submitted', mode: 'buy', revision: 1, secretHash: 'a'.repeat(64), createdAt: at, updatedAt: at, history: [{ from: null, to: 'submitted', actor: '合成客户', at, note: '测试', files: [{ id: 'MAT-fixture', name: 'fixture.png', mime: 'image/png', size: 8, at }] }] }],
    ['project', { id: 'PR-old', number: 'PR-20261027-0001', customerId: 'CUS-fixture', title: '合成旧工程', contact: '合成客户', phone: '13800009999', status: 'submitted', revision: 1, secretHash: 'old-record-hash', items: [], attachments: [], history: [], createdAt: at, updatedAt: at }],
    ['ticket', { id: 'WO-fixture', number: 'WO-20261027-0001', orderId: 'SO-fixture', status: 'submitted', assignee: null, revision: 1, history: [], createdAt: at, updatedAt: at }],
    ['conversation', { id: 'CHAT-fixture', kind: 'order', recordId: 'SO-fixture', messages: [], latestSeq: 0, readByCustomer: 0, readByStaff: 0, createdAt: at, updatedAt: at }],
    ['supportChat', { id: 'CS-fixture', customerId: 'CUS-fixture', messages: [], createdAt: at, updatedAt: at }],
    ['followup', { id: 'FU-fixture', number: 'FU-20261027-0001', kind: 'order', recordId: 'SO-fixture', ownerId: 'USR-fixture', createdBy: 'USR-fixture', status: 'open', action: '合成跟进', dueAt: '2099-01-01T00:00:00.000Z', priority: 'normal', revision: 1, history: [], createdAt: at }],
    ['product', { id: 'CUSTOM-fixture', code: 'FIXTURE-CUSTOM', name: '合成自定义设备', category: '测试', published: true, deleted: false, custom: true, image: 'assets/brand/sany-user-reference.png', specs: [] }],
    ['settings', { id: 'permissions', revision: 0 }]
  ];
  for (const [kind, body] of records) db.prepare('INSERT INTO records VALUES(?,?,?)').run(kind, body.id, JSON.stringify(body));
  db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)').run('MAT-fixture', 'order', 'SO-fixture', 'fixture.png', 'image/png', Buffer.from([137,80,78,71,13,10,26,10]), at);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(9, '合成测试', '测试记录', 'SO-fixture', at, '仅供测试');
  if (sequence) {
    db.exec('CREATE TABLE document_sequences(prefix TEXT,day TEXT,value INTEGER,PRIMARY KEY(prefix,day));');
    db.prepare('INSERT INTO document_sequences VALUES(?,?,?)').run('SO', '20261027', 4);
  }
  db.close();
  return source;
}

test('只读快照导出保留记录、附件字节、审计、序号与原始密钥，源文件哈希不变', () => {
  const source = fixture('with-sequence');
  const database = path.join(source, 'platform.sqlite');
  const before = hash(database), keyBefore = hash(path.join(source, 'face.key'));
  const output = path.join(root, 'full.json');
  assert.deepEqual(exportLegacy(source, output), { records: 10, files: 1, audit: 1, documentSequences: 1 });
  const exported = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(exported.format, 'sany-forge-legacy-v1');
  assert.equal(exported.faceKey, key.toString('base64'));
  assert.deepEqual(Buffer.from(exported.files[0].data, 'base64'), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(exported.records.find(row => row.kind === 'user').body.password, passwordHash);
  assert.equal(hash(database), before); assert.equal(hash(path.join(source, 'face.key')), keyBefore);
});

test('旧版本缺少序号表时仍可导出，序号数组为空', () => {
  const source = fixture('without-sequence', false), output = path.join(root, 'old.json');
  assert.equal(exportLegacy(source, output).documentSequences, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')).documentSequences, []);
});

test('拒绝覆盖导出文件或向旧资料目录写入', () => {
  const source = fixture('no-overwrite'), output = path.join(root, 'existing.json');
  fs.writeFileSync(output, 'preserve', { flag: 'wx' });
  assert.throws(() => exportLegacy(source, output), /已存在/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'preserve');
  assert.throws(() => exportLegacy(source, path.join(source, 'new.json')), /旧资料目录之外/);
  assert.equal(fs.existsSync(path.join(source, 'new.json')), false);
});

test('CLI 仅输出计数，损坏记录的异常不泄漏正文或凭证', () => {
  const source = fixture('cli'), output = path.join(root, 'cli.json');
  const script = path.resolve(__dirname, '../../scripts/export-legacy.cjs');
  const child = spawnSync(process.execPath, [script, '--data-dir', source, '--out', output], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { records: 10, files: 1, audit: 1, documentSequences: 1 });
  assert.equal(child.stdout.includes('legacy_fixture_admin'), false); assert.equal(child.stdout.includes(passwordHash), false);
  const db = new DatabaseSync(path.join(source, 'platform.sqlite'));
  db.prepare('UPDATE records SET body=? WHERE kind=?').run('secret-credential-never-log', 'user'); db.close();
  const bad = spawnSync(process.execPath, [script, '--data-dir', source, '--out', path.join(root, 'broken.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.equal(bad.stderr.includes('secret-credential-never-log'), false);
});
