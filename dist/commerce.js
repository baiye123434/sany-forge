'use strict';
(() => {
  const products = window.SANY_PRODUCTS;
  const storageKey = 'sany-showcase-requests-v1';
  const dialog = document.querySelector('#inquiryDialog');
  const form = document.querySelector('#inquiryForm');
  const list = document.querySelector('#requestList');
  const errorBox = document.querySelector('#inquiryError');
  const productSelect = document.querySelector('#inquiryProduct');
  const modeNames = { buy: '购买', rent: '租赁' };
  const planNames = { full: '全款购买', finance: '融资方案咨询', undecided: '尚未确定' };
  let mode = 'buy';
  let editId = null;
  let toastTimer;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const productOf = key => products.find(product => product.key === key);
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  function toast(message) {
    const element = document.querySelector('#toast');
    clearTimeout(toastTimer);
    element.textContent = message;
    element.classList.add('is-visible');
    toastTimer = setTimeout(() => element.classList.remove('is-visible'), 5000);
  }

  /* 本地保存与导入共用校验；只接收明确字段，不信任备份中的 HTML 或未知型号。 */
  function validate(record) {
    if (!record || typeof record !== 'object') throw new Error('需求记录格式不正确。');
    const string = (key, max, required = true) => {
      if (typeof record[key] !== 'string' || record[key].length > max || (required && !record[key].trim())) {
        throw new Error('请完整填写联系人、地点与项目需求，并检查文本长度。');
      }
      return record[key].trim();
    };
    if (!productOf(record.product) || !Object.hasOwn(modeNames, record.mode) || !['saved', 'archived'].includes(record.status)) {
      throw new Error('存在不支持的设备、租购方式或状态。');
    }
    if (!Number.isInteger(record.quantity) || record.quantity < 1 || record.quantity > 999) throw new Error('数量需要是 1–999 的整数。');
    if (typeof record.id !== 'string' || !/^[\w-]{1,100}$/.test(record.id)) throw new Error('需求编号无效。');
    if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date)) ||
      new Date(record.date).toISOString().slice(0, 10) !== record.date) throw new Error('请填写有效日期。');
    if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('记录时间无效。');
    const phone = string('phone', 30);
    if (!/^[+\d()\s-]{6,30}$/.test(phone) || phone.replace(/\D/g, '').length < 6) throw new Error('请输入有效联系电话，至少包含 6 位数字。');
    if (record.mode === 'rent' && (!Number.isInteger(record.duration) || record.duration < 1 || record.duration > 120)) throw new Error('租期需要是 1–120 个月的整数。');
    if (record.mode === 'buy' && !Object.hasOwn(planNames, record.plan)) throw new Error('请选择购买方式。');
    return {
      id: record.id, product: record.product, mode: record.mode, status: record.status,
      quantity: record.quantity, date: record.date, location: string('location', 100),
      contact: string('contact', 40), phone, notes: string('notes', 1000, false),
      plan: record.mode === 'buy' ? record.plan : '', duration: record.mode === 'rent' ? record.duration : null,
      createdAt: record.createdAt, updatedAt: record.updatedAt
    };
  }

  function validateList(records) {
    if (!Array.isArray(records) || records.length > 200) throw new Error('每份备份最多包含 200 条需求。');
    const clean = records.map(validate);
    if (new Set(clean.map(record => record.id)).size !== clean.length) throw new Error('备份中有重复的需求编号。');
    return clean;
  }

  function read() {
    const raw = localStorage.getItem(storageKey);
    return raw ? validateList(JSON.parse(raw)) : [];
  }

  function save(records) {
    const clean = validateList(records);
    localStorage.setItem(storageKey, JSON.stringify(clean));
    render();
  }

  function render() {
    let records;
    try { records = read(); }
    catch {
      list.innerHTML = '<div class="empty-requests"><h4>暂时无法读取本地需求</h4><p>已有内容未被覆盖。请检查浏览器存储权限；如数据异常，先导出备份保留原始内容。</p></div>';
      return;
    }
    document.querySelector('#requestCount').textContent = records.filter(record => record.status === 'saved').length;
    if (!records.length) {
      list.innerHTML = '<div class="empty-requests"><span>＋</span><h4>下一台装备，从一个需求开始。</h4><p>选好机型后，点击“购买”或“租赁”。你的需求会保存在这里。</p><a class="text-button" href="#products">去选择装备 ↗</a></div>';
      return;
    }
    list.innerHTML = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(record => {
      const product = productOf(record.product);
      const archived = record.status === 'archived';
      return `<article class="request-card${archived ? ' is-archived' : ''}">
        <img src="${product.image}" alt="${product.code}" />
        <div class="request-info"><div><span class="request-kind">${modeNames[record.mode]}</span><span class="request-status">${archived ? '已归档' : '已保存 · 未发送'}</span></div>
          <h4>${product.code}<small>${product.name}</small></h4>
          <p>${record.quantity} 台 · ${escape(record.location)} · ${escape(record.date)}${record.mode === 'rent' ? ` 起租 · ${record.duration} 个月` : ' 期望交付'}</p>
          <p class="request-meta">${escape(record.contact)} · ${escape(record.phone)} · ${record.mode === 'rent' ? '租金 / 押金待确认' : planNames[record.plan]}</p>
        </div>
        <div class="request-actions">
          <button type="button" data-edit-request="${record.id}">查看 / 编辑</button>
          <button type="button" data-export-request="${record.id}">导出需求单 ↗</button>
          <button type="button" data-archive-request="${record.id}">${archived ? '恢复需求' : '归档'}</button>
        </div>
      </article>`;
    }).join('');
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll('[data-inquiry-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inquiryMode === mode)));
    document.querySelector('#inquiryTitle').textContent = `${editId ? '编辑' : '创建'}${modeNames[mode]}需求`;
    document.querySelector('#saveInquiry').textContent = `保存${modeNames[mode]}需求`;
    document.querySelector('#dateLabel').textContent = mode === 'rent' ? '计划起租日期' : '期望交付日期';
    document.querySelector('#planField').hidden = mode !== 'buy';
    form.elements.plan.disabled = mode !== 'buy';
    document.querySelector('#durationField').hidden = mode !== 'rent';
    form.elements.duration.disabled = mode !== 'rent';
    form.elements.duration.required = mode === 'rent';
    document.querySelector('#quoteLabel').textContent = mode === 'rent' ? '租金、押金与设备供应待确认。' : '整机报价待询价。';
  }

  function open(nextMode, productKey, record) {
    form.reset();
    errorBox.textContent = '';
    editId = record ? record.id : null;
    productSelect.value = productKey;
    form.elements.date.min = record ? '' : today();
    if (record) {
      ['product', 'quantity', 'date', 'plan', 'location', 'contact', 'phone', 'notes'].forEach(key => { form.elements[key].value = record[key]; });
      form.elements.duration.value = record.duration || 1;
    }
    setMode(nextMode);
    dialog.showModal();
    document.body.classList.add('dialog-open');
  }

  function close() { dialog.close(); }
  dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
  document.querySelector('#closeInquiry').addEventListener('click', close);
  document.querySelector('#cancelInquiry').addEventListener('click', close);
  productSelect.innerHTML = products.map(product => `<option value="${product.key}">${product.code} · ${product.name}</option>`).join('');

  form.addEventListener('submit', event => {
    event.preventDefault();
    errorBox.textContent = '';
    try {
      const current = read();
      const previous = editId ? current.find(record => record.id === editId) : null;
      if (editId && !previous) throw new Error('该需求已变更，请关闭表单后重新打开。');
      const values = Object.fromEntries(new FormData(form));
      const now = new Date().toISOString();
      const record = validate({
        ...values, quantity: Number(values.quantity), duration: mode === 'rent' ? Number(values.duration) : null,
        mode, plan: values.plan || '', id: editId || `REQ-${window.SanyRequestId.create()}`,
        status: previous?.status || 'saved', createdAt: previous?.createdAt || now, updatedAt: now
      });
      if (!previous && record.date < today()) throw new Error('计划日期不能早于今天。');
      save(previous ? current.map(item => item.id === editId ? record : item) : [...current, record]);
      close();
      document.querySelector('#requests').scrollIntoView({ behavior: 'instant', block: 'start' });
      toast('需求已保存到本机，尚未发送给供应方。');
    } catch (error) {
      errorBox.textContent = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
        ? '无法写入本地存储，请检查权限或可用空间。表单内容仍保留。' : error.message;
    }
  });

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  document.addEventListener('click', event => {
    const inquiry = event.target.closest('[data-inquiry]');
    if (inquiry) {
      open(inquiry.dataset.inquiry, inquiry.dataset.product || document.body.dataset.activeProduct);
      return;
    }
    const modeButton = event.target.closest('[data-inquiry-mode]');
    if (modeButton) { setMode(modeButton.dataset.inquiryMode); return; }
    const button = event.target.closest('[data-edit-request], [data-export-request], [data-archive-request]');
    if (!button) return;
    try {
      const records = read();
      const id = button.dataset.editRequest || button.dataset.exportRequest || button.dataset.archiveRequest;
      const record = records.find(item => item.id === id);
      if (!record) { render(); toast('需求已变更，请重新选择。'); return; }
      if (button.dataset.editRequest) open(record.mode, record.product, record);
      if (button.dataset.archiveRequest) {
        save(records.map(item => item.id === id ? { ...item, status: item.status === 'saved' ? 'archived' : 'saved', updatedAt: new Date().toISOString() } : item));
        toast(record.status === 'saved' ? '已归档，可随时恢复。' : '已恢复需求。');
      }
      if (button.dataset.exportRequest) {
        const product = productOf(record.product);
        const content = [
          `三一装备 · ${modeNames[record.mode]}需求单`, '本机整理，未发送；不构成合同或订单。', '',
          `编号：${record.id}`, `设备：${product.code} ${product.name}`, `数量：${record.quantity} 台`,
          `计划日期：${record.date}`, record.mode === 'rent' ? `计划租期：${record.duration} 个月` : `购买方式：${planNames[record.plan]}`,
          `作业地点：${record.location}`, `联系人：${record.contact}`, `联系电话：${record.phone}`,
          `项目需求：${record.notes || '未填写'}`, '', '整机报价 / 租金 / 押金 / 供应及交付：待供应方确认。',
          `官方资料：${product.sourceUrl}`
        ].join('\r\n');
        download(`${product.code}-${modeNames[record.mode]}需求单.txt`, '\ufeff' + content, 'text/plain;charset=utf-8');
      }
    } catch (error) { toast(`未完成操作：${error.message}`); }
  });

  document.querySelector('#exportRequests').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(storageKey) || '[]';
      let records;
      try { records = validateList(JSON.parse(raw)); }
      catch {
        download('三一租购需求-原始数据备份.txt', raw, 'text/plain;charset=utf-8');
        toast('数据格式异常，已导出原始内容供恢复。');
        return;
      }
      download(`三一租购需求-${today()}.json`, JSON.stringify({ format: 'sany-requests', schema: 1, version: window.SANY_RELEASE.version, records }, null, 2), 'application/json');
    } catch { toast('无法读取本地存储，请检查浏览器权限。'); }
  });
  const fileInput = document.querySelector('#requestFile');
  document.querySelector('#importRequests').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('备份文件不能超过 2 MB。');
      const data = JSON.parse(await file.text());
      if (data.format !== 'sany-requests' || data.schema !== 1) throw new Error('请选择本版导出的需求备份；旧版订单库不支持直接导入。');
      const imported = validateList(data.records);
      const existing = read();
      const ids = new Set(existing.map(record => record.id));
      const added = imported.filter(record => !ids.has(record.id));
      save([...existing, ...added]);
      toast(`导入 ${added.length} 条需求，跳过 ${imported.length - added.length} 条已有记录。`);
    } catch (error) { toast(`导入失败，现有需求未改变：${error.message}`); }
    finally { fileInput.value = ''; }
  });
  window.addEventListener('storage', event => { if (event.key === storageKey) render(); });
  render();
})();
