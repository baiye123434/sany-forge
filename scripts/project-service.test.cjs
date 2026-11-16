'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { createPlatform } = require('../server/platform.cjs');
const { crc32 } = require('../server/document-files.cjs');
const root = path.resolve(__dirname, '..');
const password = 'Project-test-only-321!';
const vector = Array.from({ length: 128 }, (_, index) => .02 + index / 5000);
const image = { name: '现场.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=' };
const xmlEntries = {
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>隔离测试工程资料</w:t></w:r></w:p></w:body></w:document>'
};
/* 仅构造标准小型 DOCX 测试夹具，不含真实工程资料；CRC 和目录完整，避免用 ZIP 文件头蒙混验收。 */
function zip(entries) {
  const localParts = [], centralParts = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name), content = Buffer.from(text), packed = zlib.deflateRawSync(content), crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes); offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centralParts), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}
const docx = { name: '工程需求.docx', data: zip(xmlEntries).toString('base64') };
const proof = challenge => ({ challenge: challenge.challenge, consent: true,
  samples: [0, ...challenge.turns.map(turn => turn === 'left' ? -.22 : .22)].map(yaw => ({ descriptor: vector, yaw })) });

test('3.2 工程需求、人工报价与本机客服隔离验收', async t => {
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, '.qa', 'projects-test-'));
  let platform = createPlatform({ root, dataDir }), url = await platform.start(0);
  t.after(async () => platform.close());
  let admin, service, reviewer, product, secondProduct, orderResult, secondOrderResult, projectResult, secondProjectResult, secretProjectResult, conversationId, projectConversationId, messageFile;
  const api = async (endpoint, { method = 'GET', body, token, expected = 200, headers = {} } = {}) => {
    if (!token && method === 'POST' && ['/api/orders','/api/projects'].includes(endpoint)) token = await require('./customer-fixture.cjs')(url);
    const response = await fetch(url + endpoint, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}`); return result;
  };
  const post = (endpoint, body, token, expected) => api(endpoint, { method: 'POST', body, token, expected });
  const patch = (body, expected) => api('/api/admin/products', { method: 'PATCH', body, token: admin, expected });
  /* 与现行本机演示登录契约一致：新员工免人脸，已录入管理员仍验证挑战。 */
  const login = async username => {
    const result = await post('/api/login', { username, password });
    if (result.user.faceEnrolled === false) {
      assert.ok(result.token);
      assert.equal(result.challenge, undefined);
      assert.equal(result.enrollOnly, false);
      return result;
    }
    assert.equal(result.token, undefined);
    assert.equal(result.enroll, false);
    return post('/api/face/verify', proof(result));
  };
  const orderData = () => ({ productId: product.id, mode: 'buy', quantity: 2, contact: '甲方测试一', phone: '13800003201', address: '湖南省长沙市测试区工程资料路 321 号', date: '2099-01-01', notes: '本地隔离集成测试' });
  const projectData = () => ({ title: '厂房施工设备选型', contact: '甲方测试一', phone: '13800003201', notes: '需要审核清单及工期安排', confidential: false, items: [{ productId: product.id, quantity: 2 }], files: [] });
  const download = async (fileId, token, status = 200) => {
    const response = await fetch(`${url}/api/files/${fileId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.status, status); return response;
  };

  await t.test('管理员人脸初始化、新员工密码直登；本机无默认项目和客服消息', async () => {
    const challenge = await post('/api/setup', { username: 'project.admin', name: '工程测试管理员', password });
    assert.equal(challenge.token, undefined);
    admin = (await post('/api/face/verify', proof(challenge))).token;
    await post('/api/admin/users', { username: 'project.service', name: '工程客服', role: 'service', password }, admin);
    await post('/api/admin/users', { username: 'project.reviewer', name: '工程审核', role: 'reviewer', password }, admin);
    service = (await login('project.service')).token; reviewer = (await login('project.reviewer')).token;
    assert.deepEqual((await api('/api/projects', { token: admin })).projects, []);
    assert.deepEqual((await api('/api/conversations', { token: admin })).conversations, []);
    await api('/api/conversations', { token: reviewer, expected: 403 });
    const products = (await api('/api/products')).products;
    assert.ok(products.filter(item => !item.exhibitOnly).every(item => !item.referencePrice), '不从空白目录生成模拟报价');
    product = (await post('/api/admin/products', { code: 'PROJECT-321-A', name: '工程测试挖掘机', category: '土方机械', subcategory: '挖掘机', image: 'assets/brand/sany-user-reference.png' }, admin)).product;
    secondProduct = (await post('/api/admin/products', { code: 'PROJECT-321-B', name: '工程测试吊车', category: '起重机械' }, admin)).product;
  });
  await t.test('参考价需真实来源、两位小数和完整范围；旧编辑不丢报价', async () => {
    const referencePrice = { buyMin: 100000, buyMax: 120000.50, rentMonthlyMin: 5000, rentMonthlyMax: 6000, source: '隔离测试：人工确认价格来源，不是官网销售价', updatedAt: 'fake' };
    for (const invalid of [
      { ...referencePrice, source: '' }, { ...referencePrice, buyMin: -1 }, { ...referencePrice, buyMin: 1.000001 },
      { ...referencePrice, buyMax: 1 }, { ...referencePrice, buyMax: null }, { ...referencePrice, buyMin: '100000' }, { ...referencePrice, buyMax: 1e13 }
    ]) await patch({ ...product, referencePrice: invalid }, 400);
    product = (await patch({ ...product, referencePrice })).product;
    assert.notEqual(product.referencePrice.updatedAt, 'fake'); assert.equal(product.referencePrice.currency, 'CNY');
    const { referencePrice: ignored, ...legacyEdit } = product;
    const edited = (await patch({ ...legacyEdit, summary: '保留报价的旧版编辑' })).product;
    assert.deepEqual(edited.referencePrice, product.referencePrice);
    const cleared = (await patch({ ...secondProduct, referencePrice: null })).product;
    assert.equal(cleared.referencePrice, null);
    assert.deepEqual((await api('/api/products')).products.find(item => item.id === product.id).referencePrice, product.referencePrice);
  });
  await t.test('下单上传有效 DOCX；普通 ZIP、宏、伪装 HTML、解压炸弹和过量附件全部拒绝', async () => {
    orderResult = await post('/api/orders', { ...orderData(), files: [docx, image] });
    const { order } = orderResult;
    assert.match(order.number, /^SO-\d{8}-\d{4}$/); assert.equal(order.attachments.length, 2);
    assert.deepEqual(order.history[0].files, order.files); assert.equal(order.secretHash, undefined);
    assert.equal(order.files[0].mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal((await download(order.files[0].id, orderResult.token)).headers.get('content-type'), order.files[0].mime);
    const badPackages = [
      Buffer.from('PK\u0003\u0004not a Word file'), zip({ 'readme.txt': 'not a Word file' }),
      zip({ ...xmlEntries, 'word/vbaProject.bin': 'macro' }), zip({ ...xmlEntries, '../escape.txt': 'outside' }),
      zip({ ...xmlEntries, 'word/document.xml': '<!DOCTYPE x [<!ENTITY danger SYSTEM "file:///test">]><w:document/>' }),
      zip({ ...xmlEntries, 'word/large.xml': 'x'.repeat(17 * 1024 * 1024) }), Buffer.from('<html><script>bad()</script></html>')
    ];
    for (const bytes of badPackages) await post('/api/orders', { ...orderData(), files: [{ name: '伪造.docx', data: bytes.toString('base64') }] }, undefined, 400);
    for (const name of ['伪装.html', '伪装.docm', '图片.pdf', '图片.docx', '../资料.png', 'C:\\资料.png', '资料\u0000.png', '资料:stream.png', 'CON.png', '图\u202egnp.exe.png']) {
      await post('/api/orders', { ...orderData(), files: [{ ...image, name }] }, undefined, 400);
    }
    await post('/api/orders', { ...orderData(), files: [{ name: '图像.png', data: Buffer.from('%PDF-1.4 test').toString('base64') }] }, undefined, 400);
    await post('/api/admin/product-images', { ...image, name: '图片.html' }, admin, 400);
    await post('/api/orders', { ...orderData(), files: Array(5).fill(image) }, undefined, 400);
    await post('/api/orders', { ...orderData(), files: [{ name: '巨大.pdf', data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024)]).toString('base64') }] }, undefined, 400);
    secondOrderResult = await post('/api/orders', { ...orderData(), contact: '甲方测试二', phone: '13800003202' });
    await download(order.files[0].id, secondOrderResult.token, 403);
    await download(order.files[0].id, null, 401);
  });
  await t.test('普通工程支持文档或设备；保密工程只收分类设备清单', async () => {
    projectResult = await post('/api/projects', { ...projectData(), files: [docx] });
    assert.match(projectResult.project.number, /^PR-\d{8}-\d{4}$/);
    assert.equal(projectResult.project.secretHash, undefined);
    assert.equal(projectResult.project.items[0].product.code, product.code);
    assert.equal(projectResult.project.files.length, 1);
    secondProjectResult = await post('/api/projects', { ...projectData(), contact: '甲方测试二', phone: '13800003202', items: [], files: [docx] });
    secretProjectResult = await post('/api/projects', { ...projectData(), title: '保密工程', confidential: true });
    for (const invalid of [
      { ...projectData(), items: [], files: [] }, { ...projectData(), confidential: true, files: [docx] },
      { ...projectData(), confidential: true, items: [] }, { ...projectData(), items: [projectData().items[0], projectData().items[0]] },
      { ...projectData(), items: [{ productId: product.id, quantity: 0 }] }, { ...projectData(), items: [{ productId: product.id, quantity: 1000 }] },
      { ...projectData(), items: Array(51).fill(projectData().items[0]) }
    ]) await post('/api/projects', invalid, undefined, 400);
    const exhibit = (await api('/api/products')).products.find(item => item.exhibitOnly);
    await post('/api/projects', { ...projectData(), items: [{ productId: exhibit.id, quantity: 1 }] }, undefined, 400);
    await patch({ ...secondProduct, published: false });
    await post('/api/projects', { ...projectData(), items: [{ productId: secondProduct.id, quantity: 1 }] }, undefined, 400);
  });
  await t.test('项目与订单身份不能混用；两个客户和后台权限隔离', async () => {
    const projectPath = `/api/projects/${projectResult.project.id}`;
    await api(projectPath, { token: secondProjectResult.token, expected: 403 });
    await api(projectPath, { token: orderResult.token, expected: 403 });
    await api(`/api/orders/${orderResult.order.id}`, { token: projectResult.token, expected: 403 });
    await api('/api/orders', { token: projectResult.token, expected: 403 });
    await api('/api/projects', { token: projectResult.token, expected: 403 });
    await api('/api/admin/users', { token: projectResult.token, expected: 403 });
    await download(projectResult.project.files[0].id, secondProjectResult.token, 403);
    await download(projectResult.project.files[0].id, orderResult.token, 403);
    await download(orderResult.order.files[0].id, projectResult.token, 403);
    await download(projectResult.project.files[0].id, reviewer);
    assert.equal((await api(`/api/projects/${projectResult.project.number}`, { token: projectResult.token })).project.id, projectResult.project.id);
    await post(`${projectPath}/review`, { revision: 1, status: 'reviewing', note: '客服不能审核' }, service, 403);
  });
  await t.test('人类可读单号与加密查询链接可恢复绑定身份；篡改和错误用途拒绝', async () => {
    for (const [kind, result] of [['order', orderResult], ['project', projectResult]]) {
      assert.ok(result.accessCode); assert.ok(result.accessKey);
      assert.equal(Buffer.from(result.accessKey, 'base64url').toString().includes(result.accessCode), false);
      const restored = await post('/api/guest/access', { key: result.accessKey });
      assert.equal(restored.kind, kind); assert.equal(restored[kind].id, result[kind].id); assert.equal(restored[kind].secretHash, undefined);
      const lookupEndpoint = kind === 'order' ? '/api/guest/lookup' : '/api/projects/lookup';
      const found = await post(lookupEndpoint, { [`${kind}Id`]: result[kind].number, phone: result[kind].phone, code: result.accessCode });
      assert.ok(found.accessKey); assert.equal(found[kind].id, result[kind].id);
      await post(lookupEndpoint, { [`${kind}Id`]: result[kind].number, phone: result[kind].phone, code: 'incorrect' }, undefined, 401);
      const tampered = Buffer.from(result.accessKey, 'base64url'); tampered[30] ^= 1;
      await post('/api/guest/access', { key: tampered.toString('base64url') }, undefined, 401);
    }
    await post('/api/guest/access', { key: 'invalid' }, undefined, 401);
    /* 只读取本次随机隔离库密钥来构造错误用途封包，验证服务端确实检查用途和凭证哈希。 */
    const database = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    const stored = JSON.parse(database.prepare("SELECT body FROM records WHERE kind='project' AND id=?").get(projectResult.project.id).body); database.close();
    const key = crypto.hkdfSync('sha256', fs.readFileSync(path.join(dataDir, 'face.key')), Buffer.alloc(0), 'sany-receipt-access-v1', 32);
    for (const changes of [{ purpose: 'face' }, { version: 2 }, { secretHash: 'stale' }]) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from('sany-platform:receipt:v1'));
      const content = Buffer.concat([cipher.update(JSON.stringify({ version: 1, purpose: 'receipt', kind: 'project', id: stored.id, secretHash: stored.secretHash, ...changes })), cipher.final()]);
      const forged = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), content]).toString('base64url');
      await post('/api/guest/access', { key: forged }, undefined, 401);
    }
  });
  await t.test('工程审核与补充完整闭环；并发版本防冲突，保密模式始终保留', async () => {
    let project = projectResult.project; const endpoint = `/api/projects/${project.id}`;
    await post(`${endpoint}/review`, { revision: 1, status: 'accepted', note: '跳步' }, reviewer, 409);
    await post(`${endpoint}/supplement`, { revision: 1, notes: '不在补充阶段' }, projectResult.token, 409);
    project = (await post(`${endpoint}/review`, { revision: 1, status: 'needs_info', note: '请补充施工进度', files: [image] }, reviewer)).project;
    await post(`${endpoint}/supplement`, { revision: project.revision, notes: '后台冒充客户' }, admin, 403);
    await post(`${endpoint}/supplement`, { revision: 1, notes: '旧版本' }, projectResult.token, 409);
    project = (await post(`${endpoint}/supplement`, { revision: project.revision, notes: '新增工期说明', items: [{ productId: product.id, quantity: 3 }], files: [docx] }, projectResult.token)).project;
    assert.equal(project.status, 'submitted'); assert.equal(project.files.length, 3); assert.equal(project.items[0].quantity, 3);
    const body = { revision: project.revision, status: 'reviewing', note: '开始审核' };
    const responses = await Promise.all([1, 2].map(() => fetch(url + endpoint + '/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewer}` }, body: JSON.stringify(body) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    project = (await api(endpoint, { token: projectResult.token })).project;
    project = (await post(`${endpoint}/review`, { revision: project.revision, status: 'accepted', note: '清单通过，已安排客服沟通' }, reviewer)).project;
    project = (await post(`${endpoint}/review`, { revision: project.revision, status: 'closed', note: '工程需求处理完毕' }, reviewer)).project;
    assert.equal(project.history.length, 6); assert.equal(project.status, 'closed');
    const secretEndpoint = `/api/projects/${secretProjectResult.project.id}`;
    await post(`${secretEndpoint}/review`, { revision: 1, status: 'needs_info', note: '违规材料', files: [docx] }, reviewer, 400);
    const secret = (await post(`${secretEndpoint}/review`, { revision: 1, status: 'needs_info', note: '补充数量即可' }, reviewer)).project;
    await post(`${secretEndpoint}/supplement`, { revision: secret.revision, notes: '附图纸', files: [docx] }, secretProjectResult.token, 400);
    await post(`${secretEndpoint}/supplement`, { revision: secret.revision, notes: '取消清单', items: [] }, secretProjectResult.token, 400);
    const supplemented = (await post(`${secretEndpoint}/supplement`, { revision: secret.revision, notes: '数量确认' }, secretProjectResult.token)).project;
    assert.equal(supplemented.confidential, true); assert.equal(supplemented.files.length, 0);
  });
  await t.test('客服双向实时增量：服务器生成订单卡，幂等发送、阅读游标和客户隔离', async () => {
    const created = await post('/api/conversations', { kind: 'order', recordId: orderResult.order.id }, orderResult.token);
    conversationId = created.conversation.id;
    assert.equal((await post('/api/conversations', { kind: 'order', recordId: orderResult.order.number }, service)).conversation.id, conversationId);
    await post('/api/conversations', { kind: 'order', recordId: orderResult.order.id }, secondOrderResult.token, 403);
    await post('/api/conversations', { kind: 'order', recordId: orderResult.order.id }, reviewer, 403);
    await api(`/api/conversations/${conversationId}`, { token: secondOrderResult.token, expected: 403 });
    await api(`/api/conversations/${conversationId}`, { token: projectResult.token, expected: 403 });
    await api('/api/conversations', { token: orderResult.token, expected: 403 });
    const endpoint = `/api/conversations/${conversationId}/messages`;
    const body = { text: '请核对我的需求文档', files: [docx], sendCard: true, clientMessageId: 'customer-msg-001' };
    const sent = (await post(endpoint, body, orderResult.token)).message;
    const retry = (await post(endpoint, body, orderResult.token)).message;
    assert.equal(sent.id, retry.id); assert.equal(sent.seq, 1); assert.equal(sent.sender, 'customer');
    assert.equal(sent.card.number, orderResult.order.number); assert.equal(sent.card.recordId, orderResult.order.id);
    assert.equal(sent.card.secretHash, undefined); assert.equal(sent.actorId, undefined);
    messageFile = sent.files[0];
    await post(endpoint, { text: '替换他人卡片', sendCard: true, recordId: secondOrderResult.order.id, clientMessageId: 'bad-card' }, orderResult.token, 400);
    await post(endpoint, { files: [], text: '', clientMessageId: 'empty' }, orderResult.token, 400);
    await post(endpoint, { text: '伪造消息', clientMessageId: 'intruder' }, secondOrderResult.token, 403);
    await post(endpoint, { text: '已收到文档，正在审核', clientMessageId: 'staff-msg-001' }, service);
    const first = await api(`/api/conversations/${conversationId}?after=0`, { token: orderResult.token });
    assert.equal(first.messages.length, 2); assert.equal(first.latestSeq, 2); assert.equal(first.messages[1].sender, 'staff');
    assert.equal((await api(`/api/conversations/${conversationId}?after=1`, { token: orderResult.token })).messages.length, 1);
    await post(`/api/conversations/${conversationId}/read`, { seq: 2 }, orderResult.token);
    await post(`/api/conversations/${conversationId}/read`, { seq: 1 }, service);
    await post(`/api/conversations/${conversationId}/read`, { seq: 1 }, orderResult.token);
    const listing = (await api('/api/conversations', { token: service })).conversations[0];
    assert.equal(listing.readByCustomer, 2); assert.equal(listing.readByStaff, 1); assert.equal(listing.lastMessage.seq, 2);
    assert.equal(listing.record.number, orderResult.order.number); assert.equal(listing.messages, undefined);
    await download(messageFile.id, orderResult.token); await download(messageFile.id, service);
    await download(messageFile.id, secondOrderResult.token, 403); await download(messageFile.id, projectResult.token, 403); await download(messageFile.id, reviewer, 403);
  });
  await t.test('工程会话卡片绑定自身；保密项目聊天不允许上传工程附件', async () => {
    const conversation = (await post('/api/conversations', { kind: 'project', recordId: projectResult.project.id }, projectResult.token)).conversation;
    projectConversationId = conversation.id;
    const message = (await post(`/api/conversations/${conversation.id}/messages`, { sendCard: true, clientMessageId: 'project-card' }, projectResult.token)).message;
    assert.equal(message.card.kind, 'project'); assert.equal(message.card.title, projectResult.project.title);
    await api(`/api/conversations/${conversation.id}`, { token: orderResult.token, expected: 403 });
    const secretConversation = (await post('/api/conversations', { kind: 'project', recordId: secretProjectResult.project.id }, secretProjectResult.token)).conversation;
    await post(`/api/conversations/${secretConversation.id}/messages`, { text: '误附设计资料', files: [docx], clientMessageId: 'secret-docx' }, secretProjectResult.token, 400);
    await post(`/api/conversations/${secretConversation.id}/messages`, { text: '后台也不能附图纸', files: [docx], clientMessageId: 'secret-staff-docx' }, service, 400);
    await post(`/api/conversations/${secretConversation.id}/messages`, { text: '仅交流设备规格，不上传图纸', clientMessageId: 'secret-safe' }, service);
  });
  await t.test('消息分页游标不漏条；请求来源与材料路径保持保护', async () => {
    for (let index = 0; index < 203; index++) await post(`/api/conversations/${projectConversationId}/messages`, { text: `增量消息 ${index}`, clientMessageId: `page-${index}` }, service);
    const page = await api(`/api/conversations/${projectConversationId}?after=0`, { token: projectResult.token });
    assert.equal(page.messages.length, 200); assert.equal(page.hasMore, true); assert.equal(page.latestSeq, 200);
    const next = await api(`/api/conversations/${projectConversationId}?after=${page.latestSeq}`, { token: projectResult.token });
    assert.equal(next.messages.length, 4); assert.equal(next.latestSeq, 204); assert.equal(next.hasMore, false);
    await api(`/api/conversations/${projectConversationId}?after=-1`, { token: projectResult.token, expected: 400 });
    await api('/api/projects', { method: 'POST', body: projectData(), expected: 403, headers: { Origin: 'https://not-local.invalid' } });
    assert.equal((await api('/api/stats', { token: admin })).projects, 3);
  });
  await t.test('旧订单不带新单号也可查询；服务重启后链接、资料、会话与人工参考价仍在', async () => {
    const db = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    const oldOrder = JSON.parse(db.prepare("SELECT body FROM records WHERE kind='order' AND id=?").get(secondOrderResult.order.id).body);
    delete oldOrder.number; db.prepare("UPDATE records SET body=? WHERE kind='order' AND id=?").run(JSON.stringify(oldOrder), oldOrder.id); db.close();
    assert.equal((await post('/api/guest/lookup', { orderId: oldOrder.id, phone: oldOrder.phone, code: secondOrderResult.accessCode })).order.id, oldOrder.id);
    await platform.close(); platform = createPlatform({ root, dataDir }); url = await platform.start(0);
    await api(`/api/conversations/${conversationId}`, { token: orderResult.token, expected: 401 });
    const restoredOrder = await post('/api/guest/access', { key: orderResult.accessKey });
    const restoredProject = await post('/api/guest/access', { key: projectResult.accessKey });
    assert.equal(restoredProject.project.status, 'closed');
    const restoredConversation = await api(`/api/conversations/${conversationId}?after=0`, { token: restoredOrder.token });
    assert.equal(restoredConversation.messages.length, 2); assert.equal(restoredConversation.conversation.readByCustomer, 2);
    await download(messageFile.id, restoredOrder.token);
    assert.deepEqual((await api('/api/products')).products.find(item => item.id === product.id).referencePrice, product.referencePrice);
    admin = (await login('project.admin')).token;
    const auditText = JSON.stringify((await api('/api/admin/audit', { token: admin })).events);
    assert.equal(auditText.includes(orderResult.accessKey), false); assert.equal(auditText.includes(projectResult.accessCode), false);
    const changedDb = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
    const revoked = JSON.parse(changedDb.prepare("SELECT body FROM records WHERE kind='project' AND id=?").get(projectResult.project.id).body);
    revoked.secretHash = crypto.randomBytes(32).toString('hex');
    changedDb.prepare("UPDATE records SET body=? WHERE kind='project' AND id=?").run(JSON.stringify(revoked), revoked.id); changedDb.close();
    await post('/api/guest/access', { key: projectResult.accessKey }, undefined, 401);
  });
  console.log(`3.2 测试仅使用随机隔离库：${dataDir}（合成人脸协议，不代表真人活体验收）`);
});
