/* 品牌开屏只表达产品服务路径，不把视觉进度冒充身份核验或设备连接结果。
 * 同一标签页仅自动展示一次，随时可跳过；减少动态效果时直接进入业务页面。 */
(() => {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  function finish() {
    if (!active) return;
    const view = active;
    active = null;
    view.cleanups.forEach(cancel => cancel());
    view.screen.close(); view.screen.remove();
    /* 跳过、后台隐藏及正常关闭都释放首屏内容提交，不能让等待的路由挂起。 */
    document.dispatchEvent(new Event('sany:boot-close'));
    if (view.previousFocus?.isConnected) view.previousFocus.focus({ preventScroll: true });
  }
  function pause(view, duration) {
    if (active !== view) return Promise.resolve(false);
    return new Promise(resolve => {
      const done = result => { clearTimeout(timer); view.cleanups.delete(cancel); resolve(result && active === view); };
      const cancel = () => done(false);
      const timer = setTimeout(() => done(true), duration);
      view.cleanups.add(cancel);
    });
  }
  /* 圆环与三枚构件共享同一套可取消时钟；finished 决定正常结束，兜底时间包含错峰 delay。
   * 跳过、隐藏或重播销毁旧实例后，旧动画不得再关闭新实例或抢回焦点。 */
  function animate(view, element, frames, options) {
    if (active !== view) return Promise.resolve(false);
    if (motion.matches || document.hidden || !element?.animate) return Promise.resolve(true);
    let animation;
    try { animation = element.animate(frames, { ...options, fill: 'both' }); }
    catch { return Promise.resolve(true); }
    return new Promise(resolve => {
      let settled = false;
      const done = result => {
        if (settled) return; settled = true;
        clearTimeout(timer); view.cleanups.delete(cancel);
        try { animation.cancel(); } catch {}
        resolve(result && active === view);
      };
      const cancel = () => done(false);
      const timer = setTimeout(() => { try { animation.finish(); } catch {} done(true); }, (options.delay || 0) + options.duration + 500);
      view.cleanups.add(cancel);
      animation.finished.then(() => done(true), () => done(true));
    });
  }
  function play(manual = false) {
    if (active) return;
    const previousFocus = document.activeElement;
    const screen = document.createElement('dialog');
    screen.className = 'boot-screen';
    screen.setAttribute('aria-labelledby', 'bootTitle');
    screen.innerHTML = `<div class="boot-top"><div>三一匠造<small>SANY FORGE / ENGINEERING SERVICE</small></div><button type="button" class="boot-skip">进入平台 <span aria-hidden="true">↗</span></button></div>
      <div class="boot-stage"><div class="boot-assembly">${window.SanyEmblem?.markup() || '<img src="assets/brand/sany-emblem.svg" alt="三一徽标">'}</div><div class="boot-brand"><h1 id="bootTitle">工程装备 · 全程服务</h1><p>EQUIPMENT. DELIVERY. SERVICE.</p></div></div>
      <div class="boot-bottom"><span>选型与租购 <b>→</b> 交付与签收 <b>→</b> 维保与验收</span><small>品牌开屏 · 可按 Enter / Space / Esc 跳过</small></div>`;
    document.body.append(screen);
    const view = active = { screen, previousFocus, cleanups: new Set() };
    screen.querySelector('.boot-skip').addEventListener('click', finish);
    screen.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    screen.addEventListener('keydown', event => {
      /* 音效按钮保留原生键盘激活，不能把静音操作误当成跳过整个开屏。 */
      if (event.target.closest?.('[data-ui-sound-toggle]')) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finish(); }
    });
    /* 重播时清掉可能覆盖 dialog 的全页转场快照；首次开屏后到达的数据由路由侧守卫直接更新。 */
    document.dispatchEvent(new Event('sany:boot-open'));
    screen.showModal();
    (async () => {
      /* 不是固定总时长截断：圆环扫掠中三枚“一”依次插入，全体落位后再定格。 */
      const svg = screen.querySelector('.emblem-assembly');
      const assembled = motion.matches || !svg ? true : await window.SanyEmblem.play(svg, { animate: (element, frames, options) => animate(view, element, frames, options) });
      if (!assembled || active !== view) return;
      screen.dataset.assemblyComplete = 'true';
      /* 重布局放到飞行结束后的定格阶段，避免首屏设备目录阻塞SVG射入的绘制帧。 */
      document.dispatchEvent(new Event('sany:boot-assembled'));
      /* 减少动态时手动重播只展示静态徽标，不强制恢复已禁用的动画。 */
      if (!await pause(view, motion.matches && manual ? 1200 : 420) || active !== view) return;
      if (motion.matches || document.hidden) { finish(); return; }
      screen.classList.add('boot-leaving');
      if (await pause(view, 300) && active === view) finish();
    })().catch(() => { if (active === view) finish(); });
  }
  document.getElementById('replayBoot')?.addEventListener('click', () => play(true));
  motion.addEventListener('change', event => { if (event.matches) finish(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
  let visited = false;
  try { visited = sessionStorage.getItem('sany-brand-intro-v1') === 'seen'; sessionStorage.setItem('sany-brand-intro-v1', 'seen'); }
  catch { /* 存储不可用不影响品牌页和业务功能。 */ }
  if (!visited && !motion.matches && !/[?&]workspace=staff(?:&|$)/.test(location.search) && (!location.hash || location.hash === '#catalog')) play();
})();
