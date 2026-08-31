# 灰度迭代记录 — 第 2 轮（rc2 → rc3）

> 日期：2026-08-30 ｜ 基线：10.1.0-rc2 ｜ 产物：10.1.0-rc3
> 数据来源：**模拟面板 50 份（simulated=true，均分 2.78★，好评率 14%）** + 自动化仪器（97 项断言）。
> 反馈由 findings/round-2.json 的可复现证据驱动，详见 out/round-2-summary.md。

## 1. 反馈摘要（模拟面板）

| Finding | 优先级 | 问题 | 证据 |
|---------|--------|------|------|
| R2-01 | P1 | 硬件返回键不接管应用内层叠，详情页/弹层打开时按返回直接退出应用 | MainActivity.onBackPressed 依赖 canGoBack（SPA 恒 false）；JS 未上报层叠状态 |
| R2-02 | P1 | 已选报价客户后，详情页复制整包无任何可见提示 | data-copy-set 静默拼接 quoteHeader；detailHTML 不显示选中客户 |
| R2-03 | P2 | 客户导入失败只有一种报错 | importJSON 对 parse 失败与格式不符都返回 null |
| R2-04 | P3 | 反馈弹层未选中星标用实心星 | feedbackModal 统一使用 ICONS.starOn |

本轮 P1×2 覆盖大多数画像（返回键 = Android 最高频负反馈点），故均分较第 1 轮低——这正是灰度迭代要暴露的。

## 2. 变更点（rc3）

| # | 变更 | 文件 | 对应反馈 |
|---|------|------|----------|
| 1 | 原生桥接新增 `reportOverlay(boolean)`；`onBackPressed` 在层叠打开时执行 `__pf.closeTop()`（先弹层 → 再详情 sheet → 最后退出应用） | MainActivity.java | R2-01 |
| 2 | JS 打开/关闭 sheet 与 modal 时同步上报；暴露 `__pf.closeTop` 入口 | web/js/app.js | R2-01 |
| 3 | 详情 hero 徽标行新增「报价客户: X」胶囊（含 role=status 与 aria-label），未选择时不渲染 | web/js/app.js | R2-02 |
| 4 | 新增 `.badge-cust` 样式（accent 软底胶囊，设计规范 §3.4 扩展） | web/css/app.css | R2-02 |
| 5 | `importJSON` 失败区分返回 `{error:'parse'}` / `{error:'format'}`；runImport 分别给出方向性提示 | web/js/customer.js, app.js | R2-03 |
| 6 | 反馈星标未选中改描边星，选中切换实心星 + 琥珀色（形状+颜色双重编码） | web/js/app.js | R2-04 |
| 7 | 新增 5 项回归断言（R1 3 项 + R2 5 项中 DOM 可测部分） | tools/test_ui.js | 验证 |

## 3. 改进依据

- R2-01：Android 设计指南「Back navigation」要求返回键逐层回退；单页应用无历史栈可依赖，必须由前端上报层叠状态（findings/round-2.json R2-01）。
- R2-02：设计规范 §3.9「状态必须可见」；桌面版客户选中态有顶栏常显，移动端跨页后同样需要常显载体（findings/round-2.json R2-02）。
- R2-03：报错可操作性原则——提示必须给「下一步怎么改」（findings/round-2.json R2-03）。

## 4. 验证结果

- `node tools/test_core.js`：9/9 通过
- `node tools/test_ui.js`：**97/97 通过**（新增 R2 回归 5 项）
- `python build.py`：签名校验通过，产物 PartFinder-Mobile-v10.1.0-rc3.apk
- 不采纳项：无
- 风险注记：R2-01 涉及原生返回键行为，离线 DOM 断言只能覆盖 `closeTop` JS 路径，
  原生按键路径在 MuMu 真机回归中用 `adb shell input keyevent 4` 验证（最终版执行）。
