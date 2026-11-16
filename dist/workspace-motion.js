/* 双端切换只移动真实组件，不复制表单或工作资料。桌面主进程负责窗口顺序，
 * 本模块负责可取消的退场/入场；任何中断最终都会恢复原有布局与可操作性。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = /Electron\//.test(navigator.userAgent);
  let current = 0, animations = [], safetyTimer = null, previousInert = false, locked = false;
  const quiet = () => preference.matches || typeof Element.prototype.animate !== 'function';
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
  };
  function cancel() { for (const animation of animations) animation.cancel(); animations = []; }
  function restore(token = current) {
    if (token !== current) return false;
    const changed = root.dataset.workspaceMotion !== 'idle';
    clearTimeout(safetyTimer); safetyTimer = null; cancel();
    root.dataset.workspaceMotion = 'idle';
    if (locked) { root.inert = previousInert; locked = false; }
    if (changed) document.dispatchEvent(new Event('sany:workspace-ready'));
    return true;
  }
  function begin(token, phase) {
    restore(); current = token;
    previousInert = root.inert; root.inert = true; locked = true;
    root.dataset.workspaceMotion = phase;
    document.dispatchEvent(new Event('sany:workspace-transition'));
    /* 主窗口关闭、失焦或渲染器通讯失败时，不能让正常页面永久留在画外。 */
    safetyTimer = setTimeout(() => restore(token), 6500);
  }
  function prepare(token) { begin(token, 'prepared'); return true; }
  function refresh(token) {
    if (token !== current || !locked) return false;
    cancel(); root.dataset.workspaceMotion = 'prepared'; return true;
  }
  function components() {
    const result = [];
    const excluded = 'script,style,link,meta,.skip-link,.route-progress,[hidden]';
    function split(element, depth) {
      if (element.matches(excluded) || !visible(element)) return;
      const children = [...element.children].filter(child => !child.matches(excluded) && visible(child));
      /* 卡片、表单和复杂媒体保持整体；其余栅格按真实子组件拆分，避免把每个字当成碎片。 */
      const atomic = element.matches('a,button,form,table,canvas,svg,img,video,input,select,textarea,.card,.product-card,.hero-carousel,.access-assembly,[role="dialog"]');
      if (!atomic && depth < 3 && children.length && result.length < 65) children.forEach(child => split(child, depth + 1));
      else result.push(element);
    }
    [...document.body.children].forEach(element => split(element, 0));
    return result;
  }
  function offset(element, index) {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const top = element.closest('.topbar,.access-header'), bottom = element.closest('.footer');
    /* 位移按视口与组件真实边界计算，保证缩小后的整个组件越过画外，而非仅偏移几十像素。 */
    if (top) return { x: (cx - innerWidth / 2) * .15, y: -(rect.bottom + 96) };
    if (bottom) return { x: (cx - innerWidth / 2) * .1, y: innerHeight - rect.top + 96 };
    const left = Math.abs(cx - innerWidth / 2) < 24 ? index % 2 === 0 : cx < innerWidth / 2;
    return { x: left ? -(rect.right + 120) : innerWidth - rect.left + 120, y: (cy - innerHeight / 2) * .28 };
  }
  async function move(token, incoming) {
    if (token !== current || !locked) return false;
    cancel(); root.dataset.workspaceMotion = incoming ? 'entering' : 'leaving';
    const items = components();
    root.dataset.workspaceComponents = String(items.length);
    if (quiet() || !items.length) {
      if (incoming) restore(token); else root.dataset.workspaceMotion = 'departed';
      return true;
    }
    const pending = items.map((element, index) => {
      const { x, y } = offset(element, index);
      const outside = `translate3d(${x}px, ${y}px, 0) scale(.78)`;
      const frames = incoming
        ? [{ transform: outside, opacity: .12 }, { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 }]
        : [{ transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 }, { transform: 'scale(.94)', opacity: 1, offset: .2 }, { transform: outside, opacity: .08 }];
      const animation = element.animate(frames, {
        duration: incoming ? 540 : 380, delay: Math.min(index * 13, 100),
        easing: incoming ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.6,0,.78,.28)', fill: 'both'
      });
      animations.push(animation); return animation.finished.catch(() => false);
    });
    await Promise.all(pending);
    if (token !== current || !locked) return false;
    if (incoming) restore(token); else root.dataset.workspaceMotion = 'departed';
    return true;
  }
  function leave(token) { begin(token, 'leaving'); return move(token, false); }
  function enter(token) { return move(token, true); }
  preference.addEventListener('change', event => { if (event.matches) restore(); });
  window.addEventListener('pagehide', () => restore());
  window.SanyWindowMotion = { prepare, refresh, leave, enter, restore, isCurrent: token => token === current && locked };
  root.dataset.workspaceMotion = 'idle';

  /* 浏览器保留用户点击时的原生新标签打开，避免等待动画后被弹窗拦截。
   * noopener 继续隔离身份；源标签短退场后复位，目标标签首次加载时独立入场。 */
  if (!desktop) {
    let browserToken = 1;
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a.window-switch');
      if (!link) return;
      const token = ++browserToken;
      void leave(token).finally(() => restore(token));
    });
    if (new URLSearchParams(location.search).has('workspace')) {
      window.addEventListener('load', () => {
        if (document.querySelector('.boot-screen[open]') || preference.matches) return;
        const token = ++browserToken; prepare(token); void enter(token);
      }, { once: true });
    }
  }
})();
