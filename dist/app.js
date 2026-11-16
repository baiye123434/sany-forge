/* ============================================================
   SANY 三一 · 工程装备作品展
   本文件只保存官网可核验的产品参数与前端展示状态。
   租购需求由 commerce.js 独立管理，不生成模拟报价或运行数据。
   ============================================================ */
'use strict';

(() => {
  const products = [
    {
      key: 'excavator',
      filter: 'earthwork',
      category: '土石方机械',
      categoryEn: 'EARTHWORK',
      code: 'SY215C-S',
      name: '中型挖掘机',
      image: 'assets/products/excavator.jpg',
      summary:
        '三一 21 吨级土石方挖掘机，公开产品手册列示整机重量 21,900 kg、标准斗容 1.1 m³、额定功率 118 kW。适用于土石方开挖、基础施工与市政工程等场景。',
      specs: [
        ['整机重量', '21,900', 'kg'],
        ['标准斗容', '1.1', 'm³'],
        ['额定功率', '118', 'kW / 2,000 rpm'],
        ['铲斗挖掘力', '138', 'kN']
      ],
      workTitle: '土石方挖掘与装载',
      workDescription:
        '工作装置通过动臂、斗杆与铲斗协同完成切入、挖掘和卸料；履带底盘提供移动与稳定支撑，上车回转机构连接挖掘与装车位置。',
      steps: [
        ['定位支撑', '履带底盘移动至作业面，确认回转与挖掘范围。'],
        ['铲斗切入', '动臂下降、斗杆伸出，铲斗切入土体并完成收斗。'],
        ['上车回转', '回转平台带动工作装置转向运输车辆或堆料区。'],
        ['举升卸料', '动臂举升并打开铲斗，完成卸料后返回挖掘位置。']
      ],
      sourceTitle: 'SY215C-S 产品手册',
      sourceMeta: '三一重机 · 2024 年 3 月版',
      sourceUrl:
        'https://cos-www.sanygroup.com/2024/05/07/20240319SY215C%E5%8D%95%E8%A1%8C%E6%9C%AC-%E9%A2%84%E8%A7%88%E7%89%88.pdf'
    },
    {
      key: 'pump',
      filter: 'concrete',
      category: '混凝土机械',
      categoryEn: 'CONCRETE',
      code: 'SYM5552THB 710S',
      name: '71 米 S 系列混凝土泵车',
      image: 'assets/products/pump.jpg',
      summary:
        '五桥三一底盘泵车，官网列示臂架垂直高度 70.2 m，混凝土理论排量低压 180 m³/h、高压 125 m³/h，用于将混凝土输送至高层或远距离浇筑位置。',
      specs: [
        ['臂架垂直高度', '70.2', 'm'],
        ['低压理论排量', '180', 'm³/h'],
        ['高压泵送压力', '13', 'MPa'],
        ['桥数', '5', '桥']
      ],
      workTitle: '混凝土输送与布料',
      workDescription:
        '泵车先用支腿建立稳定支撑，再展开多节臂架，把输送管送至浇筑区域；泵送系统通过输送缸连续推动混凝土，经末端软管完成布料。',
      steps: [
        ['支腿展开', '在满足承载条件的地面展开支腿，建立整车稳定支撑。'],
        ['臂架展开', '按现场空间与浇筑位置依次展开多节臂架。'],
        ['连续泵送', '泵送系统推动混凝土通过输送管到达臂架末端。'],
        ['末端布料', '通过末端软管调整落点，完成浇筑后清洗并收拢臂架。']
      ],
      sourceTitle: 'SYM5552THB 710S 产品页',
      sourceMeta: '三一集团官网 · 71 米 S 系列混凝土泵车',
      sourceUrl: 'https://www.sanygroup.com/product/1139.html'
    },
    {
      key: 'crane',
      filter: 'lifting',
      category: '起重机械',
      categoryEn: 'LIFTING',
      code: 'SAC4000C8-8',
      name: '全地面起重机',
      image: 'assets/products/crane.jpg',
      summary:
        '400 吨级六桥全地面起重机，官网公开产品页列示 8 节主臂全伸 90 m、固定副臂标配 22 m，可用于房屋建筑、桥梁和市政等大型构件吊装。',
      specs: [
        ['最大起重量', '400', 't'],
        ['主臂全伸', '90', 'm'],
        ['主臂节数', '8', '节'],
        ['最大行驶速度', '80', 'km/h']
      ],
      workTitle: '重物起升与回转就位',
      workDescription:
        '起重机通过支腿与配重建立稳定作业条件，伸缩主臂改变高度与幅度，卷扬系统收放钢丝绳完成起升，回转机构把载荷送至目标位置。',
      steps: [
        ['支腿找平', '展开支腿并完成车身找平，为吊装建立稳定基础。'],
        ['伸臂挂载', '按吊装方案伸出主臂，吊钩下降至构件并完成可靠连接。'],
        ['起升回转', '卷扬起升载荷，结合回转与变幅把构件移向目标位置。'],
        ['精准落钩', '降低速度完成就位，解除吊具后收回吊钩与臂架。']
      ],
      sourceTitle: 'SAC4000C8-8 产品页',
      sourceMeta: '三一集团官网 · 400 吨全地面起重机',
      sourceUrl: 'https://www.sanygroup.com/product/1478.html'
    },
    {
      key: 'drill',
      filter: 'piling',
      category: '桩工机械',
      categoryEn: 'PILING',
      code: 'SR315-S',
      name: '旋挖钻机',
      image: 'assets/products/drill.jpg',
      summary:
        '额定输出扭矩 315 kN·m 的旋挖钻机，官网列示最大钻孔直径 2,500 mm，最大钻孔深度 61/95 m，适用于房屋建筑、市政公用与桥梁桩基础施工。',
      specs: [
        ['额定输出扭矩', '315', 'kN·m'],
        ['最大钻孔直径', '2,500', 'mm'],
        ['最大钻孔深度', '61 / 95', 'm'],
        ['工作重量', '112', 't']
      ],
      workTitle: '桩孔旋挖成孔',
      workDescription:
        '旋挖钻机以履带底盘稳定就位，桅杆支撑动力头与钻杆；动力头驱动钻具旋转切削土层，主卷扬周期性提钻卸土，逐步达到设计孔深。',
      steps: [
        ['桅杆立正', '设备就位后调整桅杆垂直度，使钻具对准桩位中心。'],
        ['下放钻具', '主卷扬下放钻杆与钻斗，动力头进入待钻状态。'],
        ['加压旋钻', '动力头输出扭矩并施加压力，钻斗切削并收集土体。'],
        ['提钻卸土', '提升钻具至地面并回转卸土，循环作业直至达到孔深。']
      ],
      sourceTitle: 'SR315-S 产品页',
      sourceMeta: '三一官网 · 旋挖钻机公开参数',
      sourceUrl: 'https://www.sany.com.cn/product/323204.html'
    }
  ];
  /* 两个入口共用产品目录，避免租购表单与三维页出现型号差异。 */
  window.SANY_PRODUCTS = Object.freeze(products.map(product => Object.freeze({ ...product })));

  const productGrid = document.querySelector('#productGrid');
  const modelTabs = document.querySelector('#modelTabs');
  const detail = document.querySelector('#productDetail');
  const modelHost = document.querySelector('#m3dHost');
  const workflowCode = document.querySelector('#workflowCode');
  const workflowName = document.querySelector('#workflowName');
  const workflowDescription = document.querySelector('#workflowDescription');
  const workflowSteps = document.querySelector('#workflowSteps');
  const sourceList = document.querySelector('#sourceList');
  let activeKey = products[0].key;
  let mountRevision = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const productByKey = (key) => products.find((product) => product.key === key) || products[0];

  function renderProducts() {
    productGrid.innerHTML = products
      .map(
        (product, index) => `
          <article class="product-card" data-product-card="${product.key}" data-category="${product.filter}">
            <div class="card-top">
              <span class="card-index">${String(index + 1).padStart(2, '0')} / 04</span>
              <span class="card-category">${product.category}</span>
            </div>
            <div class="card-media" data-type="${product.categoryEn}">
              <img src="${product.image}" alt="三一 ${product.code} ${product.name}" loading="lazy" />
            </div>
            <div class="card-body">
              <div>
                <span class="card-code">${product.code}</span>
                <h3>${product.name}</h3>
                <p>${product.summary}</p>
              </div>
              <button class="card-open" type="button" data-open-product="${product.key}" aria-label="查看 ${product.code} 三维模型">↘</button>
            </div>
            <div class="card-commerce">
              <span>报价待询价</span>
              <button type="button" data-inquiry="buy" data-product="${product.key}">购买 <span>↗</span></button>
              <button type="button" data-inquiry="rent" data-product="${product.key}">租赁 <span>↗</span></button>
            </div>
          </article>`
      )
      .join('');
  }

  function renderTabs() {
    modelTabs.innerHTML = products
      .map(
        (product, index) => `
          <button class="model-tab${index === 0 ? ' is-active' : ''}" type="button" role="tab"
            aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}" aria-controls="productDetail" data-select-product="${product.key}">
            <b>${String(index + 1).padStart(2, '0')}</b>
            <span>${product.code}<small>${product.categoryEn}</small></span>
          </button>`
      )
      .join('');
  }

  function renderSources() {
    sourceList.innerHTML = products
      .map(
        (product, index) => `
          <div class="source-item">
            <b>${String(index + 1).padStart(2, '0')}</b>
            <span><strong>${product.sourceTitle}</strong><small>${product.sourceMeta} · 访问核验：2026-10-20</small></span>
            <a href="${product.sourceUrl}" target="_blank" rel="noreferrer" aria-label="打开 ${product.sourceTitle}">↗</a>
          </div>`
      )
      .join('');
  }

  function renderDetail(product) {
    detail.innerHTML = `
      <span class="detail-category">${product.categoryEn} / ${product.category}</span>
      <h3>${product.code}</h3>
      <span class="detail-type">${product.name}</span>
      <p class="detail-summary">${product.summary}</p>
      <div class="detail-specs">
        ${product.specs
          .map(
            (spec) => `<div><small>${spec[0]}</small><strong>${spec[1]}<i>${spec[2]}</i></strong></div>`
          )
          .join('')}
      </div>
      <div class="detail-commerce">
        <button class="button button-primary" type="button" data-inquiry="buy" data-product="${product.key}">购买设备</button>
        <button class="button button-ghost" type="button" data-inquiry="rent" data-product="${product.key}">租赁设备</button>
      </div>
      <a class="detail-link" href="${product.sourceUrl}" target="_blank" rel="noreferrer">查看三一官方资料 <span>↗</span></a>`;
  }

  function renderWorkflow(product) {
    workflowCode.textContent = product.code;
    workflowName.textContent = product.workTitle;
    workflowDescription.textContent = product.workDescription;
    workflowSteps.innerHTML = product.steps
      .map(
        (step, index) => `
          <li>
            <b>STEP ${String(index + 1).padStart(2, '0')}</b>
            <h4>${step[0]}</h4>
            <p>${step[1]}</p>
          </li>`
      )
      .join('');
  }

  /* 切换机型时重建单一 WebGL 场景，避免多个渲染器同时占用显存。 */
  function mountModel(product) {
    const revision = ++mountRevision;
    modelHost.classList.add('hots-off');
    modelHost.innerHTML = '<div class="m3d-loading">正在构建三维模型…</div>';

    document.querySelectorAll('[data-model-action]').forEach((button) => {
      const action = button.dataset.modelAction;
      const on = !reducedMotion && (action === 'rotate' || action === 'animate');
      button.classList.toggle('is-on', on);
      if (['rotate', 'animate', 'labels', 'explode'].includes(action)) button.setAttribute('aria-pressed', String(on));
    });

    if (!window.Forge3D || !window.Forge3D.supported()) {
      modelHost.innerHTML = '<div class="m3d-fallback">当前浏览器未启用 WebGL，无法显示三维模型。</div>';
      return;
    }

    window.requestAnimationFrame(() => {
      if (revision !== mountRevision) return;
      modelHost.innerHTML = '';
      const viewer = window.Forge3D.mount(modelHost, product.key, { dark: false, animate: !reducedMotion });
      if (viewer) viewer.setAutoRotate(!reducedMotion);
    });
  }

  function selectProduct(key, shouldScroll = false) {
    const product = productByKey(key);
    activeKey = product.key;
    document.body.dataset.activeProduct = activeKey;

    document.querySelectorAll('[data-select-product]').forEach((tab) => {
      const active = tab.dataset.selectProduct === activeKey;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    renderDetail(product);
    renderWorkflow(product);
    mountModel(product);

    if (shouldScroll) {
      document.querySelector('#experience').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }
  }

  function handleModelAction(button) {
    const viewer = window.Forge3D && window.Forge3D.current ? window.Forge3D.current() : null;
    const action = button.dataset.modelAction;
    if (!viewer && action !== 'fullscreen') return;

    if (action === 'rotate') {
      button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(button.classList.contains('is-on')));
      viewer.setAutoRotate(button.classList.contains('is-on'));
      return;
    }

    if (action === 'animate') {
      button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(button.classList.contains('is-on')));
      viewer.setAnimate(button.classList.contains('is-on'));
      return;
    }

    if (action === 'labels') {
      button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(button.classList.contains('is-on')));
      modelHost.classList.toggle('hots-off', !button.classList.contains('is-on'));
      return;
    }

    if (action === 'explode') {
      button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(button.classList.contains('is-on')));
      viewer.setExplode(button.classList.contains('is-on'));
      const animateButton = document.querySelector('[data-model-action="animate"]');
      animateButton.classList.toggle('is-on', viewer.getAnimate());
      animateButton.setAttribute('aria-pressed', String(viewer.getAnimate()));
      return;
    }

    if (action === 'reset') {
      viewer.reset();
      return;
    }

    if (action === 'fullscreen') {
      const stage = document.querySelector('.model-stage');
      if (!document.fullscreenElement && stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
      else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  }

  renderProducts();
  renderTabs();
  renderSources();
  selectProduct(activeKey);
  document.querySelector('#releaseLabel').textContent = `v${window.SANY_RELEASE.version} · 网页 / Windows 同版`;

  modelTabs.addEventListener('keydown', event => {
    const tabs = [...modelTabs.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectProduct(tabs[next].dataset.selectProduct);
    tabs[next].focus();
  });

  document.addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-open-product]');
    if (openButton) {
      selectProduct(openButton.dataset.openProduct, true);
      return;
    }

    const tab = event.target.closest('[data-select-product]');
    if (tab) {
      selectProduct(tab.dataset.selectProduct);
      return;
    }

    const filter = event.target.closest('[data-filter]');
    if (filter) {
      document.querySelectorAll('[data-filter]').forEach((button) => button.classList.remove('is-active'));
      filter.classList.add('is-active');
      document.querySelectorAll('[data-product-card]').forEach((card) => {
        card.hidden = filter.dataset.filter !== 'all' && card.dataset.category !== filter.dataset.filter;
      });
      return;
    }

    const modelButton = event.target.closest('[data-model-action]');
    if (modelButton) handleModelAction(modelButton);
  });

  const menuButton = document.querySelector('#menuButton');
  const mobileNav = document.querySelector('#mobileNav');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    mobileNav.classList.toggle('is-open', open);
  });

  mobileNav.addEventListener('click', (event) => {
    if (!event.target.closest('a')) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', '打开导航');
    mobileNav.classList.remove('is-open');
  });

  window.addEventListener('beforeunload', () => {
    if (window.Forge3D && window.Forge3D.unmount) window.Forge3D.unmount();
  });
})();
