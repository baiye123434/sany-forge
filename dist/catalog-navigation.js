(function (root, factory) {
  'use strict';
  /* 同一份纯函数用于网页筛选与 Node.js 验证，不修改官方目录或商品对象。 */
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SanyCatalog = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const groups = Object.freeze([
    { id: 'excavation', label: '挖掘类', description: '挖掘机、装载机与土石方施工设备' },
    { id: 'lifting', label: '起重类', description: '汽车、履带、随车与港口起重机' },
    { id: 'concrete', label: '混凝土类', description: '泵车、搅拌车、搅拌站与混凝土施工设备' },
    { id: 'road', label: '路面施工类', description: '压路机、摊铺机、铣刨机与沥青设备' },
    { id: 'pile', label: '桩工钻掘类', description: '旋挖钻机、打桩机与地下连续墙设备' },
    { id: 'transport', label: '运输车辆类', description: '重卡、牵引车、轻卡与公路自卸车' },
    { id: 'logistics', label: '搬运仓储类', description: '叉车、AGV、立体库与港口搬运设备' },
    { id: 'parts', label: '零件类', description: '属具、工模夹具与液压核心部件' },
    { id: 'intelligent', label: '智能制造类', description: '焊接、视觉检测与建筑工业化装备' },
    { id: 'energy', label: '新能源类', description: '风电、光伏、氢能、储能与换电设备' },
    { id: 'mining', label: '矿山机械类', description: '矿用车辆、煤炭、掘进与破碎筛分装备' },
    { id: 'special', label: '环卫与特种类', description: '环卫、环保、消防、高空作业与石油装备' },
    { id: 'other', label: '其他装备', description: '尚未归入以上用途的设备与产品' }
  ].map(group => Object.freeze(group)));

  const modelGroups = Object.freeze({
    excavator: 'excavation',
    welder: 'intelligent',
    hydraulics: 'parts',
    agv: 'logistics',
    vision: 'intelligent',
    solar: 'energy',
    pump: 'concrete',
    crane: 'lifting',
    drill: 'pile'
  });

  const categoryGroups = Object.freeze({
    土石方机械: 'excavation',
    装载机械: 'excavation',
    起重机: 'lifting',
    混凝土机械: 'concrete',
    路面机械: 'road',
    桩工机械: 'pile',
    三一重卡: 'transport',
    自卸车: 'transport',
    仓储物流: 'logistics',
    港口机械: 'logistics',
    建筑工业化: 'intelligent',
    锂电装备: 'intelligent',
    风电设备: 'energy',
    光伏产品: 'energy',
    氢能装备: 'energy',
    锂能装备: 'energy',
    煤炭机械: 'mining',
    矿用自卸车: 'mining',
    破碎装备: 'mining',
    三一环境: 'special',
    环保工程: 'special',
    高空作业机械: 'special',
    应急救援装备: 'special',
    石油装备: 'special'
  });

  function hasModel(product) {
    return Boolean(product && Object.prototype.hasOwnProperty.call(modelGroups, product.modelKey));
  }

  function groupFor(product) {
    if (!product || typeof product !== 'object') return 'other';
    const category = String(product.category || '').trim();
    const subcategory = String(product.subcategory || '').trim();
    const name = String(product.name || '').trim();
    const classification = `${category} ${subcategory}`;
    const identity = `${classification} ${name}`;

    /*
     * 先识别明确作为商品销售的属具、夹具和零件，再判断整机用途。
     * 故意不检索简介、参数与宽泛的“液压”词，避免把带液压系统的整机当成零件。
     */
    if (/(属具|工模夹具|零部件|配件|液压系统|液压部件|液压核心部件)/.test(classification)
      || /零件类|液压核心部件/.test(identity)
      || /^(液压泵|液压阀|液压油缸|液压马达|液压快换|液压手腕|液压吸盘|液压抓钢器|液压振动夯)(?:\s|·|$)/.test(name)) return 'parts';

    /* 恢复的九类模型按作业用途进入大类，不把“原版模型”当成产品类别。 */
    if ((product.exhibitOnly || /^原版\s*9\s*类模型$/.test(category)) && hasModel(product)) {
      return modelGroups[product.modelKey];
    }

    /* 官网部分主类包含多种用途，使用其名称或子类做更直观的二级分流。 */
    if (/换电站/.test(`${subcategory} ${name}`)) return 'energy';
    if (category === '港口机械' && /起重机/.test(`${subcategory} ${name}`)) return 'lifting';
    if (category === '港口机械' && /牵引车/.test(`${subcategory} ${name}`)) return 'transport';
    if (category === '土石方机械' && /打桩机/.test(name)) return 'pile';
    if (Object.prototype.hasOwnProperty.call(categoryGroups, category)) return categoryGroups[category];

    /* 新增产品优先尊重后台所选大类；未选大类时，仅以名称和分类补充判断。 */
    const directGroup = groups.find(group => group.id === category || group.label === category);
    if (directGroup) return directGroup.id;
    if (/矿用|矿山|采煤|掘进|破碎|筛分/.test(identity)) return 'mining';
    if (/起重机|起重机械/.test(identity)) return 'lifting';
    if (/旋挖|桩工|打桩|铣槽|连续墙/.test(identity)) return 'pile';
    if (/混凝土|搅拌车|搅拌站|泵车|拖泵/.test(identity)) return 'concrete';
    if (/挖掘|挖机|装载机|土石方/.test(identity)) return 'excavation';
    if (/压路|摊铺|铣刨|平地机|沥青|路面机械/.test(identity)) return 'road';
    if (/叉车|AGV|仓储|搬运|物流|堆高|正面吊/i.test(identity)) return 'logistics';
    if (/光伏|风电|风力发电|储能|氢能|制氢|加氢|新能源类/.test(identity)) return 'energy';
    if (/机器人|焊接|视觉|智能制造|建筑工业化/.test(identity)) return 'intelligent';
    if (/牵引车|重卡|轻卡|自卸车|运输车辆/.test(identity)) return 'transport';
    if (/消防|环卫|环保|救援|高空作业|石油/.test(identity)) return 'special';
    return hasModel(product) ? modelGroups[product.modelKey] : 'other';
  }

  function sortProducts(products, order = 'model') {
    const source = Array.isArray(products) ? products : [];
    if (order !== 'model') return source.slice();
    /* 索引兜底保证同组保持官网原顺序；不原地排序，也不改写商品的 modelKey。 */
    return source.map((product, index) => ({ product, index }))
      .sort((left, right) => Number(hasModel(right.product)) - Number(hasModel(left.product)) || left.index - right.index)
      .map(item => item.product);
  }

  function groupCounts(products) {
    const counts = Object.fromEntries(groups.map(group => [group.id, 0]));
    for (const product of Array.isArray(products) ? products : []) counts[groupFor(product)] += 1;
    return counts;
  }

  return Object.freeze({ groups, groupFor, hasModel, sortProducts, groupCounts });
});
