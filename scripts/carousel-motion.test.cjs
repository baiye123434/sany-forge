'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/carousel-motion.js'), 'utf8');

/* 测试真实轮播模块的动画生命周期；替身不宣称验证像素效果，视觉由浏览器验收覆盖。 */
function harness({ reduced = false, hidden = false } = {}) {
  const animations = [], events = new Map(), preloads = [];
  const preference = { matches: reduced, addEventListener(_name, callback) { this.change = callback; } };
  const animate = (frames, options) => {
    let resolve, reject;
    const animation = { frames, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish() { resolve(); }, cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
    animations.push(animation); return animation;
  };
  const host = {
    dataset: {}, childElementCount: 3, innerHTML: 'old', children: [], animate,
    querySelector(selector) { return { selector, animate }; },
    append(child) { this.children.push(child); },
    cloneNode() {
      const old = { attributes: { id: 'heroSlide', 'aria-live': 'off' }, className: '', inert: false, animate, removed: false,
        removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
        querySelectorAll() { return []; }, remove() { this.removed = true; host.children = host.children.filter(child => child !== this); } };
      return old;
    }
  };
  const window = { matchMedia: () => preference }, document = { hidden, addEventListener(name, callback) { events.set(name, callback); } };
  class Image { constructor() { preloads.push(this); } decode() { return Promise.resolve(); } }
  vm.runInNewContext(source, { window, document, Image }, { filename: 'production-carousel-motion.js' });
  return { api: window.SanyHeroMotion, animations, events, preference, document, host, preloads };
}

test('轮播分层入场：旧层不可交互且无重复id，全部动画完成后完整回收', async () => {
  const app = harness();
  const pending = app.api.show(app.host, 'new', { direction: 1 });
  assert.equal(app.host.innerHTML, 'new');
  assert.equal(app.host.dataset.heroMotion, 'running');
  assert.equal(app.animations.length, 4);
  const old = app.host.children[0];
  assert.equal(old.attributes.id, undefined);
  assert.equal(old.attributes['aria-live'], undefined);
  assert.equal(old.attributes['aria-hidden'], 'true');
  assert.equal(old.inert, true);
  assert.equal(app.animations[1].frames[0].transform, 'translateX(84px) scale(.94)');
  assert.equal(app.animations[1].options.duration, 650);
  app.animations.forEach(animation => animation.finish()); await pending;
  assert.equal(app.host.dataset.heroMotion, 'idle');
  assert.equal(old.removed, true);
  assert.ok(app.animations.every(animation => animation.cancelled));
});

test('轮播连续快切：取消全部旧动画，只保留最后一项，反向切换方向相反', async () => {
  const app = harness();
  const first = app.api.show(app.host, 'second');
  const old = app.host.children[0];
  const second = app.api.show(app.host, 'third', { direction: -1 });
  await first;
  assert.equal(old.removed, true);
  assert.ok(app.animations.slice(0, 4).every(animation => animation.cancelled));
  assert.equal(app.host.innerHTML, 'third');
  assert.equal(app.host.dataset.heroMotion, 'running');
  assert.equal(app.host.children.length, 1);
  assert.equal(app.animations[5].frames[0].transform, 'translateX(-84px) scale(.94)');
  app.animations.slice(4).forEach(animation => animation.finish()); await second;
  assert.equal(app.host.dataset.heroMotion, 'idle');
  assert.equal(app.host.children.length, 0);
});

test('轮播降级：减少动态、隐藏页面和首张直接呈现，不创建退场层', async () => {
  for (const settings of [{ reduced: true }, { hidden: true }, {}]) {
    const app = harness(settings);
    await app.api.show(app.host, 'new', { animate: !!(settings.reduced || settings.hidden) });
    assert.equal(app.host.innerHTML, 'new');
    assert.equal(app.host.dataset.heroMotion, 'idle');
    assert.equal(app.host.children.length, 0);
    assert.equal(app.animations.length, 0);
  }
});

test('轮播切窗、隐藏和减少动态变化都终止悬挂动画，精选图片预加载去重', async () => {
  for (const kind of ['workspace', 'hidden', 'reduced']) {
    const app = harness();
    const pending = app.api.show(app.host, 'new');
    if (kind === 'workspace') app.events.get('sany:workspace-transition')();
    if (kind === 'hidden') { app.document.hidden = true; app.events.get('visibilitychange')(); }
    if (kind === 'reduced') app.preference.change({ matches: true });
    await pending;
    assert.equal(app.host.dataset.heroMotion, 'idle');
    assert.equal(app.host.children.length, 0);
    assert.ok(app.animations.every(animation => animation.cancelled));
  }
  const app = harness();
  app.api.preload(['one.png', 'two.png', 'one.png', '']);
  assert.deepEqual(app.preloads.map(image => image.src), ['one.png', 'two.png']);
});
