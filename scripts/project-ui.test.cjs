'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/project-service.js'), 'utf8');
const catalog = require('../dist/catalog-navigation.js');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/*
 * 加载真实模块，用最小 DOM 与接口替身核对交互及并发保护。
 * 不启动浏览器、不录入真实人脸、不读取生产业务库；视觉与双窗口验收仍由实际浏览器完成。
 */
function harness(settings = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map(), calls = [], downloads = [], modals = [], notices = [], writes = new Map();
  let serial = 0, timerId = 0, service, fileReads = 0, modalHTML = '';
  class Element {
    constructor(id = '') { this.id = id; this.dataset = {}; this.textContent = ''; this._html = ''; this.isConnected = true; this.scrollHeight = 300; this.scrollTop = 0; this.clientHeight = 300; this.disabled = false; this.value = ''; this.children = []; }
    set innerHTML(value) {
      this._html = value;
      for (const match of value.matchAll(/<[\w-]+\b([^>]*)>/g)) {
        const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(entry => [entry[1], entry[2]]));
        if (!attrs.id) continue;
        const node = new Element(attrs.id); nodes.set(node.id, node);
      }
    }
    get innerHTML() { return this._html; }
    insertAdjacentHTML(_position, value) { this._html += value; }
    querySelector(selector) {
      if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
      if (selector === '.project-chat-empty' && this._html.includes('project-chat-empty')) return { remove: () => { this._html = ''; } };
      return null;
    }
    querySelectorAll() { return []; }
    closest(selector) {
      if (selector === '[data-project-action]' && this.dataset.projectAction) return this;
      if (selector === 'form[data-project-form]' && this.dataset.projectForm) return this;
      return null;
    }
  }
  nodes.set('main', new Element('main'));
  const document = {
    hidden: false,
    querySelector: selector => selector.startsWith('#') ? nodes.get(selector.slice(1)) || null : null,
    querySelectorAll: () => [],
    addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); }
  };
  const state = { products: Array.from({ length: 65 }, (_, index) => ({ id: `P${index}`, code: `SY${index}`, name: `测试设备 ${index}`, category: index % 2 ? '液压部件' : '土石方机械', image: 'assets/test.webp', published: true })).concat([{ id: 'TEACH', code: '教学模型', exhibitOnly: true }]), user: { role: 'admin' }, staffToken: 'STAFF', dirty: false };
  const project = { id: 'P-TEST', number: 'PR-20261020-TEST', title: '测试工程', contact: '测试甲方', phone: '13800000000', status: 'submitted', revision: 1, items: [], history: [], files: [{ id: 'F-PROJECT', name: '工程.docx' }], createdAt: '2026-10-20T00:00:00Z', ...settings.project };
  const conversation = { id: 'CHAT', kind: 'project', recordId: project.id, record: { kind: 'project', recordId: project.id, number: project.number, title: project.title, status: project.status, confidential: !!project.confidential }, latestSeq: 0, readByCustomer: 0, readByStaff: 0 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const bridge = {
    esc, getState: () => state,
    async api(endpoint, method = 'GET', body, token) {
      const call = { endpoint, method, body: body === undefined ? undefined : clone(body), token }; calls.push(call);
      const custom = await settings.respond?.(call, { project, conversation });
      if (custom !== undefined) return custom;
      if (endpoint === '/api/projects' && method === 'POST') return { project, token: 'GUEST', accessCode: 'SECRET', accessKey: 'ENCRYPTED' };
      if (endpoint === '/api/projects') return { projects: [project] };
      if (endpoint === '/api/projects/lookup') return { project, token: 'GUEST' };
      if (endpoint === '/api/guest/access') return { kind: 'project', project, token: 'LINK-GUEST' };
      if (/^\/api\/projects\/[^/]+$/.test(endpoint)) return { project };
      if (/\/(review|supplement)$/.test(endpoint)) return { project };
      if (endpoint === '/api/conversations' && method === 'POST') return { conversation };
      if (endpoint === '/api/conversations') return { conversations: [conversation] };
      if (endpoint.includes('/messages')) return { message: { id: 'M1', seq: 1, sender: 'customer', senderName: '客户', text: body.text, files: [], card: body.sendCard ? conversation.record : null, at: project.createdAt } };
      if (endpoint.includes('/read')) return { ok: true };
      if (endpoint.startsWith('/api/conversations/CHAT?')) return { conversation, messages: [], latestSeq: 0 };
      throw new Error(`Missing fake API: ${method} ${endpoint}`);
    },
    field: (label, name, type, value, attrs) => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`,
    textarea: (label, name, value, attrs) => `<label>${esc(label)}<textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`,
    select: (label, name) => `<label>${esc(label)}<select name="${name}"></select></label>`,
    options: entries => entries.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join(''),
    formEnd: label => `<div class="form-error"></div><button type="submit">${esc(label)}</button>`,
    empty: (title, body) => `<div>${esc(title)} ${esc(body)}</div>`, time: value => value || '',
    toast: message => notices.push(message),
    async filesFrom() { fileReads++; return [{ name: '工程.docx', data: 'AA==' }]; },
    downloadFile: async (...args) => downloads.push(args), downloadText: (...args) => downloads.push(args),
    showModal(title, html) { service.stop(); modals.push(title); modalHTML = html; const node = new Element('modal'); node.innerHTML = html; nodes.set('modal', node); },
    openOrder: async (...args) => calls.push({ openOrder: args })
  };
  const sandbox = {
    window: { SanyCatalog: catalog, SanyRequestId: { create: () => `MSG-${++serial}` } }, document,
    location: { origin: 'http://127.0.0.1:8791' },
    localStorage: { getItem: key => writes.get(key) || null, setItem: (key, value) => writes.set(key, value) },
    navigator: { clipboard: { writeText: async value => writes.set('clipboard', value) } },
    confirm: () => true,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    FormData: class {
      constructor(form) { this.form = form; }
      entries() { return Object.entries(this.form.data)[Symbol.iterator](); }
      get(name) { return this.form.data[name] ?? null; }
    },
    console
  };
  vm.runInNewContext(source, sandbox, { filename: 'project-service.js' });
  service = sandbox.window.SanyProjects.create(bridge);
  function form(kind, data) {
    const node = new Element(); node.dataset.projectForm = kind; node.data = data;
    const submit = new Element(), error = new Element(), text = new Element();
    text.focus = () => {}; text.value = data.text || '';
    node.elements = { text }; node.submitButton = submit; node.errorBox = error; node.inputs = [text, new Element()];
    node.reset = () => { node.data = {}; text.value = ''; node.resetCount = (node.resetCount || 0) + 1; };
    node.querySelector = selector => selector === '[type="submit"]' ? submit : selector === '.form-error' ? error : null;
    node.querySelectorAll = () => node.inputs;
    return node;
  }
  async function dispatch(name, target) { await Promise.all((listeners.get(name) || []).map(callback => callback({ target, preventDefault() {} }))); }
  async function action(actionName, data = {}) { const node = new Element(); node.dataset = { projectAction: actionName, ...data }; await dispatch('click', node); }
  async function input(kind, data = {}, event = 'change') { const node = new Element(); node.dataset = { projectInput: kind, ...data }; Object.assign(node, data); await dispatch(event, node); }
  async function tick() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) await callback(); }
  return { service, nodes, calls, downloads, modals, notices, writes, state, project, conversation, form, dispatch, action, input, tick, timers, document, modalHTML: () => modalHTML, fileReads: () => fileReads };
}

test('项目选型按大类搜索、排除教学模型并保留跨筛选数量，全部目录可继续显示', async () => {
  const h = harness(); h.service.renderProjectPage();
  assert.doesNotMatch(h.nodes.get('projectPickerResults').innerHTML, /教学模型/);
  assert.match(h.nodes.get('projectPickerResults').innerHTML, /picker-more/);
  await h.action('picker-more');
  assert.match(h.nodes.get('projectPickerResults').innerHTML, /SY64/);
  await h.input('pick', { id: 'P0', checked: true });
  await h.input('quantity', { id: 'P0', value: '3' }, 'input');
  await h.input('group', { value: 'parts' });
  assert.match(h.nodes.get('projectSelection').innerHTML, /SY0/);
  await h.input('pick', { id: 'P1', checked: true });
  assert.match(h.nodes.get('projectSelection').innerHTML, /value="3"/);
  assert.equal(h.nodes.get('projectSelectedCount').textContent, '已选 2 种');
});

test('保密项目必须选设备，禁止读取或上传附件并隐藏长查询链接', async () => {
  const h = harness({ project: { confidential: true } }); h.service.renderProjectPage();
  const invalid = h.form('create', { title: '保密工程', confidential: 'on', contact: '测试', phone: '13800000000' });
  await h.dispatch('submit', invalid);
  assert.match(invalid.errorBox.textContent, /至少勾选/);
  await h.input('pick', { id: 'P0', checked: true });
  const valid = h.form('create', { title: '保密工程', confidential: 'on', contact: '测试', phone: '13800000000', remember: 'on' });
  await h.dispatch('submit', valid);
  const request = h.calls.find(call => call.endpoint === '/api/projects');
  assert.deepEqual(request.body.items, [{ productId: 'P0', quantity: 1 }]);
  assert.deepEqual(request.body.files, []); assert.equal(h.fileReads(), 0);
  assert.equal(request.body.confidential, true);
  assert.match(h.modalHTML(), /PR-20261020-TEST/);
  assert.doesNotMatch(h.modalHTML(), /ENCRYPTED/);
  await h.action('receipt-copy');
  assert.match(h.writes.get('clipboard'), /#receipt=ENCRYPTED$/);
  const stored = JSON.parse(h.writes.get('sany-project-receipts-v1'))[0];
  assert.equal(stored.accessKey, 'ENCRYPTED'); assert.equal(stored.token, undefined);
});

test('普通工程资料随提交发送，后台审核保留修订号与身份令牌', async () => {
  const h = harness(); h.service.renderProjectPage();
  await h.dispatch('submit', h.form('create', { title: '测试工程', contact: '测试', phone: '13800000000' }));
  assert.equal(h.fileReads(), 1);
  assert.equal(h.calls.find(call => call.endpoint === '/api/projects').body.files[0].name, '工程.docx');
  await h.service.openProject('P-TEST', 'STAFF', false);
  assert.match(h.modalHTML(), /项目需求审核/);
  await h.dispatch('submit', h.form('review', { status: 'reviewing', note: '确认资料完整' }));
  const review = h.calls.find(call => call.endpoint.endsWith('/review'));
  assert.equal(review.body.revision, 1); assert.equal(review.token, 'STAFF');
});

test('待补充项目由客户重提，文件下载使用当前项目授权', async () => {
  const h = harness({ project: { status: 'needs_info' } });
  await h.service.openProject('P-TEST', 'OWN-GUEST', true);
  assert.match(h.modalHTML(), /补充并重新提交审核/);
  await h.action('file', { id: 'F-PROJECT', name: '工程.docx', scope: 'detail' });
  assert.deepEqual(h.downloads[0], ['F-PROJECT', '工程.docx', 'OWN-GUEST']);
  await h.dispatch('submit', h.form('supplement', { notes: '补充运输条件' }));
  const call = h.calls.find(item => item.endpoint.endsWith('/supplement'));
  assert.equal(call.body.revision, 1); assert.equal(call.body.notes, '补充运输条件'); assert.equal(call.token, 'OWN-GUEST');
});

test('客服增量轮询去重且不重建输入区，文件下载保留对应客户令牌', async () => {
  let polls = 0;
  const h = harness({ respond(call, fixture) {
    if (call.endpoint.startsWith('/api/conversations/CHAT?')) return { conversation: fixture.conversation, messages: [{ id: 'M2', seq: 1, sender: 'staff', text: '已收到资料', files: [] }], latestSeq: ++polls ? 1 : 0 };
  } });
  await h.service.openChat('project', 'P-TEST', 'CHAT-GUEST', true);
  const content = h.modalHTML(), input = h.form('chat', { text: '尚未发送的草稿' });
  await h.tick();
  assert.equal(h.modals.length, 1); assert.equal(h.modalHTML(), content); assert.equal(input.elements.text.value, '尚未发送的草稿');
  assert.equal((h.nodes.get('projectMessages').innerHTML.match(/已收到资料/g) || []).length, 1);
  assert.ok(h.calls.some(call => call.endpoint.endsWith('?after=1')));
  await h.action('file', { id: 'CHATFILE', name: '回复.docx', scope: 'chat' });
  assert.deepEqual(h.downloads[0], ['CHATFILE', '回复.docx', 'CHAT-GUEST']);
  assert.ok(h.calls.some(call => call.endpoint.endsWith('/read') && call.body.seq === 1));
});

test('订单与工程卡片按业务类型分别显示待受理和待审核', async () => {
  for (const kind of ['order', 'project']) {
    const h = harness({ respond(call, fixture) {
      fixture.conversation.kind = kind;
      fixture.conversation.record.kind = kind;
      if (call.endpoint.startsWith('/api/conversations/CHAT?')) return { conversation: fixture.conversation, messages: [
        { id: 'CARD', seq: 1, sender: 'customer', card: fixture.conversation.record, files: [] }
      ], latestSeq: 1 };
    } });
    await h.service.openChat(kind, 'P-TEST', 'CHAT-GUEST', true);
    const html = h.nodes.get('projectMessages').innerHTML;
    assert.match(html, new RegExp(kind === 'order' ? '待受理' : '待审核'));
    assert.doesNotMatch(html, new RegExp(kind === 'order' ? '待审核' : '待受理'));
  }
});

test('网络失败保持消息和附件，重试复用幂等编号且不重复读取文件', async () => {
  let attempts = 0;
  const h = harness({ respond(call) { if (call.endpoint.endsWith('/messages') && ++attempts === 1) throw new Error('Network disconnected'); } });
  await h.service.openChat('project', 'P-TEST', 'GUEST', true);
  const form = h.form('chat', { text: '需要进一步确认', sendCard: 'on' });
  await h.dispatch('submit', form);
  assert.match(form.errorBox.textContent, /Network disconnected/); assert.equal(form.elements.text.value, '需要进一步确认');
  assert.equal(form.inputs[0].disabled, true); assert.equal(form.resetCount, undefined);
  await h.dispatch('submit', form);
  const sent = h.calls.filter(call => call.endpoint.endsWith('/messages'));
  assert.deepEqual(sent[0].body, sent[1].body); assert.equal(sent[1].body.sendCard, true);
  assert.equal(h.fileReads(), 1); assert.equal(form.resetCount, 1); assert.equal(form.inputs[0].disabled, false);
});

test('服务端明确拒绝的消息保留内容并允许用户修改', async () => {
  const h = harness({ respond(call) { if (call.endpoint.endsWith('/messages')) throw Object.assign(new Error('文件不符合要求'), { status: 400 }); } });
  await h.service.openChat('project', 'P-TEST', 'GUEST', true);
  const form = h.form('chat', { text: '保留这段说明' });
  await h.dispatch('submit', form);
  assert.equal(form.inputs[0].disabled, false); assert.equal(form.elements.text.value, '保留这段说明');
  assert.match(form.submitButton.textContent, /修改后/);
});

test('保密会话不出现上传入口，也不读取文件选择', async () => {
  const h = harness({ project: { confidential: true } });
  await h.service.openChat('project', 'P-TEST', 'GUEST', true);
  assert.doesNotMatch(h.modalHTML(), /type="file"/);
  await h.dispatch('submit', h.form('chat', { text: '仅沟通非涉密需求' }));
  assert.equal(h.fileReads(), 0);
  assert.deepEqual(h.calls.find(call => call.endpoint.endsWith('/messages')).body.files, []);
});

test('退出后迟到的会话创建与项目详情不能复活弹窗', async () => {
  for (const mode of ['chat', 'project']) {
    const pending = deferred();
    const h = harness({ respond(call) {
      if ((mode === 'chat' && call.endpoint === '/api/conversations') || (mode === 'project' && call.endpoint === '/api/projects/P-TEST')) return pending.promise;
    } });
    const work = mode === 'chat' ? h.service.openChat('project', 'P-TEST', 'GUEST', true) : h.service.openProject('P-TEST', 'GUEST', true);
    h.service.stop();
    pending.resolve(mode === 'chat' ? { conversation: h.conversation } : { project: h.project });
    await work;
    assert.equal(h.modals.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('切换页面后迟到的项目提交、查询与链接解密不能覆盖新页面', async () => {
  for (const mode of ['create', 'lookup', 'link']) {
    const pending = deferred(), endpoint = mode === 'create' ? '/api/projects' : mode === 'lookup' ? '/api/projects/lookup' : '/api/guest/access';
    const h = harness({ respond(call) { if (call.endpoint === endpoint) return pending.promise; } });
    h.service.renderProjectPage();
    const work = mode === 'link' ? h.service.handleAccessLink('KEY') : h.dispatch('submit', h.form(mode, mode === 'create' ? { title: '工程', phone: '13800000000', contact: '甲方' } : { projectId: 'P-TEST', phone: '13800000000', code: 'CODE' }));
    await new Promise(resolve => setImmediate(resolve));
    h.service.stop(); h.nodes.get('main').innerHTML = '新的工作区';
    pending.resolve({ project: h.project, kind: 'project', token: 'GUEST', accessCode: 'CODE', accessKey: 'KEY' });
    await work;
    assert.equal(h.modals.length, 0); assert.equal(h.nodes.get('main').innerHTML, '新的工作区');
  }
});

test('停止与页面隐藏均清理轮询，旧轮询响应不能写入新弹窗', async () => {
  const h = harness(); await h.service.openChat('project', 'P-TEST', 'GUEST', true);
  assert.equal(h.timers.size, 1);
  h.document.hidden = true; await h.dispatch('visibilitychange', new Object()); assert.equal(h.timers.size, 0);
  h.document.hidden = false; await h.dispatch('visibilitychange', new Object());
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.timers.size, 1);
  h.service.stop(); assert.equal(h.timers.size, 0);
  const pending = deferred();
  const delayed = harness({ respond(call) { if (call.endpoint.includes('?after=')) return pending.promise; } });
  const opening = delayed.service.openChat('project', 'P-TEST', 'GUEST', true);
  await new Promise(resolve => setImmediate(resolve));
  delayed.service.stop(); delayed.nodes.get('projectMessages').innerHTML = '新的内容';
  pending.resolve({ conversation: delayed.conversation, messages: [{ id: 'LATE', seq: 1, text: '迟到消息' }], latestSeq: 1 });
  await opening;
  assert.equal(delayed.nodes.get('projectMessages').innerHTML, '新的内容'); assert.equal(delayed.timers.size, 0);
});

test('项目详情临时状态清理后，工作人员按钮仍按项目ID打开会话', async () => {
  const h = harness();
  await h.service.openProject('P-TEST', 'STAFF', false);
  assert.match(h.modalHTML(), /data-project-action="detail-chat"[^>]*data-id="P-TEST"/);
  h.service.stop();
  await h.action('detail-chat', { id: 'P-TEST', customer: 'false' });
  assert.equal(h.modals.at(-1), '客户会话');
  assert.ok(h.calls.some(c => c.endpoint === '/api/conversations' && c.body.recordId === 'P-TEST' && c.token === 'STAFF'));
  assert.deepEqual(h.notices, []);
});
