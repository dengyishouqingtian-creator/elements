'use strict';
/* ELEMENTS 自动分析引擎（本地规则版 v1）
   原理：元素关键词词库 + 情绪词库 + 四象心情推算规则，全在本地运行，不调任何 API。
   说明：这是规则推算，不是读心。输出必须带命中词作为证据，并标注置信度；
   元素分只反映“这段输入里”的倾向，人物长期画像仍以多条记录的评分引擎为准。 */

/* 元素词库：strong 为强信号（权重 2），其余权重 1。词条按行为/表达选词，避免纯情绪词冒充行为证据。 */
const EL_LEXICON = {
  water: {
    strong: ['安慰', '倾听', '共情', '照顾', '陪伴', '缓和气氛', '帮他说话', '帮她说话', '替人着想', '体贴'],
    words: ['关心', '在意', '在乎', '感受', '委屈', '感动', '同情', '包容', '温柔', '亲近', '疏远', '冷落', '孤独', '想念', '依赖', '信任', '和好', '道歉', '原谅', '敏感', '心软', '理解别人', '陪', '关系', '朋友', '情绪', '心情']
  },
  fire: {
    strong: ['带头', '拍板', '拿第一', '争第一', '冲在前面', '立刻行动', '主动请缨', '立下目标'],
    words: ['主动', '催', '赶紧', '立刻', '目标', '赢', '第一', '比赛', '竞争', '挑战', '拼', '干劲', '推进', '领导', '指挥', '决定', '果断', '效率', '冲刺', '不服输', '好胜']
  },
  earth: {
    strong: ['制定计划', '列清单', '提前完成', '说到做到', '井井有条', '按计划'],
    words: ['计划', '安排', '整理', '秩序', '规则', '按时', '负责', '承诺', '坚持', '踏实', '稳重', '细致', '检查', '清单', '分工', '落实', '守时', '可靠', '认真', '习惯', '务实', '稳定', '存钱', '节省']
  },
  air: {
    strong: ['冒险', '新点子', '说走就走', '尝试陌生', '没去过的地方', '换个活法'],
    words: ['好奇', '探索', '尝试', '旅行', '自由', '想法', '点子', '创意', '改变', '厌倦', '无聊', '随性', '开放', '陌生', '体验', '灵活', '新鲜', '感兴趣', '想学', '跨界', '随便', '看心情']
  }
};

/* 元素对应的人物属性（输入命中后即时反映的属性倾向） */
const EL_ATTRIBUTES = {
  water: ['共情力强', '在意他人感受', '关系导向', '情感细腻'],
  fire: ['行动力强', '目标感强', '竞争意识强', '直接果断'],
  earth: ['条理清楚', '可靠守信', '责任心强', '追求稳定'],
  air: ['好奇心强', '想法多', '追求自由', '适应变化']
};

/* 情绪词库：cat -> {label, polarity(+1/-1/0), arousal(high/low/mid), words} */
const EMOTIONS = {
  joy:        { label: '愉快', polarity: 1, arousal: 'mid', words: ['开心', '高兴', '快乐', '笑', '愉快', '满意', '惊喜', '幸福'] },
  excitement: { label: '兴奋', polarity: 1, arousal: 'high', words: ['兴奋', '激动', '迫不及待', '热血', '期待'] },
  calm:       { label: '平静', polarity: 1, arousal: 'low', words: ['平静', '踏实', '安心', '放松', '淡定', '稳定'] },
  anger:      { label: '愤怒/烦躁', polarity: -1, arousal: 'high', words: ['生气', '愤怒', '恼火', '不满', '抱怨', '烦躁', '急躁', '吵架', '发火'] },
  anxiety:    { label: '焦虑/紧张', polarity: -1, arousal: 'high', words: ['焦虑', '紧张', '担心', '害怕', '心慌', '不安', '压力大', '怕'] },
  sadness:    { label: '低落/难过', polarity: -1, arousal: 'low', words: ['难过', '伤心', '哭', '低落', '失落', '委屈', '沮丧', '心酸', '孤独', '想念'] },
  tired:      { label: '疲惫', polarity: -1, arousal: 'low', words: ['累', '疲惫', '没精神', '熬夜', '失眠', '困'] }
};

/* 心情推算规则：主元素 × 主要情绪 -> 心情画像。查不到组合时用兜底规则。 */
const MOOD_RULES = {
  'water+sadness': ['水象低落', '情绪偏低、情感需求高，可能正需要安慰和陪伴，而不是讲道理。'],
  'water+anxiety': ['水象不安', '多半在担心关系变化或被冷落，需要明确的回应和确认。'],
  'water+joy': ['水象柔和', '关系融洽带来的满足感，心情柔和、愿意亲近人。'],
  'water+anger': ['水象委屈型生气', '生气背后多是觉得不被理解或在意，先处理感受再谈事情。'],
  'fire+anger': ['火象急躁', '目标受阻引发的急躁，容易与人起冲突，先降速再沟通。'],
  'fire+excitement': ['火象亢奋', '干劲十足、急于推进，适合趁势行动，但要注意别给别人压力。'],
  'fire+joy': ['火象亢奋', '干劲十足、急于推进，适合趁势行动，但要注意别给别人压力。'],
  'fire+anxiety': ['火象紧绷', '怕落后、怕输带来的紧绷，会催自己也催别人。'],
  'earth+calm': ['土象稳定', '状态踏实可控，按自己的节奏推进就好。'],
  'earth+anxiety': ['土象秩序焦虑', '担心计划被打乱或事情失控，给出明确安排能让他安心。'],
  'earth+tired': ['土象硬撑', '责任在身靠意志维持，实际已经疲惫，需要休息而不是加任务。'],
  'earth+anger': ['土象压着火', '多半是规则或承诺被破坏触怒了他，表面克制、心里计较。'],
  'air+excitement': ['风象兴奋', '被新鲜事物点燃，兴趣浓、想法多，适合顺着好奇心走。'],
  'air+joy': ['风象轻快', '心情轻快开放，愿意尝试和分享。'],
  'air+sadness': ['风象倦怠', '低落里带着想逃离现状的念头，需要换环境或新刺激。'],
  'air+tired': ['风象倦怠', '倦怠里带着想逃离现状的念头，需要换环境或新刺激。'],
  'air+anger': ['风象受束缚烦躁', '烦躁多来自被管束、被安排，越催越反弹。'],
  'air+anxiety': ['风象摇摆', '想法多又拿不定主意，在几个选项之间摇摆。']
};


/* ---------- 知识包 v2 扩充（由四象概念蒸馏的表达层：性格词 + 口语词） ---------- */
const EXTRA_EL = {
  water: { strong: ['善解人意', '重感情', '心疼'],
    words: ['温柔', '心细', '细腻', '体谅', '挂念', '牵挂', '念旧', '黏人', '社恐', '内向', '慢热', '交朋友', '聊心里话', '知心', '贴心', '心软', '共鸣', '被理解', '安全感', '归属感', '亲密', '疏离', '失望', '被忽视', '主动联系', '回消息', '陪聊'] },
  fire: { strong: ['说干就干', '争强好胜', '雷厉风行'],
    words: ['努力', '上进', '要强', '奋斗', '拼命', '执行力', '风风火火', '急性子', '直来直去', '干脆', '热情', '带队', '组长', '队长', '出头', '表现欲', '不服', '较劲', '争', '抢着', '第一个', '冲', '干', '行动派', '目标感'] },
  earth: { strong: ['自律', '坚持不懈', '有条理'],
    words: ['努力学习', '勤奋', '规划', '时间表', '准时', '严谨', '固执', '保守', '抠细节', '条理', '规矩', '靠谱', '稳', '慢条斯理', '不慌', '从容', '冷静', '理性', '务实', '节俭', '存钱', '复习', '预习', '做笔记', '打卡', '日程', '安排得', '井然有序'] },
  air: { strong: ['脑洞大', '想象力', '喜新厌旧'],
    words: ['开朗', '幽默', '脑洞', '稀奇古怪', '新鲜感', '三分钟热度', '放飞', '洒脱', '不拘小节', '讨厌被管', '追求自由', '随心所欲', '天马行空', '点子多', '鬼点子', '好奇心', '什么都想试', '换来换去', '坐不住', '爱玩', '会玩', '有趣', '好玩', '无拘无束'] }
};
const EXTRA_EMO = {
  joy: ['乐呵呵', '欣慰', '美滋滋', '眉开眼笑', '兴高采烈'],
  excitement: ['跃跃欲试', '摩拳擦掌', '按捺不住', '热血沸腾'],
  calm: ['稳如泰山', '心平气和', '不慌不忙', '悠然'],
  anger: ['发脾气', '上火', '气愤', '不爽', '怼', '翻脸', '暴躁', '窝火'],
  anxiety: ['着急', '忐忑', '坐立不安', '手心出汗', '七上八下', '提心吊胆'],
  sadness: ['心情不好', '郁闷', '憋屈', '失望', '发呆', '沉默', '不说话', '一个人待着', '心灰意冷', '红了眼眶'],
  tired: ['无精打采', '哈欠', '眼皮打架', '心累', '撑不住', '想躺平']
};
for (const k of Object.keys(EXTRA_EL)) {
  EL_LEXICON[k].strong.push(...EXTRA_EL[k].strong);
  EL_LEXICON[k].words.push(...EXTRA_EL[k].words);
}
for (const c of Object.keys(EXTRA_EMO)) EMOTIONS[c].words.push(...EXTRA_EMO[c]);

/* 同义词归一：口语说法 -> 词库标准说法，匹配前先替换（显示命中词时为标准说法） */
const SYNONYMS = {
  '心情不好': '难过', '不开心': '难过', '发脾气': '生气', '睡不着': '失眠',
  '没意思': '无聊', '心累': '累', '气死': '生气', '急死': '焦虑',
  '想太多': '焦虑', '压力山大': '压力大', '美滋滋': '开心', '乐开花': '开心',
  '红眼眶': '哭', '红了眼': '哭', '掉眼泪': '哭', '抹眼泪': '哭',
  '不理人': '冷落', '不搭理': '冷落', '黏着': '黏人', '抢着做': '主动'
};
function normalizeText(t) {
  let out = t;
  for (const k of Object.keys(SYNONYMS)) out = out.split(k).join(SYNONYMS[k]);
  return out;
}

/* 模糊弱匹配：精确零命中时用字组相似度兜底，只给弱分（1 分）并标注 weak */
function fuzzyHits(text, k) {
  const lex = EL_LEXICON[k];
  const all = [...lex.strong, ...lex.words];
  const found = [];
  const bigrams = new Set();
  for (let i = 0; i < text.length - 1; i++) bigrams.add(text.slice(i, i + 2));
  for (const w of all) {
    if (w.length < 2 || text.includes(w)) continue;
    if (w.length === 2) {
      const i1 = text.indexOf(w[0]), i2 = text.indexOf(w[1]);
      if (i1 !== -1 && i2 !== -1 && Math.abs(i1 - i2) <= 3) found.push(w);
    } else {
      let hit = 0, tot = 0;
      for (let i = 0; i < w.length - 1; i++) { tot++; if (bigrams.has(w.slice(i, i + 2))) hit++; }
      if (tot && hit / tot >= 0.6) found.push(w);
    }
    if (found.length >= 2) break;
  }
  return found;
}

function findHits(text, words) {
  const hits = [];
  for (const w of words) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      const b3 = text.slice(Math.max(0, idx - 3), idx);
      const negated = !/(特别|分别|告别|差别)$/.test(b3) && /[不没无别未]$/.test(b3);
      hits.push({ word: w, index: idx, negated });
      idx = text.indexOf(w, idx + w.length);
    }
  }
  return hits;
}

function analyzeText(text) {
  text = normalizeText(String(text || ''));
  const elScores = { water: 0, fire: 0, earth: 0, air: 0 };
  const elHits = { water: [], fire: [], earth: [], air: [] };
  const negatedHits = [];
  for (const k of Object.keys(EL_LEXICON)) {
    const lex = EL_LEXICON[k];
    for (const h of findHits(text, lex.strong)) {
      if (h.negated) { negatedHits.push({ element: k, word: h.word }); continue; }
      elScores[k] += 2; elHits[k].push({ word: h.word, weight: 2 });
    }
    for (const h of findHits(text, lex.words)) {
      if (h.negated) { negatedHits.push({ element: k, word: h.word }); continue; }
      elScores[k] += 1; elHits[k].push({ word: h.word, weight: 1 });
    }
  }
  // 情绪
  const emoHits = {};
  let emoTotal = 0;
  for (const cat of Object.keys(EMOTIONS)) {
    const hs = findHits(text, EMOTIONS[cat].words).filter(h => !h.negated);
    if (hs.length) { emoHits[cat] = hs.map(h => h.word); emoTotal += hs.length; }
  }
  const emoCats = Object.keys(emoHits).sort((a, b) => emoHits[b].length - emoHits[a].length);
  const mainEmotion = emoCats.length ? emoCats[0] : null;

  // 精确零命中时启用模糊弱匹配兜底
  let fuzzyUsed = false;
  if (Object.values(elScores).every(v => v === 0)) {
    for (const k of Object.keys(EL_LEXICON)) {
      for (const w of fuzzyHits(text, k)) { elScores[k] += 1; elHits[k].push({ word: w + '(近似)', weight: 1, weak: true }); fuzzyUsed = true; }
    }
  }
  const sorted = Object.keys(elScores).sort((a, b) => elScores[b] - elScores[a]);
  const dominant = elScores[sorted[0]] > 0 ? sorted[0] : null;
  const totalHits = Object.values(elHits).reduce((s, a) => s + a.length, 0) + emoTotal;

  // 心情推算
  let mood = null;
  if (dominant && mainEmotion) {
    const rule = MOOD_RULES[dominant + '+' + mainEmotion];
    if (rule) mood = { label: rule[0], desc: rule[1] };
    else {
      const pol = EMOTIONS[mainEmotion].polarity;
      mood = { label: '综合推算', desc: pol > 0 ? '整体情绪偏积极，结合主元素看状态不错。' : pol < 0 ? '整体情绪偏消极，结合主元素看当前状态承压。' : '情绪信号中性。' };
    }
  } else if (dominant) {
    mood = { label: '心情证据不足', desc: '这段输入只有行为信号、没有明确情绪词，只能推元素倾向，推不出心情。补充他当时的表情、语气或原话会更准。' };
  } else if (mainEmotion) {
    mood = { label: '只有情绪信号', desc: '只看得出情绪（' + EMOTIONS[mainEmotion].label + '），行为信息太少，推不出元素倾向。' };
  } else {
    mood = { label: '证据不足', desc: '没有命中任何元素或情绪关键词。把行为写具体些，例如他做了什么、说了什么、当时是什么表情。' };
  }

  const weighted = Object.values(elScores).reduce((s, v) => s + v, 0) + emoTotal;
  let confidence = weighted >= 6 ? '高' : weighted >= 3 ? '中' : weighted >= 1 ? '低' : '无';
  if (fuzzyUsed && confidence !== '无') confidence = '低';
  // 存为记录时的证据权重：元素分 >=3 -> 2 分，1-2 -> 1 分
  const evidence = Object.keys(elScores).filter(k => elScores[k] > 0)
    .map(k => ({ element: k, weight: elScores[k] >= 3 ? 2 : 1 }));

  return {
    scores: elScores, hits: elHits, negatedHits, emotions: emoHits, mainEmotion,
    dominant, mood, confidence, totalHits, evidence, fuzzyUsed,
    attributes: dominant ? EL_ATTRIBUTES[dominant] : []
  };
}

/* 近期心情：取最近若干条记录的文本做情绪加权（越近权重越高），结合画像主元素推算 */
function recentMood(observations, mainElement) {
  const sorted = [...observations].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
  if (!sorted.length) return null;
  const catScore = {};
  sorted.forEach((o, i) => {
    const w = 3 - i;
    const r = analyzeText(o.content + ' ' + (o.notes || ''));
    for (const cat of Object.keys(r.emotions)) catScore[cat] = (catScore[cat] || 0) + r.emotions[cat].length * w;
  });
  const cats = Object.keys(catScore).sort((a, b) => catScore[b] - catScore[a]);
  if (!cats.length) return { label: '心情证据不足', desc: '最近的记录里没有情绪词，推不出近期心情。在记录里补上他当时的情绪表现会更准。', basedOn: sorted.length };
  const main = cats[0];
  if (mainElement) {
    const rule = MOOD_RULES[mainElement + '+' + main];
    if (rule) return { label: rule[0], desc: rule[1], emotion: EMOTIONS[main].label, basedOn: sorted.length };
  }
  const pol = EMOTIONS[main].polarity;
  return { label: '近期偏' + EMOTIONS[main].label, desc: pol > 0 ? '最近记录里积极情绪占多，状态偏好。' : '最近记录里消极情绪占多，状态承压，多留意。', emotion: EMOTIONS[main].label, basedOn: sorted.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeText, recentMood, EL_LEXICON, EMOTIONS, MOOD_RULES, EL_ATTRIBUTES };
}
