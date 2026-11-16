/* 保留按钮的按压反馈；原有合成音已移除，消息提醒由员工门户的本地音频设置负责。 */
(() => {
  'use strict';
  const timers = new WeakMap();
  const selector = 'button, a[href], [role="button"], input[type="button"], input[type="submit"], summary';
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const element = event.target?.closest?.(selector);
    if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest('[inert]')) return;
    clearTimeout(timers.get(element));
    element.setAttribute('data-ui-pressed', 'true');
    timers.set(element, setTimeout(() => { element.removeAttribute('data-ui-pressed'); timers.delete(element); }, 160));
  }, true);
  /* 兼容历史组件的静音查询，不再创建振荡器或访问任何外部音效路径。 */
  window.SanyFeedback = { setMuted() {}, isMuted: () => true };
})();
