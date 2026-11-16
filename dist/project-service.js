/* 项目需求与本机客服共用后端权限校验，查询链接只用于换取短期会话，不进入消息正文。 */
(() => {
  'use strict';
  window.SanyProjects = { create };

  function create(bridge) {
    const { api, esc, field, textarea, select, options, formEnd, empty, time, toast, filesFrom, downloadFile, showModal, getState, openOrder, downloadText } = bridge;
    const $ = (selector, root = document) => root.querySelector(selector);
    const labels = { submitted: '待审核', reviewing: '审核与沟通中', needs_info: '待甲方补充', accepted: '需求已确认', closed: '已完成', confirmed: '已确认报价', preparing: '备货中', shipped: '待收货', delivered: '已交付', cancelled: '已取消' };
    const pbutton = (action, label, cls = '', attrs = '') => `<button type="button" class="btn ${cls}" data-project-action="${action}" ${attrs}>${label}</button>`;
    const badge = (status, kind = 'project') => `<span class="pill ${['accepted', 'closed', 'delivered'].includes(status) ? 'green' : ['needs_info', 'submitted'].includes(status) ? 'orange' : 'blue'}">${esc(kind === 'order' && status === 'submitted' ? '待受理' : labels[status] || status)}</span>`;
    const main = () => $('#main');
    let projectPhone = '';
    let epoch = 0, detail = null, receipt = null, activeChat = null, inbox = null, selected = new Map(), pickerGroup = '', pickerSearch = '', pickerLimit = 60;

    function stop() {
      epoch++; projectPhone = '';
      if (activeChat) clearTimeout(activeChat.timer);
      if (inbox) clearTimeout(inbox.timer);
      activeChat = null; inbox = null; detail = null;
    }
    function saved() {
      try { const value = JSON.parse(localStorage.getItem('sany-project-receipts-v1') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
    }
    function remember(value) {
      localStorage.setItem('sany-project-receipts-v1', JSON.stringify([value, ...saved().filter(item => item.id !== value.id)].slice(0, 50)));
    }
    function linkFor(key) { return `${location.origin}/?workspace=customer#receipt=${encodeURIComponent(key)}`; }
    function fileInput(label = '工程资料（选填）') {
      return `<label class="field wide"><span>${esc(label)}</span><input type="file" name="materials" accept=".docx,application/pdf,image/jpeg,image/png,image/webp" multiple><small>Word（.docx）、PDF、JPG / PNG / WebP；最多 4 份，每份不超过 4 MB。请勿上传涉密图纸或带宏文件；附件仅下载，不在软件内执行。</small></label>`;
    }
    function filesHTML(files, scope = 'detail') {
      return (files || []).map(file => pbutton('file', `↧ ${esc(file.name)}${file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ''}`, 'small project-file', `data-id="${esc(file.id)}" data-name="${esc(file.name)}" data-scope="${scope}"`)).join('');
    }
    function renderChatFiles(form) {
      const host = $('.project-chat-pending', form); if (!host) return;
      const names = [...(form.elements.materials?.files || [])].map(file => file.name);
      host.hidden = !names.length; host.textContent = names.length ? `待发送：${names.join('、')}` : '';
    }
    /* 通过 DataTransfer 合并文件选择和剪贴板截图，让既有附件校验与上传链路保持一致。 */
    function pasteChatImages(form, images) {
      const input = form.elements.materials; if (!input) throw new Error('保密项目不接受图片附件。');
      const current = [...(input.files || [])]; if (current.length + images.length > 4) throw new Error('一次最多发送 4 份附件。');
      const transfer = new DataTransfer(); current.forEach(file => transfer.items.add(file));
      images.forEach((file, index) => transfer.items.add(file.name ? file : new File([file], `粘贴图片-${Date.now()}-${index + 1}.${file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'}`, { type: file.type || 'image/png' })));
      input.files = transfer.files; renderChatFiles(form);
    }
    function products() { return getState().products.filter(product => !product.exhibitOnly && product.published !== false); }
    function itemProduct(item) { return item.product || products().find(product => product.id === item.productId) || { code: item.code || item.productId, name: item.name || '目录设备', image: item.image || '' }; }
    function itemList(items) {
      return `<div class="project-item-summary">${(items || []).map(item => {
        const product = itemProduct(item);
        return `<div class="project-summary-row">${product.image ? `<img src="${esc(product.image)}" alt="">` : ''}<div><strong>${esc(product.code)} · ${esc(product.name)}</strong><small>${esc(product.category || '项目选用设备')}</small></div><b>× ${esc(item.quantity)}</b></div>`;
      }).join('') || '<p class="muted">未指定设备，由工作人员根据需求协助选型。</p>'}</div>`;
    }

    async function renderProjectPage() {
      if (window.SanyCustomers) {
        main().innerHTML = '<section class="wrap"><h1>项目需求</h1><p>请先登录客户账号，再填写项目需求。</p><a class="btn" href="#account">客户登录 / 注册</a></section>';
        if (!await window.SanyCustomers.requireLogin()) return;
      }
      stop(); selected = new Map(); pickerGroup = ''; pickerSearch = ''; pickerLimit = 60;
      main().innerHTML = `<section class="wrap project-page"><div class="section-top"><div><p class="eyebrow">PROJECT REQUIREMENTS</p><h1>把工程需求，交给专业的人。</h1><p>上传工程资料，或只提供设备清单。工作人员审核后，通过本机客服与你确认需求。</p></div><a class="btn" href="#catalog">返回设备目录</a></div>
        <div class="project-steps" aria-label="项目流程"><span><b>01</b> 提交需求</span><span><b>02</b> 审核与沟通</span><span><b>03</b> 确认设备方案</span></div>
        <div class="project-layout"><section class="panel"><h2>新建自定义项目工单</h2><p class="muted">这是工程需求申请，不代表已下单或付款。设备数量与方案由双方确认。</p>
        <form data-project-form="create"><div class="form-grid">${select('用户类型', 'customerType', [['personal', '个人'], ['enterprise', '企业']], 'personal')}${field('项目名称', 'title', 'text', '', 'maxlength="120" placeholder="例如：产业园基础施工设备需求" required')}${field('甲方 / 项目联系人', 'contact', 'text', '', 'maxlength="40" autocomplete="name" required')}${field('联系电话', 'phone', 'tel', '', 'maxlength="30" autocomplete="tel" required')}
        <label class="project-confidential wide"><input type="checkbox" name="confidential" data-project-input="confidential"><span><strong>保密项目：只提交设备清单</strong><small>不上传工程图纸、文件和设计说明。选好设备与数量即可，由客服进一步确认。</small></span></label>
        ${textarea('项目需求 / 使用场景（选填）', 'notes', '', 'maxlength="4000" placeholder="作业工况、配置要求、交付安排等；请勿填写涉密内容。"')}
        <div class="wide" id="projectUpload">${fileInput()}</div></div>
        <section class="project-picker"><div class="section-top"><div><h3>需要哪些设备？</h3><p class="muted">可跨类别勾选，筛选不会清空清单。最多 50 种，每种 1–999 台。</p></div><span id="projectSelectedCount" class="pill red">已选 0 种</span></div>
        <div class="project-picker-tools"><label class="field"><span>设备大类</span><select data-project-input="group" aria-label="项目设备大类"><option value="">全部类别</option>${options(window.SanyCatalog.groups.map(group => [group.id, group.label]), '')}</select></label><label class="field"><span>搜索型号或名称</span><input type="search" data-project-input="search" placeholder="例如 SY、挖掘机、零件" aria-label="搜索项目设备"></label></div>
        <div id="projectPickerResults" class="project-picker-results"></div><div class="project-selection"><h4>已选设备清单</h4><div id="projectSelection"></div></div></section>
        <label class="check"><input type="checkbox" name="remember"><span>将查询凭证保存在本浏览器（共用电脑请勿勾选）。</span></label>${formEnd('提交项目需求')}</form></section>
        <aside class="project-sidebar"><section class="panel"><div class="actions"><h3>我提交的项目</h3>${pbutton('my-projects-refresh','刷新','small')}</div><p class="muted">查看当前账号提交的项目与处理进度。</p><div id="myProjectList" aria-live="polite">正在读取项目…</div></section>
        <div class="notice"><strong>本机客服演示</strong><br>同一台电脑打开客户窗口与工作人员窗口，即可实时收发消息和工单卡片。尚未部署服务器，不能与其他电脑跨机通信。</div></aside></div></section>`;
      renderPicker(); renderSelection(); void renderMyProjects();
    }
    async function renderMyProjects(){
      const target=$('#myProjectList'),token=window.SanyCustomers?.token();if(!target||!token)return;
      try{const result=await api('/api/customer/records','GET',undefined,token);if(!target.isConnected||token!==window.SanyCustomers?.token())return;const rows=result.records.filter(r=>r.kind==='project');target.innerHTML=rows.map(r=>`<article class="project-saved-item"><div class="cu-record-heading"><strong>${esc(r.title)}</strong>${badge(r.status)}</div><small>${esc(r.number)} · ${esc(time(r.createdAt))}</small><div class="project-item-actions">${pbutton('my-project-open','查看项目','small',`data-id="${esc(r.id)}"`)}<button type="button" class="btn small cu-record-chat" data-cu="record-chat" data-kind="project" data-id="${esc(r.id)}">联系客服<span class="cu-unread" hidden></span></button></div></article>`).join('')||'<p class="muted">暂无项目，提交左侧需求后会显示在这里。</p>';}catch(e){if(target.isConnected)target.textContent=e.message;}
    }
    function renderSaved() {
      const target = $('#projectSaved'); if (!target) return;
      target.innerHTML = saved().map(item => `<div class="project-saved-item"><strong>${esc(item.title)}</strong><small>${esc(item.number || item.id)} · ${esc(time(item.at))}</small><div class="actions">${pbutton('saved', '查看项目', 'small', `data-id="${esc(item.id)}"`)}${pbutton('forget', '移除本机凭证', 'small link', `data-id="${esc(item.id)}"`)}</div></div>`).join('') || '<p class="muted">暂无主动保存的项目凭证。</p>';
    }
    function renderPicker() {
      const target = $('#projectPickerResults'); if (!target) return;
      const query = pickerSearch.trim().toLowerCase(), list = products().filter(product => (!pickerGroup || window.SanyCatalog.groupFor(product) === pickerGroup) && (!query || `${product.code} ${product.name} ${product.category} ${product.subcategory}`.toLowerCase().includes(query)));
      target.innerHTML = `<p class="muted project-picker-count">匹配 ${list.length} 款${list.length > pickerLimit ? `，当前显示前 ${pickerLimit} 款；可继续加载或搜索型号` : ''}</p>${list.slice(0, pickerLimit).map(product => `<label class="project-pick-row"><input type="checkbox" data-project-input="pick" data-id="${esc(product.id)}" ${selected.has(product.id) ? 'checked' : ''}><img src="${esc(product.image || '')}" alt="" loading="lazy"><span><strong>${esc(product.code)}</strong><small>${esc(product.name)}</small></span><em>${esc(window.SanyCatalog.groups.find(group => group.id === window.SanyCatalog.groupFor(product))?.label || '其他装备')}</em></label>`).join('')}${list.length ? (list.length > pickerLimit ? pbutton('picker-more', '继续显示更多设备', 'small project-picker-more') : '') : empty('没有匹配的设备', '试试其他类别或更短的型号。')}`;
    }
    function renderSelection() {
      const target = $('#projectSelection'); if (!target) return;
      $('#projectSelectedCount').textContent = `已选 ${selected.size} 种`;
      target.innerHTML = [...selected].map(([id, quantity]) => {
        const product = products().find(value => value.id === id);
        if (!product) return '';
        return `<div class="project-selected-row"><div><strong>${esc(product.code)}</strong><small>${esc(product.name)}</small></div><label>数量<input type="number" min="1" max="999" step="1" value="${quantity}" data-project-input="quantity" data-id="${esc(id)}" aria-label="${esc(product.code)} 数量"></label>${pbutton('remove-item', '移除', 'small link', `data-id="${esc(id)}"`)}</div>`;
      }).join('') || '<p class="muted">尚未选择设备。普通项目可提交资料后协助选型；保密项目至少勾选一种设备。</p>';
    }
    function selectedItems() {
      return [...selected].map(([productId, quantity]) => {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('设备数量需为 1–999 的整数。');
        return { productId, quantity };
      });
    }
    function renderReceipt(result, save) {
      const project = result.project;
      receipt = { id: project.id, number: project.number || project.id, title: project.title, phone: project.phone, code: result.accessCode, accessKey: result.accessKey, at: project.createdAt, token: result.token };
      if (save) { try { remember(receiptForStorage()); } catch { toast('提交成功，但浏览器禁止保存凭证，请下载查询链接。'); } }
      showModal('项目需求已提交', `<div class="project-receipt"><span class="pill green">提交成功 · 等待审核</span><h3>${esc(project.title)}</h3><p>项目工单号</p><strong class="project-receipt-number">${esc(receipt.number)}</strong><p class="muted">工作人员审核后可在关联客服中沟通。请先保存查询链接，之后无需重复输入长凭证。</p></div><div class="actions project-receipt-actions">${pbutton('receipt-copy', '复制查询链接', 'primary')}${pbutton('receipt-download', '下载查询凭证')}${pbutton('receipt-save', '保存到本浏览器')}${pbutton('receipt-open', '查看项目进度')}</div><div class="notice warn">查询链接包含加密访问凭证。持有链接的人可查看该项目及附件；请勿公开传播。链接仅对当前本机数据库有效，其他电脑不能访问本机业务。</div><details class="project-fallback"><summary>查看备用手动查询凭证</summary><dl class="facts"><div><dt>项目编号</dt><dd>${esc(receipt.number)}</dd></div><div><dt>查询凭证</dt><dd class="project-secret">${esc(receipt.code)}</dd></div></dl></details>`);
    }
    function receiptForStorage() { const { token, ...safe } = receipt; return safe; }
    async function openProject(id, token, customer = true) {
      const request = ++epoch;
      const { project } = await api(`/api/projects/${encodeURIComponent(id)}`, 'GET', undefined, token);
      if (request !== epoch) return;
      const role = getState().user?.role, canChat = customer || ['admin', 'service'].includes(role);
      showModal('自定义项目工单', `<div class="section-top"><div><p class="eyebrow">${project.confidential ? '保密项目 · 设备清单模式' : 'PROJECT REQUIREMENTS'}</p><h3>${esc(project.title)}</h3><small>${esc(project.number || project.id)}</small></div>${badge(project.status)}</div>
        <dl class="facts"><div><dt>用户类型</dt><dd>${project.customerType === 'enterprise' ? '企业' : project.customerType === 'personal' ? '个人' : '未填写（历史记录）'}</dd></div><div><dt>甲方 / 项目联系人</dt><dd>${esc(project.contact)}</dd></div><div><dt>联系电话</dt><dd>${esc(project.phone)}</dd></div><div><dt>提交时间</dt><dd>${esc(time(project.createdAt))}</dd></div><div><dt>资料模式</dt><dd>${project.confidential ? '不上传工程资料，仅提交设备清单' : '普通项目，可提交工程资料'}</dd></div></dl>
        ${project.notes ? `<div class="notice project-pre">${esc(project.notes)}</div>` : ''}<h3 class="detail-heading">需求设备清单</h3>${itemList(project.items)}
        ${(project.files || []).length ? `<h3 class="detail-heading">项目附件</h3><div class="project-files">${filesHTML(project.files)}</div>` : ''}
        ${canChat ? `<div class="project-service-callout"><div><h3>有关这个项目，直接聊。</h3><p>${project.confidential ? '仅发送文字与设备清单卡片，不上传工程资料。' : '发送资料、文字与项目卡片，沟通记录与工单关联保存。'}</p></div>${pbutton('detail-chat', customer ? '联系本机客服' : '进入项目会话', 'primary', `data-id="${esc(project.id)}" data-customer="${customer}"`)}</div>` : ''}
        ${projectAction(project, customer, role)}<h3 class="detail-heading">审核与补充记录</h3><ol class="timeline">${[...(project.history || [])].reverse().map(event => `<li><header><span>${esc(labels[event.to] || event.to)}</span><time>${esc(time(event.at))}</time></header><small>${esc(event.actor || '工作人员')}</small><p>${esc(event.note || '')}</p><div class="project-files">${filesHTML(event.files)}</div></li>`).join('')}</ol>`);
      detail = { project, token, customer };
    }
    function projectAction(project, customer, role) {
      if (customer && project.status === 'needs_info') return `<div class="action-box project-action-box"><h3>需要你补充信息</h3><p>查看下方审核意见，补充说明后重新提交。原有设备清单与记录保留。</p><form data-project-form="supplement">${textarea('补充说明', 'notes', '', 'maxlength="4000" required')}${project.confidential ? '<p class="muted">保密项目不接受附件，请勿在说明中填写涉密设计内容。</p>' : fileInput('补充材料（选填）')}${formEnd('补充并重新提交审核')}</form></div>`;
      if (customer || !['admin', 'reviewer'].includes(role)) return '';
      const transitions = { submitted: [['reviewing', '受理，进入审核沟通'], ['needs_info', '退回甲方补充']], reviewing: [['accepted', '需求确认通过'], ['needs_info', '退回甲方补充']], accepted: [['closed', '沟通完成，关闭项目工单']] };
      if (!transitions[project.status]) return '';
      return `<div class="action-box project-action-box"><h3>项目需求审核</h3><p>先审核需求，再沟通确认。不自动创建租购订单，也不自动收款。</p><form data-project-form="review">${select('本次审核操作', 'status', transitions[project.status])}${textarea('审核意见 / 处理说明', 'note', '', 'maxlength="2000" required')}${project.confidential ? '<p class="muted">保密项目全程不上传附件。</p>' : fileInput('审核材料（选填）')}${formEnd('保存审核意见')}</form></div>`;
    }
    async function renderStaffProjects(target = main()) {
      stop(); const request = epoch, element = typeof target === 'string' ? $(target) : target;
      if (!element) return;
      element.innerHTML = '<div class="loading">正在读取项目需求…</div>';
      try {
        const { projects } = await api('/api/projects', 'GET', undefined, getState().staffToken);
        if (request !== epoch || !element.isConnected) return;
        element.innerHTML = `<p class="muted">先审核工程资料与设备清单，再联系甲方确认。保密项目只查看设备需求。</p><div class="table-wrap"><table><thead><tr><th>项目 / 工单号</th><th>甲方联系人</th><th>资料 / 设备</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${projects.map(project => `<tr><td><strong>${esc(project.title)}</strong><small>${esc(project.number || project.id)}</small></td><td>${esc(project.contact)}<small>${esc(project.phone)}</small></td><td>${project.confidential ? '保密清单' : '普通项目'}<small>${(project.items || []).length} 种设备</small></td><td>${badge(project.status)}</td><td>${esc(time(project.updatedAt || project.createdAt))}</td><td>${pbutton('staff-project', ['admin', 'reviewer'].includes(getState().user?.role) ? '查看 / 审核' : '查看需求', 'small', `data-id="${esc(project.id)}"`)}</td></tr>`).join('') || '<tr><td colspan="6">尚未收到项目需求。客户可从“项目需求”入口提交。</td></tr>'}</tbody></table></div>`;
        element.dataset.projectStaffTarget = 'projects';
      } catch (error) { if (request === epoch) element.innerHTML = empty('项目列表暂时无法读取', error.message); }
    }

    /* 会话列表和聊天分别维护定时器；切换工作区或关闭弹窗后，旧响应不能重新写回界面。 */
    async function renderStaffChat(target = main()) {
      stop(); const element = typeof target === 'string' ? $(target) : target; if (!element) return;
      element.innerHTML = `<div class="section-top"><div><h2>本机客服收件箱</h2><p>接收客户从订单或项目发起的会话。客户窗口与工作人员窗口可以同时打开。</p></div><span class="pill blue">本机实时演示</span></div><div class="notice">消息约每 1.5 秒同步。未部署远程服务器；其他电脑上的独立安装拥有各自的数据。</div><div id="projectInboxStatus" class="muted" role="status"></div><div id="projectInbox" class="project-inbox"></div>`;
      inbox = { element, timer: null, signature: '', loading: false };
      await pollInbox(inbox);
    }
    async function pollInbox(context) {
      if (inbox !== context || context.loading || document.hidden || !context.element.isConnected) return;
      context.loading = true;
      try {
        const { conversations } = await api('/api/conversations', 'GET', undefined, getState().staffToken);
        if (inbox !== context) return;
        const signature = JSON.stringify(conversations);
        if (signature !== context.signature) {
          context.signature = signature;
          $('#projectInbox', context.element).innerHTML = conversations.map(conversation => {
            const record = conversation.record || {}, unread = Math.max(0, (conversation.latestSeq || 0) - (conversation.readByStaff || 0));
            return `<button type="button" class="project-inbox-row" data-project-action="staff-chat" data-kind="${esc(conversation.kind)}" data-id="${esc(conversation.recordId)}">${record.image ? `<img src="${esc(record.image)}" alt="">` : '<span class="project-file-icon" aria-hidden="true">项</span>'}<span class="project-inbox-main"><strong>${esc(record.title || record.name || '关联业务会话')}</strong><small>${esc(record.number || conversation.recordId)}</small><span>${esc(conversation.lastMessage?.text || (conversation.lastMessage?.card ? '发送了一张业务卡片' : conversation.lastMessage?.files?.length ? '发送了附件' : '新会话，等待沟通'))}</span></span><span class="project-inbox-meta">${unread ? `<b class="project-unread">${unread} 条待查看</b>` : '<small>已查看</small>'}<small>${esc(time(conversation.lastMessage?.at || conversation.updatedAt || conversation.createdAt))}</small></span></button>`;
          }).join('') || empty('暂无客服会话', '客户在订单或项目详情点击“联系本机客服”后，会话会出现在这里。');
        }
        $('#projectInboxStatus', context.element).textContent = '已连接 · 自动同步中';
      } catch (error) { if (inbox === context && $('#projectInboxStatus', context.element)) $('#projectInboxStatus', context.element).textContent = `连接暂时中断，将自动重试：${error.message}`; }
      finally { context.loading = false; if (inbox === context && !document.hidden) context.timer = setTimeout(() => pollInbox(context), 1500); }
    }
    function cardHTML(card, action = 'chat-card') {
      if (!card) return '';
      return `<button type="button" class="project-business-card" data-project-action="${action}">${card.image ? `<img src="${esc(card.image)}" alt="">` : '<span class="project-file-icon" aria-hidden="true">项</span>'}<span><strong>${esc(card.title || '关联业务记录')}</strong>${badge(card.status, card.kind)}<small>${card.kind === 'project' ? '项目工单' : '订单'}编号：${esc(card.number || card.recordId)}</small></span><i aria-hidden="true">›</i></button>`;
    }
    async function openChat(kind, recordId, token, customer = true) {
      const request = ++epoch;
      const returnToInbox = !customer && !!inbox;
      const result = await api('/api/conversations', 'POST', { kind, recordId }, token);
      if (request !== epoch) return;
      const conversation = result.conversation, record = conversation.record || {};
      /* 收件箱在弹窗打开时停止轮询，关窗后由主路由刷新当前工作区再恢复同步。 */
      if (returnToInbox) getState().dirty = true;
      showModal(customer ? '联系本机客服' : '客户会话', `<div class="project-chat"><div class="project-chat-head"><div><span class="pill blue">${customer ? '甲方 / 客户窗口' : '工作人员窗口'}</span><h3>${esc(record.title || '业务沟通')}</h3><p>仅在本机内实时通讯 · 会话与${kind === 'project' ? '项目' : '订单'}关联保存</p></div>${pbutton('chat-record', '查看关联详情', 'small')}</div>
        <div id="projectChatStatus" class="project-chat-status" role="status">正在连接会话…</div>
        <div id="projectMessages" class="project-messages" role="log" aria-label="客服消息记录" aria-live="polite" aria-relevant="additions"></div>
        <form data-project-form="chat" class="project-chat-composer">${record.confidential ? '<div class="notice">保密项目不接受文件，请勿发送涉密设计内容。</div>' : '<div class="project-compose-toolbar"><label class="project-compose-file" title="选择图片或文件"><input type="file" name="materials" accept=".docx,application/pdf,image/jpeg,image/png,image/webp" multiple><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10h-17zM3.5 6.5v-2h6l2 2h9v2"/></svg><span>文件</span></label><span>可直接粘贴截图</span></div><div class="project-chat-pending" hidden></div>'}${textarea('消息内容', 'text', '', 'maxlength="2000" placeholder="输入消息；也可以在这里粘贴图片…"')}
        <div class="project-chat-tools"><label class="check"><input type="checkbox" name="sendCard"><span>附带当前${kind === 'project' ? '项目工单' : '订单'}卡片</span></label><span class="muted">卡片只含编号、标题与状态，不包含电话和地址。</span></div>
        <div class="project-chat-send"><span class="muted">Enter 发送 · Shift + Enter 换行</span><div class="form-error" role="alert"></div><button type="submit" class="btn primary">发送消息</button></div></form></div>`);
      activeChat = { id: conversation.id, kind, recordId, token, customer, conversation, after: 0, seen: new Set(), messages: [], timer: null, loading: false, pending: null };
      await pollChat(activeChat);
    }
    function renderMessage(message, context) {
      const mine = message.sender === (context.customer ? 'customer' : 'staff');
      const oppositeRead = context.customer ? context.conversation.readByStaff : context.conversation.readByCustomer;
      return `<article class="project-message ${mine ? 'mine' : ''}" data-message-id="${esc(message.id)}" data-seq="${message.seq}"><header><strong>${esc(message.senderName || (message.sender === 'staff' ? '工作人员' : '客户'))}</strong><time>${esc(time(message.at))}</time></header><div class="project-message-bubble">${message.text ? `<p>${esc(message.text)}</p>` : ''}${message.card ? cardHTML(message.card) : ''}${message.files?.length ? `<div class="project-files">${filesHTML(message.files, 'chat')}</div>` : ''}</div>${mine ? `<small class="project-read-state">${message.seq <= (oppositeRead || 0) ? '对方已读' : '已发送'}</small>` : ''}</article>`;
    }
    async function pollChat(context) {
      if (activeChat !== context || context.loading || document.hidden || !$('#projectMessages')) return;
      context.loading = true;
      try {
        const result = await api(`/api/conversations/${encodeURIComponent(context.id)}?after=${context.after}`, 'GET', undefined, context.token);
        if (activeChat !== context || !$('#projectMessages')) return;
        context.conversation = result.conversation;
        appendMessages(context, result.messages || []);
        context.after = Math.max(context.after, result.latestSeq || 0);
        const oppositeRead = context.customer ? context.conversation.readByStaff : context.conversation.readByCustomer;
        document.querySelectorAll('#projectMessages .mine').forEach(node => { $('.project-read-state', node).textContent = Number(node.dataset.seq) <= (oppositeRead || 0) ? '对方已读' : '已发送'; });
        $('#projectChatStatus').textContent = '已连接 · 新消息自动同步';
        await markRead(context);
      } catch (error) { if (activeChat === context && $('#projectChatStatus')) $('#projectChatStatus').textContent = `暂时无法同步，正在自动重试。${error.message}`; }
      finally { context.loading = false; if (activeChat === context && !document.hidden) context.timer = setTimeout(() => pollChat(context), 1500); }
    }
    function appendMessages(context, messages) {
      const target = $('#projectMessages'); if (!target || activeChat !== context) return;
      const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      const fresh = messages.filter(message => !context.seen.has(message.id));
      fresh.forEach(message => { context.seen.add(message.id); context.messages.push(message); });
      if (fresh.length) {
        $('.project-chat-empty', target)?.remove();
        target.insertAdjacentHTML('beforeend', fresh.map(message => renderMessage(message, context)).join(''));
        if (nearBottom) target.scrollTop = target.scrollHeight;
      } else if (!context.messages.length && !$('.project-chat-empty', target)) target.innerHTML = `<div class="project-chat-empty"><strong>沟通从这里开始</strong><p>${context.conversation.record?.confidential ? '仅发送文字与设备清单卡片，不上传工程资料。' : '可以发送文字、资料，或勾选下方选项发送一张业务卡片。'}</p></div>`;
    }
    async function markRead(context) {
      const target = $('#projectMessages');
      if (activeChat !== context || document.hidden || !target || target.scrollHeight - target.scrollTop - target.clientHeight > 120 || !context.after || context.lastRead === context.after) return;
      await api(`/api/conversations/${encodeURIComponent(context.id)}/read`, 'POST', { seq: context.after }, context.token);
      if (activeChat === context) context.lastRead = context.after;
    }
    async function sendChat(form) {
      const context = activeChat; if (!context) throw new Error('会话已关闭，请重新进入。');
      const data = new FormData(form);
      if (!context.pending) {
        const text = String(data.get('text') || '').trim(), files = context.conversation.record?.confidential ? [] : await filesFrom(form), sendCard = data.get('sendCard') === 'on';
        if (!text && !files.length && !sendCard) throw new Error('请输入消息、选择附件，或勾选发送业务卡片。');
        context.pending = { text, files, sendCard, clientMessageId: window.SanyRequestId.create() };
      }
      /* 失败时冻结待发内容并复用消息编号；即使服务端已收到，也不会因重试重复发出。 */
      const inputs = [...form.querySelectorAll('input,textarea')]; inputs.forEach(input => { input.disabled = true; });
      try {
        const { message } = await api(`/api/conversations/${encodeURIComponent(context.id)}/messages`, 'POST', context.pending, context.token);
        if (activeChat !== context) return;
        context.pending = null; form.reset(); renderChatFiles(form); appendMessages(context, [message]);
        $('#projectMessages').scrollTop = $('#projectMessages').scrollHeight;
        form.querySelector('[type="submit"]').textContent = '发送消息';
        inputs.forEach(input => { input.disabled = false; });
        form.elements.text.focus();
      } catch (error) {
        if (activeChat === context) {
          if (error.status >= 400 && error.status < 500) {
            context.pending = null; inputs.forEach(input => { input.disabled = false; });
            form.querySelector('[type="submit"]').textContent = '修改后重新发送';
          } else form.querySelector('[type="submit"]').textContent = '重试发送（原内容保留）';
        }
        throw error;
      }
    }
    async function handleAccessLink(key) {
      const request = ++epoch;
      const result = await api('/api/guest/access', 'POST', { key });
      if (request !== epoch) return;
      if (result.kind === 'project') return openProject(result.project.id, result.token, true);
      if (result.kind === 'order') return openOrder(result.order.id, result.token, true);
      throw new Error('查询链接类型无法识别。');
    }

    document.addEventListener('click', async event => {
      const target = event.target.closest('[data-project-action]'); if (!target) return;
      event.preventDefault();
      const action = target.dataset.projectAction;
      try {
        if (action === 'remove-item') { selected.delete(target.dataset.id); renderPicker(); renderSelection(); }
        else if (action === 'picker-more') { const top = $('#projectPickerResults').scrollTop; pickerLimit += 60; renderPicker(); $('#projectPickerResults').scrollTop = top; }
        else if (action === 'file') { const token = target.dataset.scope === 'chat' ? activeChat?.token : detail?.token; if (!token) throw new Error('查询会话已失效，请重新打开记录。'); await downloadFile(target.dataset.id, target.dataset.name, token); }
        else if (action === 'saved') { const item = saved().find(value => value.id === target.dataset.id); if (!item) return; const result = item.accessKey ? await api('/api/guest/access', 'POST', { key: item.accessKey }) : await api('/api/projects/lookup', 'POST', { projectId: item.id, phone: item.phone, code: item.code }); await openProject(result.project.id, result.token, true); }
        else if (action === 'forget') { const item = saved().find(value => value.id === target.dataset.id); if (item && confirm(`只移除本浏览器中“${item.title}”的查询凭证？服务器上的项目记录不会删除。`)) { localStorage.setItem('sany-project-receipts-v1', JSON.stringify(saved().filter(value => value.id !== item.id))); renderSaved(); toast('已移除本浏览器凭证，项目记录保留。'); } }
        else if (action === 'receipt-copy') { if (!receipt?.accessKey) throw new Error('当前记录未提供查询链接，请下载备用凭证。'); await navigator.clipboard.writeText(linkFor(receipt.accessKey)); toast('查询链接已复制，请仅发送给可信人员。'); }
        else if (action === 'receipt-download') downloadText(`${receipt.number}-项目查询凭证.txt`, `三一匠造 · 项目查询凭证\n项目：${receipt.title}\n项目编号：${receipt.number}\n查询链接：${receipt.accessKey ? linkFor(receipt.accessKey) : '暂不可用'}\n联系电话：${receipt.phone}\n备用查询凭证：${receipt.code}\n\n持有链接或凭证的人可查看项目资料，请勿公开传播。仅对创建该项目的本机服务有效。\n`);
        else if (action === 'receipt-save') { remember(receiptForStorage()); renderSaved(); toast('已保存到本浏览器，共用电脑请及时移除凭证。'); }
        else if (action === 'receipt-open') await openProject(receipt.id, receipt.token, true);
        else if (action === 'phone-project') {
          const request = epoch;
          const result = await api('/api/guest/phone-project', 'POST', { phone: projectPhone, projectId: target.dataset.id });
          if (request === epoch) await openProject(result.project.id, result.token, true);
        }
        else if (action === 'my-projects-refresh') await renderMyProjects();
        else if (action === 'my-project-open') { const r=await api('/api/customer/record','POST',{kind:'project',id:target.dataset.id},window.SanyCustomers.token());await openProject(target.dataset.id,r.token,true); }
        else if (action === 'staff-project') await openProject(target.dataset.id, getState().staffToken, false);
        else if (action === 'refresh-projects') await renderStaffProjects(target.closest('[data-project-staff-target]') || $('#workBody') || main());
        else if (action === 'detail-chat') {
          const id = target.dataset.id || detail?.project.id;
          const customer = target.dataset.customer ? target.dataset.customer === 'true' : detail?.customer;
          if (!id) throw new Error('项目信息已失效，请关闭弹窗后重新打开项目。');
          let token = detail?.project.id === id ? detail.token : customer ? '' : getState().staffToken;
          target.disabled = true;
          try {
            if (!token && customer && window.SanyCustomers?.token()) {
              const result = await api('/api/customer/record', 'POST', { kind: 'project', id }, window.SanyCustomers.token());
              token = result.token;
            }
            if (!token) throw new Error('登录或查询会话已失效，请重新登录或打开项目。');
            await openChat('project', id, token, customer);
          } finally { target.disabled = false; }
        }
        else if (action === 'staff-chat') await openChat(target.dataset.kind, target.dataset.id, getState().staffToken, false);
        else if (['chat-record', 'chat-card'].includes(action) && activeChat) {
          const context = activeChat;
          if (context.kind === 'project') await openProject(context.recordId, context.token, context.customer);
          else await openOrder(context.recordId, context.token, context.customer);
        }
      } catch (error) { toast(error.message); }
    });
    document.addEventListener('input', event => {
      const target = event.target;
      if (target.dataset.projectInput === 'search') { pickerSearch = target.value; pickerLimit = 60; renderPicker(); }
      if (target.dataset.projectInput === 'quantity') selected.set(target.dataset.id, Number(target.value));
    });
    document.addEventListener('change', event => {
      const target = event.target, kind = target.dataset.projectInput;
      if (kind === 'group') { pickerGroup = target.value; pickerLimit = 60; renderPicker(); }
      else if (kind === 'pick') {
        if (target.checked && selected.size >= 50) { target.checked = false; return toast('最多选择 50 种设备，请移除不需要的设备后再添加。'); }
        if (target.checked) selected.set(target.dataset.id, 1); else selected.delete(target.dataset.id);
        renderSelection();
      } else if (kind === 'confidential') {
        const upload = $('#projectUpload'), input = $('input[type="file"]', upload);
        upload.hidden = target.checked; input.disabled = target.checked;
        if (target.checked) input.value = '';
        const notes = target.form.elements.notes;
        notes.placeholder = target.checked ? '只填写不涉密的设备需求、交付安排；请勿填写工程设计细节。' : '作业工况、配置要求、交付安排等；请勿填写涉密内容。';
      }
      if (target.matches?.('form[data-project-form="chat"] input[type="file"]')) renderChatFiles(target.form);
    });
    document.addEventListener('submit', async event => {
      const form = event.target.closest('form[data-project-form]'); if (!form) return;
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]'), errorBox = $('.form-error', form);
      if (submit.disabled) return;
      const request = epoch;
      submit.disabled = true; errorBox.textContent = '';
      try {
        const data = Object.fromEntries(new FormData(form).entries()), kind = form.dataset.projectForm;
        if (kind === 'create') {
          const confidential = data.confidential === 'on', items = selectedItems();
          if (confidential && !items.length) throw new Error('保密项目请至少勾选一种设备。');
          const files = confidential ? [] : await filesFrom(form);
          if (request !== epoch) return;
          const result = await api('/api/projects', 'POST', { title: data.title, contact: data.contact, phone: data.phone, customerType: data.customerType, notes: data.notes, confidential, items, files }, window.SanyCustomers?.token());
          if (request !== epoch) return;
          renderReceipt(result, data.remember === 'on'); void renderMyProjects();
        } else if (kind === 'phone-lookup') {
          projectPhone = ''; $('#phoneProjectResults').innerHTML = '';
          const result = await api('/api/guest/phone-projects', 'POST', { phone: data.phone.trim() });
          if (request !== epoch) return;
          projectPhone = data.phone.trim();
          $('#phoneProjectResults').innerHTML = result.projects.map(project => `<article class="project-saved-item"><strong>${esc(project.title)}</strong><small>${esc(project.number)} · ${esc(time(project.createdAt))}</small>${badge(project.status)}${pbutton('phone-project', '查看项目', 'small', `data-id="${esc(project.id)}"`)}</article>`).join('') || '<p class="muted">没有找到该手机号提交的项目，请检查号码。</p>';
        } else if (kind === 'lookup') {
          const result = await api('/api/projects/lookup', 'POST', { projectId: data.projectId.trim(), phone: data.phone.trim(), code: data.code.trim() });
          if (request !== epoch) return;
          await openProject(result.project.id, result.token, true);
        } else if (['review', 'supplement'].includes(kind)) {
          const context = detail; if (!context) throw new Error('项目详情已关闭，请重新查询。');
          const files = context.project.confidential ? [] : await filesFrom(form);
          if (request !== epoch) return;
          await api(`/api/projects/${encodeURIComponent(context.project.id)}/${kind}`, 'POST', { ...data, revision: context.project.revision, files }, context.token);
          if (request !== epoch) return;
          getState().dirty = true; await openProject(context.project.id, context.token, context.customer); toast(kind === 'review' ? '审核意见已保存。' : '补充资料已提交，等待重新审核。');
        } else if (kind === 'chat') await sendChat(form);
      } catch (error) { errorBox.textContent = error.message; }
      finally { submit.disabled = false; }
    });
    document.addEventListener('paste', event => {
      const form = event.target.closest('form[data-project-form="chat"]'); if (!form) return;
      const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
      if (!images.length) return; event.preventDefault();
      try { pasteChatImages(form, images); $('#projectChatStatus').textContent = `已粘贴 ${images.length} 张图片，发送前可继续输入说明。`; } catch (error) { toast(error.message); }
    });
    document.addEventListener('keydown', event => {
      const field = event.target.closest('form[data-project-form="chat"] textarea[name="text"]');
      if (field && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); field.form.requestSubmit(); }
    });
    document.addEventListener('scroll', event => { if (event.target.id === 'projectMessages' && activeChat) markRead(activeChat).catch(() => {}); }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (activeChat) clearTimeout(activeChat.timer); if (inbox) clearTimeout(inbox.timer); }
      else { if (activeChat) pollChat(activeChat); if (inbox) pollInbox(inbox); }
    });
    return { renderProjectPage, renderStaffProjects, renderStaffChat, openProject, openChat, stop, handleAccessLink };
  }
})();
