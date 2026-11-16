'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist/emblem-assembly.js'), 'utf8');
const original = fs.readFileSync(path.join(root, 'dist/assets/brand/sany-emblem.svg'), 'utf8');

/* 在独立上下文中执行真实共享组件，只替换调用方提供的动画适配器。
 * 本组测试验证几何与时序契约，不把无浏览器测试冒充真实绘制帧验收。 */
function loadEmblem(viewport = {}) {
  const context = { window: { innerWidth: 1440, innerHeight: 900, ...viewport } };
  vm.runInNewContext(source, context, { filename: 'emblem-assembly.js' });
  return context.window.SanyEmblem;
}

function createHarness(result = () => Promise.resolve(true), geometry = {}) {
  const selectors = [
    '[data-emblem-sweep]', '[data-emblem-ring]',
    ...['top', 'right', 'left'].flatMap(part => [
      `[data-emblem-arm="${part}"]`, `[data-emblem-pulse="${part}"]`
    ])
  ];
  const elements = new Map(selectors.map(selector => [selector, { selector,
    ...(geometry.box ? { getBoundingClientRect: () => geometry.box } : {})
  }]));
  const calls = [];
  const svg = {
    dataset: { assemblyState: 'complete' },
    ...(geometry.matrix ? { getScreenCTM: () => geometry.matrix } : {}),
    querySelector(selector) {
      assert.ok(elements.has(selector), `应只请求已定义的独立构件：${selector}`);
      return elements.get(selector);
    }
  };
  const animate = (element, frames, options) => {
    /* 去除 VM 跨上下文原型差异，保留全部关键帧和时序值用于严格比较。 */
    const call = JSON.parse(JSON.stringify({ selector: element.selector, frames, options }));
    calls.push(call);
    return result(call);
  };
  return { svg, animate, calls };
}

function findCall(calls, selector) {
  const matches = calls.filter(call => call.selector === selector);
  assert.equal(matches.length, 1, `每个构件只应提交一次动画：${selector}`);
  return matches[0];
}

/* 独立解析原始路径的 M/L/C 指令，取最长直边作为箭杆轴，不从实现抄一份方向常量。
 * 相对指令需要逐段累加；M 的起点位于原图圆润尖端，用于验证尖端确实在前方。 */
function originalShaft(part) {
  const d = original.match(new RegExp(`<path\\b[^>]*id="sany-arm-${part}"[^>]*\\sd="([^"]+)"`))[1];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/g);
  const edges = [];
  let cursor = 0, command, x = 0, y = 0, tip;
  while (cursor < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[cursor])) command = tokens[cursor++];
    assert.match(command, /^[MmLlCc]$/, '原图路径出现新指令时必须重新审查几何测试');
    const upper = command.toUpperCase(), relative = command !== upper;
    const count = upper === 'C' ? 6 : 2;
    const values = tokens.slice(cursor, cursor + count).map(Number);
    cursor += count;
    const next = { x: values[count - 2] + (relative ? x : 0), y: values[count - 1] + (relative ? y : 0) };
    if (upper === 'L') edges.push({ tail: { x, y }, head: next, length: Math.hypot(next.x - x, next.y - y) });
    if (upper === 'M') { tip ||= next; command = relative ? 'l' : 'L'; }
    x = next.x; y = next.y;
  }
  const shaft = edges.sort((a, b) => b.length - a.length)[0];
  return { ...shaft, tip, forward: { x: (shaft.head.x - shaft.tail.x) / shaft.length, y: (shaft.head.y - shaft.tail.y) / shaft.length } };
}

function translation(frame) {
  const [, x, y] = frame.transform.match(/translate\(([-.\de]+)px, ([-.\de]+)px\)/).map(Number);
  return { x, y };
}

test('装配标记保留原始三臂与外环路径，不使用图片或文字替身', () => {
  const markup = loadEmblem().markup();
  for (const part of ['left', 'top', 'right']) {
    const sourcePath = original.match(new RegExp(`<path\\b[^>]*id="sany-arm-${part}"[^>]*\\sd="([^"]+)"`));
    const assemblyPath = markup.match(new RegExp(`<g\\b[^>]*data-emblem-arm="${part}"[^>]*>\\s*<path\\b[^>]*\\sd="([^"]+)"`));
    assert.ok(sourcePath && assemblyPath, `${part} 必须存在独立原始路径`);
    assert.equal(assemblyPath[1], sourcePath[1], `${part} 不得改变原标识轮廓`);
  }
  const sourceRing = original.match(/<path\b[^>]*id="sany-ring"[^>]*\sd="([^"]+)"/);
  const assemblyRing = markup.match(/<path\b[^>]*data-emblem-outline\b[^>]*\sd="([^"]+)"/);
  assert.ok(sourceRing && assemblyRing, '必须直接保留原始外环路径');
  assert.equal(assemblyRing[1], sourceRing[1]);
  assert.equal((markup.match(/<path\b/g) || []).length, 4, '仅由三臂与原始外环组成图形');
  assert.doesNotMatch(markup, /<(?:img|image|text|foreignObject)\b/i, '禁止先演替身再切换图片或文字');
});

test('重复创建的遮罩标识独立，且每枚图形引用自己的用户坐标遮罩', () => {
  const emblem = loadEmblem();
  const identifiers = new Set();
  for (let index = 0; index < 4; index++) {
    const markup = emblem.markup();
    const mask = markup.match(/<mask\b[^>]*id="([^"]+)"[^>]*>/);
    assert.ok(mask, '每枚图形都有独立扫掠遮罩');
    assert.match(mask[0], /maskUnits="userSpaceOnUse"/);
    assert.ok(markup.includes(`mask="url(#${mask[1]})"`), '只能引用本图形的遮罩');
    assert.ok(!identifiers.has(mask[1]), '开屏与登录同时存在时不得复用遮罩 ID');
    identifiers.add(mask[1]);
  }
});

test('完整绘环期间顶部、右侧、左侧三个一错峰射入并完成落位', async () => {
  const harness = createHarness();
  assert.equal(await loadEmblem().play(harness.svg, harness), true);
  assert.equal(harness.calls.length, 8, '两条绘环、三臂、三个落位脉冲应共同执行');
  const sweep = findCall(harness.calls, '[data-emblem-sweep]');
  assert.equal(sweep.options.duration, 1800);
  assert.equal(sweep.options.easing, 'linear');
  assert.deepEqual(sweep.frames, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }]);
  const guide = findCall(harness.calls, '[data-emblem-ring]');
  assert.equal(guide.options.duration, sweep.options.duration);
  const expected = [
    { part: 'top', delay: 220 },
    { part: 'right', delay: 630 },
    { part: 'left', delay: 1040 }
  ];
  for (const { part, delay } of expected) {
    const arm = findCall(harness.calls, `[data-emblem-arm="${part}"]`);
    assert.equal(arm.options.delay, delay);
    assert.equal(arm.options.duration, 620);
    assert.ok(arm.options.delay > 0 && arm.options.delay + arm.options.duration < sweep.options.duration,
      `${part} 必须在画环开始后进入、画环结束前落位`);
    assert.equal(arm.frames[0].opacity, 1, '画外起点不靠透明度伪装，构件射入屏幕时就是实物');
    assert.equal(arm.frames[1].offset, .62, '先高速飞行，再用短距离阻尼收尾');
  }
});

test('宽屏、竖屏、横屏及缩放坐标中三片起点完整位于真实屏幕之外', async () => {
  for (const [width, height, matrix] of [
    [1440, 900, { a: 4, b: 0, c: 0, d: 4 }],
    [390, 844, { a: 2.7, b: 0, c: 0, d: 2.7 }],
    [844, 390, { a: 1.9, b: 0, c: 0, d: 1.9 }],
    [3200, 1800, { a: 3.9, b: .2, c: -.2, d: 3.9 }]
  ]) {
    const box = { left: width / 2 - 45, right: width / 2 + 70, top: height / 2 - 60, bottom: height / 2 + 65 };
    const harness = createHarness(undefined, { matrix, box });
    await loadEmblem({ innerWidth: width, innerHeight: height }).play(harness.svg, harness);
    for (const part of ['top', 'right', 'left']) {
      const arm = findCall(harness.calls, `[data-emblem-arm="${part}"]`);
      const [, dx, dy] = arm.frames[0].transform.match(/translate\(([-.\de]+)px, ([-.\de]+)px\)/).map(Number);
      const screenX = matrix.a * dx + matrix.c * dy, screenY = matrix.b * dx + matrix.d * dy;
      assert.ok(box.right + screenX <= -55.99 || box.left + screenX >= width + 55.99 || box.bottom + screenY <= -55.99 || box.top + screenY >= height + 55.99,
        `${width}×${height} ${part} 必须整片在屏幕边缘之外，而不只是离开小SVG`);
      const { forward } = originalShaft(part), travel = { x: -dx, y: -dy };
      assert.ok(travel.x * forward.x + travel.y * forward.y > 0, `${part} 应朝尖端方向飞行，不得尾部领头`);
      assert.ok(Math.abs(travel.x * forward.y - travel.y * forward.x) / Math.hypot(travel.x, travel.y) < 1e-10,
        `${part} 即使父层旋转或缩放也必须沿原始箭杆轴直射，不得径向横滑`);
    }
  }
});

test('视觉视口偏移和缩放优先于布局视口，落位阻尼不随屏幕尺寸膨胀', async () => {
  const harness = createHarness(undefined, { matrix: { a: 2, b: 0, c: 0, d: 2 }, box: { left: 200, right: 300, top: 300, bottom: 390 } });
  await loadEmblem({ innerWidth: 1600, innerHeight: 1200, visualViewport: { offsetLeft: 20, offsetTop: 30, width: 450, height: 650 } }).play(harness.svg, harness);
  const top = findCall(harness.calls, '[data-emblem-arm="top"]');
  const start = translation(top.frames[0]);
  assert.ok(start.x > 0, '顶部构件应从右下反推起点，让朝左上的尖端领头');
  assert.ok(Math.abs(start.y - 218) < .00001, '起点按可见视口下沿680px加56px余量计算，而不是整张布局页');
  for (const part of ['top', 'right', 'left']) {
    const arm = findCall(harness.calls, `[data-emblem-arm="${part}"]`);
    const [, x, y] = arm.frames[1].transform.match(/translate\(([-.\de]+)px, ([-.\de]+)px\)/).map(Number);
    assert.ok(Math.abs(Math.hypot(x, y) - 1.3) < .00001, '落位过冲始终只有1.3个SVG单位');
  }
});

test('三枚构件的原始尖端领先，运动、过冲和回位均沿同一箭杆轴', async () => {
  const harness = createHarness();
  await loadEmblem().play(harness.svg, harness);
  for (const part of ['top', 'right', 'left']) {
    const { tail, head, tip, forward, length } = originalShaft(part);
    assert.ok(length > 40, `${part} 必须找到主箭杆而非短装饰边`);
    const tipLead = (tip.x - tail.x) * forward.x + (tip.y - tail.y) * forward.y;
    assert.ok(tipLead > length, `${part} 圆润尖端必须比箭杆前端更靠前`);
    assert.ok((tip.x - head.x) * forward.x + (tip.y - head.y) * forward.y > 0);
    const arm = findCall(harness.calls, `[data-emblem-arm="${part}"]`);
    const positions = arm.frames.map(translation);
    for (const position of positions) assert.ok(Math.abs(position.x * forward.y - position.y * forward.x) < 1e-8,
      `${part} 任一关键帧都不得横向漂移`);
    const project = position => position.x * forward.x + position.y * forward.y;
    assert.ok(project(positions[0]) < -100, '起点必须位于箭尾方向的画外');
    assert.ok(Math.abs(project(positions[1]) - 1.3) < 1e-8, '高速飞行沿尾→尖方向抵达并轻微过冲');
    assert.ok(Math.abs(project(positions[2]) + .22) < 1e-8, '只在落位时进行同轴的小距离阻尼');
    assert.equal(Math.abs(project(positions[3])), 0, '最终精确归位');
  }
});

test('每片终帧归零且不旋转变形，辅助圆与脉冲在终帧消失', async () => {
  const harness = createHarness();
  await loadEmblem().play(harness.svg, harness);
  for (const part of ['top', 'right', 'left']) {
    const arm = findCall(harness.calls, `[data-emblem-arm="${part}"]`);
    assert.deepEqual(arm.frames.at(-1), { transform: 'translate(0px, 0px)', opacity: 1 });
    for (const frame of arm.frames) assert.match(frame.transform, /^translate\([^()]+\)$/,
      '原始三臂只能平移，不允许旋转、缩放或替换轮廓');
    const pulse = findCall(harness.calls, `[data-emblem-pulse="${part}"]`);
    assert.equal(pulse.frames.at(-1).opacity, 0);
  }
  const guide = findCall(harness.calls, '[data-emblem-ring]');
  assert.equal(guide.frames.at(-1).strokeDashoffset, 0);
  assert.equal(guide.frames.at(-1).opacity, 0, '原始外环显示后辅助正圆不得残留');
});

test('必须等待全部绘制、三臂和最后落位脉冲结束才报告完成', async () => {
  const pending = new Map();
  const harness = createHarness(call => new Promise(resolve => pending.set(call.selector, resolve)));
  let settled = false;
  const completion = loadEmblem().play(harness.svg, harness).then(result => { settled = true; return result; });
  assert.equal(harness.svg.dataset.assemblyState, 'drawing');
  assert.equal(pending.size, 8);
  const lastPulse = '[data-emblem-pulse="left"]';
  for (const [selector, resolve] of pending) if (selector !== lastPulse) resolve(true);
  /* 刷新 Promise 微任务而非等待真实计时，证明最后一个动画仍控制总完成状态。 */
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, '其余七个任务完成也不能提前切幕');
  assert.equal(harness.svg.dataset.assemblyState, 'drawing');
  pending.get(lastPulse)(true);
  assert.equal(await completion, true);
  assert.equal(harness.svg.dataset.assemblyState, 'complete');
});

test('任意动画取消返回 false 时标记取消，不得伪装为全部完成', async () => {
  const harness = createHarness(call => Promise.resolve(call.selector !== '[data-emblem-arm="right"]'));
  assert.equal(await loadEmblem().play(harness.svg, harness), false);
  assert.equal(harness.svg.dataset.assemblyState, 'cancelled');
  assert.equal(harness.calls.length, 8);
});

test('空图形安全返回 false，不启动任何动画', async () => {
  let calls = 0;
  assert.equal(await loadEmblem().play(null, { animate: async () => { calls++; return true; } }), false);
  assert.equal(calls, 0);
});
