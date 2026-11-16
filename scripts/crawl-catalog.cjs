/* 从三一集团中文官网公开目录采集产品。仅保留公开产品字段，不采集后台人员、价格占位或内部备注。
 * API 路径来自产品解决方案页及产品分类页的公开脚本，来源证据写入 catalog-audit.json。
 * 执行：node scripts/crawl-catalog.cjs；已有本地图片复用，缺失图片并发不超过 4。
 */
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://www.sanygroup.com';
const API = 'https://api-www.sanygroup.com';
const CONCURRENCY = 4;
const PAGE_SIZE = 50;
const audit = {
  startedAt: new Date().toISOString(),
  collectedDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  scope: '三一集团中文主站当前公开导航的全部主类及列表分页；不包含独立子公司站、海外站和需登录的配件商城。',
  evidence: [],
  categories: [],
  errors: [],
  imageFailures: [],
  warnings: [],
};

/* 网络请求设定超时、最多重试一次，并对图片限制体积。遇到拒绝访问直接记录，不尝试绕过。 */
async function request(url, kind = 'json') {
  let finalError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SANY-Competition-Catalog/1.0', Accept: kind === 'json' ? 'application/json' : '*/*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.noRetry = [401, 403, 404, 429].includes(response.status);
        throw error;
      }
      if (kind === 'json') {
        const data = await response.json();
        if (data.success === false || (data.code && data.code !== 200)) throw new Error(`API response: ${data.message || data.code}`);
        return data;
      }
      if (kind === 'text') return response.text();
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/') && !type.includes('application/octet-stream')) throw new Error(`Not an image: ${type}`);
      const MAX_BYTES = 6 * 1024 * 1024;
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Image exceeds 6 MiB');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > MAX_BYTES) throw new Error('Image exceeds 6 MiB');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const format = detectImageFormat(bytes);
      if (!format) throw new Error(`Unrecognized image content: ${type}`);
      return { bytes, type, format, url: response.url };
    } catch (error) {
      finalError = error;
      if (error.noRetry) break;
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 700));
    }
  }
  throw finalError;
}

/* 官网部分历史图片以 application/octet-stream 返回，因此依据文件签名核验，不能只信 MIME。 */
function detectImageFormat(bytes) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 500).toString('utf8'))) return 'svg';
  return null;
}

async function pool(items, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

function clean(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeSource(value, fallback) {
  try {
    const url = new URL(value, SITE);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

/* 文案只用产品名称、分类与公开作业场景生成短简介；规格保留原值和单位，不推算新参数。 */
function normalize(product, category, children) {
  const subcategory = children.get(Number(product.cateid)) || category.name;
  const code = clean(product.serialnumber);
  const name = clean(product.name) || code || subcategory;
  const applications = Array.isArray(product.condition)
    ? product.condition.map(item => clean(item.name)).filter(Boolean)
    : [];
  const specs = (product.attributeGroups || []).flatMap(group =>
    (group.productAttributes || []).map(attribute => ({
      name: clean(attribute.name),
      value: clean(attribute.value),
      unit: clean(attribute.unit),
      group: clean(group.name),
    })),
  ).filter(item => item.name && item.value);
  const uniqueSpecs = [...new Map(specs.map(item => [`${item.group}|${item.name}|${item.value}|${item.unit}`, item])).values()];
  const id = `official-${product.id}`;
  const sourceUrl = safeSource(`/product/${product.purl || `${product.id}.html`}`, `${SITE}/product-list/?cate=${category.id}`);
  return {
    id,
    officialId: Number(product.id),
    code,
    name,
    category: category.name,
    categoryId: category.id,
    subcategory,
    subcategoryId: Number(product.cateid),
    summary: applications.length
      ? `${name}，属于${category.name}的${subcategory}系列。官网列出的应用场景包括${applications.slice(0, 4).join('、')}。`
      : `${name}，属于三一${category.name}的${subcategory}系列。可查看公开规格并提交购机、租赁需求。`,
    applications,
    specs: uniqueSpecs,
    image: null,
    imageSourceUrl: safeSource(product.coverimg || (product.imgs || [])[0] || '', ''),
    sourceUrl,
    brochureUrl: product.guideurl ? safeSource(product.guideurl, '') : null,
    electric: Number(product.electric) === 1,
    modelKey: null,
    modelStatus: '暂无3D模型',
    sourceModifiedAt: clean(product.modifytime) || null,
  };
}

async function collectCategory(category, products) {
  const status = {
    id: category.id,
    name: category.name,
    sourceUrl: `${SITE}/product-list/?cate=${category.id}`,
    subcategories: category.children.map(item => ({ id: item.id, name: item.name })),
    expectedCount: null,
    receivedCount: 0,
    uniqueCount: 0,
    pages: [],
  };
  audit.categories.push(status);
  const children = new Map(category.children.map(item => [Number(item.id), item.name]));
  const seen = new Set();
  try {
    for (let page = 1; page <= 100; page += 1) {
      const url = `${API}/api/product/getbyparentcate?page=${page}&limit=${PAGE_SIZE}&cate=${category.id}`;
      const response = await request(url);
      const result = response.data || {};
      const list = Array.isArray(result.productList) ? result.productList : [];
      if (page === 1) status.expectedCount = Number(result.count || 0);
      status.pages.push({ page, count: list.length, url });
      status.receivedCount += list.length;
      let added = 0;
      for (const product of list) {
        if (!product.id) continue;
        if (!seen.has(product.id)) added += 1;
        seen.add(product.id);
        const item = normalize(product, category, children);
        if (!products.has(item.id)) products.set(item.id, item);
      }
      if (seen.size >= status.expectedCount || list.length === 0) break;
      if (!added) throw new Error('Repeated page without new product IDs');
    }
    status.uniqueCount = seen.size;
    status.complete = seen.size === status.expectedCount;
    if (!status.complete) audit.warnings.push(`${category.name}：官网 count=${status.expectedCount}，实际去重=${seen.size}`);
  } catch (error) {
    status.uniqueCount = seen.size;
    status.complete = false;
    audit.errors.push({ stage: 'category', category: category.name, url: status.sourceUrl, message: error.message });
  }
  console.log(`${category.name}: ${status.uniqueCount}/${status.expectedCount ?? '?'}`);
}

async function downloadProductImage(product, index) {
  if (!product.imageSourceUrl || product.imageSourceUrl === `${SITE}/`) return;
  try {
    const source = new URL(product.imageSourceUrl);
    if (!/(^|\.)sanygroup\.com$|(^|\.)myqcloud\.com$|(^|\.)sany\.com\.cn$/.test(source.hostname)) {
      throw new Error(`Unrecognized image host: ${source.hostname}`);
    }
    /* 官网自身列表采用 imageMogr2/format/webp，复用该公开变体以压缩离线包体积。 */
    const optimized = new URL(source);
    optimized.search = 'imageMogr2/format/webp';
    product.imageDownloadUrl = optimized.href;
    const relative = `assets/catalog/${product.officialId}.webp`;
    const localPath = path.join(DIST, relative);
    try {
      const stat = await fs.stat(localPath);
      if (stat.size > 0) {
        product.image = relative;
        return;
      }
    } catch { /* 本地尚未下载时继续获取官网文件。 */ }
    let response;
    try {
      response = await request(optimized.href, 'image');
    } catch {
      response = await request(source.href, 'image');
      product.imageDownloadUrl = source.href;
    }
    const finalRelative = `assets/catalog/${product.officialId}.${response.format}`;
    await fs.writeFile(path.join(DIST, finalRelative), response.bytes);
    product.image = finalRelative;
  } catch (error) {
    audit.imageFailures.push({ id: product.id, url: product.imageSourceUrl, message: error.message });
  }
  if ((index + 1) % 50 === 0) console.log(`图片进度 ${index + 1}`);
}

async function main() {
  await fs.mkdir(path.join(DIST, 'assets', 'catalog'), { recursive: true });
  await fs.mkdir(path.join(DIST, 'assets', 'brand'), { recursive: true });

  /* 先验证入口与当前官网脚本仍公开声明这些 API，避免把接口猜测当作采集依据。 */
  const landingUrl = `${SITE}/product-solution/`;
  const categoryUrl = `${SITE}/product/tushifangjixie/`;
  const pages = await Promise.all([request(landingUrl, 'text'), request(categoryUrl, 'text')]);
  const scriptUrls = [...new Set(pages.flatMap(html =>
    [...html.matchAll(/<script src="([^"]+)"/g)].map(match => new URL(match[1], SITE).href),
  ))].filter(url => url.startsWith(`${SITE}/_nuxt/`));
  const bundles = [];
  await pool(scriptUrls, async url => {
    const text = await request(url, 'text');
    bundles.push({ url, text });
  });
  for (const term of ['api/ssrdata/single?id=141', 'api/product/getbyparentcate']) {
    const bundle = bundles.find(item => item.text.includes(term));
    if (!bundle) throw new Error(`官网脚本未找到已知公开 API：${term}，请重新核查入口`);
    audit.evidence.push({ page: term.includes('ssrdata') ? landingUrl : categoryUrl, scriptUrl: bundle.url, publicApiPattern: term });
  }
  const imageBundle = bundles.find(item => item.text.includes('imageMogr2/format/webp'));
  if (imageBundle) audit.evidence.push({ page: categoryUrl, scriptUrl: imageBundle.url, publicImageVariant: 'imageMogr2/format/webp' });
  const rootUrl = `${API}/api/ssrdata/single?id=141`;
  const rootResponse = await request(rootUrl);
  const categories = rootResponse.data?.categorytree;
  if (!Array.isArray(categories) || !categories.length) throw new Error('官网没有返回公开分类树');
  audit.categoryTreeSource = rootUrl;
  audit.categoryCount = categories.length;
  audit.subcategoryCount = categories.reduce((sum, category) => sum + category.children.length, 0);

  const products = new Map();
  await pool(categories, category => collectCategory(category, products));
  const list = [...products.values()];
  const order = new Map(categories.map((item, index) => [item.id, index]));
  list.sort((a, b) => order.get(a.categoryId) - order.get(b.categoryId) || a.officialId - b.officialId);

  for (const type of ['svg', 'png']) {
    const logoUrl = `${SITE}/img/sany-logo.${type}`;
    if (!pages.some(html => html.includes(`/img/sany-logo.${type}`))) continue;
    try {
      const result = await request(logoUrl, 'image');
      await fs.writeFile(path.join(DIST, 'assets', 'brand', `sany-logo.${type}`), result.bytes);
      audit.evidence.push({ page: landingUrl, officialBrandAsset: logoUrl, localPath: `assets/brand/sany-logo.${type}` });
    } catch (error) {
      audit.errors.push({ stage: 'brand', url: logoUrl, message: error.message });
    }
  }

  console.log(`目录完成：${list.length} 款，开始下载封面图片`);
  await pool(list, downloadProductImage);
  audit.finishedAt = new Date().toISOString();
  audit.expectedProductRows = audit.categories.reduce((sum, item) => sum + (item.expectedCount || 0), 0);
  audit.receivedProductRows = audit.categories.reduce((sum, item) => sum + item.receivedCount, 0);
  audit.uniqueProductCount = list.length;
  audit.duplicateRows = audit.receivedProductRows - list.length;
  audit.localImageCount = list.filter(item => item.image).length;
  audit.productsWithoutSpecs = list.filter(item => !item.specs.length).map(item => item.id);
  audit.complete = audit.categories.every(item => item.complete) && !audit.errors.some(item => item.stage === 'category');
  audit.limitations = [
    '“全部”限定于采集时三一集团中文主站公开导航分类及其分页返回产品，不等同于全球所有子公司和历史型号。',
    '规格为官网原值，未补造售价、库存、运行数据或质保期限；没有精确三维资产的产品统一标注暂无3D模型。',
    '封面图片为官网公开资产，仅在此参赛作品中引用；来源地址随产品保留。',
    '未公布规格的产品保留简介与官网链接，不以零值或演示参数补齐。',
  ];
  const catalog = {
    schemaVersion: 1,
    collectedAt: audit.finishedAt,
    collectedDate: audit.collectedDate,
    source: landingUrl,
    scope: audit.scope,
    categories: categories.map(item => ({ id: item.id, name: item.name, children: item.children.map(child => ({ id: child.id, name: child.name })) })),
    products: list,
  };
  const content = `${JSON.stringify(catalog, null, 2)}\n`;
  audit.catalogSha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(path.join(DIST, 'catalog.json'), content);
  await fs.writeFile(path.join(DIST, 'catalog-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  const readback = JSON.parse(await fs.readFile(path.join(DIST, 'catalog.json'), 'utf8'));
  if (readback.products.length !== list.length) throw new Error('目录读回数量不一致');
  console.log(JSON.stringify({ complete: audit.complete, categories: audit.categoryCount, subcategories: audit.subcategoryCount, products: list.length, images: audit.localImageCount, imageFailures: audit.imageFailures.length, errors: audit.errors.length }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
