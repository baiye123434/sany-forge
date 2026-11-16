'use strict';
const crypto = require('node:crypto');

/* 工程需求与本机客服独立于订单状态机。复用同一 SQLite 事务及绑定身份，
 * 客户会话始终只绑定一笔订单或一个工程工单，不能扩大为通用后台权限。 */
function createProjectService(ctx) {
  const { getCustomer, customerType, get, all, put, atomic, audit, auth, guestSession, publicProducts, addFiles, transition, revision, fail, text, integer, phone, phoneKey, checkPhoneQuery, hash, now, id, faceKey } = ctx;
  const clean = record => { const { secretHash, ...result } = record; return result; };
  const lookup = (kind, value) => get(kind, value) || all(kind).find(record => record.number === value);
  const number = ctx.documentNumber;
  const accessKeySecret = crypto.hkdfSync('sha256', faceKey, Buffer.alloc(0), 'sany-receipt-access-v1', 32);
  const accessAAD = Buffer.from('sany-platform:receipt:v1');
  function makeAccessKey(record, kind) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', accessKeySecret, iv);
    cipher.setAAD(accessAAD);
    const payload = Buffer.from(JSON.stringify({ version: 1, purpose: 'receipt', kind, id: record.id, secretHash: record.secretHash }));
    return Buffer.concat([Buffer.from([1]), iv, ...encryptPayload(cipher, payload)]).toString('base64url');
  }
  function encryptPayload(cipher, payload) {
    const content = Buffer.concat([cipher.update(payload), cipher.final()]);
    return [cipher.getAuthTag(), content];
  }
  function receipt(record, kind) { return { [kind]: clean(record), accessKey: makeAccessKey(record, kind), token: guestSession(record.id, kind) }; }
  function readAccessKey(input) {
    try {
      if (typeof input !== 'string' || input.length > 1600 || !/^[\w-]+$/.test(input)) throw new Error();
      const bytes = Buffer.from(input, 'base64url');
      if (bytes.length < 30 || bytes[0] !== 1) throw new Error();
      const decipher = crypto.createDecipheriv('aes-256-gcm', accessKeySecret, bytes.subarray(1, 13));
      decipher.setAAD(accessAAD); decipher.setAuthTag(bytes.subarray(13, 29));
      const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8'));
      if (payload.version !== 1 || payload.purpose !== 'receipt' || !['order', 'project'].includes(payload.kind)) throw new Error();
      const record = get(payload.kind, payload.id);
      if (!record || !record.secretHash || record.secretHash !== payload.secretHash) throw new Error();
      return { kind: payload.kind, record };
    } catch { fail('查询链接无效、已失效或不属于本机数据，请重新查询。', 401); }
  }
  function ownRecord(req, kind, recordId, staffRoles = ['admin', 'service', 'reviewer']) {
    const access = auth(req);
    if (access.user) {
      if (!staffRoles.includes(access.user.role)) fail('当前账号没有此操作权限。', 403);
    } else if ((kind === 'order' ? access.orderId : access.projectId) !== recordId || (kind === 'order' ? access.projectId : access.orderId)) fail('不能访问其他客户的资料。', 403);
    return access;
  }
  function projectItems(incoming) {
    if (!Array.isArray(incoming) || incoming.length > 50) fail('设备清单最多 50 项，请检查格式。');
    const products = new Map(publicProducts().filter(product => !product.exhibitOnly).map(product => [product.id, product])), seen = new Set();
    return incoming.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('设备清单格式无效。');
      const product = products.get(item.productId);
      if (!product) fail('清单中存在已下架或教学设备，请重新选择。');
      if (seen.has(product.id)) fail('同一设备请合并数量，不要重复添加。');
      seen.add(product.id);
      return { productId: product.id, quantity: integer(item.quantity, 1, 999), product: { id: product.id, code: product.code, name: product.name, category: product.category, subcategory: product.subcategory, image: product.image, referencePrice: product.referencePrice || null } };
    });
  }
  function checkProjectContent(confidential, items, files) {
    if (!Array.isArray(files)) fail('材料文件格式无效。');
    if (confidential && files.length) fail('保密工程只接收设备清单，不接收设计资料附件。');
    if (confidential && !items.length) fail('保密工程至少选择一项设备。');
    if (!confidential && !items.length && !files.length) fail('请选择设备或上传工程资料。');
  }
  const cardFor = (kind, record) => ({ kind, recordId: record.id, number: record.number || record.id, title: kind === 'order' ? `${record.product.code} ${record.product.name}` : record.title, image: kind === 'order' ? record.product.image : record.items?.[0]?.product?.image || record.items?.[0]?.image || '', status: record.status, confidential: kind === 'project' && record.confidential === true });
  const cleanConversation = conversation => {
    const record = get(conversation.kind, conversation.recordId), { messages, ...summary } = conversation;
    return { ...summary, record: record ? cardFor(conversation.kind, record) : null, lastMessage: messages.length ? publicMessage(messages.at(-1)) : null };
  };
  function conversationAccess(req, conversationId) {
    const conversation = get('conversation', conversationId);
    if (!conversation) fail('客服会话不存在。', 404);
    const access = ownRecord(req, conversation.kind, conversation.recordId, ['admin', 'service']);
    return { conversation, access };
  }
  async function route(req, url, body) {
    const p = url.pathname;
    if (p === '/api/guest/phone-projects' && req.method === 'POST') {
      checkPhoneQuery();
      const key = phoneKey(phone(body.phone));
      return { projects: all('project').filter(project => phoneKey(project.phone) === key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map(project => ({ id: project.id, number: project.number, title: project.title, status: project.status, createdAt: project.createdAt })) };
    }
    if (p === '/api/guest/phone-project' && req.method === 'POST') {
      checkPhoneQuery();
      const key = phoneKey(phone(body.phone)), project = lookup('project', text(body.projectId, 100));
      if (!project || phoneKey(project.phone) !== key) fail('联系电话与项目不匹配。', 401);
      return receipt(project, 'project');
    }
    if (p === '/api/guest/access' && req.method === 'POST') {
      const { record, kind } = readAccessKey(body.key);
      return { kind, ...receipt(record, kind) };
    }
    if (p === '/api/projects/lookup' && req.method === 'POST') {
      const project = lookup('project', text(body.projectId, 100));
      if (!project || project.phone !== body.phone || typeof body.code !== 'string' || hash(body.code) !== project.secretHash) fail('工单号、电话或查询凭证不匹配。', 401);
      return receipt(project, 'project');
    }
    if (p === '/api/projects' && req.method === 'POST') return atomic(() => {
      getCustomer(req);
      if (typeof body.confidential !== 'boolean') fail('请选择是否使用保密设备清单模式。');
      const items = projectItems(body.items || []), incoming = body.files || [];
      checkProjectContent(body.confidential, items, incoming);
      const accessCode = crypto.randomBytes(12).toString('base64url');
      const project = { customerId: getCustomer(req).id, customerType: customerType(body.customerType), id: id('PR'), number: number('PR'), title: text(body.title, 120), contact: text(body.contact, 40), phone: phone(body.phone),
        notes: text(body.notes || '', 4000, false), confidential: body.confidential, items, files: [], status: 'submitted',
        revision: 1, secretHash: hash(accessCode), createdAt: now(), updatedAt: now(), history: [] };
      project.files = addFiles(incoming, 'project', project.id, false);
      project.history.push({ id: id('EV'), from: null, to: 'submitted', actor: '客户', role: 'customer', note: project.notes || '客户提交工程需求，等待审核。', files: project.files, at: now() });
      put('project', project); audit('客户', '提交工程需求工单', project.id);
      return { ...receipt(project, 'project'), accessCode };
    });
    if (p === '/api/projects' && req.method === 'GET') { auth(req, ['admin', 'service', 'reviewer']); return { projects: all('project').map(clean) }; }
    const projectMatch = p.match(/^\/api\/projects\/([\w-]+)(?:\/(review|supplement))?$/);
    if (projectMatch) {
      const project = lookup('project', projectMatch[1]); if (!project) fail('工程工单不存在。', 404);
      const access = ownRecord(req, 'project', project.id);
      if (req.method === 'GET' && !projectMatch[2]) return { project: clean(project) };
      if (req.method === 'POST' && projectMatch[2]) return atomic(() => {
        revision(project, body);
        let next, note, files, extra = {};
        if (projectMatch[2] === 'review') {
          auth(req, ['admin', 'reviewer']);
          const transitions = { submitted: ['reviewing', 'needs_info'], reviewing: ['needs_info', 'accepted'], accepted: ['closed'] };
          next = body.status; if (!transitions[project.status]?.includes(next)) fail('当前工程工单不能跳转到此状态。', 409);
          note = text(body.note, 2000);
          if (project.confidential && body.files?.length) fail('保密工程不接收设计资料附件。');
          files = addFiles(body.files || [], 'project', project.id, false);
        } else {
          if (!access.projectId) fail('只有此工单客户可以补充资料。', 403);
          if (project.status !== 'needs_info') fail('当前工单不处于待补充资料状态。', 409);
          note = text(body.notes, 4000);
          const items = body.items === undefined ? project.items : projectItems(body.items);
          if (body.files !== undefined && !Array.isArray(body.files)) fail('材料文件格式无效。');
          checkProjectContent(project.confidential, items, [...project.files, ...(body.files || [])]);
          files = addFiles(body.files || [], 'project', project.id, false);
          extra = { items, notes: note }; next = 'submitted';
        }
        extra.files = [...project.files, ...files];
        const updated = transition(project, next, access, note, files, extra);
        put('project', updated); audit(access.actor, `工程工单 ${project.status} → ${next}`, project.id);
        return { project: clean(updated) };
      });
    }
    if (p === '/api/conversations' && req.method === 'POST') return atomic(() => {
      if (!['order', 'project'].includes(body.kind)) fail('请选择有效订单或工程工单。');
      const record = lookup(body.kind, text(body.recordId, 100)); if (!record) fail('关联记录不存在。', 404);
      const access = ownRecord(req, body.kind, record.id, ['admin', 'service']);
      const existing = all('conversation').find(value => value.kind === body.kind && value.recordId === record.id);
      if (existing) return { conversation: cleanConversation(existing) };
      const conversation = { id: id('CHAT'), kind: body.kind, recordId: record.id, createdAt: now(), updatedAt: now(), readByCustomer: 0, readByStaff: 0, latestSeq: 0, messages: [] };
      put('conversation', conversation); audit(access.actor, '建立本机客服会话', conversation.id);
      return { conversation: cleanConversation(conversation) };
    });
    if (p === '/api/conversations/unread' && req.method === 'GET') {
      auth(req, ['admin', 'service']);
      return { supportUnread: all('supportChat').reduce((n,c)=>n+c.messages.filter(m=>m.sender==='customer'&&m.seq>(c.readByStaff||0)).length,0), ticketOrderIds:[...new Set(all('ticket').map(t=>t.orderId))], conversations: all('conversation').map(c => ({ kind: c.kind, recordId: c.recordId, unread: c.messages.filter(m => m.sender === 'customer' && m.seq > (c.readByStaff || 0)).length })).filter(c => c.unread > 0) };
    }
    if (p === '/api/conversations' && req.method === 'GET') { auth(req, ['admin', 'service']); return { supportUnread: all('supportChat').reduce((n,c)=>n+c.messages.filter(m=>m.sender==='customer'&&m.seq>(c.readByStaff||0)).length,0), ticketOrderIds:[...new Set(all('ticket').map(t=>t.orderId))], conversations: all('conversation').map(cleanConversation).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }; }
    const conversationMatch = p.match(/^\/api\/conversations\/([\w-]+)(?:\/(messages|read))?$/);
    if (conversationMatch) {
      const { conversation, access } = conversationAccess(req, conversationMatch[1]);
      if (req.method === 'GET' && !conversationMatch[2]) {
        const after = integer(url.searchParams.get('after') || 0, 0, Number.MAX_SAFE_INTEGER);
        const messages = conversation.messages.filter(message => message.seq > after).slice(0, 200);
        /* 每页最多 200 条。latestSeq 是本次实际交付游标；完整最大序号见 conversation.latestSeq，
         * 这样前端按返回游标续拉时不会在重连后的消息积压中跳过记录。 */
        return { conversation: cleanConversation(conversation), messages: messages.map(publicMessage), latestSeq: messages.at(-1)?.seq ?? Math.min(after, conversation.latestSeq), hasMore: !!messages.length && messages.at(-1).seq < conversation.latestSeq };
      }
      if (req.method === 'POST' && conversationMatch[2] === 'messages') return atomic(() => {
        const clientMessageId = text(body.clientMessageId, 100);
        if (!/^[\w.-]+$/.test(clientMessageId)) fail('消息重试标识无效。');
        const sender = access.user ? 'staff' : 'customer';
        const actorId = access.user?.id || `customer:${conversation.recordId}`;
        const duplicate = conversation.messages.find(message => message.clientMessageId === clientMessageId && message.actorId === actorId);
        if (duplicate) return { message: publicMessage(duplicate), latestSeq: conversation.latestSeq };
        if (conversation.messages.length >= 5000) fail('本机会话已达到演示容量，请联系管理员归档。', 429);
        const messageText = text(body.text || '', 2000, false);
        if (body.sendCard !== undefined && typeof body.sendCard !== 'boolean') fail('订单卡片参数无效。');
        if (body.card !== undefined || body.recordId !== undefined || body.fileIds !== undefined) fail('请使用当前会话的发送订单功能，不能指定其他客户的卡片或材料。');
        const record = get(conversation.kind, conversation.recordId);
        if (conversation.kind === 'project' && record.confidential && body.files?.length) fail('保密工程客服会话不接收设计资料附件。');
        const files = addFiles(body.files || [], 'conversation', conversation.id, false);
        if (!messageText && !files.length && !body.sendCard) fail('请输入消息、添加附件或发送当前订单卡片。');
        const message = { id: id('MSG'), seq: conversation.latestSeq + 1, sender, senderName: access.user?.name || record.contact, text: messageText, files,
          card: body.sendCard ? cardFor(conversation.kind, record) : null, at: now(), clientMessageId, actorId };
        const updated = { ...conversation, messages: [...conversation.messages, message], latestSeq: message.seq, updatedAt: message.at };
        put('conversation', updated);
        return { message: publicMessage(message), latestSeq: message.seq };
      });
      if (req.method === 'POST' && conversationMatch[2] === 'read') return atomic(() => {
        const seq = integer(body.seq, 0, conversation.latestSeq), field = access.user ? 'readByStaff' : 'readByCustomer';
        const updated = { ...conversation, [field]: Math.max(conversation[field], seq) }; put('conversation', updated);
        return { conversation: cleanConversation(updated) };
      });
    }
    return undefined;
  }
  function publicMessage(message) { const { clientMessageId, actorId, ...result } = message; return result; }
  return { route, receipt, lookup, number, ownRecord, conversationAccess, publicMessage };
}

/* 参考价格仅接受人工确认的来源，空值保持“待询价”，不能生成或暗示官网销售报价。 */
function referencePrice(value, fail, text, now) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('参考价格格式无效。');
  const result = {};
  for (const field of ['buyMin', 'buyMax', 'rentMonthlyMin', 'rentMonthlyMax']) {
    const amount = value[field];
    if (amount === null || amount === undefined || amount === '') { result[field] = null; continue; }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 || Number(amount.toFixed(2)) !== amount) fail('参考价格必须为正数，最多两位小数。');
    result[field] = amount;
  }
  for (const [min, max] of [['buyMin', 'buyMax'], ['rentMonthlyMin', 'rentMonthlyMax']]) {
    if ((result[min] === null) !== (result[max] === null) || (result[min] !== null && result[max] < result[min])) fail('参考价格范围需完整填写，且上限不能低于下限。');
  }
  if (Object.values(result).every(amount => amount === null)) return null;
  return { ...result, source: text(value.source, 300), currency: 'CNY', updatedAt: now() };
}
module.exports = { createProjectService, referencePrice };
