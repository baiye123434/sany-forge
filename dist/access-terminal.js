/* 六幕访问终端：画面来自参考视频的构图，身份结论只来自业务接口。
 * 表单保留在 DOM 中，失败不丢输入；离开路由后取消所有计时与待进入状态。 */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roles = { admin: '管理员', service: '服务工程师', reviewer: '审核员' };
  const stages = ['authorization', 'identity', 'request', 'read', 'verify', 'welcome'];
  const labels = ['ACCESS AUTHORIZATION', 'IDENTITY CONFIRMATION', 'REQUEST SUBMITTED', 'PROFILE RECEIVED', 'IDENTITY VERIFIED', 'WELCOME ABOARD'];
  const emblem = '<img class="access-emblem" src="assets/brand/sany-emblem.svg" alt="三一标识">';
  let current = null;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function destroy({ keepLayout = false } = {}) {
    if (current) {
      const view = current; current = null;
      view.cleanups.forEach(cancel => cancel());
      view.resolve?.(false); view.resolve = null;
    }
    if (!keepLayout) document.body.classList.remove('access-mode');
  }
  function focus(element) { element?.focus({ preventScroll: true }); }
  const quiet = view => view.skipMotion || reduced() || document.hidden;
  /* 每一段等待都可被路由销毁取消，避免离开后旧动画重新打开欢迎页。
   * 后台标签页不等待绘制帧；动画被取消时回到 CSS 定义的完整静态状态。 */
  function pause(view, duration) {
    if (current !== view) return Promise.resolve(false);
    if (quiet(view)) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = result => { clearTimeout(timer); view.cleanups.delete(cancel); resolve(result && current === view); };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(true), duration);
      view.cleanups.add(cancel);
    });
  }
  function animate(view, element, frames, options) {
    if (current !== view) return Promise.resolve(false);
    if (quiet(view) || !element?.animate) return Promise.resolve(true);
    let animation;
    try { animation = element.animate(frames, { ...options, fill: 'both' }); }
    catch { return Promise.resolve(true); }
    view.animations.add(animation);
    return new Promise(resolve => {
      let done = false;
      const finish = result => {
        if (done) return; done = true;
        clearTimeout(timer); view.cleanups.delete(cancel); view.animations.delete(animation);
        try { animation.cancel(); } catch {}
        resolve(result && current === view);
      };
      const cancel = () => finish(false);
      /* finished 是正常结束依据；计时器仅兜底浏览器冻结/取消事件，先补齐终帧再结束。 */
      const timer = setTimeout(() => { try { animation.finish(); } catch {} finish(true); }, (options.delay || 0) + options.duration + 500);
      view.cleanups.add(cancel);
      animation.finished.then(() => finish(true), () => finish(true));
    });
  }
  function applyStage(view, stage, message, render) {
    const index = stages.indexOf(stage);
    view.root.dataset.stage = stage;
    view.shell.hidden = stage !== 'identity';
    view.scene.hidden = stage === 'identity';
    /* 矮屏表单可能已向下滚动；进入仪式幕先回舞台顶部，再计算画外飞行坐标。
     * 失败回身份幕不强制滚动，继续保留输入和字段焦点。 */
    if (stage !== 'identity') window.scrollTo({ top: 0, behavior: 'instant' });
    render?.();
    view.root.querySelector('.access-step small').textContent = labels[index];
    view.root.querySelector('.access-status p').textContent = message;
    view.root.querySelector('.access-skip').textContent = stage === 'welcome' ? '进入工作区  ↗' : view.skipMotion ? '动效已跳过' : '跳过动效  SKIP';
  }
  function setStage(view, stage, message, render) {
    if (current !== view) return Promise.resolve(false);
    const sequence = ++view.transitionSequence;
    view.stage = stage;
    /* 只对中央内容做局部退场/进场，边框和舞台保持稳定；表单节点不复制、不销毁。 */
    view.content.getAnimations().forEach(animation => animation.cancel());
    view.transition = (async () => {
      const valid = () => current === view && sequence === view.transitionSequence;
      if (!await animate(view, view.content, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 140, easing: 'cubic-bezier(.4,0,1,1)' }) || !valid()) return false;
      applyStage(view, stage, message, render);
      return await animate(view, view.content, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' }) && valid();
    })();
    return view.transition;
  }
  async function identify(view, message) {
    if (await setStage(view, 'identity', message || (view.mode === 'register' ? '创建本机演示身份 · 不收取费用' : '请输入工作账号与密码'))) focus(view.shell.querySelector('input'));
  }
  function welcome(view) {
    if (current !== view) return;
    return setStage(view, 'welcome', '访问已获准 · 确认后进入服务工作区', () => {
      view.scene.innerHTML = `<p class="access-subtitle">WELCOME TO</p><h1><span class="access-welcome-band">三一匠造</span></h1>${emblem}<div class="access-person"><strong>${esc(view.user.name)}</strong><span>${esc(roles[view.user.role] || '工作人员')} / ${esc(view.user.username)}</span></div><button type="button" class="access-primary" data-access="enter">进入工作区 <span>↗</span></button>`;
    }).then(shown => { if (shown) focus(view.scene.querySelector('button')); });
  }
  async function enter(view) {
    if (view.root.dataset.stage !== 'welcome' || !view.resolve || view.entering) return;
    view.entering = true;
    view.root.classList.add('access-leaving');
    view.root.querySelectorAll('[data-access="enter"], .access-skip').forEach(button => { button.disabled = true; button.textContent = '正在进入工作区…'; });
    /* 确认只做轻微反馈，旧欢迎画面保持可见；工作区数据就绪后由全页过渡原子替换，避免先淡空再等接口。 */
    const finished = await animate(view, view.content, [{ opacity: 1 }, { opacity: .94 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    if (finished) { const resolve = view.resolve; view.resolve = null; resolve?.(current === view); }
  }
  function skip(view) {
    if (view.root.dataset.stage === 'welcome') { enter(view); return; }
    view.skipMotion = true;
    view.root.classList.add('is-skipping');
    view.flowSequence++;
    view.animations.forEach(animation => { try { animation.finish(); } catch { animation.cancel(); } });
    if (view.stage === 'authorization') identify(view);
    else if (view.user) welcome(view);
    else view.root.querySelector('.access-skip').textContent = '动效已跳过';
  }
  function mount({ host, mode, formHTML }) {
    const keepIdentity = current?.stage === 'identity';
    destroy();
    const source = document.createElement('div'); source.innerHTML = formHTML;
    const form = source.querySelector('form'), tabs = source.querySelector('.auth-tabs'), privacy = source.querySelector('.privacy-note');
    if (!form || !tabs) return;
    host.innerHTML = `<section class="access-terminal" data-stage="authorization" aria-label="三一匠造访问终端"><header class="access-header"><a class="access-brand" href="#catalog" aria-label="返回设备选购"><img src="assets/brand/sany-emblem.svg" alt=""><span>三一匠造<small>SANY FORGE / SERVICE TERMINAL</small></span></a><button type="button" class="access-skip">跳过动效  SKIP</button></header><div class="access-stage"><div class="access-content" id="accessContent"><div class="access-scene"></div><div class="access-form-shell" hidden><div class="access-form-heading"><small>IDENTITY CONFIRMATION</small><h1>${mode === 'register' ? '建立身份' : '身份确认'}</h1><p>${mode === 'register' ? '本机演示账号 · 选择岗位，即建即用' : '登录后处理订单、交付与维保任务'}</p></div></div></div><aside class="access-readout" aria-label="访问状态"><span>LOCAL ACCESS / 本机服务</span><dl><dt>终端</dt><dd>三一匠造</dd><dt>身份</dt><dd data-access-state>等待登录</dd><dt>环境</dt><dd>本地参赛版</dd></dl></aside></div><footer class="access-footer"><div class="access-step"><small>ACCESS AUTHORIZATION</small></div><div class="access-status"><p role="status" aria-live="polite">等待访问授权</p></div><div class="access-keyhint">ENTER / SPACE <span>继续</span><a href="#catalog">返回设备选购 ↗</a></div></footer></section>`;
    const root = host.querySelector('.access-terminal');
    /* 登录页隐藏公共导航，但仍应能切回独立客户窗口；不把客户页放进员工会话分区。 */
    const headerActions = document.createElement('div'); headerActions.className = 'access-header-actions';
    headerActions.innerHTML = '<a class="window-switch" href="/?workspace=customer#catalog" target="_blank" rel="noopener">客户窗口 ↗</a>';
    headerActions.append(root.querySelector('.access-skip'));
    root.querySelector('.access-header').append(headerActions);
    /* 全屏登录隐藏公共页脚，因此在可见终端读数保留同一个发布版本，便于识别运行的程序。 */
    root.querySelector('.access-readout dd:last-child').textContent = window.SANY_RELEASE?.version ? `v${window.SANY_RELEASE.version} · 本机演示` : '本机演示';
    const view = current = { root, mode, stage: 'authorization', content: root.querySelector('.access-content'), shell: root.querySelector('.access-form-shell'), scene: root.querySelector('.access-scene'), skipMotion: reduced(), cleanups: new Set(), animations: new Set(), transitionSequence: 0, flowSequence: 0, transition: Promise.resolve(true), resolve: null, user: null };
    view.shell.append(tabs, form);
    if (privacy) view.shell.append(privacy);
    view.scene.innerHTML = `${emblem}<p class="access-subtitle">EQUIPMENT · DELIVERY · SERVICE</p><h1>访问授权</h1><p class="access-description">从装备选型，到每一次服务。<br>进入你的三一匠造工作区。</p><button type="button" class="access-primary" data-access="continue">访问工作区 <span>→</span></button>`;
    document.body.classList.add('access-mode');
    root.addEventListener('click', event => {
      if (event.target.closest('.access-skip')) skip(view);
      else if (event.target.closest('[data-access="continue"]')) identify(view);
      else if (event.target.closest('[data-access="enter"]')) enter(view);
    });
    /* 登录/注册页签由外层路由过渡接管；重挂载直接停在身份幕，避免快照捕获到一帧授权页。 */
    if (keepIdentity) {
      view.stage = 'identity';
      applyStage(view, 'identity', mode === 'register' ? '创建本机演示身份 · 不收取费用' : '请输入工作账号与密码');
      focus(view.shell.querySelector('input'));
    } else focus(view.scene.querySelector('button'));
  }
  function begin() {
    const view = current; if (!view) return;
    view.user = null; view.requestedAt = performance.now(); view.flowSequence++;
    delete view.root.dataset.ringComplete;
    setStage(view, 'request', '请求已提交 · 正在等待本机服务验证', () => {
      view.scene.innerHTML = `${emblem}<p class="access-subtitle">REQUESTING LOCAL ACCESS</p><h1>接收请求</h1><p class="access-description">正在验证账号信息，请稍候。</p>`;
    });
    focus(view.root.querySelector('.access-skip'));
  }
  function fail(message) {
    if (!current) return;
    current.flowSequence++;
    identify(current, message);
    current.root.querySelector('[data-access-state]').textContent = '尚未完成验证';
  }
  function complete(user) {
    const view = current;
    if (!view) return Promise.resolve(true);
    view.user = user;
    view.root.querySelector('[data-access-state]').textContent = `${user.name} · ${roles[user.role] || '工作人员'}`;
    return new Promise(resolve => {
      view.resolve = resolve;
      if (view.skipMotion || reduced()) { welcome(view); return; }
      const flow = ++view.flowSequence;
      const valid = () => current === view && flow === view.flowSequence;
      (async () => {
        /* 快速本机响应也先让请求幕退/进场结束；用户跳过或离开随时中断，不延迟错误提示。 */
        if (!await view.transition || !valid()) return;
        if (!await pause(view, Math.max(0, 600 - (performance.now() - (view.requestedAt || 0)))) || !valid()) return;
        if (!await setStage(view, 'read', '已收到服务端返回的账号资料', () => {
          view.scene.innerHTML = `${emblem}<p class="access-subtitle">PROFILE RECEIVED</p><h1>读取身份</h1><p class="access-description">${esc(user.name)} / ${esc(roles[user.role] || '工作人员')}</p>`;
        }) || !valid()) return;
        if (!await pause(view, 360) || !valid()) return;
        let drawing;
        if (!await setStage(view, 'verify', '本机服务已确认本次身份', () => {
          view.scene.innerHTML = `<div class="access-assembly">${window.SanyEmblem?.markup() || emblem}</div><p class="access-subtitle">IDENTITY VERIFIED</p><h1>核验通过</h1><p class="access-description">访问许可已获得</p>`;
          /* 三个“一”在圆环扫掠期间错峰插入，图形本身就是最终徽标；说明移到下方，不遮挡构件。
           * 共享序列等全部落位后才完成，下一幕不再只等待独立大圆的固定时长。 */
          const svg = view.scene.querySelector('.emblem-assembly');
          drawing = quiet(view) || !svg ? Promise.resolve(true) : window.SanyEmblem.play(svg, { animate: (element, frames, options) => animate(view, element, frames, options) });
        }) || !valid()) return;
        if (!await drawing || !valid()) return;
        view.root.dataset.ringComplete = 'true';
        if (!await pause(view, 420) || !valid()) return;
        welcome(view);
      })().catch(() => { if (valid()) welcome(view); });
    });
  }
  document.addEventListener('keydown', event => {
    if (!current || event.defaultPrevented || document.querySelector('dialog[open]') || event.target.closest('input,select,textarea,button,a')) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (current.stage === 'authorization') identify(current); else if (current.stage === 'welcome') enter(current); }
    if (event.key === 'Escape') skip(current);
  });
  /* 隐藏页和临时切换“减少动效”时补齐现有动画终帧，避免系统暂停渲染后核验永久挂起。 */
  const finishMotion = () => {
    if (current && (document.hidden || reduced())) current.animations.forEach(animation => { try { animation.finish(); } catch { animation.cancel(); } });
  };
  document.addEventListener('visibilitychange', finishMotion);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', finishMotion);
  window.SanyAccess = { mount, begin, fail, complete, destroy };
})();
