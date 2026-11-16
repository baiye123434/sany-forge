'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

/* 使用真实过渡脚本，控制快照完成时机来复现注销发生在过渡中途的情况。 */
function harness() {
  const listeners = new Map(), progress = { hidden: false, setAttribute() {} };
  const main = { inert: false, attrs: {}, contains: () => false, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; }, querySelector: () => null };
  const document = { hidden: false, documentElement: { dataset: { pageTransitions: 'animated' } }, body: { append() {} }, activeElement: {},
    createElement: () => progress, querySelector: selector => selector === '#main' ? main : null,
    addEventListener(name, callback) { listeners.set(name, callback); } };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), scrollTo() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/page-motion.js'), 'utf8'), { window, document, setTimeout, clearTimeout });
  return { motion: window.SanyMotion, document, main, progress, listeners };
}

test('取消待提交路由立即解锁，迟到数据不能重新渲染', async () => {
  const { motion, main, document, progress } = harness();
  const pending = motion.begin(); assert.equal(main.inert, true);
  motion.cancel(); let rendered = false;
  assert.equal(await pending.commit(() => { rendered = true; }), false);
  assert.equal(rendered, false); assert.equal(main.inert, false);
  assert.equal(main.attrs['aria-busy'], undefined); assert.equal(progress.hidden, true);
  assert.equal(document.documentElement.dataset.pageMotion, 'idle');
});

test('取消已经创建但未更新的原生快照，旧回调仍不能写回', async () => {
  const { motion, document, main } = harness();
  let apply, release, skipped = 0, rendered = false;
  const finished = new Promise(resolve => { release = resolve; });
  document.startViewTransition = callback => {
    apply = callback;
    return { ready: Promise.resolve(), updateCallbackDone: finished, finished, skipTransition() { skipped++; release(); } };
  };
  const pending = motion.begin().commit(() => { rendered = true; });
  motion.cancel(); apply(); await pending;
  assert.equal(skipped, 1); assert.equal(rendered, false); assert.equal(main.inert, false);
});

test('双窗口组件入场期间直接更新业务内容，不创建遮挡快照', async () => {
  const { motion, document } = harness(); let rendered = 0;
  document.documentElement.dataset.workspaceMotion = 'entering';
  document.startViewTransition = () => { throw new Error('不应创建快照'); };
  assert.equal(await motion.begin().commit(() => { rendered++; }), true);
  assert.equal(rendered, 1);
});

test('窗口切换事件结束已有快照，正常业务更新不丢失', async () => {
  const { motion, document, listeners } = harness(); let release, skipped = 0, rendered = 0;
  const finished = new Promise(resolve => { release = resolve; });
  document.startViewTransition = callback => {
    callback(); return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished, skipTransition() { skipped++; release(); } };
  };
  const pending = motion.begin().commit(() => { rendered++; });
  listeners.get('sany:workspace-transition')(); await pending;
  assert.equal(skipped, 1); assert.equal(rendered, 1);
});

test('默认切页不创建整页快照或淡出动画',async()=>{const {motion,document,main}=harness();delete document.documentElement.dataset.pageTransitions;document.startViewTransition=()=>{throw Error('不应创建快照')};main.animate=()=>{throw Error('不应淡出')};let rendered=false;await motion.begin().commit(()=>{rendered=true});assert.equal(rendered,true);assert.equal(main.inert,false);});
