/**
 * 渲染层性能探针：量化列表渲染与热点查询耗时。
 * 纯 Node 运行，用最小 DOM 桩驱动 app.js 的真实渲染路径。
 * 用法：node tools/perf_render.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const WEB = path.join(__dirname, '..', 'web');

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(id) {
  return {
    id,
    innerHTML: '',
    className: '',
    style: {},
    textContent: '',
    value: '',
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    remove() {},
    getAttribute() { return null; },
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    focus() {},
    select() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

const elements = {};
global.document = {
  readyState: 'complete',
  body: { style: {}, classList: { add() {} }, appendChild() {}, removeChild() {} },
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  querySelector(sel) {
    const id = String(sel).replace(/^#/, '');
    return elements[id] || (elements[id] = makeEl(id));
  },
  createElement() { return makeEl('tmp'); },
  addEventListener() {},
  execCommand() { return true; },
};

class MockXHR {
  open(_m, url) { this.url = url; }
  send() {
    const file = path.join(WEB, this.url);
    if (fs.existsSync(file)) {
      this.status = 200;
      this.responseText = fs.readFileSync(file, 'utf8');
      if (this.onload) this.onload();
    } else {
      this.status = 404;
      if (this.onerror) this.onerror(new Error('404 ' + this.url));
    }
  }
}
global.XMLHttpRequest = MockXHR;
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.Android = {
  copy() {}, toast() {}, paste() { return ''; },
  getPref() { return null; }, setPref() {},
};
global.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
global.addEventListener = () => {};
global.scrollTo = () => {};
global.innerWidth = 400;
global.innerHeight = 800;
global.window = global;

/* ---------- 加载应用 ---------- */
const bootStart = Date.now();
// 与 web/index.html 保持同一加载顺序
[
  'core/util.js', 'core/icons.js', 'core/store.js',
  'search.js', 'data.js', 'contract.js', 'customer.js',
  'ui/primitives.js', 'ui/modal.js',
  'views/chrome.js', 'views/results.js', 'views/config.js', 'views/rival.js',
  'views/customers.js', 'views/saved.js', 'views/detail.js',
  'app.js',
].forEach((f) => require(path.join(WEB, 'js', f)));
const loadMs = Date.now() - bootStart;

function ms(fn, times) {
  times = times || 20;
  fn(); // 预热
  const t = Date.now();
  for (let i = 0; i < times; i++) fn();
  return ((Date.now() - t) / times).toFixed(2);
}

setTimeout(() => {
  const app = global.__pf;
  if (!app || !app.state || !app.state.catalog) {
    console.error('启动失败：catalog 未就绪');
    process.exit(1);
  }
  const st = app.state;
  const N = st.catalog.materials.length;

  console.log(`\n渲染层性能基线（物料 ${N} 条 · 脚本加载 ${loadMs}ms）\n${'='.repeat(52)}`);

  /* 1. 搜索列表渲染 */
  st.results = st.catalog.materials.slice(0, 600);
  st.shown = 600;
  console.log(`  renderList(600 条平铺)      ${ms(() => app.renderList())} ms`);

  st.query = '';
  st.shown = 600;
  console.log(`  renderList(600 条按系列分组) ${ms(() => app.renderList())} ms`);

  st.query = 'x';
  st.shown = 30;
  console.log(`  renderList(首屏 30 条)      ${ms(() => app.renderList())} ms`);

  /* 2. 热点查询（预置 300 条收藏，逼出真实的 JSON.parse + 线性查找成本） */
  const sample = st.catalog.materials.slice(0, 600).map((m) => m.material_no);
  global.PFData.setPref('favorites', JSON.stringify(sample.slice(0, 300)));
  // 渲染实际走的是 Store 的 Set 缓存；PFData 原始 API 仅作对照，暴露为何需要缓存
  console.log(`  Store.hasFav() × 600        ${ms(() => sample.forEach((n) => global.PFStore.hasFav(n)))} ms`);
  console.log(`  [对照] PFData.has() × 600   ${ms(() => sample.forEach((n) => global.PFData.favorites.has(n)))} ms`);
  console.log(`  findByNo() × 600            ${ms(() => sample.forEach((n) => app.findByNo(n)))} ms`);

  /* 3. 收藏页（含 findByNo 回路） */
  global.PFData.setPref('favorites', JSON.stringify(sample.slice(0, 30)));
  st.tab = 'saved';
  console.log(`  renderSavedList(30 收藏)    ${ms(() => app.renderList())} ms`);
  global.PFData.setPref('favorites', '[]');

  /* 4. 详情页（含套包解析） */
  const model = st.catalog.materials.find((m) => m.material_code === 'VN4000-101-021');
  st.selected = model;
  st.detailMode = 'lookup';
  console.log(`  renderDetailPane(套包解析)  ${ms(() => app.renderDetailPane())} ms`);

  /* 5. 选型三层 */
  st.tab = 'config';
  st.cfg = { level: 'category', group: '', quality: 'original', series: '' };
  console.log(`  选型 L1 类别卡(全库计数)    ${ms(() => app.renderList())} ms`);
  st.cfg.group = 'reader';
  st.cfg.level = 'series';
  console.log(`  选型 L2 系列卡(全库计数)    ${ms(() => app.renderList())} ms`);

  /* 6. 搜索 + 详情 联动（每键成本） */
  st.tab = 'search';
  st.selected = model;
  st.query = 'VS1000';
  st.results = st.catalog.materials.slice(0, 300);
  st.shown = 30;
  console.log(`  键入重渲染(列表+详情)       ${ms(() => app.renderList() && app.renderDetailPane())} ms`);

  console.log(`${'='.repeat(52)}\n`);
}, 300);
