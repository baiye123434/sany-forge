/* 轮播只更新公开设备资料；旧图作为不可交互的短暂退场层，新图与信息分层入场。
 * 连续切换只保留最新一次动画，路由离开、页面隐藏及减少动态偏好都立即回收退场层。 */
(() => {
  'use strict';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  const images = new Map();
  function preload(sources) {
    /* 精选设备最多九张，提前解码防止切换入场时闪出空白；不预加载整份目录。 */
    sources.forEach(source => { if (source && !images.has(source)) { const image = new Image(); image.decoding = 'async'; image.src = source; images.set(source, image); image.decode?.().catch(() => {}); } });
  }
  function cancel() {
    const run = active; if (!run) return;
    active = null;
    run.animations.forEach(animation => animation.cancel());
    run.outgoing?.remove();
    run.host.dataset.heroMotion = 'idle';
  }
  async function show(host, html, { direction = 1, animate = true } = {}) {
    cancel();
    const quiet = preference.matches || document.hidden || !animate || !host.animate;
    const outgoing = !quiet && host.childElementCount ? host.cloneNode(true) : null;
    host.innerHTML = html;
    host.dataset.heroMotion = 'idle';
    if (!outgoing) return;
    /* 复制层不能被朗读、聚焦或响应点击，也不能制造重复 id；真实按钮始终属于当前设备。 */
    outgoing.removeAttribute('id'); outgoing.removeAttribute('aria-live');
    outgoing.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    outgoing.querySelectorAll('[data-action]').forEach(element => element.removeAttribute('data-action'));
    outgoing.setAttribute('aria-hidden', 'true'); outgoing.inert = true;
    outgoing.className = 'hero-slide hero-slide-outgoing';
    host.append(outgoing);
    const run = { host, outgoing, animations: [] }; active = run;
    host.dataset.heroMotion = 'running';
    const sign = direction < 0 ? -1 : 1;
    const move = (element, frames, duration, delay = 0) => {
      if (!element) return Promise.resolve();
      const animation = element.animate(frames, { duration, delay, easing: 'cubic-bezier(.2,.8,.22,1)', fill: 'both' });
      run.animations.push(animation);
      return animation.finished.catch(() => {});
    };
    try {
      await Promise.all([
        move(outgoing, [{ opacity: 1, transform: 'translateX(0) scale(1)' }, { opacity: 0, transform: `translateX(${-sign * 72}px) scale(.965)` }], 300),
        move(host.querySelector('.hero-equipment-canvas'), [{ opacity: .05, transform: `translateX(${sign * 84}px) scale(.94)`, clipPath: 'inset(0 24% 0 24%)' }, { opacity: 1, transform: 'translateX(0) scale(1)', clipPath: 'inset(0 0% 0 0%)' }], 650),
        move(host.querySelector('.hero-slide-top'), [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }], 360, 90),
        move(host.querySelector('.hero-slide-info'), [{ opacity: 0, transform: `translateX(${sign * 30}px)` }, { opacity: 1, transform: 'translateX(0)' }], 470, 100)
      ]);
    } finally {
      if (active === run) cancel();
    }
  }
  preference.addEventListener('change', event => { if (event.matches) cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  document.addEventListener('sany:workspace-transition', cancel);
  window.SanyHeroMotion = { show, cancel, preload };
})();
