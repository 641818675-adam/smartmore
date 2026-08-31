/* 设计令牌守门测试（P5-2）：对比度与字阶栅栏。
   用法：node tools/test_design.js   —— 打包前置，与 test_core/test_ui 同级。
   对比度算法 = WCAG 2.1 相对亮度定义；徽章底色按「tint 透明度合成到表面」复算。 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 样式已分层（tokens / base / components / views），按 index.html 顺序拼接后统一守门，
// 保证"零内联字号""无死令牌"等约束不会因为拆文件而漏检。
const CSS_FILES = ['tokens.css', 'base.css', 'components.css', 'views.css'];
const CSS = CSS_FILES.map((f) =>
  fs.readFileSync(path.join(ROOT, 'web', 'css', f), 'utf8')).join('\n');

// 守门对象扩大到全站 JS：视图层与核心层同样不允许出现 style=""
const JS_FILES = [
  'core/util.js', 'core/icons.js', 'core/store.js',
  'search.js', 'data.js', 'contract.js', 'customer.js',
  'ui/primitives.js', 'ui/modal.js',
  'views/chrome.js', 'views/results.js', 'views/config.js', 'views/rival.js',
  'views/customers.js', 'views/saved.js', 'views/detail.js',
  'app.js',
];
const JS = JS_FILES.map((f) =>
  fs.readFileSync(path.join(ROOT, 'web', 'js', f), 'utf8')).join('\n');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(f, b) {
  const [a, c] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (a + 0.05) / (c + 0.05);
}
/** tint（rgba 前景）以 alpha 叠在 bg 上的合成色。 */
function composite(fgHex, alpha, bgHex) {
  const p = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const f = p(fgHex), b = p(bgHex);
  return '#' + f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i])
    .toString(16).padStart(2, '0')).join('');
}

/** 解析某个选择器块内的自定义属性为 { name: value }。 */
function tokensIn(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  const out = {};
  if (m) {
    for (const kv of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[kv[1]] = kv[2].trim();
  }
  return out;
}
/* VISION.OS 单一暗色主题：所有对比度从 :root 令牌实算，
   主题换色时本守门无需改动（令牌即真相）。 */
const T = tokensIn(':root');
/* rgba() 令牌（表面分层）无法直接算亮度，解析为可算的实体色；
   表面 = rgba 白 A% 叠在 --bg 上（与浏览器合成一致）。 */
function overRgba(rgbaVal, baseHex) {
  const m = rgbaVal.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return rgbaVal;
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  const b = [0, 2, 4].map((i) => parseInt(baseHex.replace('#', '').slice(i, i + 2), 16));
  const f = [+m[1], +m[2], +m[3]];
  return '#' + f.map((v, i) => Math.round(a * v + (1 - a) * b[i])
    .toString(16).padStart(2, '0')).join('');
}
const SURFACE = overRgba(T['--surface'], T['--bg']);
const BG = T['--bg'].toLowerCase().startsWith('#') ? T['--bg'] : overRgba(T['--bg'], '#000000');

console.log(`\n对比度守门（WCAG 2.1，表面 ${SURFACE} / 底色 ${BG}）：`);

const BODY_TARGET = 4.5, PLACEHOLDER_TARGET = 3.0;
function tier(name, onSurface, onBg, target) {
  const fg = T[name];
  check(`${name} ${fg} on ${onSurface} ≥${target}`, ratio(fg, onSurface) >= target,
    ratio(fg, onSurface).toFixed(2));
  if (onBg) check(`${name} ${fg} on ${onBg} ≥${target}`, ratio(fg, onBg) >= target,
    ratio(fg, onBg).toFixed(2));
}
tier('--text', SURFACE, BG, BODY_TARGET);
tier('--text-2', SURFACE, BG, BODY_TARGET);
tier('--text-3', SURFACE, BG, BODY_TARGET);
tier('--text-4', SURFACE, BG, PLACEHOLDER_TARGET);
tier('--accent', SURFACE, BG, BODY_TARGET);
tier('--st-phasing', SURFACE, BG, BODY_TARGET);
check(`accent-text ${T['--accent-text']} on accent ≥4.5`,
  ratio(T['--accent-text'], T['--accent']) >= BODY_TARGET,
  ratio(T['--accent-text'], T['--accent']).toFixed(2));

/* 状态徽章：fg 对「tint 合成到表面」的实际底色 ≥4.5（深色 tint 0.16） */
for (const st of ['active', 'pending', 'phasing', 'retired']) {
  const fg = T[`--st-${st}`];
  const bg = composite(fg, 0.16, SURFACE);
  check(`st-${st} ${fg} 徽章合成底 ≥4.5`, ratio(fg, bg) >= BODY_TARGET,
    `${bg} ${ratio(fg, bg).toFixed(2)}`);
}
check('主题为单暗场（无 prefers-color-scheme 亮色分支）',
  !CSS.includes('prefers-color-scheme: light'));

console.log('\n字阶与工程栅栏：');
const fsUsed = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => m[1]);
check('CSS 无绕过令牌的 font-size', fsUsed.length === 0, fsUsed.join(','));
/* 字阶 10 级栅栏（2026-08-31 大屏审计后定稿，--fs-21 零使用点已退役）：
   核心 8 级 11..17+22 必须在用；展示层 24/28 只允许顶栏大标题/空态/启动屏取用，
   不设上限数量、但任何 var(--fs-*)都必须出自这 10 个令牌，堵住任意字号。 */
const CORE_STEPS = ['11', '12', '13', '14', '15', '16', '17', '22'];
const ALLOWED_STEPS = new Set([...CORE_STEPS, '24', '28']);
const steps = new Set([...CSS.matchAll(/var\(--fs-(\d+)\)/g)].map((m) => m[1]));
check('字阶全部出自 10 级令牌', [...steps].every((s) => ALLOWED_STEPS.has(s)),
  [...steps].sort((a, b) => a - b).join(','));
check('核心 8 级全部在用', CORE_STEPS.every((s) => steps.has(s)),
  CORE_STEPS.filter((s) => !steps.has(s)).join(','));
/* 展示层字阶（24/28）只允许出现在顶栏大标题、启动屏、空态三类展示选择器上 */
const displayMisuse = [...CSS.matchAll(/([^{}]+)\{([^{}]*var\(--fs-(?:24|28)\)[^{}]*)\}/g)]
  .filter((m) => !/(topbar|splash|empty)/.test(m[1]));
check('展示层字阶只服务顶栏/空态/启动屏', displayMisuse.length === 0,
  displayMisuse.map((m) => m[1].trim().split('\n').pop().trim()).join(' | '));
check('app.js 零内联 style', !/style="/.test(JS), String((JS.match(/style="/g) || []).length));
/* U4 通用死令牌守门：:root 定义集 − var() 引用集 − 白名单 必须为空。
   白名单 = 预留展示字阶 --fs-28 + 4pt 网格完整性保留档 --sp-5/--sp-6。 */
const _defined = new Set(Object.keys(T));
const _ref = new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
const _DEAD_OK = new Set(['--fs-28', '--sp-5', '--sp-6']);
const _dead = [..._defined].filter((t) => !_ref.has(t) && !_DEAD_OK.has(t));
check('无死令牌（定义未引用，白名单外）', _dead.length === 0, _dead.join(','));
/* U5 未定义引用守门：CSS 引用的每个 --* 必须在 :root 已定义（差集为空）。 */
const _undef = [..._ref].filter((t) => !_defined.has(t));
check('无未定义令牌引用', _undef.length === 0, _undef.join(','));
check('复制热区补偿存在', /mini-copy[^}]*::after[\s\S]{0,80}inset:\s*-8px/.test(CSS));
check('客户创建时间用 --text-3', /\.cust-time[^}]*--text-3/.test(CSS));
check('reduced-motion 护栏仍在', CSS.includes('prefers-reduced-motion'));

console.log('\n桌面大屏适配层守门（2026-08-31）：');
check('度量令牌已定义且在用',
  /--measure:\s*\d+px/.test(CSS) && /--measure-wide:\s*\d+px/.test(CSS) &&
  /var\(--measure\)/.test(CSS) && /var\(--measure-wide\)/.test(CSS));
check('顶栏兜底令牌被 topbar 与 detail-bar 共用',
  (CSS.match(/var\(--topbar-pad-top\)/g) || []).length >= 2);
check('单栏画布模式只允许竞品/客户/收藏三个页签',
  ![...CSS.matchAll(/data-tab="([a-z]+)"/g)].some((m) => !['rival', 'customers', 'saved'].includes(m[1])),
  [...new Set([...CSS.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]))].join(','));
/* 画布/滚动条等桌面新增区块里不允许出现裸色值：色板改动必须走 tokens.css */
const desktopBlocks = (CSS.match(/@media[^{]*pointer:\s*fine[^{]*\{[\s\S]*?\n\}\n/) || ['']) +
  (CSS.split('大屏画布模式')[1] || '').split('竞品 ——')[0];
check('桌面分支不引入令牌外颜色', !/#[0-9a-fA-F]{3,8}\b/.test(desktopBlocks),
  (desktopBlocks.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(','));

console.log(`\n通过 ${pass} · 失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
