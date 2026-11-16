'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/ui-feedback.js'), 'utf8');

/* 独立运行真实事件委托和音效调度，替换音频设备而不把合成器创建当成听感验收。 */
function harness({ preference = null, audioError = false } = {}) {
  const events = {}, windowEvents = {}, hosts = [], buttons = [], timers = new Map();
  const store = new Map(preference === null ? [] : [['sany-ui-sound-muted-v1', preference]]);
  const stats = { contexts: 0, starts: 0, stops: 0, frequencies: [], disconnected: 0, resumed: 0 };
  let now = 100, timerId = 0, observer;
  function element({ toggle = false, disabled = false, inert = false, button = true, primary = false } = {}) {
    const attributes = new Map(toggle ? [['data-ui-sound-toggle', '']] : []);
    return { disabled, attributes, innerHTML: '',
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: key => attributes.get(key),
      hasAttribute: key => attributes.has(key), removeAttribute: key => attributes.delete(key),
      matches: () => primary,
      closest(selector) { return selector === '[inert]' ? inert ? {} : null : button ? this : null; }
    };
  }
  function host() {
    const value = { children: [], querySelector: () => value.children[0] || null,
      append(child) { value.children.push(child); buttons.push(child); } };
    hosts.push(value); return value;
  }
  const footer = host();
  const document = { body: {}, hidden: false,
    querySelectorAll: selector => selector === '[data-ui-sound-toggle]' ? buttons : hosts,
    createElement: () => element({ toggle: true }),
    addEventListener: (type, handler) => { events[type] = handler; }
  };
  class AudioContext {
    constructor() { if (audioError) throw Error('Audio disabled'); stats.contexts++; this.state = 'suspended'; this.currentTime = 1; this.destination = {}; }
    resume() { stats.resumed++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() { const oscillator = { frequency: { setValueAtTime: value => stats.frequencies.push(value), exponentialRampToValueAtTime() {} },
      connect() {}, disconnect() { stats.disconnected++; }, start() { stats.starts++; }, stop() { stats.stops++; oscillator.onended?.(); } }; return oscillator; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { stats.disconnected++; } }; }
  }
  const window = { AudioContext, addEventListener: (type, handler) => { windowEvents[type] = handler; } };
  const context = { window, document, localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    performance: { now: () => now }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} } };
  vm.runInNewContext(source, context, { filename: 'ui-feedback.js' });
  return { ...context, stats, store, events, windowEvents, footer, buttons, element, host,
    advance: () => { now += 100; }, mount: () => observer(),
    flushTimers: () => { for (const fn of timers.values()) fn(); timers.clear(); },
    click: async (target, isTrusted = true) => { events.click({ target, isTrusted }); await Promise.resolve(); await Promise.resolve(); } };
}

test('初始化无自动发声，业务页/开屏/登录节点重建后只补一个可访问开关', () => {
  const h = harness();
  assert.equal(h.stats.contexts, 0);
  assert.equal(h.footer.children.length, 1);
  assert.equal(h.buttons[0].getAttribute('aria-pressed'), 'true');
  assert.match(h.buttons[0].getAttribute('aria-label'), /点击静音/);
  const access = h.host(); h.mount(); h.mount();
  assert.equal(access.children.length, 1);
  assert.equal(h.buttons.length, 2);
});

test('可信按钮激活才创建和恢复音频，原生键盘click只播放一次且节点及时释放', async () => {
  const h = harness(), button = h.element({ primary: true });
  await h.click(button, false); assert.equal(h.stats.contexts, 0);
  assert.equal(h.events.keydown, undefined, '不重复监听Enter/Space以免与原生click叠音');
  assert.equal(h.events.input, undefined, '不监听密码或其他文字键入');
  await h.click(button);
  assert.equal(h.stats.contexts, 1); assert.equal(h.stats.resumed, 1);
  assert.equal(h.stats.starts, 1); assert.equal(h.stats.stops, 1); assert.equal(h.stats.disconnected, 2);
  assert.deepEqual(h.stats.frequencies, [720]);
  assert.equal(button.getAttribute('data-ui-pressed'), 'true');
  h.flushTimers(); assert.equal(button.hasAttribute('data-ui-pressed'), false);
  await h.click(button); assert.equal(h.stats.starts, 1, '65ms内不叠放同类短音');
  h.advance(); await h.click(button); assert.equal(h.stats.starts, 2);
});

test('禁用、inert、输入框以及后台页没有按钮音效', async () => {
  const h = harness();
  for (const button of [h.element({ disabled: true }), h.element({ inert: true }), h.element({ button: false })]) await h.click(button);
  h.document.hidden = true; await h.click(h.element());
  assert.equal(h.stats.contexts, 0);
});

test('静音开关立即生效并持久记忆，重新开启只有一声确认音', async () => {
  const h = harness();
  await h.click(h.buttons[0]);
  assert.equal(h.window.SanyFeedback.isMuted(), true);
  assert.equal(h.store.get('sany-ui-sound-muted-v1'), 'true');
  assert.equal(h.buttons[0].getAttribute('aria-pressed'), 'false');
  await h.click(h.element()); assert.equal(h.stats.contexts, 0);
  h.advance(); await h.click(h.buttons[0]);
  assert.equal(h.window.SanyFeedback.isMuted(), false);
  assert.equal(h.stats.starts, 1);
  const restored = harness({ preference: 'true' });
  await restored.click(restored.element()); assert.equal(restored.stats.contexts, 0);
});

test('同源标签页偏好同步，禁用WebAudio也不影响按钮视觉反馈', async () => {
  const h = harness();
  h.windowEvents.storage({ key: 'sany-ui-sound-muted-v1', newValue: 'true' });
  assert.equal(h.window.SanyFeedback.isMuted(), true);
  h.windowEvents.storage({ key: null }); assert.equal(h.window.SanyFeedback.isMuted(), false);
  const unavailable = harness({ audioError: true }), button = unavailable.element();
  await unavailable.click(button);
  assert.equal(button.getAttribute('data-ui-pressed'), 'true');
});
