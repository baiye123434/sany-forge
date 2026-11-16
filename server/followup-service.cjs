'use strict';
// 跟进任务独立于业务状态；完成跟进不能代替报价、发货、审核或客户验收。
function createFollowupService(ctx) {
  const { get, all, put, atomic, audit, auth, fail, text, now, id, revision, hash } = ctx;
  const kinds = ['project', 'order', 'ticket'];
  function due(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('请填写有效的下次跟进时间。');
    if (Date.parse(value) <= Date.parse(now())) fail('下次跟进时间必须晚于当前时间。');
    return value;
  }
  function owner(ownerId, access) {
    const user = get('user', ownerId);
    if (!user?.active || !['admin', 'service'].includes(user.role)) fail('请选择在用的管理员或服务人员负责跟进。');
    if (access.user.role !== 'admin' && user.id !== access.user.id) fail('服务人员只能为自己建立或调整跟进任务。', 403);
    return user;
  }
  function source(kind, recordId) {
    if (!kinds.includes(kind)) fail('跟进对象必须是工程需求、订单或售后工单。');
    const record = get(kind, text(recordId, 100));
    if (!record) fail('关联业务记录不存在。', 404);
    return record;
  }
  function target(kind, record) {
    return { kind, id: record.id, number: record.number || record.id, title: kind === 'project' ? record.title : `${record.product.code} · ${kind === 'ticket' ? record.issue : record.product.name}`, status: record.status };
  }
  function publicTask(task, at) {
    const { requestId, requestHash, ...result } = task;
    const record = get(task.kind, task.recordId), user = get('user', task.ownerId);
    return { ...result, ownerName: user?.name || '账号不存在', ownerActive: user?.active === true, overdue: task.status === 'open' && task.dueAt < at, target: record ? target(task.kind, record) : null };
  }
  async function route(req, url, body) {
    const p = url.pathname;
    if (!p.startsWith('/api/followups')) return undefined;
    const access = auth(req, ['admin', 'service', 'reviewer']);
    if (p === '/api/followups' && req.method === 'GET') {
      const at = now(), tasks = all('followup').map(task => publicTask(task, at)).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
      const targets = kinds.flatMap(kind => all(kind).map(record => target(kind, record)));
      return { tasks, targets, asOf: at, counts: { open: tasks.filter(t => t.status === 'open').length, overdue: tasks.filter(t => t.overdue).length, mine: tasks.filter(t => t.status === 'open' && t.ownerId === access.user.id).length, done: tasks.filter(t => t.status === 'done').length } };
    }
    if (p === '/api/followups' && req.method === 'POST') return atomic(() => {
      auth(req, ['admin', 'service']);
      const requestId = text(body.requestId, 100);
      if (!/^[\w.-]+$/.test(requestId)) fail('提交标识无效。');
      const requestHash = hash(JSON.stringify([body.kind, body.recordId, body.ownerId, body.action, body.dueAt, body.priority || 'normal']));
      const existing = all('followup').find(t => t.createdBy === access.user.id && t.requestId === requestId);
      if (existing) {
        if (existing.requestHash !== requestHash) fail('此提交标识已用于其他内容，请重新打开表单。', 409);
        return { task: publicTask(existing, now()) };
      }
      source(body.kind, body.recordId);
      const assigned = owner(body.ownerId, access);
      if (!['normal', 'urgent'].includes(body.priority || 'normal')) fail('跟进优先级无效。');
      const task = { id: id('FU'), number: ctx.documentNumber('FU'), kind: body.kind, recordId: body.recordId, ownerId: assigned.id, action: text(body.action, 1000), dueAt: due(body.dueAt), priority: body.priority || 'normal', status: 'open', revision: 1, createdAt: now(), createdBy: access.user.id, requestId, requestHash, history: [] };
      task.history.push({ action: 'created', actor: access.actor, actorId: access.user.id, at: task.createdAt, note: task.action, dueAt: task.dueAt, ownerId: task.ownerId });
      put('followup', task); audit(access.actor, '建立业务跟进任务', task.id);
      return { task: publicTask(task, now()) };
    });
    const match = p.match(/^\/api\/followups\/([\w-]+)\/(complete|reschedule)$/);
    if (match && req.method === 'POST') return atomic(() => {
      auth(req, ['admin', 'service']);
      const task = get('followup', match[1]); if (!task) fail('跟进任务不存在。', 404);
      if (access.user.role !== 'admin' && task.ownerId !== access.user.id) fail('仅负责人或管理员可以处理此跟进。', 403);
      revision(task, body);
      if (task.status !== 'open') fail('已完成的跟进不能重复处理，请建立后续任务。', 409);
      const at = now(), note = text(body.note, 2000), event = { action: match[2], actor: access.actor, actorId: access.user.id, at, note };
      const updated = { ...task, revision: task.revision + 1, updatedAt: at, history: [...task.history, event] };
      if (match[2] === 'complete') Object.assign(updated, { status: 'done', outcome: note, completedAt: at, completedBy: access.user.id });
      else {
        updated.ownerId = owner(body.ownerId, access).id; updated.dueAt = due(body.dueAt);
        Object.assign(event, { previousDueAt: task.dueAt, dueAt: updated.dueAt, previousOwnerId: task.ownerId, ownerId: updated.ownerId });
      }
      put('followup', updated); audit(access.actor, match[2] === 'complete' ? '完成业务跟进' : '调整业务跟进计划', task.id);
      return { task: publicTask(updated, at) };
    });
    fail('跟进接口或操作不存在。', 404);
  }
  return { route };
}
module.exports = { createFollowupService };
