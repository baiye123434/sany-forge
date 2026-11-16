(() => {
  'use strict';
  function create(ctx) {
    const { api, esc, button, field, textarea, select, formEnd, empty, time, toast, showModal, closeModal, getState } = ctx;
    let data = null, generation = 0, filter = 'open', term = '', host = null;
    const labels = { project: '售前需求', order: '售中交付', ticket: '售后服务' };
    const canWrite = () => ['admin', 'service'].includes(getState().user?.role);
    const canHandle = task => getState().user?.role === 'admin' || (getState().user?.role === 'service' && task.ownerId === getState().user.id);
    function stop() { generation++; data = null; host = null; }
    async function render(body) {
      host = body;
      const serial = ++generation, token = getState().staffToken;
      body.innerHTML = '<p role="status">正在读取跟进计划…</p>';
      try {
        const result = await api('/api/followups', 'GET', undefined, token);
        if (serial !== generation || !body.isConnected || getState().staffToken !== token) return;
        data = result; draw();
      } catch (e) { if (serial === generation && body.isConnected && getState().staffToken === token) body.innerHTML = empty('跟进计划载入失败', e.message); }
    }
    function draw() {
      if (!host || !data) return;
      const list = data.tasks.filter(t => (filter === 'all' || filter === 'open' && t.status === 'open' || filter === 'overdue' && t.overdue || filter === 'mine' && t.status === 'open' && t.ownerId === getState().user.id || filter === 'done' && t.status === 'done') && `${t.target?.number} ${t.target?.title} ${t.action} ${t.ownerName}`.toLowerCase().includes(term.toLowerCase()));
      host.innerHTML = `<div class="notice">每项任务明确负责人、下次行动和截止时间。完成跟进不会改变订单、工程审核或维修状态。</div><div class="stats">${[['待跟进', data.counts.open], ['已逾期', data.counts.overdue], ['我的待办', data.counts.mine], ['已完成', data.counts.done]].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><div class="section-top"><p>统计截至 ${esc(time(data.asOf))}，刷新后更新。</p>${canWrite() ? button('followup-new', '新增跟进计划', 'primary') : '<span class="pill">审核员只读</span>'}</div><div class="tabs">${[['open','待跟进'],['overdue','已逾期'],['mine','我的待办'],['done','已完成'],['all','全部']].map(([value,label]) => button('followup-filter', label, filter === value ? 'dark small' : 'small', `data-value="${value}" aria-pressed="${filter === value}"`)).join('')}</div><form data-form="followup-search"><div class="form-grid">${field('搜索业务编号、设备、行动或负责人','term','search',term,'maxlength="150"')}${formEnd('搜索')}</div></form><div class="records">${list.map(t => `<article class="record"><div class="record-main"><small>${esc(labels[t.kind])} · ${esc(t.target?.number || t.recordId)}</small><h3>${esc(t.action)}</h3><p>${esc(t.target?.title || '关联记录缺失')}</p><p>负责人：${esc(t.ownerName)}${t.ownerActive ? '' : '（已停用，请管理员改派）'} · 截止：${esc(time(t.dueAt))}</p>${t.outcome ? `<p>结果：${esc(t.outcome)}</p>` : ''}</div><span class="pill ${t.overdue ? 'orange' : t.status === 'done' ? 'green' : ''}">${t.status === 'done' ? '已完成' : t.overdue ? '已逾期' : '待跟进'}${t.priority === 'urgent' ? ' · 紧急' : ''}</span>${button('followup-detail','查看 / 处理','small',`data-id="${esc(t.id)}"`)}</article>`).join('') || empty('暂无符合条件的跟进任务','从已有工程需求、订单或售后工单建立计划；这里不会自动生成示例业务。')}</div>`;
    }
    const owners = () => getState().users.filter(u => u.active && ['admin', 'service'].includes(u.role) && (getState().user.role === 'admin' || u.id === getState().user.id)).map(u => [u.id, u.name]);
    const localDate = iso => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
    function newTask() {
      if (!canWrite()) return;
      if (!data?.targets.length) { toast('请先建立工程需求、订单或售后工单，再添加跟进。'); return; }
      const requestId = window.SanyRequestId.create();
      showModal('新增跟进计划', `<form data-form="followup-create" data-request="${requestId}"><div class="form-grid">${select('关联业务','target',data.targets.map(t => [`${t.kind}:${t.id}`,`${labels[t.kind]} · ${t.number} · ${t.title}`]),'', 'required')}${select('负责人','ownerId',owners(),getState().user.id,'required')}${field('下次跟进时间（本机时区）','dueAt','datetime-local','','required')}${select('优先级','priority',[['normal','普通'],['urgent','紧急']])}${textarea('下次行动','action','','maxlength="1000" required placeholder="例如：联系客户确认设备配置与预计交付日期"')}</div>${formEnd('保存跟进计划')}</form>`);
    }
    function detail(id) {
      const t = data?.tasks.find(t => t.id === id); if (!t) return;
      const editable = t.status === 'open' && canHandle(t);
      showModal('跟进记录与处理', `<p>${esc(t.target?.number)} · ${esc(t.action)}</p><p>负责人：${esc(t.ownerName)}；截止：${esc(time(t.dueAt))}</p><div class="panel"><h3>跟进历史</h3>${t.history.map(e => `<p><strong>${esc(time(e.at))} · ${esc(e.actor)}</strong><br>${esc(e.note)}${e.dueAt ? `<br>计划时间：${esc(time(e.dueAt))}` : ''}</p>`).join('')}</div>${editable ? `<h3>记录本次跟进结果</h3><form data-form="followup-complete" data-id="${esc(t.id)}" data-revision="${t.revision}">${textarea('实际结果（必填）','note','','required maxlength="2000" placeholder="记录已完成的沟通或处理结果；业务交付和验收仍需在对应单据办理"')}${formEnd('完成本次跟进')}</form><details><summary>调整时间或负责人</summary><form data-form="followup-reschedule" data-id="${esc(t.id)}" data-revision="${t.revision}">${select('负责人','ownerId',owners(),t.ownerId,'required')}${field('新跟进时间（本机时区）','dueAt','datetime-local',localDate(t.dueAt),'required')}${textarea('调整原因','note','','maxlength="2000" required')}${formEnd('保存调整')}</form></details>` : '<p class="notice">已完成记录保留历史；仅当前负责人或管理员可处理待办。</p>'}`);
    }
    async function click(action, target) {
      if (action === 'followup-new') newTask();
      if (action === 'followup-detail') detail(target.dataset.id);
      if (action === 'followup-filter') { filter = target.dataset.value; draw(); }
    }
    async function submit(kind, form, fields) {
      if (kind === 'followup-search') { term = fields.term.trim(); draw(); return; }
      const token = getState().staffToken;
      if (kind === 'followup-create') {
        const [recordKind, recordId] = fields.target.split(':');
        await api('/api/followups', 'POST', { kind: recordKind, recordId, action: fields.action, ownerId: fields.ownerId, priority: fields.priority, dueAt: new Date(fields.dueAt).toISOString(), requestId: form.dataset.request }, token);
      } else {
        await api(`/api/followups/${form.dataset.id}/${kind === 'followup-complete' ? 'complete' : 'reschedule'}`, 'POST', { note: fields.note, revision: Number(form.dataset.revision), ...(kind === 'followup-reschedule' ? { ownerId: fields.ownerId, dueAt: new Date(fields.dueAt).toISOString() } : {}) }, token);
      }
      if (getState().staffToken !== token) return;
      closeModal(); toast('跟进记录已保存'); if (host?.isConnected) await render(host);
    }
    function design(body) {
      body.innerHTML = `<article class="panel"><h2>全流程跟进功能设计说明</h2><h3>功能设计价值</h3><p>将售前需求沟通、售中交付协调、售后维修回访形成有负责人、有计划时间、有结果留痕的待办，减少遗漏与交接断点。</p><h3>设计导入</h3><p>背景：原流程主要记录业务状态，缺少跨环节的下次行动。目标：工作人员从已有业务单据建立计划，在工作台筛选逾期与本人待办，再完成跟进或说明延期原因。管理员可分配和改派；服务人员只处理自己的任务；审核员只读。</p><h3>流程与逻辑</h3><p>建立计划 → 待跟进 → 完成。待跟进允许改期、改派并保留历史；完成后不能再次处理，可新建后续计划。逾期由时间计算，不是业务状态。完成跟进不会确认报价、发货、审核、签收或结束维修。</p><h3>字段规则与取数规则</h3><p>关联对象从现有工程需求、订单和售后工单选择；编号和标题来自原单据，负责人来自在用员工。下次行动必填、最多 1000 字；截止时间必填且保存时晚于当前时间；优先级为普通或紧急。结果及调整原因必填、最多 2000 字。前端将本机时区输入转换为 UTC，服务端严格验证时间格式与角色。</p><h3>指标口径</h3><p>源头：records 中 kind=followup 的计划记录，关联 project、order、ticket 与 user。生成：不自动生成跟进，不从聊天猜测结果；负责人名称实时关联账号，状态 open/done 单独保存。汇总：待跟进=状态 open 的条数；逾期=状态 open 且 dueAt 早于本次服务端 asOf；我的待办=状态 open 且 ownerId 为当前用户；已完成=状态 done。卡片按全量任务统计，列表筛选不改卡片；按任务计数，不按订单去重。刷新时重新计算，不等同于 SLA 达标率。</p><h3>权限、校验与异常</h3><p>客户不能读取或写入内部跟进。管理员可处理全部任务；服务人员只能给自己建立计划和处理本人任务；审核员只能查看。创建使用提交标识防重复，同一标识内容改变返回冲突；修改使用 revision 拦截过期版本。网络失败保留表单；冲突时关闭详情并刷新后重试；账号停用显示提示，由管理员改派。注销或离开工作台后丢弃迟到请求。</p><h3>接口及数据边界</h3><p>GET/POST /api/followups；POST /api/followups/:id/complete、reschedule。复用本机事务和审计存储，不提供删除历史接口。尚未接入短信、推送、外部 CRM、合同、库存、收款或 SLA 引擎；这些能力均待后续确认。保密项目只显示业务标题与编号，不复制设计附件。员工沿用当前系统的全量业务可见范围，组织或区域数据隔离待建设。</p><footer>原型来源方：SDMC-IT</footer></article>`;
    }
    return { render, design, stop, click, submit };
  }
  window.SanyFollowups = { create };
})();
