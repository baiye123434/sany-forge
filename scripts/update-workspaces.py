from pathlib import Path
root=Path(__file__).resolve().parents[1]
def edit(name,old,new):
 p=root/name;s=p.read_text(encoding='utf-8');assert old in s,(name,old[:70]);p.write_text(s.replace(old,new),encoding='utf-8')
edit('server/platform.cjs','integer, phone, hash, now, id, faceKey });','integer, phone, phoneKey, checkPhoneQuery, hash, now, id, faceKey });')
edit('dist/platform.js',"  const customerWindow =", "  const staffWindow = /[?&]workspace=staff(?:&|$)/.test(location.search || '');\n  const customerWindow =")
edit('dist/platform.js',"    if (customerWindow) document.querySelectorAll", "    document.documentElement.dataset.workspace = staffWindow ? 'staff' : 'customer';\n    document.querySelector('.brand').href = staffWindow ? '#work' : '#catalog';\n    document.querySelectorAll('[data-nav]').forEach(link => { link.hidden = staffWindow ? ['catalog', 'customer', 'projects'].includes(link.dataset.nav) : ['work', 'admin'].includes(link.dataset.nav); });\n    if (customerWindow) document.querySelectorAll")
edit('dist/platform.js',"const counter = ++routeCounter, next = location.hash.replace('#', '') || 'catalog';", "const counter = ++routeCounter;\n    let next = location.hash.replace('#', '') || (staffWindow ? 'work' : 'catalog');\n    if (staffWindow && !['work', 'admin', 'about'].includes(next)) {\n      next = 'work'; window.history.replaceState(null, '', `${location.pathname}${location.search}#work`);\n    }")
for name in ['dist/platform.js','dist/project-service.js']:
 edit(name,'项目需求工单','售前项目需求工单')
old='''<p class="muted">可直接打开保存的查询链接，也可使用项目编号和查询凭证。</p><form data-project-form="lookup">${field('项目编号', 'projectId', 'text', '', 'placeholder="PR-…" maxlength="100" required')}${field('提交时的联系电话', 'phone', 'tel', '', 'maxlength="30" required')}${field('查询凭证', 'code', 'password', '', 'maxlength="100" autocomplete="off" required')}${formEnd('查询项目', '')}</form>'''
new='''<p class="muted">输入提交需求时的完整手机号，选择要查看的项目。</p><form data-project-form="phone-lookup">${field('提交时的手机号', 'phone', 'tel', '', 'maxlength="30" autocomplete="tel" required')}${formEnd('查询项目', '')}</form><p class="privacy-note">仅限本机演示：未接短信验证，知道手机号即可查询对应项目，请勿提交真实敏感资料。</p><div id="phoneProjectResults" aria-live="polite"></div>'''
edit('dist/project-service.js',old,new)
edit('dist/project-service.js',"let epoch = 0, detail", "let projectPhone = '';\n    let epoch = 0, detail")
edit('dist/project-service.js',"      epoch++;", "      epoch++; projectPhone = '';")
edit('dist/project-service.js',"        else if (action === 'staff-project')", "        else if (action === 'phone-project') {\n          const request = epoch;\n          const result = await api('/api/guest/phone-project', 'POST', { phone: projectPhone, projectId: target.dataset.id });\n          if (request === epoch) await openProject(result.project.id, result.token, true);\n        }\n        else if (action === 'staff-project')")
edit('dist/project-service.js',"        } else if (kind === 'lookup') {", """        } else if (kind === 'phone-lookup') {
          projectPhone = ''; $('#phoneProjectResults').innerHTML = '';
          const result = await api('/api/guest/phone-projects', 'POST', { phone: data.phone.trim() });
          if (request !== epoch) return;
          projectPhone = data.phone.trim();
          $('#phoneProjectResults').innerHTML = result.projects.map(project => `<article class="project-saved-item"><strong>${esc(project.title)}</strong><small>${esc(project.number)} · ${esc(time(project.createdAt))}</small>${badge(project.status)}${pbutton('phone-project', '查看项目', 'small', `data-id="${esc(project.id)}"`)}</article>`).join('') || '<p class="muted">没有找到该手机号提交的项目，请检查号码。</p>';
        } else if (kind === 'lookup') {""")
edit('dist/platform.js','工程项目的查询方式保持不变。','工程项目也可按提交时的手机号查询。') if '工程项目的查询方式保持不变。' in (root/'dist/platform.js').read_text(encoding='utf-8') else None
edit('dist/platform.js','工程项目仍使用项目编号与凭证查询。','工程项目也可按手机号查询。')
edit('dist/index.html','  <link rel="stylesheet" href="workspace-motion.css">','  <link rel="stylesheet" href="workspace-motion.css">\n  <link rel="stylesheet" href="mobile-workspaces.css">')
