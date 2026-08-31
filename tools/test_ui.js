/* 渲染层离线自测：用最小 DOM 模拟驱动 app.js 的渲染路径。
   目的不是替代真机验证，而是在打包前拦住"白屏级"错误
   （渲染函数抛异常、字段访问踩空、竞品视图空数据崩溃等）。
   用法： node tools/test_ui.js
*/
'use strict';

const path = require('path');
const fs = require('fs');

const WEB = path.join(__dirname, '..', 'web');
const errors = [];

/* ---------- 最小 DOM ---------- */
function makeEl(id) {
  return {
    id,
    innerHTML: '',
    className: '',
    style: {},
    textContent: '',
    value: '',
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    remove() { removed.push(id); },
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
const removed = [];

global.document = {
  readyState: 'complete',
  body: { style: {}, appendChild() {}, removeChild() {} },
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  querySelector(sel) {
    const id = String(sel).replace(/^#/, '');
    return elements[id] || (elements[id] = makeEl(id));
  },
  createElement() { return makeEl('tmp'); },
  // 捕获监听器，让事件路由（app.js 的 ROUTES）可以被直接驱动验证
  addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  execCommand() { return true; },
};

const listeners = {};
function dispatch(type, event) {
  (listeners[type] || []).forEach((fn) => fn(event));
}

/**
 * 构造一个"命中指定 data-* 契约"的事件目标。
 * closest(sel) 只在目标确实携带该属性时返回元素，语义与真实 DOM 一致，
 * 因此可以用来验证路由表的优先级（例如客户卡按钮必须先于通用 .card）。
 */
function targetWith(attrs) {
  return {
    closest(sel) {
      const hit = String(sel).split(',').some((s) => {
        s = s.trim();
        if (s.startsWith('[') && s.endsWith(']')) {
          return Object.prototype.hasOwnProperty.call(attrs, s.slice(1, -1));
        }
        if (s.startsWith('.')) {
          return attrs._class && attrs._class.split(/\s+/).includes(s.slice(1));
        }
        return false;
      });
      if (!hit) return null;
      return {
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        click() {},
        innerHTML: '',
      };
    },
    preventDefault() {},
    stopPropagation() {},
  };
}

function clickWith(attrs) {
  dispatch('click', { target: targetWith(attrs) });
}

class MockXHR {
  open(_method, url) { this.url = url; }
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
global.Android = { copy() {}, toast() {}, paste() { return ''; }, getPref() { return null; }, setPref() {} };
global.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
global.addEventListener = () => {};
global.scrollTo = () => {};
global.window = global;

// 加载顺序必须与 web/index.html 一致（依赖顺序：核心 → 领域 → 元件 → 视图 → 编排）
const JS_FILES = [
  'core/util.js', 'core/icons.js', 'core/store.js',
  'search.js', 'data.js', 'contract.js', 'customer.js',
  'ui/primitives.js', 'ui/modal.js',
  'views/chrome.js', 'views/results.js', 'views/config.js', 'views/rival.js',
  'views/customers.js', 'views/saved.js', 'views/detail.js',
];
JS_FILES.forEach((f) => require(path.join(WEB, 'js', f)));

// 必须打印：否则异常被静默吞掉，后续断言全部跳过，测试会假绿
process.on('uncaughtException', (e) => {
  const msg = String((e && e.stack) || e);
  errors.push(msg);
  console.error('\n[uncaughtException] ' + msg + '\n');
});

require(path.join(WEB, 'js', 'app.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}
function html(id) { return (elements[id] && elements[id].innerHTML) || ''; }

setTimeout(() => {
  console.log('\n渲染自测：');

  check('启动未抛异常', errors.length === 0, errors[0]);
  check('启动屏已移除', removed.includes('splash'));

  const app = global.__pf;
  check('应用接口已暴露', !!app && !!app.renderList);
  check('目录已加载', app.state.catalog && app.state.catalog.count === 1264,
    app.state.catalog ? String(app.state.catalog.count) : '未加载');
  check('竞品数据已加载', !!app.state.rival);

  check('导航已渲染', html('nav').includes('搜索') && html('nav').includes('选型'));
  check('搜索页列表已渲染', html('list-body').length > 500, `${html('list-body').length} 字符`);

  // 逐个切换 Tab
  for (const tab of ['config', 'rival', 'saved', 'search']) {
    app.switchTab(tab);
    check(`Tab ${tab} 渲染成功`, html('list-body').length > 100, `${html('list-body').length} 字符`);
  }

  // 竞品四个视图
  app.switchTab('rival');
  for (const view of ['match', 'brand', 'objection', 'industry']) {
    app.state.rivalTab = view;
    app.renderList();
    const out = html('list-body');
    check(`竞品视图 ${view} 渲染成功`, out.length > 100, `${out.length} 字符`);
  }

  // 搜索交互
  app.switchTab('search');
  app.state.query = 'VS1000';
  global.PFSearch.search(app.state.catalog.materials, 'VS1000', {}, 5);
  app.state.results = global.PFSearch.search(app.state.catalog.materials, 'VS1000', {}, 50);
  app.renderList();
  check('搜索结果渲染出卡片', html('list-body').includes('class="card"'));
  check('卡片带料号数据属性', html('list-body').includes('data-no='));

  // 详情与套包
  const sample = app.state.catalog.materials.find((m) => m.is_accessory === 0);
  app.state.selected = sample;
  app.renderDetailPane();
  const detail = html('detail-pane');
  check('详情页渲染成功', detail.length > 500, `${detail.length} 字符`);
  check('详情页含料号', detail.includes(sample.material_no));
  check('详情页含套包区', detail.includes('选型套包'));
  check('详情页含复制按钮', detail.includes('复制料号'));

  const sheetHTML = app.detailHTML(sample, true);
  check('折叠态详情含返回栏', sheetHTML.includes('data-close'));
  check('折叠态详情含返回图标', sheetHTML.includes('icon-btn back'));

  // 关键规格带单位
  const withPixel = app.state.catalog.materials.find((m) => m.pixel && m.is_accessory === 0);
  app.state.selected = withPixel;
  app.renderDetailPane();
  check('像素带单位显示', html('detail-pane').includes('MP'),
    `pixel=${withPixel.pixel}`);

  // ---- 本轮新增：套包规则覆盖度提示 ----
  // 有规则的系列不应出现告警；无规则的系列必须出现，否则用户会漏录 CRM
  const withKit = app.state.catalog.materials.find(
    (m) => m.is_accessory === 0 && /^VS1000P/.test(m.material_code || ''));
  // VN4000 已并入拖链配线规则（需求3），改用仍无规则的 VN6000 验证告警
  const noKit = app.state.catalog.materials.find(
    (m) => m.is_accessory === 0 && /^VN6000/.test(m.material_code || '')) ||
    app.state.catalog.materials.find(
    (m) => m.is_accessory === 0 && /^VE30/.test(m.material_code || ''));

  if (withKit) {
    const h = app.detailHTML(withKit, false);
    const n = global.PFContract.resolve(withKit, app.state.catalog.materials, '3M').required.length;
    check('有规则的系列不告警', n === 1 || !h.includes('contract-warning'),
      `required=${n}`);
  }
  if (noKit) {
    const h = app.detailHTML(noKit, false);
    check('无规则的系列给出告警', h.includes('contract-warning'),
      `${noKit.material_code} 未出现 contract-warning`);
    check('告警文案可指引人工补齐', h.includes('人工补齐'));
  }

  // ---- 本轮新增：长度变体不得混入复制清单 ----
  if (withKit) {
    const set = global.PFContract.resolve(withKit, app.state.catalog.materials, '3M');
    const text = global.PFContract.toText(set);
    const lines = text.split('\n').filter((l) => l.trim());
    check('长度变体已单独归类', set.alternates.length > 0, `alternates=${set.alternates.length}`);
    check('真配件仍留在可选清单', set.optional.length > 0, `optional=${set.optional.length}`);
    check('复制清单不含长度变体',
      set.alternates.every((a) => !text.includes(a.material.material_no)),
      '变体料号出现在复制文本中');
    check('复制清单精简到 10 行内', lines.length <= 10, `${lines.length} 行`);

    const d = app.detailHTML(withKit, false);
    check('详情页展示长度变体区', d.includes('同款其他长度'));
    check('长度变体区标注不计入复制', d.includes('不计入复制清单'));
  }

  // ---- 本轮新增：空状态分因 ----
  app.switchTab('search');
  app.state.query = 'ZZZ_NOT_EXIST_ZZZ';
  app.state.results = [];
  app.renderList();
  let emptyHTMLStr = html('list-body');
  check('无结果空状态含关键词', emptyHTMLStr.includes('ZZZ_NOT_EXIST_ZZZ'));
  check('无结果空状态给出清除入口', emptyHTMLStr.includes('data-act="clear-query"'));

  app.state.query = '';
  app.state.category = '不存在的类别';
  app.state.results = [];
  app.renderList();
  emptyHTMLStr = html('list-body');
  check('筛选过窄空状态指向筛选', emptyHTMLStr.includes('过滤掉了全部结果'));
  check('筛选过窄空状态给出清除入口', emptyHTMLStr.includes('data-act="clear-filters"'));
  app.state.category = '';

  // ---- 本轮新增：无关键词时的总数不得虚报 ----
  app.switchTab('search');
  app.state.query = '';
  app.state.results = app.state.catalog.materials.slice(0, 300);
  app.renderList();
  const metaHTML = html('list-body');
  check('无关键词时显示库内总量', metaHTML.includes('共 1264 条'),
    metaHTML.slice(0, 120));
  check('无关键词时标注截断', metaHTML.includes('列出前 300 条'));
  check('无关键词时不虚报为 300 条', !/>共 300 条/.test(metaHTML));

  // ---- 本轮新增：型号归一化（复制粘贴带空格的场景）----
  const nq = app.normalizeQuery;
  check('连字符两侧空格被收拢', nq('VS1000P - 111 - 022') === 'VS1000P-111-022',
    nq('VS1000P - 111 - 022'));
  check('首尾空格被去除', nq('  VS2000-523-030  ') === 'VS2000-523-030');
  check('连续空格被压缩', nq('VS1000P   111') === 'VS1000P 111', nq('VS1000P   111'));

  // 归一化后必须能精确命中，否则这个改动没有意义
  const norm = nq('VS1000P - 111 - 022');
  const normHits = global.PFSearch.search(app.state.catalog.materials, norm, {}, 300);
  check('归一化后精确命中 1 条', normHits.length === 1, `${normHits.length} 条`);
  check('归一化后命中正确型号', normHits[0] && normHits[0].material_code === 'VS1000P-111-022',
    normHits[0] && normHits[0].material_code);

  // 去空格重查：并集 85 条 -> 精确 1 条
  const de = norm.replace(/\s+/g, '');
  const deHits = global.PFSearch.search(app.state.catalog.materials, 'VS1000P111022', {}, 300);
  check('去空格后收敛到 1 条', deHits.length === 1, `${deHits.length} 条`);

  // 多关键词结果过多时应给出提示与重查入口
  app.state.query = 'VS1000P 111 022';
  app.state.results = global.PFSearch.search(app.state.catalog.materials, 'VS1000P 111 022', {}, 300);
  app.renderList();
  const hintHTML = html('list-body');
  check('多关键词给出并集提示', hintHTML.includes('result-hint'));
  check('多关键词给出去空格入口', hintHTML.includes('data-act="despace"'));
  app.state.query = '';

  // ---- 本轮新增：无障碍属性 ----
  app.renderNav();
  check('导航带 aria-selected', html('nav').includes('aria-selected='));
  app.switchTab('search');
  app.state.query = 'VS1000';
  app.state.results = global.PFSearch.search(app.state.catalog.materials, 'VS1000', {}, 5);
  app.renderList();
  const cardsHTML = html('list-body');
  check('卡片可聚焦', cardsHTML.includes('tabindex="0"'));
  check('卡片带可读标签', cardsHTML.includes('aria-label="') && cardsHTML.includes('料号'));
  app.state.query = '';

  // 收藏与设置
  app.switchTab('saved');
  check('收藏页含设置项', html('list-body').includes('隐藏退市型号'));
  check('收藏页含体验反馈入口', html('list-body').includes('data-fb-open'));
  check('收藏页显示客户端版本', html('list-body').includes('v' + app.version));

  // ---- 新增：客户管理（桌面版 V9.7 迁移） ----
  const C = global.PFCustomers;
  check('客户存储模块已加载', !!C && typeof C.add === 'function');
  C.setSelected(null);

  // 空状态
  app.switchTab('customers');
  check('导航含客户页签', html('nav').includes('客户'));
  check('客户页表单渲染', html('list-body').includes('新增客户') &&
    html('list-body').includes('客户名称') && html('list-body').includes('收货地址'));
  check('客户页空状态', html('list-body').includes('暂无客户'));

  // 名称必填校验（对齐桌面版文案）
  app.saveCustomerFromForm();
  const toastText = () => (elements['toast'] ? (elements['toast'].innerHTML || elements['toast'].textContent) : '');
  check('空名称被拦截且文案对齐', toastText().includes('请输入客户名称'));

  // 表单新增
  document.getElementById('cust-name').value = '华为莞深工业区';
  document.getElementById('cust-addr').value = '广东省东莞市的某个详细地址';
  app.saveCustomerFromForm();
  check('新增客户成功', C.count() === 1, `count=${C.count()}`);
  check('表单回到新增态', html('list-body').includes('新增客户') &&
    !html('list-body').includes('保存修改'));

  // 列表卡片字段：名称/地址/创建时间/三个操作
  let custHTML = html('list-body');
  check('客户卡片含名称', custHTML.includes('华为莞深工业区'));
  check('客户卡片含地址', custHTML.includes('广东省东莞市的某个详细地址'));
  check('客户卡片含操作按钮', custHTML.includes('data-cust-copy') &&
    custHTML.includes('data-cust-edit') && custHTML.includes('data-cust-del'));
  check('客户卡片含创建日期', /创建: \d{4}-\d{2}-\d{2}/.test(custHTML));

  // 编辑态
  const cid = C.all()[0].id;
  app.state.custEditing = cid;
  app.renderList();
  custHTML = html('list-body');
  check('编辑态标题切换', custHTML.includes('编辑客户'));
  check('编辑态出现取消按钮', custHTML.includes('data-cust-cancel'));
  check('编辑态回填名称', custHTML.includes('value="华为莞深工业区"'));
  document.getElementById('cust-name').value = '华为莞深工业区二期';
  app.saveCustomerFromForm();
  check('更新客户成功', C.get(cid).name === '华为莞深工业区二期' && C.count() === 1);

  // 选中用于报价（桌面版 customer_selected 的移动端等效）
  C.setSelected(C.get(cid));
  app.renderTopbar();
  check('顶栏显示已选择', html('topbar').includes('已选择'));
  check('报价头带客户与地址',
    C.quoteHeader() === '客户: 华为莞深工业区二期\n收货地址: 广东省东莞市的某个详细地址',
    C.quoteHeader());
  // 未选中时不带客户块
  C.setSelected(null);
  check('未选中时报价头为空', C.quoteHeader() === '');

  // 删除确认弹层（桌面版 QMessageBox 的等效）
  app.confirmModal({ title: '确认删除', body: '确定要删除客户「X」吗？', confirmLabel: '删除', danger: true });
  check('删除确认弹层出现', app.modalHTML().includes('确认删除') &&
    app.modalHTML().includes('确定要删除客户'));
  check('弹层默认可取消', app.modalHTML().includes('取消'));
  app.closeModal();
  check('弹层可关闭', app.modalHTML() === '');

  // 删除
  C.add('临时客户', '');
  const tmp = C.all().filter(function (c) { return c.name === '临时客户'; })[0];
  C.remove(tmp.id);
  check('删除客户成功', C.count() === 1 && !C.get(tmp.id));

  // 复制文本格式对齐桌面版
  check('客户复制文本格式对齐', C.copyText(C.get(cid)) ===
    '客户: 华为莞深工业区二期\n地址: 广东省东莞市的某个详细地址', C.copyText(C.get(cid)));

  // 导入/导出（跨端数据一致性通道）
  const exported = C.exportJSON();
  check('导出 JSON 带类型标记', exported.includes('"partfinder-customers"'));
  global.PFData.setPref('customers', '[]');
  const imported = C.importJSON(exported);
  check('导入恢复全部客户', imported && imported.added === 1 && imported.skipped === 0,
    JSON.stringify(imported));
  check('导入后可查询', C.get(cid) && C.get(cid).name === '华为莞深工业区二期');
  const again = C.importJSON(exported);
  check('重复导入按名称+地址去重', again && again.added === 0 && again.skipped === 1,
    JSON.stringify(again));
  check('坏 JSON 返回 parse 错误', C.importJSON('not-json').error === 'parse');
  check('缺数组 JSON 返回 format 错误', C.importJSON('{"foo":1}').error === 'format');
  const r2 = app.runImport; // 冒烟：导入弹层可渲染
  app.importModal();
  check('导入弹层渲染', app.modalHTML().includes('从桌面版导入客户') &&
    app.modalHTML().includes('import-text'));
  app.closeModal();

  // ---- 本轮新增：体验反馈（灰度结构化收集） ----
  app.feedbackModal();
  const fbHTML = app.modalHTML();
  check('反馈弹层含打分与类型', fbHTML.includes('data-fb-rate') && fbHTML.includes('data-fb-cat'));
  check('反馈弹层含提交按钮', fbHTML.includes('data-fb-send'));
  app.closeModal();
  const rec = app.feedbackRecord(4, ['搜索', '界面'], '搜索很快');
  check('反馈记录带版本号', rec.app_version === app.version);
  check('反馈记录带结构与时间戳',
    rec.rating === 4 && Array.isArray(rec.categories) && !!rec.submitted_at);
  check('反馈记录不含业务数据', !JSON.stringify(rec).includes('VS1000'));

  // ---- 灰度 Round 1 回归：R1-01 / R1-03 ----
  app.switchTab('rival');
  app.state.query = 'SR-710';
  app.renderTopbar();
  check('R1-01 竞品页搜索框有清空按钮', html('topbar').includes('data-clear'));
  app.state.query = '';
  app.switchTab('search');
  app.state.results = app.state.catalog.materials.slice(0, 600);
  app.state.shown = 600;
  app.renderList();
  check('R1-03 触顶给出看全出口', html('list-body').includes('已列出前 600 条') &&
    html('list-body').includes('缩小范围'));
  app.state.shown = 30;
  app.renderList();
  check('R1-03 未触顶时仍显示加载更多', html('list-body').includes('data-more'));
  app.state.shown = 30;

  // ---- 灰度 Round 2 回归：R2-02 / R2-04 / 返回键入口 ----
  const kitModel = app.state.catalog.materials.find((m) => m.is_accessory === 0);
  C.setSelected(null);
  app.state.selected = kitModel;
  app.renderDetailPane();
  check('R2-02 未选客户时详情页无客户胶囊',
    !html('detail-pane').includes('badge-cust'));
  C.setSelected(C.all()[0]);
  app.renderDetailPane();
  check('R2-02 已选客户时详情页显示报价客户胶囊',
    html('detail-pane').includes('badge-cust') &&
    html('detail-pane').includes('报价客户'));
  C.setSelected(null);

  app.feedbackModal();
  check('R2-04 反馈星标未选中为描边星', app.modalHTML().includes('fill="none"'));
  app.closeModal();

  app.openModal('<div class="modal-title">测试层叠</div>');
  app.closeTop();
  check('R2-01 closeTop 可关闭弹层', app.modalHTML() === '');

  // ---- 灰度 Round 3 回归：R3-01 / R3-02 / R3-03 ----
  // R3-01 删除已选客户要有连带提示
  const delTarget = C.all()[0];
  C.setSelected(delTarget);
  app.state._pendingDel = delTarget.id;
  app.confirmModalOk();
  check('R3-01 删除已选客户提示连带后果', toastText().includes('取消报价选择'));
  check('R3-01 删除后选中态已清空', C.getSelected() === null && !C.get(delTarget.id));

  // R3-02 加载更多步进递增 + 重置
  app.state.results = app.state.catalog.materials.slice(0, 200);
  app.state.shown = 30;
  app.loadMore();
  check('R3-02 首次加载更多 +30', app.state.shown === 60, `shown=${app.state.shown}`);
  app.loadMore();
  check('R3-02 之后每次 +60', app.state.shown === 120, `shown=${app.state.shown}`);
  app.resetShown();
  check('R3-02 resetShown 重置游标与步进', app.state.shown === 30 && app.state.moreClicks === 0);

  // R3-03 客户表单回车提交
  app.switchTab('customers');
  document.getElementById('cust-name').value = '回车新增客户';
  document.getElementById('cust-addr').value = '';
  const entered = app.handleCustEnter({ target: { id: 'cust-name' }, preventDefault() {} });
  check('R3-03 回车触发保存', entered === true && C.all().some((c) => c.name === '回车新增客户'));
  check('R3-03 非表单输入不拦截', app.handleCustEnter({ target: { id: 'q' } }) === false);

  // ---- 需求1：详情页首屏料号速览 + 规格折叠下移 ----
  app.switchTab('search');
  const glanceModel = app.state.catalog.materials.find((m) => m.material_code === 'VN4000-101-021');
  app.state.selected = glanceModel;
  app.renderDetailPane();
  let d = html('detail-pane');
  check('需求1 首屏含机型料号速览', d.includes('kit-glance') && d.includes('机型料号'));
  check('需求1 首屏含配套线材料号', d.includes('数据线（3M）') && d.includes('网线（3M）') &&
    d.includes('97010047') && d.includes('97010073'));
  check('需求1 速览行带独立复制按钮', /kit-glance[\s\S]*?data-copy-part="97010047"[\s\S]*?copy-row/.test(d));
  check('需求1 规格参数折叠且在套包之后', d.includes('<details class="section specs-fold">') &&
    d.indexOf('选型套包') < d.indexOf('specs-fold'));
  // 切换线长，速览行联动
  app.state.cableLength = '10M';
  app.renderDetailPane();
  d = html('detail-pane');
  check('需求1 速览随线长联动', d.includes('网线（10M）') && d.includes('97010049') && d.includes('97010075'));
  app.state.cableLength = '3M';

  // ---- 需求2：三个模块逐项复制按钮 ----
  check('需求2 套包行带复制按钮',
    (d.match(/选型套包[\s\S]*(?:data-copy-part)/) || []).length > 0);
  check('需求2 可选配件行带复制按钮',
    !d.includes('可选配件') || /可选配件[\s\S]*?data-copy-part/.test(d));
  app.state.selected = withKit;
  app.renderDetailPane();
  d = html('detail-pane');
  check('需求2 同款长度行带复制按钮',
    !d.includes('同款其他长度') || /同款其他长度[\s\S]*?data-copy-part/.test(d));
  // 复制处理器走 data-copy-part 且文案为「复制成功」
  const copyPartCalls = [];
  global.Android.copy = (t) => copyPartCalls.push(t);
  const btn = { getAttribute: () => '97010047' };
  // 直接调用委托路径不可行（mock 无事件），验证处理器存在性经由渲染 + 复制参数约定：
  check('需求2 复制按钮携带正确料号', d.includes('data-copy-part="95010009"') ||
    d.includes('data-copy-part="' + withKit.material_no + '"'));
  global.Android.copy = () => {};

  // ---- 需求1：左侧列表型号为第一准则；右侧明细料号卡片置顶 ----
  app.switchTab('search');
  app.state.query = 'VN4000-101-021';
  app.state.results = global.PFSearch.search(app.state.catalog.materials, 'VN4000-101-021', {}, 5);
  app.renderList();
  const sr = html('list-body');
  const titleIdx = sr.indexOf('class="card-title'), noIdx2 = sr.indexOf('class="card-no');
  check('需求1 搜索卡片型号优先', titleIdx >= 0 && noIdx2 > titleIdx &&
    sr.slice(titleIdx, noIdx2).includes('VN4000-101-021'));
  check('需求1 卡片次行展示料号', noIdx2 >= 0 && sr.slice(noIdx2, noIdx2 + 200).includes('95020001'));
  app.state.selected = app.state.results[0];
  app.state.detailMode = 'lookup';
  app.renderDetailPane();
  let dl = html('detail-pane');
  check('需求1 右侧明细料号卡片置顶', dl.indexOf('kit-glance') >= 0 &&
    dl.indexOf('kit-glance') < dl.indexOf('规格参数') && dl.includes('95020001'));

  // ---- 需求2：选型三级钻取 ----
  app.switchTab('config');
  check('需求2 第1层类别卡', html('list-body').includes('读码器') &&
    html('list-body').includes('智能相机') && html('list-body').includes('data-cfg-group'));
  app.state.cfg.group = 'reader';
  app.state.cfg.level = 'series';
  app.renderTopbar();
  app.renderList();
  check('需求2 读码器系列卡', html('list-body').includes('VS1000P') &&
    html('list-body').includes('data-cfg-series'));
  check('需求2 原型/中性切换出现', html('topbar').includes('原型') &&
    html('list-body').includes('data-cfg-quality'));
  check('需求2 顶栏面包屑', html('topbar').includes('crumb') &&
    html('topbar').includes('读码器'));
  app.state.cfg.quality = 'neutral';
  app.renderList();
  check('需求2 中性档系列', html('list-body').includes('中性机型') &&
    html('list-body').includes('VS1000PRO'));

  // ---- 需求2b：智能相机同样支持 中性/原型（中性机=VA中性 系列） ----
  app.state.cfg.group = 'camera';
  app.state.cfg.quality = 'neutral';
  app.renderTopbar();
  app.renderList();
  check('需求2b 相机出现质量切换', html('list-body').includes('data-cfg-quality'));
  const camNeutral = html('list-body');
  check('需求2b 相机中性档含 VA中性 与 VN4000/VN2000 中性机',
    camNeutral.includes('VA中性') && camNeutral.includes('VN4000') &&
    camNeutral.includes('VN2000'));
  app.state.cfg.quality = 'original';
  app.renderList();
  const camOrig = html('list-body');
  check('需求2b 相机原型档无 VA中性', camOrig.includes('VN4000') &&
    !camOrig.includes('data-cfg-series="VA中性"'));
  check('需求2b 相机档不混入读码器系列', !camOrig.includes('data-cfg-series="VS2000"') &&
    !camOrig.includes('data-cfg-series="VS1000P"'));
  app.state.cfg.group = 'reader';
  app.state.cfg.quality = 'original';
  app.renderList();
  app.state.cfg.quality = 'original';
  app.state.cfg.series = 'VS1000P';
  app.state.cfg.level = 'models';
  app.renderTopbar();
  app.renderList();
  check('需求2 第3层型号列表', html('list-body').includes('VS1000P-'));
  check('需求2 面包屑含系列', html('topbar').includes('VS1000P'));

  // ---- 需求2：选型动线详情 = 规格参数优先，料号其次 ----
  const cfgModel = app.state.catalog.materials.find((m) => m.material_code === 'VN4000-101-021');
  app.state.selected = cfgModel;
  app.state.detailMode = 'select';
  app.renderDetailPane();
  let dd = html('detail-pane');
  check('需求2 选型详情规格在套包之前', dd.indexOf('规格参数') < dd.indexOf('选型套包') &&
    !dd.includes('specs-fold'));
  check('需求2 料号速览随规格其后', dd.indexOf('规格参数') < dd.indexOf('kit-glance') &&
    dd.includes('kit-glance standalone'));
  app.state.detailMode = 'lookup';
  app.renderDetailPane();
  dd = html('detail-pane');
  check('需求1 查料号动线规格仍折叠在尾', dd.indexOf('选型套包') < dd.indexOf('specs-fold'));

  /* ============================================================
     事件路由回归
     重构把原先的 if 链换成 app.js 的 ROUTES 表，这是本次风险最高的改动：
     路由顺序一旦错位（例如客户卡按钮落到通用 .card 之后），
     点击「复制/编辑/删除」就会被卡片选中动作吞掉，且不会报任何错。
     下面逐条驱动真实的分派函数，锁住顺序与取值。
     ============================================================ */
  console.log('\n事件路由：');

  // data-tab → 切页
  clickWith({ 'data-tab': 'saved' });
  check('路由 data-tab 切页', app.state.tab === 'saved', `tab=${app.state.tab}`);

  // data-more → 加载更多步进
  app.switchTab('search');
  app.state.shown = 30;
  clickWith({ 'data-more': '1' });
  check('路由 data-more 步进 +30', app.state.shown === 60, `shown=${app.state.shown}`);

  // data-clear → 清空关键词
  app.state.query = 'VS1000';
  clickWith({ 'data-clear': '1' });
  check('路由 data-clear 清空关键词', app.state.query === '', `q=${app.state.query}`);

  // data-act=clear-filters → 清类别/状态/隐藏退市
  app.state.category = '固定式读码器';
  app.state.status = '可售';
  global.PFData.settings.set('hideRetired', true);
  clickWith({ 'data-act': 'clear-filters' });
  check('路由 clear-filters 复位全部筛选',
    app.state.category === '' && app.state.status === '' &&
    global.PFData.settings.get('hideRetired') === false);

  // data-cat / data-status → 写入筛选并触发搜索
  clickWith({ 'data-cat': '智能传感器' });
  check('路由 data-cat 写入类别', app.state.category === '智能传感器', app.state.category);
  clickWith({ 'data-status': '' });
  check('路由 data-status 可清空', app.state.status === '');

  // data-cable → 线长切换
  clickWith({ 'data-cable': '5M' });
  check('路由 data-cable 切换线长', app.state.cableLength === '5M', app.state.cableLength);
  clickWith({ 'data-cable': '3M' });

  // data-copy-part → 只复制该料号
  const partCopied = [];
  const realCopy = global.Android.copy;
  global.Android.copy = (t) => partCopied.push(t);
  clickWith({ 'data-copy-part': '97010047' });
  check('路由 data-copy-part 复制单项料号',
    partCopied.length === 1 && partCopied[0] === '97010047', JSON.stringify(partCopied));

  // data-copy-set → 整包复制（选中客户时带头）
  C.add('路由测试客户', '深圳市坪山区');
  C.setSelected(C.all().filter((c) => c.name === '路由测试客户')[0]);
  partCopied.length = 0;
  clickWith({ 'data-copy-set': withKit.material_no });
  check('路由 data-copy-set 整包带头带客户',
    partCopied.length === 1 && partCopied[0].indexOf('客户: 路由测试客户') === 0 &&
    partCopied[0].indexOf(withKit.material_no) > 0);
  C.setSelected(null);
  global.Android.copy = realCopy;

  // data-fav → 收藏切换
  const favNo = app.state.catalog.materials[0].material_no;
  const favBefore = global.PFData.favorites.has(favNo);
  clickWith({ 'data-fav': favNo });
  check('路由 data-fav 切换收藏', global.PFData.favorites.has(favNo) === !favBefore);
  clickWith({ 'data-fav': favNo });
  check('路由 data-fav 可切回', global.PFData.favorites.has(favNo) === favBefore);

  // 选型三级钻取路由
  app.switchTab('config');
  clickWith({ 'data-cfg-group': 'reader' });
  check('路由 data-cfg-group 进入系列层',
    app.state.cfg.group === 'reader' && app.state.cfg.level === 'series');
  clickWith({ 'data-cfg-series': 'VS1000P' });
  check('路由 data-cfg-series 进入型号层',
    app.state.cfg.series === 'VS1000P' && app.state.cfg.level === 'models');
  clickWith({ 'data-cfg-back': 'series' });
  check('路由 data-cfg-back 回退一层',
    app.state.cfg.level === 'series' && app.state.cfg.series === '');
  clickWith({ 'data-cfg-back': 'category' });
  check('路由 data-cfg-back 回到类别层',
    app.state.cfg.level === 'category' && app.state.cfg.group === '');

  // .card → 选中物料 + 记录最近查看
  app.switchTab('search');
  global.PFData.setPref('recent', '[]');
  const cardNo = app.state.catalog.materials[5].material_no;
  clickWith({ _class: 'card', 'data-no': cardNo });
  check('路由 .card 选中物料',
    app.state.selected && app.state.selected.material_no === cardNo);
  check('路由 .card 写入最近查看',
    global.PFData.recent.all().indexOf(cardNo) === 0, JSON.stringify(global.PFData.recent.all().slice(0, 2)));

  // ---- 路由优先级：卡片内按钮必须先于通用 .card ----
  app.state.selected = null;
  app.state.custEditing = null;
  clickWith({ _class: 'card', 'data-no': cardNo, 'data-cust-edit': '12345' });
  check('优先级 客户卡编辑按钮不被 .card 吞掉',
    app.state.custEditing === 12345 && app.state.selected === null,
    `editing=${app.state.custEditing} selected=${app.state.selected && app.state.selected.material_no}`);
  app.state.custEditing = null;

  app.state.selected = null;
  clickWith({ _class: 'card', 'data-no': cardNo, 'data-cust-select': '999' });
  check('优先级 客户卡选中走 cust-select 而非物料卡', app.state.selected === null);

  // 模态路由
  clickWith({ 'data-fb-open': '1' });
  check('路由 data-fb-open 打开反馈弹层', app.modalHTML().includes('data-fb-rate'));
  clickWith({ 'data-modal-close': '1' });
  check('路由 data-modal-close 关闭弹层', app.modalHTML() === '');

  // 数据迁移路由
  clickWith({ 'data-bk-export': '1' });
  check('路由 data-bk-export 打开导出弹层',
    app.modalHTML().includes('导出备份') && app.modalHTML().includes('data-bk-copy'));
  clickWith({ 'data-modal-close': '1' });
  check('路由 data-bk-export 可关闭', app.modalHTML() === '');

  clickWith({ 'data-bk-import': '1' });
  check('路由 data-bk-import 打开恢复弹层',
    app.modalHTML().includes('恢复备份') && app.modalHTML().includes('data-bk-restore'));
  clickWith({ 'data-modal-close': '1' });

  // 优先级：.card 上的 data-bk-export 必须命中备份路由，而非被通用 .card 吞掉
  app.state.selected = null;
  clickWith({ _class: 'card', 'data-no': cardNo, 'data-bk-export': '1' });
  check('优先级 .card 上的导出按钮不被 .card 吞掉', app.state.selected === null);
  clickWith({ 'data-modal-close': '1' });

  check('全流程无未捕获异常', errors.length === 0, errors[0]);

  console.log(`\n通过 ${pass} · 失败 ${fail}\n`);
  process.exit(fail ? 1 : 0);
}, 300);
