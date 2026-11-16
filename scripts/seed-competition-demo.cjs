// Explicitly run with --apply to add synthetic competition records to the local app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const marker = '[参赛演示-20261026]';
const base = 'http://127.0.0.1:8790';
async function api(route, token, body) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${result.error || result.message || 'request failed'}`);
  return result;
}
async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Use --apply only when demo data creation is authorized.');
  const dir = path.join(root, '.qa/demo-seed');
  const output = path.join(dir, 'result.json');
  if (fs.existsSync(output)) throw new Error('Seed receipt already exists; inspect it before creating another batch.');
  const files = [{ name: '参赛演示材料-非真实单据.png', data: fs.readFileSync(path.join(dir, '演示材料.png')).toString('base64') }];
  const password = crypto.randomBytes(24).toString('base64url');
  const session = await api('/api/register', null, { username: `demo.seed.${Date.now()}`, name: '参赛演示工程师', role: 'service', password, repeat: password });
  const token = session.token;
  const result = { batch: marker, generatedAt: new Date().toISOString(), orders: [], tickets: [], source: '报告来源方:SDMC-IT' };
  try {
    const existing = (await api('/api/orders', token)).orders;
    if (existing.some(o => o.notes?.includes(marker))) throw new Error('Batch already exists; refusing duplicate creation.');
    result.before = await api('/api/stats', token);
    const products = (await api('/api/products')).products.filter(p => !p.exhibitOnly);
    if (!products.length) throw new Error('No orderable products.');
    const targets = ['submitted','submitted','submitted','submitted','submitted','confirmed','confirmed','preparing','preparing','shipped','shipped','delivered','delivered','delivered','delivered'];
    const stages = ['confirmed','preparing','shipped','delivered'];
    for (let i = 0; i < targets.length; i++) {
      const contact = `参赛演示客户${String(i + 1).padStart(2, '0')}`;
      const phone = `1380000${String(i + 1).padStart(4, '0')}`;
      const address = `参赛演示园区（虚构地址，不配送）第${i + 1}号工区`;
      const receipt = await api('/api/orders', null, { productId: products[(i * 17) % products.length].id, mode: i % 3 ? 'buy' : 'rent', quantity: i % 3 + 1, contact, phone, address, date: new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), duration: 3, plan: '演示方案，非真实交易', notes: `${marker} 虚构客户及联系方式，仅用于比赛展示，不构成采购或付款依据。`, files });
      let order = receipt.order;
      const guest = receipt.token;
      for (const status of stages) {
        if (order.status === targets[i]) break;
        const body = { revision: order.revision, status, note: `${marker} 模拟${status}，报价与物流信息均非真实业务。`, files, amount: 10000 + i * 1000, carrier: '参赛演示物流（虚构）', tracking: `DEMO-20261026-${i + 1}`, confirmed: true };
        order = (await api(`/api/orders/${order.id}/${status === 'delivered' ? 'confirm' : 'transition'}`, status === 'delivered' ? guest : token, body)).order;
      }
      result.orders.push({ id: order.id, number: order.number, contact, product: order.product.name, status: order.status });
      if (order.status === 'delivered') {
        const target = ['submitted','in_progress','pending_review','pending_review'][i - 11];
        let ticket = (await api('/api/tickets', guest, { orderId: order.id, contact, phone, address, issue: `${marker} 模拟设备巡检及保养申请，无真实故障。`, urgency: i === 11 ? 'urgent' : 'normal', files })).ticket;
        for (const status of ['assigned','in_progress','pending_review']) {
          if (ticket.status === target) break;
          ticket = (await api(`/api/tickets/${ticket.id}/transition`, token, { revision: ticket.revision, status, assignee: session.user.id, note: `${marker} 模拟维修进度及材料提交，供管理员审核演示。`, files })).ticket;
        }
        result.tickets.push({ id: ticket.id, orderId: order.id, status: ticket.status });
      }
      fs.writeFileSync(output, JSON.stringify(result, null, 2));
    }
    result.after = await api('/api/stats', token);
    const saved = (await api('/api/orders', token)).orders.filter(o => o.notes?.includes(marker));
    if (saved.length !== 15 || result.after.orders - result.before.orders !== 15 || result.after.pendingOrders - result.before.pendingOrders !== 5 || result.after.openTickets - result.before.openTickets !== 4 || result.after.pendingReview - result.before.pendingReview !== 2) throw new Error('Unexpected final counts; inspect saved receipt.');
    result.verified = true;
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ addedOrders: result.orders.length, addedTickets: result.tickets.length, before: result.before, after: result.after, verified: true }, null, 2));
  } finally { await api('/api/logout', token, {}).catch(() => {}); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
