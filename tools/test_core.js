/* 核心逻辑离线自测：不依赖 WebView，直接在 Node 中驱动搜索与套包模块。
   用法： node tools/test_core.js
*/
'use strict';

const path = require('path');
const fs = require('fs');

global.window = global;
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

require(path.join(__dirname, '..', 'web', 'js', 'search.js'));
require(path.join(__dirname, '..', 'web', 'js', 'contract.js'));

const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'web', 'data', 'products.json'), 'utf8'),
);
const materials = window.PFSearch.index(payload.materials);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

console.log(`\n数据集：${materials.length} 条，导出于 ${payload.exported_at}\n`);

// ---- 搜索 ----
const QUERIES = [
  'VS1000', 'VS2000', 'VN4000', 'VS600', 'WIT40',
  '读码器', '传感器', '偏振', '液态', '支架', '线材', '红光',
  'VS1000-', 'M12', '5MP', '500万', '8mm', '1234567',
];

console.log('搜索质量：');
for (const q of QUERIES) {
  const t0 = process.hrtime.bigint();
  const r = window.PFSearch.search(materials, q, {}, 30);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const top = r[0];
  console.log(
    `  "${q}" -> ${String(r.length).padStart(3)} 条  ${ms.toFixed(1).padStart(5)}ms  ` +
    `top: ${top ? (top.material_code || top.material_no) : '（无）'}`,
  );
}

console.log('\n断言：');
const r1 = window.PFSearch.search(materials, 'VS1000', {}, 30);
check('型号查询有结果', r1.length > 0, `${r1.length}`);
check('型号查询命中相关系列',
  r1.slice(0, 10).every((m) => JSON.stringify(m).toUpperCase().includes('VS1000')),
);

// 料号精确匹配应当排第一
const sample = materials[500];
const r2 = window.PFSearch.search(materials, sample.material_no, {}, 30);
check('料号精确匹配置顶', r2.length > 0 && r2[0].material_no === sample.material_no,
  r2[0] ? r2[0].material_no : '空');

// 分级单调性：分级序号不应倒序
const r3 = window.PFSearch.search(materials, 'VS', {}, 200);
let monotonic = true;
for (let i = 1; i < r3.length; i++) {
  if (r3[i]._level < r3[i - 1]._level) { monotonic = false; break; }
}
check('结果按分级有序', monotonic);

// 空查询返回全量
const r4 = window.PFSearch.search(materials, '', {}, 100000);
check('空查询返回全量', r4.length === materials.length, `${r4.length}/${materials.length}`);

// 筛选生效
const cat = Object.keys(payload.facets.categories)[0];
const r5 = window.PFSearch.search(materials, '', { category: cat }, 100000);
check('类别筛选生效',
  r5.length > 0 && r5.every((m) => m.product_category === cat), `${r5.length} 条`);

// 性能：连续 20 次查询
const t0 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) window.PFSearch.search(materials, 'VS10', {}, 60);
const avg = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
check('单次搜索 < 30ms', avg < 30, `${avg.toFixed(1)}ms`);

// ---- 套包 ----
console.log('\n选型套包：');
const set = window.PFContract.resolve(r1[0], materials, '3M');
console.log(`  主机：${set.primary.material_code} (${set.primary.material_no})`);
for (const it of set.required) {
  console.log(`    [必需] ${it.role.padEnd(5)} ${it.material ? it.material.material_no : '— ' + it.note}`);
}
for (const it of set.optional.slice(0, 5)) {
  console.log(`    [可选] ${it.role.padEnd(5)} ${it.material.material_no}`);
}
check('套包含主机', set.required.length > 0 && set.required[0].role === '主机');
check('套包文本非空', window.PFContract.toText(set).length > 0);

// 主线缆系列应能解析出必需线缆
const vs1000 = materials.find((m) => window.PFSearch.seriesKey(m.product_series) === 'VS1000' && m.is_accessory === 0);
if (vs1000) {
  const s2 = window.PFContract.resolve(vs1000, materials, '5M');
  const roles = s2.required.map((i) => i.role);
  check('VS1000 解析出网线/数据线',
    roles.includes('网线') && roles.includes('数据线'), roles.join(','));
  check('线长参数生效', s2.length === '5M');
}

// ---- 拖链配线规则（需求3）：《配件型号清单-拖链专用线材.xlsx》----
// VN4000/VN4000CL/VA6500/VA200/VA500/VA502/WIT 系列 = 同长度 网线1 + 数据线1，与 VS1000P 一致
console.log('\n拖链配线规则：');
const sk = window.PFSearch.seriesKey;
check('seriesKey 归一 VN4000CL 彩色相机', sk('VN4000CL 彩色相机') === 'VN4000CL', sk('VN4000CL 彩色相机'));
check('seriesKey 归一 VA200(标准) 半角括号', sk('VA200(标准)') === 'VA200', sk('VA200(标准)'));
check('seriesKey 归一 WIT40 换行说明', sk('WIT40\n\n软件与VN4000一样') === 'WIT40', sk('WIT40\n\n软件与VN4000一样'));

const PAIR_EXPECT = { 'M12-8PIN-5M': '97010048', 'M12-12PIN-5M': '97010074' };
const pairSamples = ['VN4000-101-021', 'VN4000CL-501-CL20', 'VA6500-501-020', 'VA200-202-021',
                     'VA500-501-020', 'VA502-502-020', 'WIT50-201-021', 'WIT60-201-021'];
for (const code of pairSamples) {
  const host = materials.find((m) => m.material_code === code && m.is_accessory === 0);
  if (!host) { check(`拖链规则 ${code}`, false, '库内无此整机行'); continue; }
  const s5 = window.PFContract.resolve(host, materials, '5M');
  const by5 = {};
  s5.required.forEach((i) => { if (i.material) by5[i.role] = i.material.material_no; });
  const ok = by5['网线'] === PAIR_EXPECT['M12-8PIN-5M'] &&
             by5['数据线'] === PAIR_EXPECT['M12-12PIN-5M'] && s5.hasCable;
  check(`拖链规则 ${code} = 网线${PAIR_EXPECT['M12-8PIN-5M']} + 数据线${PAIR_EXPECT['M12-12PIN-5M']}`,
    ok, JSON.stringify(by5));
}

// 同套内网线与数据线必须同长度（xlsx：同长度的网线1根+数据线1根=1套）
const vnHost = materials.find((m) => m.material_code === 'VN4000-101-021' && m.is_accessory === 0);
const vnSet = window.PFContract.resolve(vnHost, materials, '3M');
const vnCableNos = vnSet.required.filter((i) => i.role === '网线' || i.role === '数据线')
  .map((i) => i.material.material_no);
check('VN4000 3M 套 = 97010047 + 97010073',
  vnCableNos.includes('97010047') && vnCableNos.includes('97010073'),
  vnCableNos.join(','));
check('VN4000 有线缆规则（hasCable）', vnSet.hasCable === true);
// 弯头变体（库存有限）不进必需清单，默认按标准直头出单
check('弯头变体不在必需清单',
  !vnSet.required.some((i) => i.material &&
    ['97010059', '97010060', '97010061', '97010080', '97010081', '97010082'].includes(i.material.material_no)),
  vnSet.required.map((i) => i.material && i.material.material_no).join(','));

console.log(`\n通过 ${pass} · 失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
