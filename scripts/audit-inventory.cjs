'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), out = path.join(root, '.qa', 'review-20261026');
fs.mkdirSync(out, { recursive: true });
const rows = [], errors = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name), rel = path.relative(root, file).replaceAll('\\', '/');
    if (e.isSymbolicLink()) { rows.push({ path: rel, category: 'link', bytes: 0 }); continue; }
    if (e.isDirectory()) { if (!['.qa', '.git', 'release'].includes(e.name)) walk(file); continue; }
    try {
      const b = fs.readFileSync(file);
      const category = rel.startsWith('node_modules/') ? 'dependency' : /^\.desktop-/.test(rel) ? 'runtime' : rel.startsWith('dist/vendor/') ? 'vendor' : rel.startsWith('dist/assets/') ? 'asset' : /\.(c?js|css|html|md|json|cmd|py|svg)$/.test(rel) ? 'project-text' : 'binary';
      const row = { path: rel, category, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
      if (category === 'project-text') {
        const s = b.toString('utf8'); row.lines = s.split(/\r?\n/).length;
        if (rel.endsWith('.json')) { try { JSON.parse(s); row.json = 'valid'; } catch { row.json = 'invalid'; } }
        const backup = path.join(out, 'baseline', rel);
        if (!fs.existsSync(backup)) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, b); }
      }
      rows.push(row);
    } catch (e) { errors.push({ path: rel, code: e.code }); }
  }
}
walk(root);
const summary = {};
for (const row of rows) { const c = summary[row.category] ||= { files: 0, bytes: 0 }; c.files++; c.bytes += row.bytes; }
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify({ at: new Date().toISOString(), exclusions: ['.qa', '.git', 'release'], summary, errors, files: rows }, null, 2));
console.log(JSON.stringify({ summary, errors, projectFiles: rows.filter(r => r.category === 'project-text').map(({path,lines}) => ({path,lines})) }, null, 2));
