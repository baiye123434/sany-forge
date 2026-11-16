/* 三个工作区共用同一本机接口。本机演示允许按联系电话查询订单，员工权限由服务端复核。 */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const staffWindow = /[?&]workspace=staff(?:&|$)/.test(location.search || '');
  /* 历史员工链接统一进入角色门户，防止旧工作区继续暴露混合岗位界面。 */
  if (staffWindow) { location.replace('/staff.html'); return; }
  const customerWindow = /[?&]workspace=customer(?:&|$)/.test(location.search || '');
  let projectServices = null;
  let followupServices = null;
  /* 客户窗口不读取工作人员会话；桌面端另用独立浏览器分区，双端演示不会串身份。 */
  function readSession() { return ''; }
  function writeSession(value) { try { if (value) sessionStorage.setItem('sany-staff', value); else sessionStorage.removeItem('sany-staff'); } catch { /* 存储受限时仍可使用本次页面内存会话，刷新后需重登。 */ } }
  let authEpoch = 0, staffEpoch = 0, routeCounter = 0, staffSessionCheck = null, releaseBootWait = null;
  const catalogNav = window.SanyCatalog;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let heroTimer = null;
  const chinaRegions = window.SANY_CHINA_REGIONS?.provinces || [];
  const state = {
    products: [], bootstrap: {}, user: null, staffToken: readSession(),
    route: '', category: '', subcategory: '', search: '', page: 1, modelOnly: false, group: '', sort: 'model',
    heroSlides: [], heroIndex: 0, heroPaused: !!reducedMotion?.matches, heroHover: false, heroFocus: false, heroWindowPaused: false,
    workOrderMode: '', workTab: 'overview', workFilter: '', workSearch: '', workPage: 1,
    orders: [], tickets: [], users: [], adminProducts: [], events: [], stats: {},
    currentOrder: null, currentTicket: null, currentToken: '', customer: false, dirty: false, phoneLookup: null
  };
  const modal = $('#modal'), main = $('#main');
  const swapView = (render, options = {}) => window.SanyMotion ? window.SanyMotion.swap(render, options) : render();
  const statusText = { submitted: '待受理', confirmed: '已确认报价', preparing: '备货中', shipped: '待收货', delivered: '已交付', cancelled: '已取消', assigned: '待工程师接单', in_progress: '维修处理中', pending_review: '待材料审核', awaiting_customer: '待客户验收', closed: '已完成' };
  const roleText = { admin: '管理员', service: '服务工程师', reviewer: '审核员' };
  const statusBadge = status => `<span class="pill ${['delivered', 'closed'].includes(status) ? 'green' : ['pending_review', 'submitted', 'awaiting_customer'].includes(status) ? 'orange' : 'blue'}">${esc(statusText[status] || status)}</span>`;
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const empty = (title, body, extra = '') => `<div class="empty"><strong>${esc(title)}</strong><p>${esc(body)}</p>${extra}</div>`;
  const button = (action, text, cls = '', attrs = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${text}</button>`;
  const field = (label, name, type = 'text', value = '', attrs = '') => `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const options = (values, chosen, placeholder = '') => `${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}${values.map(v => {
    const [value, title] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(value)}" ${String(value) === String(chosen) ? 'selected' : ''}>${esc(title)}</option>`;
  }).join('')}`;
  const select = (label, name, values, chosen = '', attrs = '') => `<label class="field"><span>${esc(label)}</span><select name="${name}" ${attrs}>${options(values, chosen)}</select></label>`;
  /*
   * 地址数据按民政部层级保存。直辖市与省直辖县级单位没有普通地级父节点，
   * 因此在界面层补一个仅用于联动的“城市”分组，最终地址不会写入该分组名称。
   */
  function addressCities(province) {
    if (!province) return [];
    const children = province[2] || [];
    const cities = children.filter(region => String(region[0]).endsWith('00'));
    const directAreas = children.filter(region => !String(region[0]).endsWith('00'));
    if (!cities.length) return [[province[0], province[1], directAreas]];
    return directAreas.length ? [...cities, [`direct:${province[0]}`, `${province[1]}直辖县级行政区划`, directAreas]] : cities;
  }
  function purchaseAddressFields() {
    const provinceOptions = options(chinaRegions.map(region => [region[0], region[1]]), '', '请选择省份');
    return `<fieldset class="field wide address-region"><legend>省 / 市 / 县（区）</legend><div class="address-region-grid">
      <label><span>省份</span><select id="addressProvince" name="addressProvince" required>${provinceOptions}</select></label>
      <label><span>城市</span><select id="addressCity" name="addressCity" required disabled><option value="">请先选择省份</option></select></label>
      <label><span>县（区）</span><select id="addressCounty" name="addressCounty" required disabled><option value="">请先选择城市</option></select></label>
    </div><small id="addressRegionHint">先选择省份，再依次选择城市和县（区）。</small></fieldset>
    <label class="field wide"><span>街道及详细地址</span><input name="addressDetail" autocomplete="street-address" minlength="2" maxlength="240" placeholder="街道、门牌号、工地名称与具体收货地点" required></label>`;
  }
  function setAddressOptions(selectElement, regions, placeholder, emptyText) {
    if (!selectElement) return;
    selectElement.innerHTML = regions.length ? options(regions.map(region => [region[0], region[1]]), '', placeholder) : `<option value="">${esc(emptyText)}</option>`;
    selectElement.value = '';
    selectElement.disabled = !regions.length;
    selectElement.required = !!regions.length;
  }
  function updatePurchaseCounties(provinceCode, cityCode) {
    const province = chinaRegions.find(region => region[0] === provinceCode);
    const city = addressCities(province).find(region => region[0] === cityCode);
    const counties = city?.[2] || [];
    setAddressOptions($('#addressCounty'), counties, '请选择县（区）', '该地区不设县级区划');
    const hint = $('#addressRegionHint');
    if (hint) hint.textContent = counties.length ? '省、市、县（区）采用随软件发布的 2025 年行政区划数据。' : '该地区不设县级区划或暂无下级资料，请在详细地址中补充。';
  }
  function updatePurchaseCities(provinceCode) {
    const province = chinaRegions.find(region => region[0] === provinceCode);
    const cities = addressCities(province);
    setAddressOptions($('#addressCity'), cities, '请选择城市', '暂无城市资料');
    setAddressOptions($('#addressCounty'), [], '请选择县（区）', '请先选择城市');
    const hint = $('#addressRegionHint');
    if (hint) hint.textContent = '请选择城市，再选择对应县（区）。';
  }
  function purchaseAddress(data) {
    const province = chinaRegions.find(region => region[0] === data.addressProvince);
    const city = addressCities(province).find(region => region[0] === data.addressCity);
    const counties = city?.[2] || [];
    const county = counties.find(region => region[0] === data.addressCounty);
    const detail = String(data.addressDetail || '').trim();
    if (!province) throw new Error('请选择省份。');
    if (!city) throw new Error('请选择城市。');
    if (counties.length && !county) throw new Error('请选择县（区）。');
    if (detail.length < 2) throw new Error('请填写街道及详细收货地址。');
    const cityName = city[1];
    return [province[1], cityName !== province[1] && !cityName.includes('直辖县级行政区划') ? cityName : '', county?.[1], detail].filter(Boolean).join('');
  }
  const textarea = (label, name, value = '', attrs = '') => `<label class="field wide"><span>${esc(label)}</span><textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`;
  const materials = (required = true, label = '证明材料') => `<label class="field wide"><span>${esc(label)}${required ? '（必填）' : '（选填）'}</span><input type="file" name="materials" accept=".docx,application/pdf,image/jpeg,image/png,image/webp" multiple ${required ? 'required' : ''}><small>支持 Word（.docx）、PDF、JPG / PNG / WebP；最多 4 份，每份不超过 4 MB。不支持旧版 .doc 或带宏文档，请另存为 .docx；附件不在软件内执行，下载后请先确认来源。</small></label>`;
  const formEnd = (label = '提交并保存', cls = 'primary') => `<div class="form-error" role="alert"></div><button class="btn ${cls}" type="submit">${esc(label)}</button>`;
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 4200); }
  async function api(path, method = 'GET', body, token = '') {
    const staffRequest = !!token && token === state.staffToken, epoch = staffEpoch;
    const response = await fetch(path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    /* 退出立即切断所有旧员工请求；即使服务端已返回成功，迟到结果也不能恢复敏感数据或弹窗。 */
    if (staffRequest && (epoch !== staffEpoch || token !== state.staffToken)) throw Object.assign(new Error('登录状态已变化，请重新登录。'), { name: 'AbortError' });
    if (!response.ok) {
      if (response.status === 401 && token && token === state.staffToken) {
        clearStaff();
      }
      throw Object.assign(new Error(result.error || '本地服务暂不可用，请重试。'), { status: response.status });
    }
    return result;
  }
  function receipts() { try { const saved = JSON.parse(localStorage.getItem('sany-receipts-v3') || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; } }
  function saveReceipt(receipt) { const list = receipts().filter(v => v.id !== receipt.id); localStorage.setItem('sany-receipts-v3', JSON.stringify([receipt, ...list].slice(0, 50))); }
  function identity() {
    $('#identity').innerHTML = state.user ? `<span class="pill">${esc(roleText[state.user.role])}</span><span>${esc(state.user.name)}</span><button data-action="logout" type="button">退出</button>` : `<span class="pill">${customerWindow ? '客户窗口' : '本地参赛版'}</span>`;
    if (document.documentElement) document.documentElement.dataset.workspace = staffWindow ? 'staff' : 'customer';
    const brand = document.querySelector('.brand'); if (brand) brand.href = staffWindow ? '#work' : '#catalog';
    document.querySelectorAll('[data-nav]').forEach(link => { link.hidden = staffWindow ? ['catalog', 'customer', 'projects'].includes(link.dataset.nav) : ['work', 'admin'].includes(link.dataset.nav); });
    window.SanyCustomers?.identity();
    if (customerWindow) document.querySelectorAll('[data-nav="work"],[data-nav="admin"]').forEach(link => { link.hidden = true; });
  }
  function clearStaff() {
    window.SanyAdminTools?.stop(); followupServices?.stop(); window.SanyCustomers?.stop();
    releaseBootWait?.(false);
    projectServices?.stop(); stopHero(); window.SanyHeroMotion?.cancel(); window.SanyFace?.stop();
    state.staffToken = ''; state.user = null; state.orders = []; state.tickets = []; state.users = []; state.events = []; state.adminProducts = []; state.stats = {};
    state.currentOrder = null; state.currentTicket = null; state.currentToken = ''; state.customer = false; state.dirty = false; state.challenge = null;
    state.workTab = 'overview'; state.workFilter = ''; state.workSearch = ''; state.workPage = 1;
    authEpoch++; staffEpoch++; routeCounter++; staffSessionCheck = null; writeSession('');
    window.SanyMotion?.cancel?.(); window.SanyAccess?.destroy();
    if (modal.open) modal.close();
    $('#modalContent').innerHTML = '';
    /* 用 replaceState 收回当前受保护历史项；同步呈现登录，不等待注销网络请求或旧页面转场。 */
    if (!customerWindow) {
      state.authMode = 'login'; state.route = 'work';
      window.history?.replaceState(null, '', `${location.pathname || '/'}${location.search || ''}#work`);
      main.inert = false; main.removeAttribute('aria-busy'); renderLogin();
      document.querySelectorAll('[data-nav]').forEach(link => { link.classList.toggle('active', link.dataset.nav === 'work'); if (link.dataset.nav === 'work') link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    }
    identity();
  }
  /* 独立窗口重新切入以及浏览器回到前台时，先向本机服务确认真实会话；不信任旧工作区 DOM。 */
  async function ensureStaffSession() {
    if (customerWindow) return false;
    const token = state.staffToken, epoch = staffEpoch;
    if (!token) { if (!main.querySelector('[data-form="login"], [data-form="register"]')) clearStaff(); return false; }
    if (staffSessionCheck?.token === token && staffSessionCheck.epoch === epoch) return staffSessionCheck.promise;
    const check = { token, epoch, promise: null };
    check.promise = (async () => {
      let timeout;
      try {
        /* 窗口切入不能被失联接口无限卡住；超时按未登录处理，迟到成功也由 staffEpoch 丢弃。 */
        const result = await Promise.race([api('/api/me', 'GET', undefined, token), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('登录状态校验超时。')), 3500); })]);
        if (epoch !== staffEpoch || token !== state.staffToken) return false;
        if (!result.user) throw new Error('无法确认当前工作人员身份。');
        state.user = result.user; identity(); return true;
      } catch (error) {
        if (epoch === staffEpoch && token === state.staffToken) { clearStaff(); if (error.status !== 401) toast('暂时无法确认登录状态，请重新登录。'); }
        return false;
      } finally { clearTimeout(timeout); if (staffSessionCheck === check) staffSessionCheck = null; }
    })();
    staffSessionCheck = check; return check.promise;
  }
  window.SanyStaffSession = { ensure: ensureStaffSession };
  function showModal(title, html) {
    stopHero(); projectServices?.stop();
    authEpoch++;
    window.Forge3D?.unmount(); window.SanyFace?.stop();
    $('#modalContent').innerHTML = `<header class="dialog-head"><h2 id="modalTitle">${esc(title)}</h2><button type="button" class="close" data-action="close" aria-label="关闭弹窗">×</button></header><div class="dialog-body">${html}</div>`;
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
    window.SanyMotion?.reveal($('#modalContent'));
  }
  function closeModal() { modal.close(); }
  modal.addEventListener('close', () => { authEpoch++; projectServices?.stop(); window.Forge3D?.unmount(); window.SanyFace?.stop(); if (state.dirty) { state.dirty = false; route(); } else scheduleHero(); });
  modal.addEventListener('cancel', () => { authEpoch++; window.SanyFace?.stop(); });
  async function filesFrom(form, name = 'materials') {
    const files = [...(form.elements[name]?.files || [])];
    if (files.length > 4) throw new Error('最多上传 4 份材料。');
    return Promise.all(files.map(async file => {
      if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} 超过 4 MB。`);
      if (!/\.(docx|pdf|jpe?g|png|webp)$/i.test(file.name)) throw new Error(`${file.name}：请使用 .docx、PDF 或 JPG / PNG / WebP。`);
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file); });
      return { name: file.name, data };
    }));
  }
  function downloadText(filename, text) { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  async function downloadFile(id, name, token = state.currentToken) {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error((await response.json()).error || '材料下载失败');
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const routeLink = (routeName, title) => `<a class="btn" href="#${routeName}">${title}</a>`;
  /* 参考区间必须来自工作人员维护，零值和空值都不能被当作真实售价。 */
  function referencePrice(p, detailed = false) {
    if (p.exhibitOnly) return '';
    const price = p.referencePrice || {}, valid = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const range = (min, max) => `${min.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${valid(max) && max !== min ? `–${max.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : ''}`;
    const buy = valid(price.buyMin), rent = valid(price.rentMonthlyMin);
    return `<div class="reference-price${detailed ? ' detailed' : ''}"><div><span>购买参考</span><strong>${buy ? `¥ ${range(price.buyMin, price.buyMax)} / 台` : '待询价'}</strong></div><div><span>月租参考</span><strong>${rent ? `¥ ${range(price.rentMonthlyMin, price.rentMonthlyMax)} / 台·月` : '待询价'}</strong></div>${detailed ? `<small>${buy || rent ? `来源：${esc(price.source)}${price.updatedAt ? ` · ${esc(time(price.updatedAt))}` : ''}。仅供预算参考，配置、税费、运费与最终报价需另行确认。` : '暂无已核验参考报价。后台可录入有来源的价格区间；不使用零元或虚构售价。'}</small>` : ''}</div>`;
  }
  /* 客户商品目录只使用真实可租购商品；旧教学占位记录仅用于给精确匹配商品补充 3D 步骤。 */
  function sellableProducts() { return state.products.filter(p => !p.exhibitOnly); }
  /* 轮播仅推荐可租购商品，避免旧教学占位记录再次被误认为商品。 */
  function featuredProducts() {
    const keys = ['excavator', 'crane', 'pump', 'drill', 'agv', 'welder', 'hydraulics', 'vision', 'solar'];
    const products = sellableProducts();
    const slides = keys.map(key => products.find(p => p.modelKey === key)).filter(Boolean);
    return slides.length ? slides : products.slice(0, 6);
  }
  function stopHero() { clearTimeout(heroTimer); heroTimer = null; }
  function scheduleHero() {
    stopHero();
    const hero = $('#heroCarousel');
    /* 目录重建时鼠标可能仍停在原位置，不会再次触发 pointerover，必须补查真实悬停和焦点。 */
    if (hero?.matches) state.heroHover = hero.matches(':hover');
    if (hero && document.activeElement !== undefined) state.heroFocus = hero.contains(document.activeElement);
    const paused = state.route !== 'catalog' || state.heroSlides.length < 2 || state.heroPaused || state.heroHover || state.heroFocus || state.heroWindowPaused || reducedMotion?.matches || document.hidden || modal.open || !hero;
    if (hero) hero.dataset.playback = paused ? 'paused' : 'playing';
    if (paused) return;
    heroTimer = setTimeout(() => { state.heroIndex = (state.heroIndex + 1) % state.heroSlides.length; renderHero(false, 1); scheduleHero(); }, 6000);
  }
  function renderHero(manual = false, direction = 1) {
    const slide = $('#heroSlide'), p = state.heroSlides[state.heroIndex]; if (!slide || !p) return;
    const groupName = catalogNav.groups.find(g => g.id === catalogNav.groupFor(p))?.label || '装备精选';
    slide.setAttribute('aria-live', manual || state.heroPaused ? 'polite' : 'off');
    const html = `<div class="hero-slide-top"><span class="pill ${catalogNav.hasModel(p) ? 'red' : ''}">${catalogNav.hasModel(p) ? '可体验 3D 作业' : '精选设备'}</span><span class="hero-slide-count">${String(state.heroIndex + 1).padStart(2, '0')} / ${String(state.heroSlides.length).padStart(2, '0')}</span></div><div class="hero-equipment-canvas"><img class="hero-slide-image" src="${esc(p.image)}" alt="${esc(p.code + ' · ' + p.name)}" decoding="async"></div><div class="hero-slide-info"><div><small>${esc(groupName)} · 官网产品</small><h2>${esc(p.code)}</h2><p>${esc(p.name)}</p></div>${button('hero-open', catalogNav.hasModel(p) ? '体验 3D ↗' : '查看设备 ↗', 'small', `data-id="${esc(p.id)}"`)}</div>`;
    if (window.SanyHeroMotion) window.SanyHeroMotion.show(slide, html, { direction, animate: slide.dataset.index !== undefined && Number(slide.dataset.index) !== state.heroIndex }); else slide.innerHTML = html;
    slide.dataset.index = String(state.heroIndex);
    /* 只更新指示器状态，不替换按钮，避免键盘切换时焦点丢失。 */
    document.querySelectorAll('[data-action="hero-dot"]').forEach(dot => {
      const active = Number(dot.dataset.index) === state.heroIndex;
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }
  function changeHero(index) {
    if (!state.heroSlides.length) return;
    const direction = index < state.heroIndex ? -1 : 1;
    state.heroIndex = (index + state.heroSlides.length) % state.heroSlides.length;
    renderHero(true, direction); scheduleHero();
  }
  function renderGroupChips() {
    const products = sellableProducts(), counts = catalogNav.groupCounts(products);
    $('#categoryChips').innerHTML = `<button type="button" class="category-chip" data-action="browse-group" data-group="" aria-pressed="${!state.group}"><span>全部装备</span><b>${products.length}</b></button>${catalogNav.groups.filter(g => counts[g.id] || g.id === state.group).map(g => `<button type="button" class="category-chip" data-action="browse-group" data-group="${esc(g.id)}" aria-pressed="${state.group === g.id}" title="${esc(g.description)}"><span>${esc(g.label)}</span><b>${counts[g.id] || 0}</b></button>`).join('')}`;
  }
  function groupProducts() { return sellableProducts().filter(p => !state.group || catalogNav.groupFor(p) === state.group); }
  function updateCategoryOptions() {
    const values = [...new Set(groupProducts().map(p => p.category))];
    if (!values.includes(state.category)) state.category = '';
    $('#categoryFilter').innerHTML = options(values, state.category, '全部官方类目');
    updateSubcategories();
  }
  function renderCatalog() {
    stopHero();
    state.heroHover = false; state.heroFocus = false;
    state.heroSlides = featuredProducts();
    window.SanyHeroMotion?.preload(state.heroSlides.map(product => product.image));
    state.heroIndex = Math.min(state.heroIndex, Math.max(0, state.heroSlides.length - 1));
    const official = sellableProducts();
    /* 将品牌展台、任务入口、目录筛选分成三层，客户可直接找到当前要做的事。 */
    main.innerHTML = `<section class="hero equipment-hero">
      <div class="hero-copy"><p class="eyebrow">SANY FORGE / 工程装备 · 服务终端</p><h1>为工程选装备。<br><em>让服务有着落。</em></h1><p class="lead">选型、租购、交付、维保。<br>从第一台设备，到每一次作业，全程清晰可查。</p><div class="hero-actions">${button('explore', '浏览装备目录 <span>↘</span>', 'primary')}${button('models', '探索 3D 设备', '')}</div><div class="hero-index"><span>01 — EQUIPMENT</span><span>选型 / 租购 / 服务</span></div></div>
      <section class="hero-art hero-carousel" id="heroCarousel" role="region" aria-roledescription="轮播" aria-label="装备精选轮播" aria-describedby="heroHint" tabindex="0"><div class="ark-stage-label"><span>01 / EQUIPMENT ARCHIVE</span><strong>装备档案 · 三一</strong></div>${state.heroSlides.length ? `<div class="hero-slide" id="heroSlide"></div><div class="hero-controls">${button('hero-prev', '←', 'small hero-arrow', `aria-label="上一款装备" ${state.heroSlides.length < 2 ? 'disabled' : ''}`)}<div class="hero-dots" id="heroDots">${state.heroSlides.map((p, i) => `<button type="button" class="hero-dot" data-action="hero-dot" data-index="${i}" aria-label="切换到 ${esc(p.code)}" aria-current="${i === state.heroIndex}"></button>`).join('')}</div>${button('hero-next', '→', 'small hero-arrow', `aria-label="下一款装备" ${state.heroSlides.length < 2 ? 'disabled' : ''}`)}</div><p class="hero-hint" id="heroHint">悬停或聚焦时暂停 · ← → 切换 · 空格锁定暂停</p>` : empty('暂无上架设备', '管理员上架设备后，这里将展示精选产品。')}<div class="art-label"><span>3D 装备优先推荐</span><strong>${official.length} 款官方目录产品</strong></div></section>
      </section><div class="service-shortcuts wrap" aria-label="常用服务"><a class="service-shortcut" href="#projects"><b>01</b><div><strong>为项目配齐设备</strong><span>提交工程需求 · 多设备选型</span></div><span aria-hidden="true">↗</span></a><a class="service-shortcut" href="#customer"><b>02</b><div><strong>查看我的订单</strong><span>登录查看 · 跟进交付</span></div><span aria-hidden="true">↗</span></a><a class="service-shortcut" href="#customer"><b>03</b><div><strong>报修与售后服务</strong><span>找到已交付订单 · 提交报修</span></div><span aria-hidden="true">↗</span></a></div><section class="wrap" id="catalogSection" aria-labelledby="catalogHeading">
      <div class="section-top"><div><p class="eyebrow">EQUIPMENT DIRECTORY / 设备目录</p><h2 id="catalogHeading">找到适合项目的装备</h2><p>${official.length} 款官方目录产品，按作业用途快速筛选。</p></div><a class="btn small" href="#about">目录来源 ↗</a></div>
      <div class="catalog-layout"><aside class="catalog-sidebar" aria-label="设备分类"><div class="filter-heading"><span>按用途筛选</span><span aria-hidden="true">⌕</span></div><div class="category-browser"><div class="category-browser-head"><h3>设备大类</h3><small>仅列可租购商品</small></div><div id="categoryChips" class="category-chips" role="group" aria-label="设备大类"></div></div><p class="sidebar-note">先选作业用途，再筛选具体型号。<br>匹配的 3D 教学能力已并入对应商品。</p></aside><div class="catalog-results">
      <div class="catalog-tools"><input id="catalogSearch" type="search" value="${esc(state.search)}" placeholder="搜索型号、设备名称或作业场景" aria-label="搜索设备"><select id="categoryFilter" aria-label="官方类目"></select><select id="subcategoryFilter" aria-label="产品子分类"></select><select id="catalogSort" aria-label="产品排序">${options([['model', '有 3D 模型优先'], ['catalog', '原目录顺序']], state.sort)}</select>${button('models', state.modelOnly ? '查看全部产品' : '仅看可租购 3D 商品', state.modelOnly ? 'dark' : '')}</div>
      <div class="catalog-meta"><span id="resultCount" aria-live="polite"></span>${button('reset-filters', '清除筛选', 'small link')}</div><div class="grid" id="productGrid"></div><div class="pagination" id="catalogPagination"></div><p class="catalog-source">官网资料整理于 2026.10.20 · 价格与供货由工作人员确认 · 3D 为结构与作业教学展示</p></div></div></section>`;
    renderGroupChips(); updateCategoryOptions(); renderProductGrid(); renderHero(); scheduleHero();
  }
  function updateSubcategories() {
    const values = [...new Set(groupProducts().filter(p => (!state.modelOnly || catalogNav.hasModel(p)) && (!state.category || p.category === state.category)).map(p => p.subcategory).filter(Boolean))];
    if (!values.includes(state.subcategory)) state.subcategory = '';
    $('#subcategoryFilter').innerHTML = options(values, state.subcategory, '全部系列 / 子类');
  }
  function filteredProducts() {
    const term = state.search.trim().toLowerCase();
    return catalogNav.sortProducts(groupProducts().filter(p => (!state.modelOnly || catalogNav.hasModel(p)) && (!state.category || p.category === state.category) && (!state.subcategory || p.subcategory === state.subcategory) && (!term || `${p.code} ${p.name} ${p.category} ${p.subcategory} ${p.summary} ${(p.applications || []).join(' ')}`.toLowerCase().includes(term))), state.sort);
  }
  function renderProductGrid() {
    const list = filteredProducts(), pages = Math.max(1, Math.ceil(list.length / 24));
    state.page = Math.min(state.page, pages);
    const groupLabel = catalogNav.groups.find(g => g.id === state.group)?.label || '全部装备';
    $('#resultCount').textContent = `${groupLabel} · 共 ${list.length} 项${state.modelOnly ? '可租购 3D 设备' : '可租购设备'} · ${state.sort === 'model' ? '有 3D 优先' : '原目录顺序'} · 第 ${state.page} / ${pages} 页`;
    $('#productGrid').innerHTML = list.slice((state.page - 1) * 24, state.page * 24).map(p => `<article class="product-card"><div class="product-image"><span class="pill ${p.modelKey ? 'red' : ''}">${p.modelKey ? '3D 教学模型' : '暂无 3D 模型'}</span><img loading="lazy" src="${esc(p.image)}" alt="${esc(p.code + ' ' + p.name)}"></div><div class="product-info"><span class="category">${esc(p.category)} / ${esc(p.subcategory || '产品')}</span><h3>${esc(p.code)}</h3><p>${esc(p.name)}</p><div class="mini-specs">${p.specs?.length ? p.specs.slice(0, 2).map(s => `<div><span>${esc(s.name)}</span><b>${esc(s.value)} ${esc(s.unit)}</b></div>`).join('') : '<div><span>官方结构化参数</span><b>暂未公开</b></div>'}</div>${referencePrice(p)}<div class="actions">${button('product', '查看设备', '', `data-id="${esc(p.id)}"`)}${button('buy', '询价租购 →', 'link', `data-id="${esc(p.id)}"`)}</div></div></article>`).join('') || empty('没有找到对应设备', '试试型号关键词，或清除类别筛选。', button('reset-filters', '重置筛选'));
    $('#catalogPagination').innerHTML = `${button('catalog-prev', '← 上一页', 'small', state.page === 1 ? 'disabled' : '')}<span>${state.page} / ${pages}</span>${button('catalog-next', '下一页 →', 'small', state.page === pages ? 'disabled' : '')}`;
  }
  function showProduct(id) {
    const p = state.products.find(p => p.id === id); if (!p) throw new Error('产品已调整，请刷新目录。');
    showModal(`${p.code} · ${p.name}`, `<div class="detail-hero"><img class="detail-image" src="${esc(p.image)}" alt="${esc(p.name)}"><div><span class="pill red">${esc(p.category)}</span><h3>${esc(p.code)}</h3><p>${esc(p.summary || p.name)}</p><div class="actions">${!p.exhibitOnly ? `${button('buy', '购买申请', 'primary', `data-id="${esc(p.id)}" data-mode="buy"`)}${button('buy', '租赁申请', '', `data-id="${esc(p.id)}" data-mode="rent"`)}` : '<span class="pill">教学单元，不作为商品下单</span>'}</div></div></div>
      ${referencePrice(p, true)}<h3 class="detail-heading">设备参数</h3>${p.specs?.length ? `<div class="spec-grid">${p.specs.map(s => `<div><small>${esc(s.name)}</small><strong>${esc(s.value)} ${esc(s.unit)}</strong></div>`).join('')}</div>` : `<div class="notice">${p.exhibitOnly ? '未核验的旧版性能数据已移除，保留设备结构和作业演示。' : '官网暂未提供结构化规格，请查看官方资料或在租购申请中填写选型需求。'}</div>`}
      ${p.sourceUrl ? `<a class="btn small" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">查看对应官网资料 ↗</a>` : ''}${p.brochureUrl ? ` <a class="btn small" href="${esc(p.brochureUrl)}" target="_blank" rel="noopener">官方产品画册 ↗</a>` : ''}
      <h3 class="detail-heading">3D 结构与作业展示</h3>${p.modelKey ? `<div class="notice">程序化教学模型，用于理解结构和动作，不是官方 CAD，也不表示实时设备状态或安全操作指导。</div><div class="model-host hots-off" id="modelHost"></div><div class="model-toolbar">${button('model-play', '播放作业', 'small', 'aria-pressed="false"')}${button('model-rotate', '自动旋转', 'small', 'aria-pressed="false"')}${button('model-labels', '部件标识', 'small', 'aria-pressed="false"')}${button('model-explode', '结构拆解', 'small', 'aria-pressed="false"')}${button('model-reset', '重置视角', 'small')}</div><small>鼠标拖动旋转，滚轮缩放。触屏可拖动查看。</small><div class="steps">${(p.steps || state.products.find(v => v.exhibitOnly && v.modelKey === p.modelKey)?.steps || []).map((step, i) => `<div><b>0${i + 1}</b>${esc(step)}</div>`).join('')}</div>` : empty('暂无 3D 模型', '该产品的官方资料已收录；待补充与机型相符的模型后再开放展示，不使用其他设备的模型代替。')}
      <div class="notice">质保范围、服务周期及租赁可供性需以正式合同和实际设备情况确认。本作品不虚构质保承诺，不接入官方采购或付款系统。</div>`);
    if (p.modelKey) requestAnimationFrame(() => { const host = $('#modelHost'); if (host) { state.viewer = window.Forge3D.mount(host, p.modelKey); state.viewer?.setAnimate(false); state.viewer?.setAutoRotate(false); } });
  }
  async function showPurchase(id, mode = 'buy') {
    if (window.SanyCustomers && !await window.SanyCustomers.requireLogin({type:'purchase',id,mode})) return;
    const p = state.products.find(p => p.id === id); if (!p || p.exhibitOnly) throw new Error('请从官方商品目录选择设备。');
    showModal('填写租购申请', `<div class="record"><img src="${esc(p.image)}" alt=""><div class="record-main"><h3>${esc(p.code)} · ${esc(p.name)}</h3><p>提交后由本机服务工作台受理、录入报价与交付材料。</p></div></div>${referencePrice(p, true)}<div class="notice">这是参赛作品中的本地业务申请，不向三一官方发送订单，不在线付款。收货地址、联系电话将仅保存在本机数据库。</div>
      <form data-form="purchase" data-product="${esc(p.id)}"><div class="form-grid">${select('用户类型', 'customerType', [['personal', '个人'], ['enterprise', '企业']], 'personal')}${select('办理方式', 'mode', [['buy', '购买设备'], ['rent', '租赁设备']], mode)}${field('设备数量', 'quantity', 'number', 1, 'min="1" max="999" required')}${field('收货联系人', 'contact', 'text', '', 'maxlength="40" autocomplete="name" required')}${field('联系电话', 'phone', 'tel', '', 'maxlength="30" autocomplete="tel" required')}
      ${purchaseAddressFields()}${field('计划交付日期', 'date', 'date', '', `min="${today()}" required`)}<div id="modeOptions">${purchaseModeFields(mode)}</div>${textarea('项目需求 / 使用场景（选填）', 'notes', '', 'maxlength="2000" placeholder="例如作业工况、需要的配置、运输条件等"')}${materials(false, '工程资料 / 需求文件')}</div><p class="privacy-note">提交后可用联系电话查询订单。本机演示未接入短信验证，请勿填写真实敏感资料。</p><label class="check"><input type="checkbox" name="remember">在此浏览器保存快捷入口（选填；不保存也能用联系电话查询）</label><br><label class="check"><input type="checkbox" required>我已核对收货信息，并同意本机保存本次申请用于后续交付与维保。</label>${formEnd('提交租购申请')}</form>`);
  }
  function purchaseModeFields(mode) { return mode === 'rent' ? field('预计租期（月）', 'duration', 'number', 1, 'min="1" max="120" required') : select('购买意向', 'plan', ['全款购买', '分期方案咨询', '待商议'], '待商议'); }
  function receiptView(result, remembered) {
    state.lastReceipt = { id: result.order.id, number: result.order.number || result.order.id, phone: result.order.phone, code: result.accessCode, accessKey: result.accessKey || '', product: `${result.order.product.code} ${result.order.product.name}`, at: result.order.createdAt };
    /* 订单已落库后，本地浏览器存储失败也必须显示凭证，不能把成功误报成下单失败。 */
    let saveFailed = false;
    if (remembered) { try { saveReceipt(state.lastReceipt); } catch { remembered = false; saveFailed = true; } }
    state.guestTokens ||= {}; state.guestTokens[result.order.id] = result.token;
    showModal('申请已提交 · 查看我的订单', `<div class="notice">已进入本机服务工作台的“待受理”队列。之后进入“订单与售后”即可查看账号下的订单与售后工单。${remembered ? '本浏览器已保存快捷入口。' : ''}${saveFailed ? '<br>浏览器拒绝写入本地存储，但订单提交已成功，仍可按电话查询，请勿重复下单。' : ''}</div><div class="receipt-summary"><span class="pill orange">待受理</span><h3>${esc(state.lastReceipt.product)}</h3><small>订单编号</small><strong>${esc(state.lastReceipt.number)}</strong><p>查询联系电话：${esc(result.order.phone)}</p></div><div class="actions">${button('guest-order', '查看订单进度', 'primary', `data-id="${esc(result.order.id)}"`)}${button('receipt-chat', '联系本机客服', '', `data-id="${esc(result.order.id)}"`)}${button('download-receipt', '下载申请回执')}</div><p class="privacy-note">仅限本机演示，未接入短信验证。知道联系电话即可查询对应订单，请勿使用真实敏感资料。</p><details class="legacy-receipt"><summary>兼容旧版：备用查询方式（无需填写）</summary><p>旧版链接和凭证仍可使用，但不再是查询订单的必填项。</p>${result.accessKey ? button('copy-order-link', '复制备用查询链接', 'small') : ''}<p>查询凭证：<code>${esc(result.accessCode)}</code></p></details>`);
  }
  function receiptLink(key) { return `${location.origin || 'http://127.0.0.1:8790'}/?workspace=customer#receipt=${encodeURIComponent(key)}`; }
  async function copyOrderLink() {
    const link = receiptLink(state.lastReceipt.accessKey);
    try { await navigator.clipboard.writeText(link); toast('本机查询链接已复制，请勿公开分享'); }
    catch { showModal('复制本机查询链接', `${textarea('仅供本人查询，请勿公开', 'queryLink', link, 'readonly')}<p class="privacy-note">剪贴板不可用，请手动选择并复制。持有链接可访问本单资料。</p>`); }
  }
  function renderCustomer() { void window.SanyCustomers.orders(main); }
  function renderPhoneOrders(orders) {
    const target = $('#phoneOrderResults'); if (!target) return;
    target.innerHTML = orders.length ? `<h3>找到 ${orders.length} 笔订单</h3><p class="muted">按提交时间由近到远排列，点击对应订单继续。</p>${orders.map(order => `<div class="phone-order-card"><img src="${esc(order.product.image)}" alt=""><div><h4>${esc(order.product.code)} · ${esc(order.product.name)}</h4><small>${esc(order.number || order.id)}</small><p>${order.mode === 'rent' ? '租赁' : '购买'} · ${esc(order.quantity)} 台 · ${esc(time(order.createdAt))}</p>${statusBadge(order.status)}</div>${button('phone-order', '查看订单 / 联系客服', 'small', `data-id="${esc(order.id)}"`)}</div>`).join('')}` : empty('没有找到对应订单', '请核对完整联系电话，并确认订单是在这台电脑提交的。不同电脑的数据暂不互通。');
  }
  function history(events) { return `<ol class="timeline">${[...events].reverse().map(e => `<li><header><span>${esc(statusText[e.to] || e.to)}</span><time>${esc(time(e.at))}</time></header><small>${esc(e.actor)} · ${esc(roleText[e.role] || '客户')}</small><p>${esc(e.note)}</p><div>${(e.files || []).map(f => `<button class="file-link" type="button" data-action="file" data-id="${esc(f.id)}" data-name="${esc(f.name)}">↧ ${esc(f.name)} (${Math.ceil(f.size / 1024)} KB)</button>`).join('')}</div></li>`).join('')}</ol>`; }
  function progress(record, type) {
    const stages = type === 'order' ? ['submitted', 'confirmed', 'preparing', 'shipped', 'delivered'] : ['submitted', 'assigned', 'in_progress', 'pending_review', 'awaiting_customer', 'closed'];
    return `<div class="progress">${stages.map((s, i) => `<div class="${i <= stages.indexOf(record.status) ? 'done' : ''}"><i></i>${esc(statusText[s])}</div>`).join('')}</div>`;
  }
  async function openOrder(id, token = state.staffToken, customer = false) {
    const requestEpoch = ++authEpoch;
    const { order, tickets } = await api(`/api/orders/${id}`, 'GET', undefined, token);
    if (requestEpoch !== authEpoch) return;
    state.currentOrder = order; state.currentTicket = null; state.currentToken = token; state.customer = customer;
    showModal('订单详情与交付记录', `<div class="record"><img src="${esc(order.product.image)}" alt=""><div class="record-main"><h3>${esc(order.product.code)} · ${esc(order.product.name)}</h3><small>${esc(order.number || order.id)}</small></div>${statusBadge(order.status)}</div>${customer || ['admin', 'service'].includes(state.user?.role) ? `<div class="order-chat-entry"><span>需要确认配置、资料或交付安排？</span>${button('order-chat', customer ? '联系本机客服' : '打开客户会话', 'small primary')}</div>` : ''}${progress(order, 'order')}
      <dl class="facts"><div><dt>用户类型</dt><dd>${order.customerType === 'enterprise' ? '企业' : order.customerType === 'personal' ? '个人' : '未填写（历史记录）'}</dd></div><div><dt>租购方式 / 数量</dt><dd>${order.mode === 'rent' ? `租赁 ${order.duration} 个月` : `购买 · ${esc(order.plan)}`} / ${order.quantity} 台</dd></div><div><dt>计划交付</dt><dd>${esc(order.date)}</dd></div><div><dt>收货联系人 / 电话</dt><dd>${esc(order.contact)} / ${esc(order.phone)}</dd></div><div><dt>收货地址</dt><dd>${esc(order.address)}</dd></div><div><dt>已确认报价</dt><dd>${order.quote ? `¥ ${Number(order.quote.amount).toLocaleString('zh-CN')}（工作人员录入，未在线收款）` : '待工作人员联系确认'}</dd></div><div><dt>运输信息</dt><dd>${order.delivery ? `${esc(order.delivery.carrier)} / ${esc(order.delivery.tracking)}` : '尚未发运'}</dd></div></dl>${order.notes ? `<div class="notice">需求备注：${esc(order.notes)}</div>` : ''}
      ${orderAction(order, customer)}<h3 class="detail-heading">交付过程与证明材料</h3>${history(order.history)}
      <div class="section-top"><h3>关联维保工单</h3>${customer && order.status === 'delivered' ? button('new-ticket', '提交维保报修', 'primary small') : ''}</div>${tickets.length ? `<div class="records">${tickets.map(t => `<div class="record"><div class="record-main"><h3>${esc(t.issue.slice(0, 60))}</h3><small>${esc(t.number||t.id)}</small></div>${statusBadge(t.status)}${button('ticket', '查看', 'small', `data-id="${esc(t.id)}"`)}</div>`).join('')}</div>` : empty('暂无维保记录', order.status === 'delivered' ? '设备出现问题时，客户可在这里提交现场情况。' : '设备确认收货后开放维保报修。')}`);
  }
  function orderAction(order, customer) {
    if (customer) return order.status === 'shipped' ? `<div class="action-box"><h3>下一步：核对设备并确认收货</h3><p>请核对型号、数量、外观与交付材料。上传签收单或现场收货照片。</p><form data-form="order-confirm">${textarea('收货说明', 'note', '', 'maxlength="2000" required')}${materials()}<label class="check"><input name="confirmed" type="checkbox" required>我已核对并收到设备。</label>${formEnd('确认收货')}</form></div>` : '';
    if (!['admin', 'service'].includes(state.user?.role)) return '';
    const transitions = { submitted: [['confirmed', '确认需求与报价'], ['cancelled', '取消申请']], confirmed: [['preparing', '开始备货'], ['cancelled', '取消订单']], preparing: [['shipped', '登记发运']] };
    if (!transitions[order.status]) return '';
    return `<div class="action-box"><h3>下一步：${transitions[order.status][0][1]}</h3><p>每一步均需说明和材料，保存后进入订单时间线，不可跳过处理步骤。</p><form data-form="order-transition">${select('本次操作', 'status', transitions[order.status])}<div id="orderExtra">${orderExtra(transitions[order.status][0][0])}</div>${textarea('处理说明', 'note', '', 'maxlength="2000" required')}${materials()}${formEnd('提交本次处理')}</form></div>`;
  }
  function orderExtra(status) { return status === 'confirmed' ? field('双方确认的订单总金额（元）', 'amount', 'number', '', 'min="0.01" step="0.01" required') : status === 'shipped' ? `<div class="form-grid">${field('承运单位 / 自有运输', 'carrier', 'text', '', 'maxlength="100" required')}${field('运单号 / 运输登记号', 'tracking', 'text', '', 'maxlength="100" required')}</div>` : ''; }
  function newTicket() {
    const order = state.currentOrder;
    showModal('提交维保报修', `<div class="notice">${esc(order.product.code)} · ${esc(order.product.name)}<br>已关联订单 ${esc(order.id)}。请说明故障现象，避免在危险情况下自行拆机。</div><form data-form="ticket-create"><div class="form-grid">${field('现场联系人', 'contact', 'text', order.contact, 'maxlength="40" required')}${field('联系电话', 'phone', 'tel', order.phone, 'maxlength="30" required')}${textarea('设备所在位置', 'address', order.address, 'maxlength="300" required')}${select('紧急程度', 'urgency', [['normal', '一般报修'], ['urgent', '紧急 / 影响作业']])}</div>${textarea('故障现象与服务需求', 'issue', '', 'maxlength="2000" placeholder="何时出现、哪些部件异常、是否影响安全、已采取哪些措施" required')}${materials(false)}${formEnd('提交报修工单')}</form>`);
  }
  async function openTicket(id, token = state.currentToken, customer = state.customer) {
    const requestEpoch = ++authEpoch;
    const { ticket } = await api(`/api/tickets/${id}`, 'GET', undefined, token);
    if (!customer && !state.users.length) state.users = (await api('/api/staff', 'GET', undefined, state.staffToken)).users;
    if (requestEpoch !== authEpoch) return;
    state.currentTicket = ticket; state.currentToken = token; state.customer = customer;
    showModal('维保工单 · 材料与审核', `<div class="section-top"><div><p class="eyebrow">${ticket.urgency === 'urgent' ? '紧急维保' : 'AFTER-SALES SERVICE'}</p><h3>${esc(ticket.product.code)} · ${esc(ticket.product.name)}</h3><small>${esc(ticket.number||ticket.id)}</small></div>${statusBadge(ticket.status)}</div>${customer || ['admin','service'].includes(state.user?.role) ? `<div class="order-chat-entry"><span>沟通故障、维修安排与验收结果（沿用关联订单会话）</span>${button('ticket-chat', customer ? '联系客服' : '打开客户会话', 'small primary')}</div>` : ''}${progress(ticket, 'ticket')}<div class="notice">${esc(ticket.issue)}</div><dl class="facts"><div><dt>现场联系</dt><dd>${esc(ticket.contact)} / ${esc(ticket.phone)}</dd></div><div><dt>设备位置</dt><dd>${esc(ticket.address)}</dd></div><div><dt>服务负责人</dt><dd>${esc(ticket.assigneeName || '等待指派')}</dd></div><div><dt>关联订单</dt><dd>${esc(ticket.orderId)}</dd></div></dl>${ticketAction(ticket, customer)}<h3 class="detail-heading">全过程记录</h3>${history(ticket.history)}`);
  }
  function ticketAction(ticket, customer) {
    if (customer) return ticket.status === 'awaiting_customer' ? `<div class="action-box"><h3>下一步：验收维修结果</h3><p>工程师已处理，材料审核已通过。请核对现场结果并上传验收照片或确认单。</p><form data-form="ticket-accept">${select('验收结论', 'decision', [['accept', '验收通过，关闭工单'], ['return', '仍有问题，退回处理']])}${textarea('验收说明', 'note', '', 'maxlength="2000" required')}${materials()}${formEnd('提交验收结果')}</form></div>` : '';
    const user = state.user;
    if (ticket.status === 'submitted' && ['admin', 'service'].includes(user.role)) {
      const engineers = state.users.filter(u => u.role === 'service' && u.active).map(u => [u.id, `${u.name}（${u.username}）`]);
      return engineers.length ? `<div class="action-box"><h3>下一步：确认问题并指派工程师</h3><form data-form="ticket-transition"><input type="hidden" name="status" value="assigned">${select('负责工程师', 'assignee', engineers)}${textarea('受理与派单说明', 'note', '', 'maxlength="2000" required')}${materials()}${formEnd('保存派单')}</form></div>` : `<div class="notice warn">尚无在用服务工程师账号。请管理员在“员工与权限”中新增服务工程师，然后指派工单。</div>`;
    }
    if (['assigned', 'in_progress'].includes(ticket.status) && ticket.assignee === user.id) {
      const next = ticket.status === 'assigned' ? 'in_progress' : 'pending_review';
      return `<div class="action-box"><h3>下一步：${next === 'in_progress' ? '接单并登记现场检查' : '提交维修结果，申请独立审核'}</h3><p>${next === 'in_progress' ? '上传现场检查照片、诊断记录或接单确认材料。' : '上传维修前后照片、维修报告或检测记录。审核人员不能是本工单的处理人。'}</p><form data-form="ticket-transition"><input type="hidden" name="status" value="${next}">${textarea('处理说明与维修结论', 'note', '', 'maxlength="2000" required')}${materials()}${formEnd(next === 'in_progress' ? '开始维修处理' : '提交材料审核')}</form></div>`;
    }
    if (ticket.status === 'pending_review' && ['admin', 'reviewer'].includes(user.role)) {
      if ([ticket.assignee, ticket.completedBy].includes(user.id)) return '<div class="notice warn">你参与了此工单的维修处理，请由另一位管理员或审核员独立审核。</div>';
      return `<div class="action-box"><h3>下一步：独立审核维修材料</h3><p>核对故障描述、维修结果、现场材料和责任人员。通过后仍需客户验收，不能直接关闭工单。</p><form data-form="ticket-review">${select('审核结论', 'decision', [['approve', '材料充分，通过审核'], ['reject', '材料或处理不足，退回补充']])}${textarea('审核意见（退回请说明补充要求）', 'note', '', 'maxlength="2000" required')}${materials()}${formEnd('提交审核意见')}</form></div>`;
    }
    return `<div class="notice">${ticket.status === 'closed' ? '工单已完成审核与客户验收，历史记录保留。' : ticket.status === 'awaiting_customer' ? '审核已通过，等待订单客户从“订单与售后”入口验收。' : ticket.status === 'pending_review' ? '等待管理员或审核员进行独立审核。' : '仅被指派的服务工程师可以提交维修处理进度。'}</div>`;
  }
  function renderLogin() {
    const mode = state.authMode === 'register' ? 'register' : 'login';
    const isRegister = mode === 'register';
    main.innerHTML = `<section class="login-layout"><div class="login-copy"><p class="eyebrow">SERVICE &amp; MANAGEMENT</p><h1>让每一次服务，<br>都有据可查。</h1><p>售中订单、售后维修和后台审核，在一个清晰的工作区内协同。注册入口就在这里。</p><ol><li>自由注册：选好岗位，即建即用</li><li>账号密码直接登录，无需摄像头</li><li>按岗位展示待办与操作权限</li></ol><div class="notice">本作品为教学级演示，注册端对所有人开放，可自由创建管理员、服务工程师或审核员账号；密码仅作展示用途，请勿使用真实常用密码。</div></div><div class="login-panel"><span class="pill red">${isRegister ? '自由注册 · 即建即用' : '工作人员入口'}</span><div class="auth-tabs" role="tablist"><button type="button" class="${isRegister ? '' : 'active'}" data-action="auth-mode" data-mode="login" role="tab" aria-selected="${!isRegister}">账号登录</button><button type="button" class="${isRegister ? 'active' : ''}" data-action="auth-mode" data-mode="register" role="tab" aria-selected="${isRegister}">自由注册</button></div><h2>${isRegister ? '创建演示账号' : '登录服务工作区'}</h2><p>${isRegister ? '填写信息即可注册并直接进入工作区，不需要摄像头与人脸录入。' : '未录入人脸的账号输入账号密码后直接进入工作区。'}</p><form data-form="${mode}">${field('工作账号', 'username', 'text', '', 'pattern="[A-Za-z0-9_.-]{3,40}" minlength="3" maxlength="40" autocomplete="username" placeholder="3–40 位字母、数字、下划线或点" required')}${isRegister ? field('姓名', 'name', 'text', '', 'maxlength="40" autocomplete="name" required') : ''}${isRegister ? select('岗位权限', 'role', [['admin', '管理员 · 产品、员工、订单与审核'], ['service', '服务工程师 · 订单与维修'], ['reviewer', '审核员 · 审核与审计']]) : ''}${field('密码', 'password', 'password', '', `minlength="10" maxlength="200" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="至少 10 位（演示用途随意设）" required`)}${isRegister ? field('再次输入密码', 'repeat', 'password', '', 'minlength="10" maxlength="200" autocomplete="new-password" required') : ''}${formEnd(isRegister ? '注册并进入工作区' : '登录')}</form><p class="privacy-note">本机演示注册不设验证码与审批，仅用于参赛展示，请勿录入真实个人敏感信息。原人脸核验功能保留：已录入人脸的账号登录时仍需本人摄像头比对。</p></div></section>`;
    if (window.SanyAccess) window.SanyAccess.mount({ host: main, mode, formHTML: $('.login-panel').innerHTML });
  }
  function showFace(challenge) {
    state.challenge = challenge;
    showModal(challenge.enroll ? '首次录入 · 本人身份核验' : '登录 · 本人人脸核验', `<div class="split"><div><div class="camera-frame"><video id="faceVideo" autoplay muted playsinline aria-label="本人摄像头预览"></video></div><p id="faceStatus" class="camera-status">准备好后，开启摄像头。</p><progress id="faceProgress" max="1" value="0" aria-label="人脸采集进度"></progress></div><div><p class="eyebrow">IDENTITY CHECK</p><h3>${esc(challenge.user.name)} · ${esc(roleText[challenge.user.role])}</h3><p>正对镜头，然后按照随机提示向左、向右转头。请保持光线均匀，画面中只出现本人。</p><div class="notice">${challenge.enroll ? '这是首次录入，会把 128 维人脸特征加密保存在本机。后续登录必须与此账号特征匹配。' : '本次采集将与当前账号的已录入特征比对，不会重新覆盖已有人脸。'}</div><label class="check"><input id="faceConsent" type="checkbox">我同意使用本机摄像头${challenge.enroll ? '并加密保存本人特征' : '进行本次身份核验'}，了解其为参赛作品的教学级验证。</label><br><div class="actions">${button('start-face', '开启摄像头并验证', 'primary')}${button('close', '取消登录')}</div><div class="form-error" id="faceError" role="alert"></div><p class="privacy-note">没有摄像头、未授权或识别失败时不会模拟通过。挑战约 2 分钟有效，超时请重新输入账号密码。取消或关闭窗口会立即停止摄像头。</p></div></div>`);
  }
  async function startFace(buttonElement) {
    if (!$('#faceConsent').checked) throw new Error('请先阅读并同意本机摄像头与特征使用说明。');
    buttonElement.disabled = true;
    const challenge = state.challenge, errorBox = $('#faceError'), epoch = authEpoch, routeAtStart = routeCounter;
    errorBox.textContent = '';
    try {
      const proof = await window.SanyFace.authenticate(challenge, { video: $('#faceVideo'), consent: true, onStatus: (message, detail) => {
        if ($('#faceStatus')) $('#faceStatus').textContent = message;
        if ($('#faceProgress')) $('#faceProgress').value = detail.progress;
      } });
      if (epoch !== authEpoch || !modal.open) return;
      const result = await api('/api/face/verify', 'POST', { challenge: challenge.challenge, ...proof });
      /* 用户取消后，迟到的验证响应不得恢复登录；顺便撤销刚签发的服务端会话。 */
      if (epoch !== authEpoch || !modal.open) { try { await api('/api/logout', 'POST', {}, result.token); } catch {} return; }
      /* 等原生 close 事件清理摄像头之后再展示欢迎幕，避免把关闭弹窗误作取消本次成功登录。 */
      if (window.SanyAccess && modal.open) await new Promise(resolve => { modal.addEventListener('close', resolve, { once: true }); closeModal(); });
      const enterWorkspace = await (window.SanyAccess?.complete(result.user) ?? true);
      if (!enterWorkspace || routeAtStart !== routeCounter) { try { await api('/api/logout', 'POST', {}, result.token); } catch {} return; }
      state.staffToken = result.token; state.user = result.user; writeSession(result.token);
      closeModal(); identity(); toast('账号与人脸核验通过'); await route();
    } catch (error) {
      if (error.name !== 'AbortError' && errorBox.isConnected) errorBox.textContent = `${error.message} 请关闭此窗口，重新验证密码后再试。`;
    }
  }
  async function loadWorkspace(isCurrent = () => true) {
    const token = state.staffToken, routeName = state.route, user = state.user;
    if (!token || !user || customerWindow) return;
    const [stats, orders, tickets, staff] = await Promise.all([api('/api/stats', 'GET', undefined, token), user.capabilities?.orders === false ? Promise.resolve({orders:[]}) : api('/api/orders', 'GET', undefined, token), user.capabilities?.tickets === false ? Promise.resolve({tickets:[]}) : api('/api/tickets', 'GET', undefined, token), api('/api/staff', 'GET', undefined, token)]);
    const update = { stats, orders: orders.orders, tickets: tickets.tickets, users: staff.users };
    if (routeName === 'admin' && user.role === 'admin') {
      const [products, users] = await Promise.all([api('/api/admin/products', 'GET', undefined, token), api('/api/admin/users', 'GET', undefined, token)]);
      update.adminProducts = products.products; update.users = users.users;
    }
    if (['admin', 'reviewer'].includes(user.role)) update.events = (await api('/api/admin/audit', 'GET', undefined, token)).events;
    /* 页面在请求期间可能已切换；旧工作区的响应不得污染新视图或恢复已清除的员工数据。 */
    if (isCurrent() && token === state.staffToken) Object.assign(state, update);
  }
  function workspaceTabs() {
    const canChat = ['admin','service'].includes(state.user.role) && state.user.capabilities?.chat !== false;
    if (state.route !== 'admin') return [['overview','业务看板'], ...(canChat ? [['customer-chat','在线客服咨询']] : []), ['projects','售前需求工单'], ['orders','售中订单跟进'], ['tickets','售后维保工单']].filter(([key])=>state.user.capabilities?.[key]!==false);
    return [...(state.user.role==='admin' ? [['products','产品与上下架'],['users','员工权限'],['customers','客户账号管理'],['backups','数据备份与恢复'],['permissions','角色权限配置'],['monitor','运行监控'],['content','内容管理']] : []), ['audit','操作审计']];
  }
  function adminSummary(tab) {
    return ({backups:'创建本机数据快照，校验备份并恢复业务数据。',permissions:'配置岗位功能权限，限定工作人员可操作的业务范围。',monitor:'查看服务运行状态、数据规模和数据库检查结果。',content:'维护首页公告、服务联系方式和服务时间。',products:'维护设备资料与展示信息，管理产品上架和下架。', users:'管理员工账号、岗位权限与启停状态，按需重置身份验证。', customers:'查看客户注册信息，管理客户账号的启用与停用。', audit:'查看关键操作记录，追溯操作人员、时间与业务对象。'})[tab] || '';
  }
  function workspaceSummary(tab) {
    return ({overview:'查看业务待办与未读消息，快速进入需要处理的事项。', 'customer-chat':'接收客户在线咨询，查看聊天记录并及时回复。', projects:'受理客户项目需求，审核资料并确认设备方案。', orders:'跟进购买与租赁订单，处理报价、备货、发运和交付。', tickets:'处理客户报修，跟进派单、维修、审核与客户验收。'})[tab] || '';
  }
  function renderWorkspace() {
    window.SanyAdminTools?.stop(); followupServices?.stop(); window.SanyCustomers?.stop();
    if (!state.user || !state.staffToken || customerWindow) { if (!customerWindow) renderLogin(); return; }
    projectServices?.stop();
    if (state.route === 'admin' && state.user.role === 'service') {
      main.innerHTML = `<section class="wrap">${empty('此账号是服务工程师', '请前往服务工作台处理订单和指派给你的维修任务。产品维护和材料审核由管理员或审核员负责。', routeLink('work', '进入服务工作台'))}</section>`;
      return;
    }
    const tabs = workspaceTabs();
    if (!tabs.some(([value]) => value === state.workTab)) state.workTab = tabs[0][0];
    main.innerHTML = `<div class="workspace" data-workspace="${state.route === 'admin' ? 'admin' : 'service'}"><aside class="sidebar"><p class="eyebrow">${state.route === 'admin' ? 'MANAGEMENT' : 'SERVICE DESK'}</p>${tabs.map(([value, title]) => `<button type="button" data-action="work-tab" data-tab="${value}" class="${state.workTab === value ? 'active' : ''}">${title}</button>`).join('')}<p class="side-note">当前岗位<br><strong>${esc(roleText[state.user.role])}</strong><br><br>交付与维修需证明材料；项目审核保留处理意见，保密项目不收附件。权限由本机服务端检查。</p></aside><section class="work-content"><div class="section-top"><div><p class="eyebrow">${state.route === 'admin' ? 'CONTROL & REVIEW' : 'WORKSPACE'}</p><h1 class="section-title">${tabs.find(([value]) => value === state.workTab)[1]}</h1><p class="workspace-summary">${esc(state.route === 'admin' ? adminSummary(state.workTab) : workspaceSummary(state.workTab))}</p></div><div class="actions">${button('refresh-work', '刷新数据', 'small')}</div></div><div id="workBody"></div></section></div>`;
    renderWorkBody();
  }
  function renderWorkBody() {
    const body = $('#workBody'), tab = state.workTab;
    if (!body) return;
    body.onclick=null; body.onsubmit=null;
    if (['backups','permissions','monitor','content'].includes(tab)) { void window.SanyAdminTools.render(body,tab,state.staffToken); return; }
    if (tab === 'customer-chat' || tab === 'customers') { window.SanyCustomers?.staff(body, tab, state.staffToken); return; }
    if (tab === 'workspace-design' || tab === 'customer-design') { body.innerHTML = window.SanyWorkspaceDesign(); return; }
    if (tab === 'followups') { void followupServices?.render(body); return; }
    if (tab === 'followup-design') { followupServices?.design(body); return; }
    if (tab === 'projects' || tab === 'chat') {
      const task = tab === 'projects' ? projectServices?.renderStaffProjects(body) : projectServices?.renderStaffChat(body);
      task?.catch(error => { if (body.isConnected) body.innerHTML = empty('暂时无法载入', error.message); });
      return;
    }
    if (tab === 'overview') {
      const stats = state.stats;
      body.innerHTML = `<div class="stats">${[['待受理订单', stats.pendingOrders, '联系客户，确认需求'], ['在途维保工单', stats.openTickets, '跟进服务与验收'], ['待材料审核', stats.pendingReview, '由独立人员审核'], ['累计订单', stats.orders, '全部来自实际提交']].map(([name, value, note]) => `<div class="stat"><span>${name}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div><div class="panel"><h3>建议先处理</h3><div class="records">${state.orders.filter(o => o.status === 'submitted').slice(0, 3).map(o => `<div class="record"><div class="record-main"><h3>${esc(o.product.code)} · 待确认租购需求</h3><p>${esc(o.contact)} / ${esc(o.phone)} · 计划 ${esc(o.date)}</p></div>${button('staff-order', '处理订单', 'small', `data-id="${esc(o.id)}"`)}</div>`).join('')}${state.tickets.filter(t => t.status !== 'closed' && (t.assignee === state.user.id || ['submitted', 'pending_review'].includes(t.status))).slice(0, 4).map(t => `<div class="record"><div class="record-main"><h3>${esc(t.product.code)} · ${esc(t.issue.slice(0, 40))}</h3><p>${esc(t.assigneeName || '等待派单')}</p></div>${statusBadge(t.status)}${button('staff-ticket', '处理工单', 'small', `data-id="${esc(t.id)}"`)}</div>`).join('') || (stats.pendingOrders ? '' : empty('当前没有需要优先处理的待办', '这里不会生成模拟订单。客户实际提交后，待办会出现在此处。'))}</div></div><div class="split"><div class="panel"><h3>售中交付</h3><p class="muted">申请 → 报价确认 → 备货 → 发运 → 客户签收</p>${button('work-tab', '打开订单列表 →', 'link', 'data-tab="orders"')}</div><div class="panel"><h3>售后闭环</h3><p class="muted">报修 → 派单 → 维修 → 材料审核 → 客户验收</p>${button('work-tab', '打开维保列表 →', 'link', 'data-tab="tickets"')}</div></div>`;
      return;
    }
    if (['orders', 'tickets', 'review'].includes(tab)) {
      const orderMode = tab === 'orders';
      const statuses = orderMode ? ['submitted', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] : tab === 'review' ? ['pending_review', 'awaiting_customer', 'closed'] : ['submitted', 'assigned', 'in_progress', 'pending_review', 'awaiting_customer', 'closed'];
      body.innerHTML = `${orderMode ? `<div class="tabs" aria-label="订单类型">${[['','全部订单'],['buy','购买订单'],['rent','租赁订单']].map(([mode,label])=>`<button type="button" data-action="work-order-mode" data-mode="${mode}" class="${state.workOrderMode===mode?'active':''}" aria-pressed="${state.workOrderMode===mode}">${label}（${state.orders.filter(o=>!mode||o.mode===mode).length}）</button>`).join('')}</div>` : ''}<div class="tabs"><button type="button" data-action="work-filter" data-filter="" class="${!state.workFilter ? 'active' : ''}">${tab === 'review' ? '待审核' : '全部'}</button>${statuses.filter(s => tab !== 'review' || s !== 'pending_review').map(s => `<button type="button" data-action="work-filter" data-filter="${s}" class="${state.workFilter === s ? 'active' : ''}">${statusText[s]}</button>`).join('')}</div><input class="search-input" id="workSearch" type="search" value="${esc(state.workSearch)}" placeholder="搜索订单号、设备、联系人或故障描述" aria-label="搜索记录"><br><br><div id="workList"></div>`;
      renderRecordList(); return;
    }
    if (tab === 'products') {
      body.innerHTML = `<div class="notice">官网目录 ${state.adminProducts.filter(p => !p.custom && !p.exhibitOnly).length} 款 + 原版 9 类教学模型。修改只影响本地在售列表，原始官方快照保留；已有订单保留当时的产品信息。</div><div class="section-top"><input class="search-input" id="adminProductSearch" type="search" value="${esc(state.workSearch)}" placeholder="搜索型号、名称、类别" aria-label="搜索后台产品">${button('new-product', '新增产品', 'primary')}</div><div id="adminProductList"></div>`;
      renderAdminProducts(); return;
    }
    if (tab === 'users') {
      body.innerHTML = `<div class="notice">服务工程师负责维修；审核员或管理员独立核验材料。本机演示允许未录入人脸账号使用密码登录；已录入人脸账号仍须本人核验。不提供通用密码。</div><div class="section-top"><h3>${state.users.length} 个工作人员账号</h3>${button('new-user', '新增员工账号', 'primary')}</div><div class="table-wrap"><table><thead><tr><th>工作人员</th><th>岗位</th><th>身份验证</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.users.map(u => `<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.username)}</small></td><td>${esc(roleText[u.role])}</td><td>${u.faceEnrolled ? '<span class="pill green">已录入人脸</span>' : '<span class="pill orange">未录入 · 密码登录</span>'}</td><td>${u.active ? '在用' : '已停用'}</td><td>${u.id !== state.user.id ? button('edit-user', '管理账号', 'small', `data-id="${esc(u.id)}"`) : '<small>当前账号</small>'}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    if (tab === 'audit') body.innerHTML = `<div class="notice">最近 300 条操作记录。材料及状态历史另保存在相应订单、工单中；审计记录不提供编辑或删除入口。</div><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>行为</th><th>对象</th></tr></thead><tbody>${state.events.map(e => `<tr><td>${esc(time(e.at))}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td><small>${esc(e.target)}</small></td></tr>`).join('') || '<tr><td colspan="4">暂无操作记录</td></tr>'}</tbody></table></div>`;
  }
  function renderRecordList() {
    const orderMode = state.workTab === 'orders', term = state.workSearch.toLowerCase();
    let list = orderMode ? state.orders : state.tickets;
    const status = state.workFilter || (state.workTab === 'review' ? 'pending_review' : '');
    list = list.filter(r => (!orderMode || !state.workOrderMode || r.mode===state.workOrderMode) && (!status || r.status === status) && `${r.number || ''} ${r.id} ${r.product.code} ${r.product.name} ${r.contact} ${r.phone} ${r.issue || ''}`.toLowerCase().includes(term)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pages = Math.max(1, Math.ceil(list.length / 20)); state.workPage = Math.min(state.workPage, pages);
    $('#workList').innerHTML = !list.length ? empty('当前条件下没有记录', '可以切换状态或搜索关键词。业务数据由实际申请产生，不填充模拟记录。') : `<div class="table-wrap"><table><thead><tr><th>${orderMode ? '设备 / 订单' : '设备 / 故障'}</th>${orderMode ? '<th>订单类型</th>' : ''}<th>联系人</th><th>状态</th><th>${orderMode ? '计划交付' : '工程师'}</th><th>操作</th></tr></thead><tbody>${list.slice((state.workPage - 1) * 20, state.workPage * 20).map(r => `<tr><td><strong>${esc(r.product.code)} · ${esc(orderMode ? r.product.name : r.issue.slice(0, 28))}</strong><small>${esc(r.number || r.id)}</small></td>${orderMode ? `<td><span class="pill ${r.mode==='rent'?'blue':'green'}">${r.mode==='rent'?'租赁订单':r.mode==='buy'?'购买订单':'未填写'}</span>${r.mode==='rent'?`<small>租期 ${esc(r.duration)} 个月</small>`:''}</td>` : ''}<td>${esc(r.contact)}<small>${esc(r.phone)}</small></td><td>${statusBadge(r.status)}${r.urgency === 'urgent' ? '<small>紧急工单</small>' : ''}</td><td>${esc(orderMode ? r.date : r.assigneeName || '待指派')}</td><td>${button(orderMode ? 'staff-order' : 'staff-ticket', '查看 / 处理', 'small', `data-id="${esc(r.id)}"`)}</td></tr>`).join('')}</tbody></table></div><div class="pagination">${button('work-prev', '上一页', 'small', state.workPage === 1 ? 'disabled' : '')}<span>${state.workPage} / ${pages} · ${list.length} 条</span>${button('work-next', '下一页', 'small', state.workPage === pages ? 'disabled' : '')}</div>`;
  }
  function renderAdminProducts() {
    const term = state.workSearch.toLowerCase(), list = state.adminProducts.filter(p => `${p.code} ${p.name} ${p.category}`.toLowerCase().includes(term));
    const pages = Math.max(1, Math.ceil(list.length / 20)); state.workPage = Math.min(state.workPage, pages);
    $('#adminProductList').innerHTML = `<div class="table-wrap"><table><thead><tr><th>产品型号与名称</th><th>类别</th><th>来源 / 3D</th><th>展示状态</th><th>操作</th></tr></thead><tbody>${list.slice((state.workPage - 1) * 20, state.workPage * 20).map(p => `<tr><td><strong>${esc(p.code)}</strong><small>${esc(p.name)}</small></td><td>${esc(p.category)}</td><td>${p.exhibitOnly ? '原版教学' : p.custom ? '手动添加' : '官网收录'}<small>${p.modelKey ? '已有教学模型' : '暂无 3D 模型'}</small></td><td><span class="pill ${p.published && !p.deleted ? 'green' : ''}">${p.deleted ? '已移除' : p.published ? '已上架' : '已下架'}</span></td><td>${button('edit-product', p.deleted ? '编辑 / 恢复' : '编辑', 'small', `data-id="${esc(p.id)}"`)} ${!p.deleted ? button('remove-product', '移除', 'small danger', `data-id="${esc(p.id)}"`) : ''}</td></tr>`).join('') || '<tr><td colspan="5">没有匹配产品。</td></tr>'}</tbody></table></div><div class="pagination">${button('work-prev', '上一页', 'small', state.workPage === 1 ? 'disabled' : '')}<span>${state.workPage} / ${pages} · ${list.length} 项</span>${button('work-next', '下一页', 'small', state.workPage === pages ? 'disabled' : '')}</div>`;
  }
  function editProduct(id = '') {
    const p = state.adminProducts.find(p => p.id === id) || {};
    showModal(id ? '编辑产品与展示状态' : '新增在售产品', `<div class="notice">${p.sourceUrl ? '保留官方原始目录快照与来源链接；你修改的内容仅在本机覆盖。' : '新增内容请按真实资料填写，不编造参数、价格和供货承诺。'}未提供相符的模型时显示“暂无 3D 模型”。</div><form data-form="product-edit" data-id="${esc(id)}"><div class="form-grid">${field('型号 / 编号', 'code', 'text', p.code, 'maxlength="100" required')}${field('产品名称', 'name', 'text', p.name, 'maxlength="150" required')}${field('产品主类', 'category', 'text', p.category, 'maxlength="80" required')}${field('系列 / 子类（选填）', 'subcategory', 'text', p.subcategory, 'maxlength="80"')}${textarea('产品简介', 'summary', p.summary, 'maxlength="2000"')}${textarea('规格参数（每行：参数名 | 数值 | 单位）', 'specText', (p.specs || []).map(s => `${s.name} | ${s.value} | ${s.unit || ''}`).join('\n'), 'placeholder="整机重量 | 1910 | kg"')}${priceFields(p)}<label class="field wide"><span>${id ? '替换产品照片（选填）' : '产品照片（选填）'}</span><input type="file" name="productImage" accept="image/jpeg,image/png,image/webp"><small>最多 1 张，4 MB 以内。未上传时保留原图，新产品使用品牌标识。</small></label>${select('展示状态', 'published', [['true', '上架：客户可见'], ['false', '下架：客户不可见']], String(p.published !== false))}</div>${formEnd('保存产品')}</form>`);
  }
  function priceFields(p) {
    if (p.exhibitOnly) return '<p class="notice wide">教学模型不设置参考售价，也不作为商品接单。</p>';
    const price = p.referencePrice || {}, amountAttrs = 'min="0.01" max="1000000000000" step="0.01"';
    return `<fieldset class="price-fields wide"><legend>参考价格（选填）</legend><p>人民币，按每台计价；只填有来源的区间。上下限填相同金额表示单价，全部清空则恢复“待询价”。不代替双方最终报价。</p><div class="form-grid">${field('购买参考下限（元 / 台）', 'buyMin', 'number', price.buyMin ?? '', amountAttrs)}${field('购买参考上限（元 / 台）', 'buyMax', 'number', price.buyMax ?? '', amountAttrs)}${field('月租参考下限（元 / 台·月）', 'rentMonthlyMin', 'number', price.rentMonthlyMin ?? '', amountAttrs)}${field('月租参考上限（元 / 台·月）', 'rentMonthlyMax', 'number', price.rentMonthlyMax ?? '', amountAttrs)}${textarea('价格来源与适用配置（有价格时必填）', 'priceSource', price.source || '', 'maxlength="300" placeholder="例如报价单编号、提供方、适用配置及是否含税运"')}</div></fieldset>`;
  }
  function removeProduct(id) {
    const p = state.adminProducts.find(p => p.id === id);
    showModal('确认从产品列表移除', `<p>将从售中目录移除 <strong>${esc(p.code)} · ${esc(p.name)}</strong>。</p><div class="notice">此操作为可恢复的软移除，不删除官方快照、历史订单或维修记录。之后可在后台列表“编辑 / 恢复”。</div><form data-form="product-remove" data-id="${esc(id)}"><label class="check"><input type="checkbox" required>确认从在售列表移除此产品</label>${formEnd('确认移除', 'danger')}</form>`);
  }
  function newUser() {
    showModal('新增工作人员账号', `<div class="notice">请分别创建服务工程师与审核员，不要多人共用账号。未录入人脸账号可用密码登录；已录入人脸账号仍须本人核验。</div><form data-form="user-create"><div class="form-grid">${field('工作账号', 'username', 'text', '', 'pattern="[A-Za-z0-9_.-]{3,40}" minlength="3" maxlength="40" autocomplete="off" required')}${field('员工姓名', 'name', 'text', '', 'maxlength="40" required')}${select('岗位权限', 'role', [['service', '服务工程师 · 订单与维修'], ['reviewer', '审核员 · 审核与审计'], ['admin', '管理员 · 产品、员工、订单与审核']])}${field('初始密码', 'password', 'password', '', 'minlength="10" maxlength="200" autocomplete="new-password" required')}</div>${formEnd('创建账号')}</form>`);
  }
  function editUser(id) {
    const u = state.users.find(u => u.id === id);
    showModal('管理员工账号', `<h3>${esc(u.name)} · ${esc(u.username)}</h3><div class="notice warn">修改后该账号的已有登录会话将失效。重置人脸后，该演示账号将改为密码登录；请先确认身份及操作目的。</div><form data-form="user-edit" data-id="${esc(id)}">${select('账号状态', 'active', [['true', '在用'], ['false', '停用']], String(u.active))}${field('重设密码（不修改请留空）', 'password', 'password', '', 'minlength="10" maxlength="200" autocomplete="new-password"')}<label class="check"><input type="checkbox" name="resetFace">重置本机人脸特征，改为密码登录</label>${formEnd('保存账号变更')}</form>`);
  }
  function renderAbout() {
    main.innerHTML = `<section class="wrap"><p class="eyebrow">ABOUT THIS PROJECT</p><h1 class="section-title">不止展示装备，更让服务闭环。</h1><p class="subtitle">三一匠造 · 工程装备租购与售后服务平台 / 独立参赛作品</p><div class="split"><div class="panel"><h2>售中，清楚地交付</h2><p>客户免注册选型，完整填写联系人、电话和收货地址。工作人员确认实际报价、上传备货和发运材料，客户凭查询凭证签收。</p><h2>售后，有证据地完成</h2><p>每次状态变更必须附说明和材料。工程师维修后由另一名有权限的人员审核，退回要求留痕，最后由客户验收。</p></div><div class="panel"><h2>真实资料的边界</h2><p>2026 年 10 月 20 日收录三一集团中文主站公开导航下的 24 主类、119 子类、561 款产品；每类数量与公开目录对账。范围不含独立子公司站、海外站及登录后的配件商城。</p><p>其中 24 款未公开结构化规格，明确留空。原版 9 类程序化教学模型单独保留，不作为 9 款已核验可售商品；仅型号精确匹配时关联到官网产品。</p><a class="btn small" href="https://www.sanygroup.com/product-solution/" target="_blank" rel="noopener">三一官方产品目录 ↗</a></div></div><div class="panel"><h2>本机运行与身份说明</h2><p>网页和 Windows 软件使用同一套界面与本机 Java/MySQL 服务。工作人员可在登录页自由注册演示岗位，无预置密码。未录入人脸账号可用密码登录；已录入人脸账号仍需本人摄像头特征比对。</p><p>人脸特征加密保存在本机，不保存原始视频。随机转头是教学级辅助验证，不是认证级活体检测。没有摄像头或验证失败时不会模拟放行。上线到公网前仍需专业身份安全、数据保护、备份与通知系统建设。</p><p>不连接三一官方销售、支付或售后系统；此处申请仅在作品本机流转。Logo、产品图片与参数源自官方公开资料，保留来源说明，不暗示官方授权或背书。质保期限、价格、库存等未核实信息不会被伪造。</p></div></section>`;
  }
  /* 数据可以提前请求，但目录的大量节点与布局计算必须让出飞镖绘制阶段。
   * 完成绘制后在开屏定格时提交；跳过、隐藏、减少动态由开屏 close 事件释放，异常最多等待三秒。 */
  function waitForBootAssembly(isCurrent) {
    const screen = document.querySelector('.boot-screen[open]');
    if (!screen || screen.dataset.assemblyComplete === 'true' || document.hidden || reducedMotion?.matches) return Promise.resolve(isCurrent());
    return new Promise(resolve => {
      let timer, settled = false;
      const finish = (allowed = true) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        document.removeEventListener('sany:boot-assembled', completed);
        document.removeEventListener('sany:boot-close', completed);
        if (releaseBootWait === finish) releaseBootWait = null;
        resolve(allowed && isCurrent());
      };
      const completed = () => finish(true);
      releaseBootWait = finish;
      document.addEventListener('sany:boot-assembled', completed);
      document.addEventListener('sany:boot-close', completed);
      timer = setTimeout(completed, 3000);
    });
  }
  async function route() {
    window.SanyCustomers?.stop();
    window.SanyAdminTools?.stop(); followupServices?.stop(); window.SanyCustomers?.stop();
    releaseBootWait?.(false);
    authEpoch++; stopHero(); window.SanyHeroMotion?.cancel(); projectServices?.stop();
    window.SanyAccess?.destroy({ keepLayout: true });
    const counter = ++routeCounter;
    let next = location.hash.replace('#', '') || (staffWindow ? 'work' : 'catalog');
    if (['work', 'admin'].includes(next)) { location.replace('/staff.html'); return; }
    if (staffWindow && !['work', 'admin', 'about', 'workspace-design'].includes(next)) {
      next = 'work'; window.history.replaceState(null, '', `${location.pathname}${location.search}#work`);
    }
    const changed = next !== state.route; state.route = next;
    const motion = window.SanyMotion?.begin(main);
    const current = () => counter === routeCounter;
    const present = async render => {
      if (!current()) return;
      if (!await waitForBootAssembly(current) || !current()) return;
      const update = () => { if (current()) { window.SanyAccess?.destroy(); render(); if (changed) window.scrollTo({ top: 0, behavior: 'instant' }); } };
      if (motion) await motion.commit(update); else update();
    };
    if (changed) { state.workFilter = ''; state.workSearch = ''; state.workPage = 1; state.phoneLookup = null; }
    document.querySelectorAll('[data-nav]').forEach(a => { a.classList.toggle('active', a.dataset.nav === next); if (a.dataset.nav === next) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    identity();
    try {
      if (next.startsWith('receipt=')) {
        /* 凭证只经 POST 提交本机，立刻移出地址栏与当前历史项，不作为可公开工单号使用。 */
        const key = decodeURIComponent(next.slice(8));
        window.history?.replaceState(null, '', `${location.pathname || '/'}${location.search || ''}#customer`);
        state.route = 'customer'; await present(renderCustomer);
        if (current()) await projectServices?.handleAccessLink(key);
      }
      else if (next === 'catalog' || next === 'projects') {
        const products = (await api('/api/products')).products;
        await present(() => { state.products = products; if (next === 'catalog') renderCatalog(); else projectServices?.renderProjectPage(); });
      }
      else if (next === 'customer') await present(renderCustomer);
      else if (next === 'account' && !staffWindow) await present(() => window.SanyCustomers.account(main));
      else if (next === 'workspace-design') await present(() => { main.innerHTML = window.SanyWorkspaceDesign(); });
      else if (next === 'about') await present(renderAbout);
      else if (['work', 'admin'].includes(next)) {
        if (customerWindow) await present(() => { main.innerHTML = `<section class="wrap">${empty('这是客户窗口', '工作人员请在员工工作台登录。')}</section>`; });
        else if (!state.user) { const bootstrap = await api('/api/bootstrap'); await present(() => { state.bootstrap = bootstrap; renderLogin(); }); }
        else { await loadWorkspace(current); await present(renderWorkspace); }
      } else { location.hash = 'catalog'; }
    } catch (error) { await present(() => { main.innerHTML = `<section class="wrap">${empty('暂时无法载入', error.message, button('retry', '重新载入'))}</section>`; }); }
  }

  /* 使用事件委托处理动态工作区；表单提交期间禁用按钮，服务端 revision 防止多窗口重复覆盖。 */
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
    const { action, id } = target.dataset;
    try {
      if (action === 'close') closeModal();
      else if (action.startsWith('followup-')) await followupServices?.click(action, target);
      else if (action === 'retry') await route();
      else if (action === 'explore') $('#catalogSection').scrollIntoView({ behavior: 'smooth' });
      else if (action === 'models') await swapView(() => { state.modelOnly = !state.modelOnly; state.group = ''; state.category = ''; state.subcategory = ''; state.search = ''; state.page = 1; renderCatalog(); $('.catalog-tools [data-action="models"]').focus?.({ preventScroll: true }); $('#catalogSection').scrollIntoView({ behavior: 'instant' }); });
      else if (action === 'reset-filters') await swapView(() => { Object.assign(state, { modelOnly: false, group: '', sort: 'model', category: '', subcategory: '', search: '', page: 1 }); renderCatalog(); $('#catalogSearch').focus?.({ preventScroll: true }); });
      else if (action === 'browse-group') {
        const group = target.dataset.group;
        if (group && !catalogNav.groups.some(g => g.id === group)) return;
        Object.assign(state, { group, modelOnly: false, category: '', subcategory: '', search: '', page: 1 });
        /* 保留分类按钮本身，避免连续筛选时焦点丢失或轮播被重建。 */
        document.querySelectorAll('[data-action="browse-group"]').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.group === group)));
        $('#catalogSearch').value = '';
        const modelsButton = $('.catalog-tools [data-action="models"]');
        modelsButton.textContent = '仅看可租购 3D 商品'; modelsButton.classList.remove('dark');
        updateCategoryOptions(); renderProductGrid();
      }
      else if (action === 'hero-prev') changeHero(state.heroIndex - 1);
      else if (action === 'hero-next') changeHero(state.heroIndex + 1);
      else if (action === 'hero-dot') changeHero(Number(target.dataset.index));
      else if (action === 'hero-open') showProduct(id);
      else if (action === 'catalog-prev' || action === 'catalog-next') await swapView(() => { state.page += action.endsWith('next') ? 1 : -1; renderProductGrid(); $('#catalogSection').scrollIntoView({ behavior: 'instant' }); }, { focus: '#catalogSearch' });
      else if (action === 'product') showProduct(id);
      else if (action === 'buy') await showPurchase(id, target.dataset.mode || 'buy');
      else if (action.startsWith('model-')) {
        const on = target.getAttribute('aria-pressed') !== 'true';
        if (action === 'model-play') state.viewer?.setAnimate(on);
        else if (action === 'model-rotate') state.viewer?.setAutoRotate(on);
        else if (action === 'model-labels') { $('#modelHost').classList.toggle('hots-off', !on); $('#modelHost').classList.toggle('show-labels', on); }
        else if (action === 'model-explode') state.viewer?.setExplode(on);
        else if (action === 'model-reset') state.viewer?.reset();
        if (action !== 'model-reset') target.setAttribute('aria-pressed', String(on));
      }
      else if (action === 'download-receipt') { const r = state.lastReceipt; downloadText(`三一匠造-订单申请回执-${r.number || r.id}.txt`, `三一匠造 · 参赛作品本地订单\n设备：${r.product}\n订单号：${r.number || r.id}\n联系电话：${r.phone}\n\n查询方法：打开本机软件的“订单与售后”，输入以上联系电话，再选择对应订单。\n本机演示未接入短信验证，知道电话即可查询对应订单，请勿公开此回执。\n此申请未发送三一官方，不是付款或交易凭证。\n`); }
      else if (action === 'copy-order-link') await copyOrderLink();
      else if (action === 'receipt-chat') await projectServices?.openChat('order', id, state.guestTokens[id], true);
      else if (action === 'order-chat') await projectServices?.openChat('order', state.currentOrder.id, state.currentToken, state.customer);
      else if (action === 'guest-order') await openOrder(id, state.guestTokens[id], true);
      else if (action === 'phone-order') {
        const lookup = state.phoneLookup;
        if (!lookup?.orders.some(order => order.id === id)) throw new Error('请先使用联系电话查询订单。');
        target.disabled = true;
        const requestEpoch = ++authEpoch;
        try {
          const result = await api('/api/guest/phone-order', 'POST', { phone: lookup.phone, orderId: id });
          if (requestEpoch !== authEpoch || state.phoneLookup !== lookup) return;
          await openOrder(result.order.id, result.token, true);
        } finally { target.disabled = false; }
      }
      else if (action === 'saved-order') { const r = receipts().find(r => r.id === id); const result = r.accessKey ? await api('/api/guest/access', 'POST', { key: r.accessKey }) : await api('/api/guest/lookup', 'POST', { orderId: id, phone: r.phone, code: r.code }); if (!result.order || result.order.id !== id) throw new Error('保存的凭证与订单不匹配，请重新查询。'); await openOrder(id, result.token, true); }
      else if (action === 'forget-order') {
        const r = receipts().find(r => r.id === id);
        showModal('移除此浏览器的查询凭证', `<p>仅移除本机浏览器保存的 ${esc(r.product)} 查询凭证，不删除业务订单。请先确保你已另行保存。</p><form data-form="forget-receipt" data-id="${esc(id)}"><label class="check"><input type="checkbox" required>已另存查询凭证，确认移除本浏览器副本</label>${formEnd('移除本地凭证', 'danger')}</form>`);
      }
      else if (action === 'file') await downloadFile(id, target.dataset.name);
      else if (action === 'staff-unread-chat') await projectServices?.openChat(event.target.closest('[data-action]').dataset.kind || 'order', id, state.staffToken, false);
      else if (action === 'staff-order') await openOrder(id, state.staffToken, false);
      else if (action === 'ticket') await openTicket(id);
      else if (action === 'staff-ticket') await openTicket(id, state.staffToken, false);
      else if (action === 'ticket-chat' && state.currentTicket) await projectServices?.openChat('order', state.currentTicket.orderId, state.currentToken, state.customer);
      else if (action === 'new-ticket') newTicket();
      else if (action === 'start-face') await startFace(target);
      else if (action === 'logout') {
        const token = state.staffToken;
        clearStaff();
        try { if (token) await api('/api/logout', 'POST', {}, token); } catch { toast('本机服务未响应，已清除当前页面登录状态'); }
      }
      else if (action === 'admin-design') showModal('后台管理功能设计说明', '<p>管理后台集中维护产品、员工权限、客户账号与操作审计。业务受理、订单交付及维保审核在服务工作台处理。</p><p>产品资料来自本机产品记录，员工权限来自user记录，客户来自customer记录，操作审计来自audit日志；页面读取已保存数据，不生成模拟指标。沿用服务器角色校验，菜单显示不替代权限验证。移除菜单不删除原业务数据。</p><p>管理员可维护产品、员工和客户状态；客户不能进入后台。停用或重置身份验证沿用现有会话失效规则。操作失败显示服务端错误；审计按原日志展示，不提供客户端篡改入口。</p><footer>原型来源方：SDMC-IT</footer>');
      else if (action === 'work-tab') {
        if (state.workTab === target.dataset.tab) return;
        projectServices?.stop(); window.SanyAdminTools?.stop(); followupServices?.stop(); window.SanyCustomers?.stop();
        await swapView(() => {
          state.workTab = target.dataset.tab; state.workOrderMode=''; state.workFilter = ''; state.workSearch = ''; state.workPage = 1;
          document.querySelectorAll('.sidebar [data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===state.workTab));
          const title=document.querySelector('.work-content > .section-top .section-title');
          if(title)title.textContent=workspaceTabs().find(([key])=>key===state.workTab)?.[1]||'';
          const summary=document.querySelector('.work-content > .section-top .workspace-summary');
          if(summary)summary.textContent=state.route === 'admin' ? adminSummary(state.workTab) : workspaceSummary(state.workTab);
          renderWorkBody();
          /* 焦点与内容在同一个提交回调更新，取消的旧动画不能抢回用户在新页面的焦点。 */
          const selected = $(`.sidebar [data-tab="${state.workTab}"]`);
          selected?.focus?.({ preventScroll: true });
          selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        });
      }
      else if (action === 'work-order-mode') { state.workOrderMode=target.dataset.mode;state.workPage=1;renderWorkBody(); }
      else if (action === 'work-filter') await swapView(() => { state.workFilter = target.dataset.filter; state.workPage = 1; renderWorkBody(); }, { focus: `.tabs [data-filter="${target.dataset.filter}"]` });
      else if (action === 'refresh-work') {
        target.disabled = true;
        const counter = routeCounter, motion = window.SanyMotion?.begin(main);
        const current = () => counter === routeCounter && (!motion || motion.current());
        try {
          await loadWorkspace(current);
          if (current()) { const update = () => { renderWorkspace(); toast('已更新工作区'); }; if (motion) await motion.commit(update); else update(); }
        } catch (error) { if (current()) { if (motion) await motion.commit(() => {}); throw error; } }
      }
      else if (action === 'work-prev' || action === 'work-next') await swapView(() => { state.workPage += action.endsWith('next') ? 1 : -1; if (state.workTab === 'products') renderAdminProducts(); else renderRecordList(); }, { focus: `[data-action="${action}"]` });
      else if (action === 'new-product' || action === 'edit-product') editProduct(id);
      else if (action === 'remove-product') removeProduct(id);
      else if (action === 'new-user') newUser();
      else if (action === 'auth-mode') await swapView(() => { state.authMode = target.dataset.mode === 'register' ? 'register' : 'login'; renderLogin(); });
      else if (action === 'edit-user') editUser(id);
    } catch (error) { if (error.name !== 'AbortError') toast(error.message); target.disabled = false; }
  });
  document.addEventListener('input', event => {
    const el = event.target;
    /* 改号码立即清空上一位客户的结果，并使旧请求失效，防止迟到响应串单。 */
    if (el.id === 'orderLookupPhone') { authEpoch++; state.phoneLookup = null; if ($('#phoneOrderResults')) $('#phoneOrderResults').innerHTML = ''; }
    if (el.id === 'catalogSearch') { state.search = el.value; state.page = 1; renderProductGrid(); }
    if (el.id === 'workSearch') { state.workSearch = el.value; state.workPage = 1; renderRecordList(); }
    if (el.id === 'adminProductSearch') { state.workSearch = el.value; state.workPage = 1; renderAdminProducts(); }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'categoryFilter') { state.category = el.value; state.subcategory = ''; state.page = 1; state.modelOnly = false; $('.catalog-tools [data-action="models"]').textContent = '仅看可租购 3D 商品'; $('.catalog-tools [data-action="models"]').classList.remove('dark'); updateSubcategories(); renderProductGrid(); }
    if (el.id === 'subcategoryFilter') { state.subcategory = el.value; state.page = 1; renderProductGrid(); }
    if (el.id === 'catalogSort') { state.sort = el.value === 'catalog' ? 'catalog' : 'model'; state.page = 1; renderProductGrid(); }
    if (el.name === 'addressProvince') { if ($('#addressProvince')) $('#addressProvince').value = el.value; updatePurchaseCities(el.value); }
    if (el.name === 'addressCity') { if ($('#addressCity')) $('#addressCity').value = el.value; updatePurchaseCounties($('#addressProvince')?.value || '', el.value); }
    if (el.name === 'mode' && $('#modeOptions')) $('#modeOptions').innerHTML = purchaseModeFields(el.value);
    if (el.name === 'status' && $('#orderExtra')) $('#orderExtra').innerHTML = orderExtra(el.value);
  });
  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-form]'); if (!form) return;
    event.preventDefault();
    if (form.dataset.busy === 'true' || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form)), kind = form.dataset.form, submit = form.querySelector('button[type="submit"]'), errorBox = $('.form-error', form);
    form.dataset.busy = 'true'; if (submit) submit.disabled = true; if (errorBox) errorBox.textContent = '';
    try {
      if (kind.startsWith('followup-')) await followupServices?.submit(kind, form, data);
      else if (kind === 'purchase') {
        const { addressProvince, addressCity, addressCounty, addressDetail, ...orderData } = data;
        const address = purchaseAddress({ addressProvince, addressCity, addressCounty, addressDetail });
        const result = await api('/api/orders', 'POST', { ...orderData, address, productId: form.dataset.product, quantity: Number(data.quantity), duration: Number(data.duration), files: await filesFrom(form) }, window.SanyCustomers?.token());
        receiptView(result, data.remember === 'on');
      } else if (kind === 'phone-lookup') {
        const requestEpoch = ++authEpoch, phone = data.phone.trim();
        state.phoneLookup = null;
        if ($('#phoneOrderResults')) $('#phoneOrderResults').innerHTML = '<p class="muted" role="status">正在查询订单…</p>';
        try {
          const result = await api('/api/guest/phone-orders', 'POST', { phone });
          if (requestEpoch !== authEpoch || !form.isConnected || state.route !== 'customer') return;
          state.phoneLookup = { phone, orders: result.orders };
          renderPhoneOrders(result.orders);
        } catch (error) {
          if (requestEpoch !== authEpoch) return;
          if ($('#phoneOrderResults')) $('#phoneOrderResults').innerHTML = '';
          throw error;
        }
      } else if (kind === 'lookup') { const result = await api('/api/guest/lookup', 'POST', { ...data, orderId: data.orderId.trim(), phone: data.phone.trim(), code: data.code.trim() }); await openOrder(result.order.id, result.token, true); }
      else if (kind === 'access-link') {
        const input = data.accessLink.trim(), match = input.match(/#receipt=([^&\s]+)/);
        await projectServices?.handleAccessLink(match ? decodeURIComponent(match[1]) : input);
      }
      else if (kind === 'forget-receipt') { localStorage.setItem('sany-receipts-v3', JSON.stringify(receipts().filter(r => r.id !== form.dataset.id))); closeModal(); renderCustomer(); toast('已移除浏览器凭证，订单仍保留'); }
      else if (kind === 'login' || kind === 'register') {
        if (kind === 'register' && data.password !== data.repeat) throw new Error('两次输入的密码不一致。');
        const requestEpoch = ++authEpoch;
        window.SanyAccess?.begin();
        const result = await api(`/api/${kind}`, 'POST', data);
        /* 路由离开后不接受迟到会话；动效只是呈现，不能改变真实鉴权或让旧请求重新登录。 */
        if (requestEpoch !== authEpoch || !form.isConnected) { if (result.token) { try { await api('/api/logout', 'POST', {}, result.token); } catch {} } return; }
        state.bootstrap.setupNeeded = false;
        if (result.challenge) { window.SanyAccess?.fail('账号密码已确认 · 请继续本人摄像头核验'); showFace(result); return; }
        const enterWorkspace = await (window.SanyAccess?.complete(result.user) ?? true);
        if (!enterWorkspace || requestEpoch !== authEpoch) { try { await api('/api/logout', 'POST', {}, result.token); } catch {} return; }
        state.staffToken = result.token; state.user = result.user; writeSession(result.token);
        closeModal(); toast(kind === 'register' ? '注册成功，已直接进入工作区' : '登录成功'); await route();
      }
      else if (['order-transition', 'order-confirm'].includes(kind)) {
        const o = state.currentOrder, token = state.currentToken, customer = state.customer;
        await api(`/api/orders/${o.id}/${kind === 'order-confirm' ? 'confirm' : 'transition'}`, 'POST', { ...data, confirmed: data.confirmed === 'on', revision: o.revision, files: await filesFrom(form) }, token);
        state.dirty = true; await openOrder(o.id, token, customer); toast('订单进度与材料已保存');
      }
      else if (kind === 'ticket-create') {
        const result = await api('/api/tickets', 'POST', { ...data, orderId: state.currentOrder.id, files: await filesFrom(form) }, state.currentToken);
        state.dirty = true; await openTicket(result.ticket.id); toast('报修工单已提交');
      }
      else if (['ticket-transition', 'ticket-review', 'ticket-accept'].includes(kind)) {
        const t = state.currentTicket;
        await api(`/api/tickets/${t.id}/${kind.replace('ticket-', '')}`, 'POST', { ...data, revision: t.revision, files: await filesFrom(form) }, state.currentToken);
        state.dirty = true; await openTicket(t.id); toast('工单状态与证明材料已保存');
      }
      else if (kind === 'product-edit') {
        const existing = state.adminProducts.find(p => p.id === form.dataset.id);
        const specs = data.specText.split('\n').filter(line => line.trim()).map(line => { const parts = line.split('|').map(s => s.trim()); if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error('每项参数请按“名称 | 数值 | 单位”填写。'); return { name: parts[0], value: parts[1], unit: parts[2] || '' }; });
        let image = existing?.image;
        const photos = await filesFrom(form, 'productImage');
        if (photos.length) image = (await api('/api/admin/product-images', 'POST', photos[0], state.staffToken)).image;
        const values = Object.fromEntries(['buyMin', 'buyMax', 'rentMonthlyMin', 'rentMonthlyMax'].map(key => [key, data[key] === undefined || data[key] === '' ? null : Number(data[key])]));
        const price = Object.values(values).some(value => value !== null) ? { ...values, source: data.priceSource || '' } : null;
        await api('/api/admin/products', existing ? 'PATCH' : 'POST', { ...data, id: existing?.id, published: data.published === 'true', specs, image, ...(!existing?.exhibitOnly ? { referencePrice: price } : {}) }, state.staffToken);
        state.dirty = true; closeModal(); toast('产品信息已保存，售中目录同步更新');
      }
      else if (kind === 'product-remove') { await api(`/api/admin/products/${form.dataset.id}`, 'DELETE', {}, state.staffToken); state.dirty = true; closeModal(); toast('已从售中目录移除，可在后台恢复'); }
      else if (kind === 'user-create') { await api('/api/admin/users', 'POST', data, state.staffToken); state.dirty = true; closeModal(); toast('员工账号已创建，可使用设置的密码登录'); }
      else if (kind === 'user-edit') { await api(`/api/admin/users/${form.dataset.id}`, 'PATCH', { active: data.active === 'true', ...(data.password ? { password: data.password } : {}), resetFace: data.resetFace === 'on' }, state.staffToken); state.dirty = true; closeModal(); toast('账号已更新，旧会话已失效'); }
    } catch (error) {
      if ((kind === 'login' || kind === 'register') && form.isConnected) window.SanyAccess?.fail(error.message);
      if (errorBox?.isConnected) errorBox.textContent = error.message; else toast(error.message);
    } finally { form.dataset.busy = 'false'; if (submit) submit.disabled = false; }
  });
  /* 阅读、键盘操作、弹窗和后台标签页期间停止自动切换，防止用户正要点击时设备变更。 */
  document.addEventListener('pointerover', event => {
    const hero = event.target.closest?.('#heroCarousel');
    if (hero && !hero.contains(event.relatedTarget)) { state.heroHover = true; scheduleHero(); }
  });
  document.addEventListener('pointerout', event => {
    const hero = event.target.closest?.('#heroCarousel');
    if (hero && !hero.contains(event.relatedTarget)) { state.heroHover = false; scheduleHero(); }
  });
  document.addEventListener('focusin', event => {
    if (event.target.closest?.('#heroCarousel')) { state.heroFocus = true; scheduleHero(); }
  });
  document.addEventListener('focusout', event => {
    const hero = event.target.closest?.('#heroCarousel');
    if (hero && !hero.contains(event.relatedTarget)) { state.heroFocus = false; scheduleHero(); }
  });
  document.addEventListener('keydown', event => {
    const target = event.target, hero = target.closest?.('#heroCarousel');
    if (!hero || (target !== hero && !target.closest?.('.hero-controls'))) return;
    /* 不新增占位暂停按钮；容器本身可用空格锁定暂停，避免吞掉箭头按钮原生空格激活。 */
    if (target === hero && event.key === ' ') { event.preventDefault(); state.heroPaused = !state.heroPaused; scheduleHero(); return; }
    const index = { ArrowLeft: state.heroIndex - 1, ArrowRight: state.heroIndex + 1, Home: 0, End: state.heroSlides.length - 1 }[event.key];
    if (index !== undefined) { event.preventDefault(); changeHero(index); }
  });
  document.addEventListener('visibilitychange', () => { scheduleHero(); if (!document.hidden) void refreshStaffUnread(); if (!document.hidden && state.staffToken) void ensureStaffSession(); });
  document.addEventListener('sany:workspace-transition', () => { state.heroWindowPaused = true; scheduleHero(); });
  document.addEventListener('sany:workspace-ready', () => { state.heroWindowPaused = false; scheduleHero(); });
  window.addEventListener('focus', () => { if (state.staffToken) void ensureStaffSession(); });
  reducedMotion?.addEventListener?.('change', event => {
    state.heroPaused = event.matches;
    if (state.route === 'catalog') { renderHero(); scheduleHero(); }
  });
  window.addEventListener('hashchange', () => { if (modal.open) closeModal(); route(); });
  window.addEventListener('beforeunload', () => { releaseBootWait?.(false); stopHero(); window.SanyHeroMotion?.cancel(); projectServices?.stop(); window.SanyFace?.stop(); });
  async function boot() {
    if (location.protocol === 'file:') { main.innerHTML = `<section class="wrap">${empty('请通过本机服务打开', '完整订单、审核与账号功能需要本地服务。请先运行 Windows 便携版，或在工程目录运行“启动网页版.cmd”。', '<a class="btn primary" href="http://127.0.0.1:8790">打开本机平台</a>')}</section>`; return; }
    try {
      state.bootstrap = await api('/api/bootstrap');
      $('#releaseVersion').textContent = `v${state.bootstrap.version}`;
      if (state.staffToken) { try { state.user = (await api('/api/me', 'GET', undefined, state.staffToken)).user; } catch { state.staffToken = ''; writeSession(''); } }
      await route();
    } catch (error) { main.innerHTML = `<section class="wrap">${empty('未连接到本机服务', '请确认 Windows 软件或“启动网页版.cmd”正在运行。关闭旧进程后重新启动；订单数据不会因此丢失。', button('retry', '重新连接'))}</section>`; }
  }
  projectServices = window.SanyProjects?.create({ api, esc, button, field, textarea, select, options, formEnd, empty, time, toast, filesFrom, downloadFile, showModal, closeModal, getState: () => state, openOrder, downloadText });
  let staffUnreadBusy = false;
  async function refreshStaffUnread() {
    if (customerWindow || document.hidden || staffUnreadBusy || !state.staffToken || !['admin','service'].includes(state.user?.role) || state.user.capabilities?.chat === false) return;
    const token = state.staffToken; staffUnreadBusy = true;
    try {
      const data = await api('/api/conversations/unread', 'GET', undefined, token);
      if (token !== state.staffToken) return;
      const counts = {overview:data.conversations.reduce((n,c)=>n+c.unread,0)+data.supportUnread, 'customer-chat':data.supportUnread, projects:0,orders:0,tickets:0};
      data.conversations.forEach(c=>{if(c.kind==='project')counts.projects+=c.unread;else {counts.orders+=c.unread;if(data.ticketOrderIds.includes(c.recordId))counts.tickets+=c.unread;}});
      document.querySelectorAll('.sidebar [data-tab]').forEach(el=>{let dot=el.querySelector('.cu-unread');const count=counts[el.dataset.tab]||0;if(!dot){dot=document.createElement('span');dot.className='cu-unread';el.append(dot);}dot.hidden=!count;dot.textContent=count>99?'99+':String(count);dot.setAttribute('aria-label',`${count}条未读消息`);});
      document.querySelectorAll('[data-action="staff-order"],[data-action="staff-ticket"],[data-project-action="staff-project"]').forEach(button => {
        const ticket=button.dataset.action==='staff-ticket'?state.tickets.find(t=>t.id===button.dataset.id):null;
        const kind=button.dataset.projectAction?'project':'order',recordId=ticket?ticket.orderId:button.dataset.id;
        const count = data.conversations.find(c => c.kind === kind && c.recordId === recordId)?.unread || 0;
        let dot = button.nextElementSibling?.classList.contains('staff-order-unread')?button.nextElementSibling:null;
        if (!count) { dot?.remove(); return; }
        if (!dot) { dot = document.createElement('button'); dot.type = 'button'; dot.className = 'staff-order-unread'; dot.dataset.action = 'staff-unread-chat'; dot.dataset.id = recordId; dot.dataset.kind=kind; button.after(dot); }
        dot.textContent = count > 99 ? '99+' : String(count); dot.title = `${count}条客户未读消息，点击打开会话`; dot.setAttribute('aria-label', dot.title);
      });
    } catch {} finally { staffUnreadBusy = false; }
  }
  setInterval(refreshStaffUnread, 2000);
  window.SanyResumeCustomer=async destination=>{
    window.history.replaceState(null,'',`${location.pathname}${location.search}${destination.hash}`);
    await route();
    if(location.hash!==destination.hash)return;
    window.scrollTo({top:Number(destination.scrollY)||0,behavior:'instant'});
    if(destination.action?.type==='purchase')await showPurchase(destination.action.id,destination.action.mode==='rent'?'rent':'buy');
    else if(destination.action?.type==='chat')await window.SanyCustomers.openChat();
  };
  window.SanyOpenCustomerTicket=(id,token)=>openTicket(id,token,true);
  window.SanyStartAfterSales=async(id,token)=>{await openOrder(id,token,true);if(state.currentOrder?.id===id&&state.currentOrder.status==='delivered')newTicket();};
  window.SanyOpenCustomerConversation=(kind,id,token)=>projectServices.openChat(kind,id,token,true);
  followupServices = window.SanyFollowups?.create({ api, esc, button, field, textarea, select, formEnd, empty, time, toast, showModal, closeModal, getState: () => state });
  boot();
})();
