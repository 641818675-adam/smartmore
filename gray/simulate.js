/* ============================================================
   模拟面板反馈生成器（本沙箱专用）

   ⚠️ 本脚本生成的反馈全部携带 "simulated": true。
   用途：本机完全离线、无真实用户分发通道时，驱动灰度迭代
   流程继续运转。每条反馈必须关联 findings 中的可复现证据
   （finding_id + evidence），改进依据是证据本身，不是虚构意见。

   用法：node gray/simulate.js 1        # 依据 findings/round-1.json 生成
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const GRAY = __dirname;
const round = process.argv[2] || '1';

const personas = JSON.parse(fs.readFileSync(path.join(GRAY, 'personas.json'), 'utf8')).panelists;
const findingsRaw = JSON.parse(
  fs.readFileSync(path.join(GRAY, 'findings', `round-${round}.json`), 'utf8'));
const findings = findingsRaw.items || [];
const inbox = path.join(GRAY, 'inbox');
if (!fs.existsSync(inbox)) fs.mkdirSync(inbox, { recursive: true });

/* 确定性伪随机（同轮次重跑结果一致，保证可复现） */
let seed = 20260830 + Number(round) * 1000;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

/* 严重度 → 该 finding 的基础不满概率与打分压低 */
const SEVERITY = {
  P0: { hit: 0.95, rating: [1, 2] },
  P1: { hit: 0.75, rating: [2, 3] },
  P2: { hit: 0.5, rating: [3, 3] },
  P3: { hit: 0.3, rating: [3, 4] },
};

const DEVICE_W = { 'fold3-folded': 832, 'fold3-open': 1768, 'bar-phone': 1080, tablet: 1600 };

/* 基线满意度：迁移 + 升级后的整体水位（真实用户分布通常是正偏态） */
function baselineRating(skill) {
  const r = rand();
  if (skill === 'expert') return r < 0.15 ? 3 : (r < 0.7 ? 4 : 5);
  if (skill === 'skilled') return r < 0.1 ? 3 : (r < 0.6 ? 4 : 5);
  return r < 0.25 ? 3 : (r < 0.75 ? 4 : 5);
}

const VOICES = {
  搜索: ['搜型号挺快', '从 Excel 粘过来没再炸出几百条', '偶尔想翻全库看配件'],
  选型: ['套包复制清单很省事', '线长切换顺手'],
  竞品: ['打单时查对标方便'],
  客户: ['客户页跟电脑版一样顺手', '录客户少打很多字', '复制清单自动带客户名很实用'],
  界面: ['界面舒服多了', '深色模式不刺眼了'],
  性能: ['没感觉卡'],
};

let generated = 0;
for (const p of personas) {
  // 命中该用户关注面的 findings
  const hits = findings.filter(
    (f) => f.affected_focus.some((k) => p.focus.includes(k)) ||
           (f.affected_devices && f.affected_devices.includes(p.device)));
  const raised = hits.filter((f) => rand() < SEVERITY[f.priority].hit);

  let rating;
  if (raised.length) {
    const worst = raised.reduce((a, b) => (SEVERITY[a.priority].rating[0] <= SEVERITY[b.priority].rating[0] ? a : b));
    const [lo, hi] = SEVERITY[worst.priority].rating;
    rating = Math.max(1, lo + (rand() < 0.5 ? 0 : hi - lo) - (raised.length > 2 ? 1 : 0));
  } else {
    rating = baselineRating(p.skill);
  }

  const cats = new Set();
  raised.forEach((f) => f.categories.forEach((c) => cats.add(c)));
  if (!cats.size && rand() < 0.6) cats.add(p.focus[Math.floor(rand() * p.focus.length)]);

  const rec = {
    type: 'partfinder-feedback',
    submitted_at: new Date(Date.UTC(2026, 7, 30, 2 + generated, 12 + generated % 40)).toISOString(),
    rating,
    categories: [...cats],
    message: raised.length
      ? raised.map((f) => f.voice).filter(Boolean).join('；')
      : VOICES[p.focus[0]] ? VOICES[p.focus[0]][Math.floor(rand() * VOICES[p.focus[0]].length)] : '',
    app_version: findingsRaw.app_version,
    data_version: '9.7.0',
    data_count: 1213,
    screen_width: DEVICE_W[p.device],
    screen_height: p.device === 'fold3-folded' ? 2268 : 2400,
    dark_mode: ['P-07', 'P-14', 'P-34'].includes(p.id),
    simulated: true,
    panelist: p.id,
    finding_ids: raised.map((f) => f.id),
    evidence: raised.length
      ? raised.map((f) => `${f.id}: ${f.evidence}`).join(' | ')
      : '无问题命中，仅基线体验打分',
  };

  const file = path.join(inbox, `r${round}-${p.id}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  generated++;
}

console.log(`[simulate] round-${round}：已生成 ${generated} 份模拟反馈（全部标注 simulated=true）到 gray/inbox/`);
console.log('[simulate] 提醒：本沙箱无真实用户通道；真实分发流程见 gray/README.md §三');
