'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../dist/catalog-navigation.js');

const root = path.resolve(__dirname, '..');
const official = JSON.parse(fs.readFileSync(path.join(root, 'dist/catalog.json'), 'utf8')).products;
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'dist/legacy-models.json'), 'utf8'));
const all = [...official, ...legacy];

test('561 款官网产品和 9 类原版模型均恰好归入一个已定义大类', () => {
  assert.equal(official.length, 561);
  assert.equal(legacy.length, 9);
  const ids = navigation.groups.map(group => group.id);
  assert.equal(new Set(ids).size, ids.length);
  const counts = navigation.groupCounts(all);
  for (const product of all) {
    const group = navigation.groupFor(product);
    assert.equal(ids.filter(id => id === group).length, 1, `${product.id} / ${product.name}`);
  }
  assert.deepEqual(Object.keys(counts), ids);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 570);
  assert.equal(counts.other, 0, '现有目录不应有漏分产品');
});

test('分类、计数和排序不改写官方来源、类别或任何产品元数据', () => {
  const before = JSON.stringify(all);
  const originalReferences = all.slice();
  all.forEach(navigation.groupFor);
  navigation.groupCounts(all);
  navigation.sortProducts(all);
  navigation.sortProducts(all, 'catalog');
  assert.equal(JSON.stringify(all), before);
  assert.deepEqual(all, originalReferences);
  all.forEach((product, index) => assert.equal(product, originalReferences[index]));
});

test('9 个注册模型全部可识别，并按用途回到各自大类', () => {
  const expected = {
    excavator: 'excavation', welder: 'intelligent', hydraulics: 'parts',
    agv: 'logistics', vision: 'intelligent', solar: 'energy',
    pump: 'concrete', crane: 'lifting', drill: 'pile'
  };
  assert.deepEqual(legacy.map(product => product.modelKey).sort(), Object.keys(expected).sort());
  for (const product of legacy) {
    assert.equal(navigation.hasModel(product), true, product.modelKey);
    assert.equal(navigation.groupFor(product), expected[product.modelKey], product.modelKey);
  }
  for (const modelKey of [null, undefined, '', 'unknown-model', 'constructor', '__proto__', 'toString']) {
    assert.equal(navigation.hasModel({ modelKey }), false);
  }
  assert.equal(navigation.hasModel(null), false);
});

test('属具、工模夹具和液压核心部件统一进入零件类', () => {
  const attachments = official.filter(product => product.subcategory === '属具');
  const tooling = official.filter(product => product.subcategory === '工模夹具');
  assert.equal(attachments.length, 24);
  assert.equal(tooling.length, 5);
  for (const product of [...attachments, ...tooling, legacy.find(product => product.modelKey === 'hydraulics')]) {
    assert.equal(navigation.groupFor(product), 'parts', `${product.code} / ${product.name}`);
  }
  assert.equal(navigation.groupFor({ name: '液压泵' }), 'parts');
  assert.equal(navigation.groupFor({ name: '液压油缸' }), 'parts');
  assert.equal(navigation.groupCounts(all).parts, 30);
});

test('整机不能因为简介提及液压泵、配件、属具等词而误归零件', () => {
  const machines = [
    { category: '土石方机械', subcategory: '中挖', name: '液压挖掘机', summary: '配有液压泵和可换属具', expected: 'excavation' },
    { category: '起重机', name: '全液压起重机', summary: '零部件包括液压阀', expected: 'lifting' },
    { category: '煤炭机械', subcategory: '液压支架', name: '高强支护装置', summary: '采用液压系统', expected: 'mining' },
    { category: '混凝土机械', subcategory: '泵车', name: '液压混凝土泵车', summary: '液压核心部件可靠', expected: 'concrete' }
  ];
  for (const product of machines) assert.equal(navigation.groupFor(product), product.expected);
  for (const product of official.filter(product => product.subcategory === '液压支架')) {
    assert.equal(navigation.groupFor(product), 'mining');
  }
});

test('混合官网主类按实际用途细分，换电站不混入车辆', () => {
  const cases = [
    [{ category: '港口机械', subcategory: '岸边集装箱起重机' }, 'lifting'],
    [{ category: '港口机械', subcategory: '叉车' }, 'logistics'],
    [{ category: '港口机械', subcategory: '纯电动港口牵引车' }, 'transport'],
    [{ category: '三一重卡', subcategory: '换电站' }, 'energy'],
    [{ category: '土石方机械', subcategory: '多样化产品', name: '打桩机' }, 'pile'],
    [{ category: '矿用自卸车', name: '宽体自卸车' }, 'mining'],
    [{ category: '自卸车', name: '电动自卸车' }, 'transport'],
    [{ category: '智能制造类', name: '自定义生产单元' }, 'intelligent'],
    [{ category: 'parts', name: '自定义部件' }, 'parts']
  ];
  for (const [product, expected] of cases) assert.equal(navigation.groupFor(product), expected);
});

test('有模型优先为稳定排序，保留组内顺序与对象引用', () => {
  const fixtures = [
    { id: 'plain-1', modelKey: null },
    { id: 'model-1', modelKey: 'crane' },
    { id: 'plain-2', modelKey: 'unknown-model' },
    { id: 'model-2', modelKey: 'excavator' },
    { id: 'plain-3', modelKey: null }
  ];
  const originalOrder = fixtures.map(product => product.id);
  const sorted = navigation.sortProducts(fixtures);
  assert.deepEqual(sorted.map(product => product.id), ['model-1', 'model-2', 'plain-1', 'plain-2', 'plain-3']);
  assert.deepEqual(fixtures.map(product => product.id), originalOrder);
  assert.notEqual(sorted, fixtures);
  assert.equal(sorted[0], fixtures[1]);
  const catalogOrder = navigation.sortProducts(fixtures, 'catalog');
  assert.notEqual(catalogOrder, fixtures);
  assert.deepEqual(catalogOrder, fixtures);
  const fullSorted = navigation.sortProducts(all);
  assert.deepEqual(fullSorted.slice(0, 9), legacy);
  assert.deepEqual(fullSorted.slice(9), official);
});

test('缺失输入安全兜底，分类定义只读且 CommonJS 不污染全局', () => {
  assert.equal(navigation.groupFor(null), 'other');
  assert.equal(navigation.groupFor({}), 'other');
  assert.deepEqual(navigation.sortProducts(null), []);
  assert.equal(Object.values(navigation.groupCounts(null)).reduce((sum, count) => sum + count, 0), 0);
  assert.equal(Object.isFrozen(navigation), true);
  assert.equal(Object.isFrozen(navigation.groups), true);
  assert.equal(Object.isFrozen(navigation.groups[0]), true);
  assert.equal(globalThis.SanyCatalog, undefined);
});

test('浏览器脚本暴露相同的 window.SanyCatalog 接口，无 DOM 或网络依赖', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'dist/catalog-navigation.js'), 'utf8'), context);
  const browser = context.window.SanyCatalog;
  assert.equal(typeof browser.groupFor, 'function');
  assert.equal(browser.groups.length, navigation.groups.length);
  assert.equal(browser.groupFor({ category: '土石方机械', subcategory: '属具' }), 'parts');
  assert.equal(browser.hasModel({ modelKey: 'excavator' }), true);
  assert.equal(JSON.stringify(browser.groupCounts(all)), JSON.stringify(navigation.groupCounts(all)));
});
