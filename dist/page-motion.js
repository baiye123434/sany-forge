/* 路由先准备数据，再一次性换画面。每次操作有独立序号，旧响应/旧动画不能覆盖新页面。
 * 优先使用浏览器的视图快照交叉淡化，不复制表单或敏感内容；不支持时退化为短淡出/淡入。 */
(() => {
  'use strict';
  let serial = 0, active = null, fallback = null, pendingTimer = null, lockedTarget = null;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* 原生转场快照位于 dialog 之上；品牌开屏期间只更新背后的业务页，不能让首页快照盖住组装。 */
  const quiet = () => document.documentElement.dataset.pageTransitions !== 'animated' || preference.matches || document.hidden || !!document.querySelector('.boot-screen[open]')
    || !!(document.documentElement.dataset.workspaceMotion && document.documentElement.dataset.workspaceMotion !== 'idle');
  const progress = document.createElement('div');
  progress.className = 'route-progress'; progress.hidden = true;
  progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  progress.textContent = '正在载入页面…'; document.body.append(progress);
  function stopAnimation() { active?.skipTransition(); active = null; fallback?.cancel(); fallback = null; }
  /* 退出登录必须立即撤销旧快照与迟到更新，不能等注销网络请求或过渡结束才遮住工作资料。 */
  function cancel() {
    serial++; stopAnimation(); clearTimeout(pendingTimer); progress.hidden = true;
    if (lockedTarget) { lockedTarget.inert = false; lockedTarget.removeAttribute('aria-busy'); lockedTarget = null; }
    document.documentElement.dataset.pageMotion = 'idle';
  }
  function begin(target = document.querySelector('#main')) {
    const id = ++serial;
    stopAnimation(); clearTimeout(pendingTimer); progress.hidden = true;
    const focusWasInside = target.contains(document.activeElement);
    target.inert = true; target.setAttribute('aria-busy', 'true'); lockedTarget = target;
    document.documentElement.dataset.pageMotion = 'pending';
    pendingTimer = setTimeout(() => { if (id === serial) progress.hidden = false; }, 180);
    const current = () => id === serial;
    function release() {
      if (!current()) return;
      clearTimeout(pendingTimer); progress.hidden = true;
      target.inert = false; target.removeAttribute('aria-busy');
      if (lockedTarget === target) lockedTarget = null;
    }
    async function commit(update, options = {}) {
      if (!current()) return false;
      let applied = false, callbackStarted = false;
      const apply = () => {
        if (!current() || callbackStarted) return;
        callbackStarted = true;
        /* 同步更新前解除 inert，保证新表单/侧栏的主动聚焦有效；本回调中不会插入用户事件。 */
        release(); update(); applied = true;
        if (options.top) window.scrollTo({ top: 0, behavior: 'instant' });
        const selected = options.focus && target.querySelector(options.focus);
        if (selected) { selected.focus({ preventScroll: true }); selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); }
        else if (focusWasInside && document.activeElement === document.body) target.focus({ preventScroll: true });
      };
      try {
        if (quiet()) apply();
        else if (document.startViewTransition) {
          document.documentElement.dataset.pageMotion = 'transition';
          let transition;
          try {
            transition = document.startViewTransition(apply); active = transition;
            /* ready 可能因页面隐藏或快速连点被拒绝；取消不是业务失败，更新回调仍由序号保护。 */
            transition.ready.catch(() => {});
            /* 必须立即接管 finished 的拒绝；若业务更新先抛错，也不能留下未处理的动画 Promise。 */
            const finished = transition.finished.catch(() => {});
            await transition.updateCallbackDone;
            await finished;
          } catch (error) {
            /* 浏览器拒绝快照时仍可换页，但业务回调自身的错误必须外抛，绝不能重复执行更新。 */
            if (callbackStarted) throw error;
            apply();
          } finally { if (active === transition) active = null; }
        } else {
          const outgoing = target.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'ease-out', fill: 'forwards' });
          fallback = outgoing; await outgoing.finished.catch(() => {});
          if (!current()) return false;
          outgoing.cancel(); apply();
          const incoming = quiet() ? null : target.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.22,1,.36,1)' });
          fallback = incoming; await incoming?.finished.catch(() => {});
          if (current()) fallback = null;
        }
        return applied;
      } finally {
        if (current()) { release(); document.documentElement.dataset.pageMotion = 'idle'; }
      }
    }
    return { current, commit };
  }
  function swap(update, options = {}) { return begin().commit(update, options); }
  function reveal(element) {
    if (!element || quiet()) return;
    element.animate([{ opacity: .35, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  preference.addEventListener('change', event => { if (event.matches) stopAnimation(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAnimation(); });
  /* 手动重播可能发生在一次页面过渡中途，立即结束既有快照；后续数据更新由上面的开屏守卫处理。 */
  document.addEventListener('sany:boot-open', stopAnimation);
  /* 双窗口分组件运动期间停止整页快照，否则快照会遮住真实组件的退场与入场。 */
  document.addEventListener('sany:workspace-transition', stopAnimation);
  window.SanyMotion = { begin, swap, reveal, cancel };
})();
