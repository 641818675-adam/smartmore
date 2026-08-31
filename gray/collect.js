/* ============================================================
   灰度反馈聚合器（真实与模拟反馈通用）

   校验 gray/inbox/ 下的反馈 JSON → 聚合 → 生成 out/round-N-summary.md。
   模拟反馈（simulated=true）在报告中显式标注，绝不与真实反馈混同。

   用法：node gray/collect.js 1
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const GRAY = __dirname;
const round = process.argv[2] || '1';
const CATS = ['搜索', '选型', '竞品', '客户', '界面', '性能', '其他'];

const inbox = path.join(GRAY, 'inbox');
const outDir = path.join(GRAY, 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inbox)
  .filter((f) => f.startsWith(`r${round}-`) && f.endsWith('.json'))
  .sort();

if (!files.length) {
  console.error(`!! inbox/ 中没有 round-${round} 的反馈文件`);
  process.exit(1);
}

const records = [];
const invalid = [];
for (const f of files) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8'));
    const errs = [];
    if (rec.type !== 'partfinder-feedback') errs.push('type 不符');
    if (!Number.isInteger(rec.rating) || rec.rating < 1 || rec.rating > 5) errs.push('rating 非法');
    if (!rec.submitted_at) errs.push('缺 submitted_at');
    if (!rec.app_version) errs.push('缺 app_version');
    (rec.categories || []).forEach((c) => { if (!CATS.includes(c)) errs.push(`未知类别 ${c}`); });
    if (errs.length) { invalid.push(`${f}: ${errs.join(', ')}`); continue; }
    records.push(rec);
  } catch (e) {
    invalid.push(`${f}: JSON 解析失败`);
  }
}

const n = records.length;
const avg = records.reduce((s, r) => s + r.rating, 0) / n;
const dist = [1, 2, 3, 4, 5].map((v) => records.filter((r) => r.rating === v).length);
const simulated = records.filter((r) => r.simulated).length;
const real = n - simulated;
const catCount = {};
records.forEach((r) => (r.categories || []).forEach((c) => { catCount[c] = (catCount[c] || 0) + 1; }));

/* finding 频次与关联评分（定位最伤体验的问题） */
const findingStats = {};
records.forEach((r) => {
  (r.finding_ids || []).forEach((id) => {
    if (!findingStats[id]) findingStats[id] = { count: 0, ratings: [] };
    findingStats[id].count++;
    findingStats[id].ratings.push(r.rating);
  });
});
const findingsFile = path.join(GRAY, 'findings', `round-${round}.json`);
const findings = fs.existsSync(findingsFile)
  ? JSON.parse(fs.readFileSync(findingsFile, 'utf8')) : { items: [] };
const findingById = {};
(findings.items || []).forEach((f) => { findingById[f.id] = f; });

const findingRows = Object.entries(findingStats)
  .sort((a, b) => b[1].count - a[1].count)
  .map(([id, s]) => {
    const f = findingById[id] || { title: id, priority: '?' };
    const avgR = (s.ratings.reduce((x, y) => x + y, 0) / s.ratings.length).toFixed(1);
    return `| ${id} | ${f.priority} | ${f.title} | ${s.count} | ${avgR} |`;
  });

const csat = Math.round((dist[3] + dist[4]) / n * 100);
const bottom2 = dist[0] + dist[1];

const md = `# 第 ${round} 轮灰度反馈汇总

> 生成时间：${new Date().toISOString().slice(0, 19)} ｜ 反馈版本：${records[0].app_version}

> ⚠️ **数据来源**：${simulated ? `**含 ${simulated} 份模拟面板反馈（simulated=true，无真实用户通道，见 gray/README.md §四）**` : ''}${real ? `${real} 份真实用户反馈` : ''}。${simulated ? '改进依据为各 finding 的可复现证据链（测试断言/性能探针/代码走查），非虚构用户意见。' : ''}

## 总览

| 指标 | 值 |
|------|-----|
| 有效反馈 | ${n} 份（无效丢弃 ${invalid.length}） |
| 平均打分 | **${avg.toFixed(2)} / 5** |
| 打分分布 | 1★:${dist[0]} 2★:${dist[1]} 3★:${dist[2]} 4★:${dist[3]} 5★:${dist[4]} |
| 好评率（4–5★） | ${csat}% |
| 差评率（1–2★） | ${Math.round(bottom2 / n * 100)}% |

## 类别命中

| 类别 | 提及次数 |
|------|----------|
${CATS.filter((c) => catCount[c]).map((c) => `| ${c} | ${catCount[c]} |`).join('\n') || '| （无） | — |'}

## 问题命中排序

| Finding | 优先级 | 标题 | 命中人数 | 该群体均分 |
|---------|--------|------|----------|------------|
${findingRows.join('\n') || '| （无） | — | — | — | — |'}

## 用户原声（模拟画像语录，逐条绑定证据）

${records.filter((r) => r.message).slice(0, 12).map((r) => `- **${r.panelist}**（${r.rating}★）：${r.message}`).join('\n') || '（无文字反馈）'}

## 无效反馈

${invalid.length ? invalid.map((s) => `- ${s}`).join('\n') : '（无）'}

## 下一步

按 gray/README.md §五 优先级规则处理命中 findings，修复后进入 ROUND-${round} 记录并打包 rc${Number(round) + 1}。
`;

const outFile = path.join(outDir, `round-${round}-summary.md`);
fs.writeFileSync(outFile, md);
console.log(`[collect] round-${round}：${n} 份有效（模拟 ${simulated} / 真实 ${real}），平均 ${avg.toFixed(2)}★，好评率 ${csat}%`);
console.log(`[collect] 报告 -> ${outFile}`);
if (invalid.length) console.log(`[collect] 丢弃无效 ${invalid.length} 份`);
