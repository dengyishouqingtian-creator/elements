'use strict';
/* ELEMENTS V1 原型 — 原生 JS，localStorage 存储
   模块划分（单文件内分区，对应 PRD 文件分工）：
   storage / profile / elements / scoring / report / app */

const LS_KEY = 'elements_data_v1';
const SCORING_VERSION = 'v1';

/* ---------- elements.js ---------- */
const ELEMENTS = {
  water: { name: '水', label: '感受与关系', color: '#2878D0', deep: '#18549B', light: '#E8F2FC' },
  fire:  { name: '火', label: '行动与目标', color: '#D94B4B', deep: '#A92F35', light: '#FCECEC' },
  earth: { name: '土', label: '秩序与责任', color: '#D6A52D', deep: '#8C6410', light: '#FBF3D9' },
  air:   { name: '风', label: '探索与自由', color: '#269B70', deep: '#176C4C', light: '#E7F5EE' }
};
const EL_KEYS = Object.keys(ELEMENTS);
const SOURCE_LABEL = { observed: '亲眼观察', self_report: '对方亲口表达', inference: '推测（不计分）' };
const SOURCE_COEF = { observed: 1.0, self_report: 1.0, inference: 0 };

/* ---------- storage.js ---------- */
/* localStorage 在某些预览环境（如应用内文件预览、隐私模式）会被浏览器禁用，
   直接调用会抛错并中断保存按钮的后续动作，表现为“点保存没反应”。
   因此先探测可用性，不可用时自动退到内存存储，保证功能先跑通。 */
let storageOK = true;
let memoryStore = null;
try {
  localStorage.setItem('__elements_test__', '1');
  localStorage.removeItem('__elements_test__');
} catch (e) { storageOK = false; }

function loadData() {
  if (!storageOK) {
    return memoryStore ? JSON.parse(memoryStore) : { version: 1, persons: [], observations: [], analyses: [] };
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { version: 1, persons: [], observations: [], analyses: [] };
    const d = JSON.parse(raw);
    if (!Array.isArray(d.persons) || !Array.isArray(d.observations)) throw new Error('bad format');
    if (!Array.isArray(d.analyses)) d.analyses = [];
    return d;
  } catch (e) {
    alert('本地数据读取失败，可能是数据损坏。请导入之前的 JSON 备份。');
    return { version: 1, persons: [], observations: [], analyses: [] };
  }
}
let storageWarned = false;
function saveData() {
  const raw = JSON.stringify(data);
  if (!storageOK) {
    memoryStore = raw;
    if (!storageWarned) {
      storageWarned = true;
      alert('提醒：当前打开方式下浏览器禁用了本地存储，数据只能临时保存在本次打开期间，关掉页面就会丢。请把这个 HTML 文件下载到电脑上、用 Chrome 直接打开再正式使用，并定期导出 JSON 备份。');
    }
    return;
  }
  try { localStorage.setItem(LS_KEY, raw); }
  catch (e) { storageOK = false; memoryStore = raw; }
}
let data = loadData();
let currentPersonId = null;
let editingPersonId = null;
let editingObsId = null;

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function nowISO() { return new Date().toISOString(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- scoring.js ----------
   规则见 SCORING_RULES.md v1：
   S_e = Σ w × r；同一 eventId 对同一元素只计一次（取最高 w）；
   inference 系数 0；独立事件数 <2 的元素等级最高为“暂无足够证据”。 */
function computeScores(observations) {
  const perEvent = {}; // eventId -> { element: maxW }，仅计分来源
  const eventCounts = {}, contextSets = {}, sourceScores = {};
  EL_KEYS.forEach(k => { eventCounts[k] = 0; contextSets[k] = new Set(); sourceScores[k] = { observed: 0, self_report: 0 }; });
  const countedEvents = {}; EL_KEYS.forEach(k => countedEvents[k] = new Set());

  for (const o of observations) {
    const coef = SOURCE_COEF[o.source] ?? 0;
    for (const ev of (o.evidence || [])) {
      if (!EL_KEYS.includes(ev.element)) continue;
      // 情境统计（含全部来源，用于展示覆盖面）
      contextSets[ev.element].add(o.context || '');
      if (coef === 0) continue;
      const key = o.eventId || o.id;
      perEvent[key] = perEvent[key] || {};
      if ((perEvent[key][ev.element] || 0) < ev.weight) perEvent[key][ev.element] = ev.weight;
      if (!countedEvents[ev.element].has(key)) {
        countedEvents[ev.element].add(key);
        sourceScores[ev.element][o.source] += 0; // 占位，分数在下方按事件汇总
      }
    }
  }
  const scores = {}; EL_KEYS.forEach(k => scores[k] = 0);
  // 按事件汇总分数，并统计独立事件数
  const evSeen = {}; EL_KEYS.forEach(k => evSeen[k] = new Set());
  for (const o of observations) {
    const coef = SOURCE_COEF[o.source] ?? 0;
    if (coef === 0) continue;
    const key = o.eventId || o.id;
    for (const ev of (o.evidence || [])) {
      if (!EL_KEYS.includes(ev.element)) continue;
      if (evSeen[ev.element].has(key)) continue;
      // 只在该事件第一次出现该元素时，按 perEvent 的最高 w 计一次
      evSeen[ev.element].add(key);
      scores[ev.element] += (perEvent[key][ev.element] || 0) * coef;
      sourceScores[ev.element][o.source] += (perEvent[key][ev.element] || 0) * coef;
    }
  }
  EL_KEYS.forEach(k => eventCounts[k] = evSeen[k].size);
  const contextCounts = {}; EL_KEYS.forEach(k => contextCounts[k] = contextSets[k].size);

  // 等级与主副判定（SCORING_RULES 第 8 章基线）
  const levels = {}, eligible = [];
  EL_KEYS.forEach(k => {
    if (eventCounts[k] < 2 || scores[k] === 0) levels[k] = '暂无足够证据';
    else if (scores[k] >= 5 && eventCounts[k] >= 3 && contextCounts[k] >= 2) levels[k] = '明显倾向';
    else levels[k] = '有一定倾向';
    if (levels[k] !== '暂无足够证据') eligible.push(k);
  });
  eligible.sort((a, b) => scores[b] - scores[a]);
  let mainElement = null, secondaryElements = [];
  if (eligible.length) {
    const top = scores[eligible[0]];
    const mains = eligible.filter(k => scores[k] === top);
    mainElement = mains[0];
    secondaryElements = eligible.filter(k => !mains.includes(k));
    if (mains.length > 1) secondaryElements = eligible.filter(k => scores[k] < top);
    var mainGroup = mains;
  } else { var mainGroup = []; }

  return { scores, levels, eventCounts, contextCounts, sourceScores, mainElement, mainGroup, secondaryElements, scoringVersion: SCORING_VERSION };
}

/* ---------- report.js ---------- */
function buildReport(person, observations) {
  const box = document.getElementById('report');
  if (!observations.length) {
    box.innerHTML = '<p>暂无足够证据。先添加观察记录，这里才会生成画像。</p>' +
      '<p class="disclaimer">本报告是基于有限观察的探索性画像，不是心理诊断或人格测量。</p>';
    return;
  }
  const r = computeScores(observations);
  const maxScore = Math.max(4, ...EL_KEYS.map(k => r.scores[k]));
  let html = '';
  EL_KEYS.forEach(k => {
    const e = ELEMENTS[k];
    html += `<div class="score-row"><span class="s-name" style="color:${e.deep}">${e.name}·${e.label}</span>` +
      `<span class="bar"><i style="width:${Math.round(r.scores[k] / maxScore * 100)}%;background:${e.color}"></i></span>` +
      `<span class="s-val">${r.scores[k]} 分 · ${r.eventCounts[k]} 事件</span></div>` +
      `<p class="obs-meta" style="margin:-4px 0 6px 84px">等级：${r.levels[k]}</p>`;
  });

  html += '<div class="report-block"><h5>主 / 副倾向</h5>';
  if (!r.mainElement) html += '<p>暂无足够证据：每个元素都需要至少 2 个独立事件的记录，才能给出倾向判断。继续记录吧。</p>';
  else {
    const mains = r.mainGroup.map(k => `${ELEMENTS[k].name}（${ELEMENTS[k].label}）`).join('、');
    html += `<p>主倾向：<strong>${esc(mains)}</strong>${r.mainGroup.length > 1 ? '（并列，不强行分第一第二）' : ''}</p>`;
    if (r.secondaryElements.length) html += `<p>副倾向：${r.secondaryElements.map(k => ELEMENTS[k].name).join('、')}</p>`;
    const potential = EL_KEYS.filter(k => r.levels[k] === '暂无足够证据' && r.scores[k] > 0);
    if (potential.length) html += `<p>潜在可能（证据不足）：${potential.map(k => ELEMENTS[k].name).join('、')}</p>`;
  }
  html += '</div>';

  if (typeof recentMood === 'function') {
    const rm = recentMood(observations, r.mainElement);
    if (rm) {
      html += '<div class="report-block"><h5>近期心情推算（最近 ' + rm.basedOn + ' 条记录）</h5>' +
        `<p><strong>${esc(rm.label)}</strong>：${esc(rm.desc)}</p>` +
        '<p class="obs-meta">这是按四象规则对记录中情绪词的推算，不是读心；记录里写清当时的表情、语气、原话会更准。</p></div>';
    }
  }

  const supporting = observations.filter(o => o.source !== 'inference' && (o.evidence || []).length);
  if (supporting.length) {
    html += '<div class="report-block"><h5>支持证据</h5><ul>' +
      supporting.map(o => `<li>${esc(o.content)} <span class="obs-meta">[${SOURCE_LABEL[o.source]} · ${esc(o.context)} · ${esc(o.date)}]</span></li>`).join('') + '</ul></div>';
  }
  const hypotheses = observations.filter(o => o.source === 'inference');
  if (hypotheses.length) {
    html += '<div class="report-block"><h5>待验证假设（推测，不计分）</h5><ul>' +
      hypotheses.map(o => `<li>${esc(o.content)}</li>`).join('') + '</ul></div>';
  }
  const altNotes = observations.map(o => o.notes).filter(Boolean);
  html += '<div class="report-block"><h5>其他可能解释</h5><ul>' +
    (altNotes.length ? altNotes.map(n => `<li>${esc(n)}</li>`).join('') : '<li>暂未记录其他解释。给记录加一条“备注”，写下别的可能性，能防止画像变成贴标签。</li>') +
    '</ul></div>';

  const weak = EL_KEYS.filter(k => r.levels[k] === '暂无足够证据');
  const questions = weak.slice(0, 3).map(k => `关于「${ELEMENTS[k].label}」还缺证据：他在什么场景下会表现出${ELEMENTS[k].name}的一面？`);
  if (!questions.length) questions.push('有没有出现过与当前主倾向相反的行为？记下来能让画像更准。');
  html += '<div class="report-block"><h5>下一步需要了解的问题</h5><ul>' + questions.map(q => `<li>${esc(q)}</li>`).join('') + '</ul></div>';
  if (typeof GUIDES !== 'undefined') {
    html += '<div class="report-block"><h5>相处指南（把画像翻译成能照着做的事）</h5>';
    if (r.mainElement) {
      const g = GUIDES[r.mainElement];
      const evRecs = observations.filter(o => o.source !== 'inference' && (o.evidence || []).some(e => e.element === r.mainElement)).slice(0, 2);
      html += `<p class="obs-meta">按他的主要线索（${ELEMENTS[r.mainElement].name}·${ELEMENTS[r.mainElement].label}）生成的通用框架${evRecs.length ? '，并附记录依据' : '；暂无直接记录支持的部分请当通用参考'}。记录与模板矛盾时，以记录为准。</p>`;
      if (evRecs.length) html += '<p>记录依据：' + evRecs.map(o => '「' + esc(o.content) + '」').join('、') + '</p>';
      for (const [sec, title] of GUIDE_SECTIONS) {
        html += `<div class="guide-sec"><h6>${title}</h6><ul>` + g[sec].map(t => `<li>${esc(t)}</li>`).join('') + '</ul></div>';
      }
      if (r.secondaryElements && r.secondaryElements.length) html += `<p class="obs-meta">${esc(SECONDARY_TIP[r.secondaryElements[0]])}</p>`;
    } else {
      html += '<p class="obs-meta">暂无个人记录或主要线索未形成，以下为通用沟通版，仅供一般参考。</p>';
      for (const [sec, title] of GUIDE_SECTIONS) {
        html += `<div class="guide-sec"><h6>${title}</h6><ul>` + GENERIC_GUIDE[sec].map(t => `<li>${esc(t)}</li>`).join('') + '</ul></div>';
      }
    }
    html += '</div>';
  }
  html += '<p class="disclaimer">本报告是基于有限观察的探索性画像（评分规则 ' + SCORING_VERSION + '），不是心理诊断或人格测量。结论会随新记录修正。</p>';
  box.innerHTML = html;
  return r;
}

/* ---------- profile / app ---------- */
const $ = id => document.getElementById(id);

function elIndex(scores, n) {
  const idx = {};
  EL_KEYS.forEach(k => { idx[k] = n ? Math.min(100, Math.round(scores[k] / (2 * n) * 100)) : 0; });
  return idx;
}

function renderStats() {
  const grid = $('statsGrid');
  if (!grid) return;
  const totalObs = data.observations.length;
  const scoredObs = data.observations.filter(o => o.source !== 'inference').length;
  const dist = { water: 0, fire: 0, earth: 0, air: 0 };
  let withMain = 0;
  for (const p of data.persons) {
    const r = computeScores(data.observations.filter(o => o.personId === p.id));
    if (r.mainElement) { dist[r.mainGroup[0]]++; withMain++; }
  }
  const card = (num, label) => `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`;
  let donutHtml;
  if (!withMain) {
    donutHtml = `<div class="donut" style="background:#E9E4D8"><div class="donut-hole">0</div></div><div class="donut-legend">主要线索分布<br><span style="color:var(--muted)">暂无达到判断条件的人物</span></div>`;
  } else {
    let acc = 0; const parts = [];
    EL_KEYS.forEach(k => {
      if (!dist[k]) return;
      const from = acc / withMain * 360; acc += dist[k]; const to = acc / withMain * 360;
      parts.push(`${ELEMENTS[k].color} ${from}deg ${to}deg`);
    });
    const legend = EL_KEYS.filter(k => dist[k]).map(k => `<span class="dot" style="background:${ELEMENTS[k].color}"></span>${ELEMENTS[k].name} ${dist[k]} 人`).join('<br>');
    donutHtml = `<div class="donut" style="background:conic-gradient(${parts.join(',')})"><div class="donut-hole">${withMain}</div></div><div class="donut-legend">主要线索分布<br>${legend}</div>`;
  }
  grid.innerHTML = card(data.persons.length, '观察对象（人物档案）') + card(totalObs, '观察记录总数') +
    card(scoredObs, '有效计分记录') + card(withMain, '已形成主要线索的人物') +
    `<div class="stat-card donut-card">${donutHtml}</div>`;
}

function renderPersons() {
  renderStats();
  const list = $('personList');
  list.innerHTML = '';
  $('emptyHint').style.display = data.persons.length ? 'none' : 'block';
  for (const p of data.persons) {
    const obs = data.observations.filter(o => o.personId === p.id);
    const r = computeScores(obs);
    const n = obs.filter(o => o.source !== 'inference').length;
    const idx = elIndex(r.scores, n);
    const domKey = r.mainElement || EL_KEYS.reduce((a, b) => idx[a] >= idx[b] ? a : b);
    const card = document.createElement('div');
    card.className = 'person-card';
    let chips = '';
    if (r.mainElement) chips = r.mainGroup.map(k => `<span class="chip${k === 'earth' ? ' chip-earth' : ''}" style="background:${ELEMENTS[k].color}">主要线索·${ELEMENTS[k].name}</span>`).join('') +
      r.secondaryElements.map(k => `<span class="chip${k === 'earth' ? ' chip-earth' : ''}" style="background:${ELEMENTS[k].color};opacity:.65">副·${ELEMENTS[k].name}</span>`).join('');
    else chips = '<span class="chip" style="background:#9AA3AD">证据不足</span>';
    let mini;
    if (!n) mini = '<div class="mini-note">暂无互动记录</div>';
    else {
      mini = '<div class="mini-bars">' + EL_KEYS.map(k =>
        `<div class="mini-row"><span class="m-name" style="color:${ELEMENTS[k].deep}">${ELEMENTS[k].name}</span><span class="mini-bar"><i style="width:${idx[k]}%;background:${ELEMENTS[k].color}"></i></span><span class="mini-val">${idx[k]}</span></div>`).join('') +
        (n < 5 ? '<div class="mini-note">四象线索指数（0–100）· 记录不足，继续观察</div>' : '<div class="mini-note">四象线索指数（0–100），不是人格测量百分比</div>') + '</div>';
    }
    card.innerHTML = `<div class="pc-bar" style="background:${n ? ELEMENTS[domKey].color : '#D8D2C4'}"></div><div class="pc-body"><h3>${esc(p.alias)}</h3><p>${esc(p.relationship)}${p.description ? ' · ' + esc(p.description) : ''}</p><p>${obs.length} 条观察记录</p><div class="chips">${chips}</div>${mini}</div>`;
    card.onclick = () => openDetail(p.id);
    list.appendChild(card);
  }
}

function openDetail(pid) {
  currentPersonId = pid;
  const p = data.persons.find(x => x.id === pid);
  if (!p) return;
  $('detail').classList.remove('hidden');
  $('detailTitle').textContent = p.alias;
  $('detailMeta').textContent = `${p.relationship}${p.description ? ' · ' + p.description : ''} · 建档于 ${String(p.createdAt).slice(0, 10)}`;
  renderObs();
  buildReport(p, data.observations.filter(o => o.personId === pid));
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

function renderObs() {
  const obs = data.observations.filter(o => o.personId === currentPersonId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const box = $('obsList');
  if (!obs.length) { box.innerHTML = '<p class="obs-meta">还没有记录。点“添加记录”，写下你亲眼看到的一件具体小事。</p>'; return; }
  box.innerHTML = obs.map(o => {
    const tags = (o.evidence || []).map(ev => `<span class="tag" style="background:${ELEMENTS[ev.element].color}">${ELEMENTS[ev.element].name} ${ev.weight}</span>`).join('');
    return `<div class="obs-item"><p>${esc(o.content)}</p>
      <p class="obs-meta">${esc(o.date)} · ${esc(o.context)} · ${SOURCE_LABEL[o.source]}</p>
      <p>${tags}</p>${o.autoMood ? `<p class="obs-meta">自动分析心情：${esc(o.autoMood.label)}（置信度 ${esc(o.autoMood.confidence)}）</p>` : ''}${o.notes ? `<p class="obs-meta">其他解释：${esc(o.notes)}</p>` : ''}
      <div class="obs-btns"><button class="btn btn-sm" onclick="editObs('${o.id}')">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="deleteObs('${o.id}')">删除</button></div></div>`;
  }).join('');
}

window.editObs = function (id) {
  const o = data.observations.find(x => x.id === id); if (!o) return;
  editingObsId = id;
  $('obsFormTitle').textContent = '编辑观察记录';
  $('oContent').value = o.content; $('oContext').value = o.context; $('oDate').value = o.date;
  $('oSource').value = o.source; $('oEvent').value = o.eventId || ''; $('oNotes').value = o.notes || '';
  document.querySelectorAll('.ev-check').forEach(c => { c.checked = false; });
  document.querySelectorAll('.ev-weight').forEach(s => { s.value = '1'; });
  for (const ev of (o.evidence || [])) {
    const c = document.querySelector(`.ev-check[data-el="${ev.element}"]`);
    const s = document.querySelector(`.ev-weight[data-el="${ev.element}"]`);
    if (c) c.checked = true; if (s) s.value = String(ev.weight);
  }
  $('dlgObs').showModal();
};
window.deleteObs = function (id) {
  if (!confirm('删除这条记录？分析报告会随之变化。')) return;
  data.observations = data.observations.filter(x => x.id !== id);
  const p = data.persons.find(x => x.id === currentPersonId);
  if (p) p.observationIds = data.observations.filter(o => o.personId === p.id).map(o => o.id);
  saveData(); renderObs(); if (p) buildReport(p, data.observations.filter(o => o.personId === p.id)); 
};

/* 人物表单 */
$('btnAddPerson').onclick = () => { editingPersonId = null; $('personFormTitle').textContent = '新建人物'; $('formPerson').reset(); $('dlgPerson').showModal(); };
$('btnEditPerson').onclick = () => {
  const p = data.persons.find(x => x.id === currentPersonId); if (!p) return;
  editingPersonId = p.id; $('personFormTitle').textContent = '编辑人物';
  $('fAlias').value = p.alias; $('fRel').value = p.relationship; $('fDesc').value = p.description || '';
  $('dlgPerson').showModal();
};
$('formPerson').addEventListener('submit', e => {
  e.preventDefault();
  const alias = $('fAlias').value.trim(); if (!alias) return;
  let savedId = editingPersonId;
  if (editingPersonId) {
    const p = data.persons.find(x => x.id === editingPersonId);
    p.alias = alias; p.relationship = $('fRel').value; p.description = $('fDesc').value.trim(); p.updatedAt = nowISO();
  } else {
    savedId = uid('p_');
    data.persons.push({ id: savedId, alias, relationship: $('fRel').value, description: $('fDesc').value.trim(), createdAt: nowISO(), updatedAt: nowISO(), observationIds: [], deletedAt: null });
  }
  $('dlgPerson').close();
  saveData(); renderPersons();
  openDetail(savedId);
});
$('btnDeletePerson').onclick = () => {
  const p = data.persons.find(x => x.id === currentPersonId); if (!p) return;
  if (!confirm(`删除人物「${p.alias}」？会同步删除他的全部观察记录和分析，此操作不可恢复（建议先导出备份）。`)) return;
  data.observations = data.observations.filter(o => o.personId !== p.id);
  data.analyses = data.analyses.filter(a => a.personId !== p.id);
  data.persons = data.persons.filter(x => x.id !== p.id);
  currentPersonId = null; saveData(); $('detail').classList.add('hidden'); renderPersons();
};
$('btnBack').onclick = () => { currentPersonId = null; $('detail').classList.add('hidden'); renderPersons(); };

/* 记录表单 */
$('btnAddObs').onclick = () => {
  editingObsId = null; $('obsFormTitle').textContent = '添加观察记录'; $('formObs').reset();
  $('oDate').value = new Date().toISOString().slice(0, 10);
  $('dlgObs').showModal();
};
$('formObs').addEventListener('submit', e => {
  e.preventDefault();
  const evidence = [];
  document.querySelectorAll('.ev-check').forEach(c => {
    if (c.checked) {
      const w = document.querySelector(`.ev-weight[data-el="${c.dataset.el}"]`);
      evidence.push({ element: c.dataset.el, weight: Number(w.value), note: '' });
    }
  });
  const fields = {
    personId: currentPersonId, source: $('oSource').value, context: $('oContext').value.trim(),
    date: $('oDate').value, content: $('oContent').value.trim(), evidence,
    eventId: $('oEvent').value.trim() || uid('evt_'), notes: $('oNotes').value.trim()
  };
  if (editingObsId) Object.assign(data.observations.find(x => x.id === editingObsId), fields);
  else data.observations.push(Object.assign({ id: uid('o_') }, fields));
  const p = data.persons.find(x => x.id === currentPersonId);
  if (p) { p.observationIds = data.observations.filter(o => o.personId === p.id).map(o => o.id); p.updatedAt = nowISO(); }
  $('dlgObs').close();
  saveData(); renderObs(); if (p) buildReport(p, data.observations.filter(o => o.personId === p.id)); renderPersons();
});

document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());

/* 示例数据：人物A逐条权重表 V1（见 SCORING_RULES 第10章）
   1 小组冲突先听后总结 水2 土1 / 2 整理任务清单 土2 / 3 提新活动方案 风2
   4 亲口说喜欢尝试陌生领域 风1 / 5 帮受批评组员说话 水1
   预期总分：水3 火0 土3 风3（三个元素并列，演示“不强行分主副”） */
$('btnDemo').onclick = () => {
  if (data.persons.some(p => p.alias === '示例·同学A')) { alert('示例人物已经载入过了，在列表里点开就能看。'); return; }
  const pid = uid('p_');
  const mk = (content, context, date, source, evidence, eventId) =>
    ({ id: uid('o_'), personId: pid, content, context, date, source, evidence, eventId, notes: '' });
  const obs = [
    mk('小组起冲突时，先听双方说完，再总结出共同点', '小组讨论', '2026-11-20', 'observed', [{ element: 'water', weight: 2, note: '先倾听' }, { element: 'earth', weight: 1, note: '总结推动结论' }], 'evt_demo_1'),
    mk('课程项目里整理了任务清单并分工', '课程项目', '2026-11-21', 'observed', [{ element: 'earth', weight: 2, note: '组织落实' }], 'evt_demo_2'),
    mk('社团里提出了一个新活动方案', '社团活动', '2026-11-22', 'observed', [{ element: 'air', weight: 2, note: '新想法' }], 'evt_demo_3'),
    mk('亲口说自己喜欢尝试陌生领域', '日常聊天', '2026-11-23', 'self_report', [{ element: 'air', weight: 1, note: '亲口表达' }], 'evt_demo_4'),
    mk('组员受批评时主动帮他说话、缓和气氛', '小组讨论', '2026-11-24', 'observed', [{ element: 'water', weight: 1, note: '维护关系' }], 'evt_demo_5')
  ];
  obs[0].notes = '也可能只是因为他是组长，在履行职责';
  data.persons.push({ id: pid, alias: '示例·同学A', relationship: '同学', description: '演示数据，可随时删除', createdAt: nowISO(), updatedAt: nowISO(), observationIds: obs.map(o => o.id), deletedAt: null });
  data.observations.push(...obs);
  saveData(); renderPersons(); openDetail(pid);
};

/* 数据管理 */
$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'elements_backup_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};
$('fileImport').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.persons) || !Array.isArray(d.observations)) throw new Error('bad');
      if (!confirm('导入将整体替换当前全部数据，确定继续？')) return;
      data = { version: 1, persons: d.persons, observations: d.observations, analyses: Array.isArray(d.analyses) ? d.analyses : [] };
      currentPersonId = null; saveData(); $('detail').classList.add('hidden'); renderPersons();
      alert('导入成功。');
    } catch (err) { alert('导入失败：文件格式不对，现有数据未被改动。'); }
    e.target.value = '';
  };
  reader.readAsText(f);
});
$('btnClearAll').onclick = () => {
  if (!confirm('清空全部人物、记录和分析？不可恢复，建议先导出备份。')) return;
  data = { version: 1, persons: [], observations: [], analyses: [] };
  currentPersonId = null; saveData(); $('detail').classList.add('hidden'); renderPersons();
};

renderPersons();
const heroCreate = $('btnHeroCreate');
if (heroCreate) heroCreate.onclick = () => $('btnAddPerson').click();
const heroExplore = $('btnHeroExplore');
if (heroExplore) heroExplore.onclick = () => $('featBlk').scrollIntoView({ behavior: 'smooth' });

/* ---------- 自动分析（auto.js 本地规则引擎） ---------- */
let lastAuto = null, lastAutoText = '';
function renderAutoResult(r, text) {
  const box = $('autoResult');
  const maxScore = Math.max(3, ...EL_KEYS.map(k => r.scores[k]));
  let html = '';
  EL_KEYS.forEach(k => {
    const e = ELEMENTS[k];
    const hits = r.hits[k].map(h => h.word).join('、');
    html += `<div class="score-row"><span class="s-name" style="color:${e.deep}">${e.name}·${e.label}</span>` +
      `<span class="bar"><i style="width:${Math.round(r.scores[k] / maxScore * 100)}%;background:${e.color}"></i></span>` +
      `<span class="s-val">${r.scores[k]} 分</span></div>` +
      (hits ? `<p class="obs-meta" style="margin:-4px 0 6px 84px">命中词：${esc(hits)}</p>` : '');
  });
  if (r.dominant) {
    html += '<div class="report-block"><h5>人物属性（本条输入反映）</h5><p>' +
      `<strong>主元素：${ELEMENTS[r.dominant].name}·${ELEMENTS[r.dominant].label}</strong></p><p>` +
      r.attributes.map(a => `<span class="attr-chip">${esc(a)}</span>`).join('') + '</p>' +
      '<p class="obs-meta">这是这一条输入反映的属性，长期画像以左侧多条记录的报告为准。</p></div>';
  }
  const emoWords = Object.values(r.emotions).flat().join('、');
  html += `<div class="mood-box"><p><strong>心情推算：${esc(r.mood.label)}</strong>（置信度：${r.confidence}）</p>` +
    `<p>${esc(r.mood.desc)}</p>` +
    (r.fuzzyUsed ? '<p class="obs-meta">本次为近似匹配（词库无精确词，按相近表达推算），置信度已下调。</p>' : '') +
    (r.scene ? `<p class="obs-meta">识别情景：<strong>${esc(r.scene.name)}</strong>（置信度 ${r.scene.confidence}${r.scene.second ? '，也可能涉及' + esc(r.scene.second) : ''}）｜这个情景下看人：${esc(r.scene.focus)}</p>` : '') +
    (r.scene && r.scene.interpretation ? `<div class="mood-box"><p><strong>情景化解读</strong>：${esc(r.scene.interpretation)}</p></div>` : '') +
    (r.modifiers && (r.modifiers.intensity || r.modifiers.frequency) ? `<p class="obs-meta">修饰标记：${r.modifiers.intensity ? '表达强度 ' + r.modifiers.intensity.label + '（“' + esc(r.modifiers.intensity.word) + '”）' : ''}${r.modifiers.intensity && r.modifiers.frequency ? ' · ' : ''}${r.modifiers.frequency ? '出现频率 ' + r.modifiers.frequency.label + '（“' + esc(r.modifiers.frequency.word) + '”）' : ''}——只作标记，不改变分数</p>` : '') +
    (emoWords ? `<p class="obs-meta">情绪命中词：${esc(emoWords)}</p>` : '') +
    (r.negatedHits.length ? `<p class="obs-meta">否定表达未计分：${r.negatedHits.map(h => esc(h.word)).join('、')}</p>` : '') +
    '<p class="obs-meta">推算依据：四象元素规则 + 情绪词库，本地计算。不是心理诊断。</p></div>';
  box.innerHTML = html;
}
$('btnAuto').onclick = () => {
  const text = $('autoInput').value.trim();
  if (!text) { alert('先输入一件事或一句话再分析。'); return; }
  if (typeof analyzeText !== 'function') { alert('自动分析引擎未加载，请刷新页面重试。'); return; }
  lastAuto = analyzeText(text); lastAutoText = text;
  renderAutoResult(lastAuto, text);
  $('btnAutoSave').disabled = !lastAuto.evidence.length;
  if (!lastAuto.evidence.length && !lastAuto.mainEmotion) {
    $('autoResult').innerHTML = '<div class="mood-box"><p><strong>暂时没有找到明确匹配</strong></p>' +
      '<p>这不代表你的描述没有意义，只是现有知识包暂时无法准确归类，所以不计算元素分数、也不硬猜。你可以补充：这是他偶尔一次的表现还是经常如此？当时发生了什么？他具体做了什么（而不是你觉得他是什么样的人）？补充后重新分析即可。原始描述也可以先用下方“添加记录”手动保存。</p></div>';
  }
};
$('btnAutoSave').onclick = () => {
  if (!lastAuto || !currentPersonId) return;
  const o = {
    id: uid('o_'), personId: currentPersonId, source: 'observed', context: '自动分析',
    date: new Date().toISOString().slice(0, 10), content: lastAutoText,
    evidence: lastAuto.evidence, eventId: uid('evt_'), notes: '',
    autoMood: { label: lastAuto.mood.label, desc: lastAuto.mood.desc, confidence: lastAuto.confidence }
  };
  data.observations.push(o);
  const p = data.persons.find(x => x.id === currentPersonId);
  if (p) { p.observationIds = data.observations.filter(x => x.personId === p.id).map(x => x.id); p.updatedAt = nowISO(); }
  saveData(); renderObs(); if (p) buildReport(p, data.observations.filter(x => x.personId === p.id)); renderPersons();
  $('btnAutoSave').disabled = true;
  alert('已存为记录，报告已更新。来源默认“亲眼观察”，如不对可在记录里编辑修改。');
};
$('btnAutoFill').onclick = () => {
  const text = $('oContent').value.trim();
  if (!text) { alert('先写行为描述，再自动勾选。'); return; }
  if (typeof analyzeText !== 'function') { alert('自动分析引擎未加载，请刷新页面重试。'); return; }
  const r = analyzeText(text);
  if (!r.evidence.length) { alert('没有命中元素关键词，把行为写得更具体些，或手动勾选。'); return; }
  document.querySelectorAll('.ev-check').forEach(c => { c.checked = false; });
  for (const ev of r.evidence) {
    const c = document.querySelector(`.ev-check[data-el="${ev.element}"]`);
    const s = document.querySelector(`.ev-weight[data-el="${ev.element}"]`);
    if (c) c.checked = true; if (s) s.value = String(ev.weight);
  }
  alert('已按自动分析勾选：' + r.evidence.map(ev => ELEMENTS[ev.element].name + ev.weight + '分').join('、') + '。保存前你可以再改。');
};

renderPersons();

/* ---------- 模拟对话 UI（与真实记录隔离：只存在页面内存里） ---------- */
let simRounds = [];
function simProfile() {
  const obs = data.observations.filter(o => o.personId === currentPersonId);
  const r = computeScores(obs);
  const scored = obs.filter(o => o.source !== 'inference');
  return {
    mainElement: r.mainElement, secondary: r.secondaryElements && r.secondaryElements[0],
    secondaryName: r.secondaryElements && r.secondaryElements[0] ? ELEMENTS[r.secondaryElements[0]].name : null,
    obsCount: scored.length,
    evidenceCount: r.mainElement ? obs.filter(o => (o.evidence || []).some(e => e.element === r.mainElement)).length : 0
  };
}
function simPush(cls, text) {
  const d = document.createElement('div');
  d.className = 'bubble ' + cls; d.textContent = text;
  $('simLog').appendChild(d); $('simLog').scrollTop = 1e6;
}
function simPushWhy(html) {
  const d = document.createElement('div');
  d.className = 'sim-why'; d.innerHTML = html;
  $('simLog').appendChild(d); $('simLog').scrollTop = 1e6;
}
if ($('simScene') && typeof SIM_SCENES !== 'undefined') {
  $('simScene').innerHTML = SIM_SCENES.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
  $('btnSimOpen').onclick = () => {
    if (!currentPersonId) { alert('先打开一个人物档案，再开始模拟对话。'); return; }
    const p = simProfile();
    const sceneId = $('simScene').value;
    const op = OPENINGS[sceneId];
    const line = op[p.mainElement || 'neutral'] || op.neutral;
    const sceneName = (SIM_SCENES.find(x => x[0] === sceneId) || [])[1] || '';
    simPush('bubble-him', '（情景：' + sceneName + '）' + line);
    simPushWhy(`<p>这是按${p.mainElement ? '他的主要线索（' + ELEMENTS[p.mainElement].name + '）' : '中性模板'}生成的开场回应。${esc(p.obsCount ? '' : '暂无该人物记录，当前仅为通用情景演示。')}</p>`);
    simRounds = [];
  };
  $('btnSimClear').onclick = () => { $('simLog').innerHTML = ''; simRounds = []; };
  const doSimSend = () => {
    if (!currentPersonId) { alert('先打开一个人物档案，再开始模拟对话。'); return; }
    const text = $('simInput').value.trim();
    if (!text) return;
    $('simInput').value = '';
    simPush('bubble-me', text);
    const p = simProfile();
    const res = simulateReply(p, text);
    simPush('bubble-him', res.reply);
    simPushWhy(`<p><strong>话语类型</strong>：${esc(res.speech.name)}｜<strong>可能原因</strong>：${esc(res.why)}</p>` +
      `<p><strong>沟通建议</strong>：${esc(res.advice)}</p>` +
      `<p><strong>不确定性</strong>：${esc(res.tier)}（模拟可信度：${res.confidence}）。这是规则推测，不是他本人真实想法。</p>`);
    simRounds.push({ text, reply: res.reply });
    if (simRounds.length > 3) simRounds.shift();
  };
  $('btnSimSend').onclick = doSimSend;
  $('simInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSimSend(); });
}
