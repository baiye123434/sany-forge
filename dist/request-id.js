(() => {
  'use strict';

  /*
   * 局域网客户页通过普通 HTTP 打开时，randomUUID 可能因安全上下文限制不可用。
   * 请求编号只用于幂等去重：优先使用原生 UUID，否则用仍可用的随机字节生成 UUID v4；
   * 极老浏览器再退回到时间与伪随机字节，避免消息在浏览器端直接发送失败。
   */
  function create() {
    const provider = window.crypto;
    if (typeof provider?.randomUUID === 'function') return provider.randomUUID();

    const bytes = new Uint8Array(16);
    if (typeof provider?.getRandomValues === 'function') provider.getRandomValues(bytes);
    else {
      const seed = Date.now();
      for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256) ^ (seed >> (index % 6));
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  window.SanyRequestId = Object.freeze({ create });
})();
