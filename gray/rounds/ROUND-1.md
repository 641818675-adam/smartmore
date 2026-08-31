# 灰度迭代记录 — 第 1 轮（rc1 → rc2）

> 日期：2026-08-30 ｜ 基线：10.1.0-rc1 ｜ 产物：10.1.0-rc2
> 数据来源：**模拟面板 50 份（simulated=true）** + 自动化仪器（92 项离线断言、perf.js）。
> 本沙箱无真实用户分发通道（离线环境），真实用户执行清单见 gray/README.md §三；
> 改进依据 = 各 finding 的可复现证据链，非虚构用户意见。

## 1. 反馈摘要（模拟面板，均分 3.12★，好评率 26%）

| Finding | 优先级 | 问题 | 证据 |
|---------|--------|------|------|
| R1-01 | P2 | 竞品页搜索框没有清空按钮 | app.js renderTopbar rival 分支缺 data-clear（代码走查） |
| R1-02 | P2 | 331dp 外屏客户卡片三按钮竖排挤压信息区 | app.css .cust-actions 竖排 + Fold3 外屏宽度测算 |
| R1-03 | P1 | 无关键词浏览 300 条触顶无出口；**且分组浏览路径「加载更多」从未渲染** | runSearch 上限 300；renderList 分组分支无 more 按钮（代码走查，后者为测试暴露的既有 bug） |
| R1-04 | P3 | 深色模式选中 chip 投影沿用亮色蓝 | .chip.on 硬编码 rgba(43,92,240,.32)，违反设计规范 §2.1 |

## 2. 变更点（rc2）

| # | 变更 | 文件 | 对应反馈 |
|---|------|------|----------|
| 1 | 竞品页搜索框补齐清空按钮（含 aria-label） | web/js/app.js | R1-01 |
| 2 | 检索上限 300 → 600（SEARCH_CAP 常量），触顶时显示「已列出前 N 条 + 缩小范围」指引 | web/js/app.js | R1-03 |
| 3 | 分组浏览路径补渲染「加载更多」按钮（既有 bug 修复） | web/js/app.js | R1-03 |
| 4 | ≤359dp 时客户卡操作按钮换行为横向整行 | web/css/app.css | R1-02 |
| 5 | 新增 --accent-glow / --danger-glow 令牌，亮暗模式各自定义；chip.on / btn.primary / btn.danger 改引令牌 | web/css/app.css | R1-04 |
| 6 | 新增 3 项回归断言（R1-01 / R1-03×2） | tools/test_ui.js | 验证 |

## 3. 改进依据

- R1-03 触顶指引：_perf.js 实测单次检索 0.45–4.5ms，上限 600 无性能风险；1213 全量渲染低端 WebView 滚动有风险，故 600 为折中_（gray/findings/round-1.json R1-03）。
- R1-02 响应式：_设计规范 §2.3「窄屏优先」条款；Fold3 外屏 331dp 是最小目标宽度_。
- R1-04 令牌化：_设计规范 §2.1「禁止令牌外取色」硬规则_。

## 4. 验证结果

- `node tools/test_core.js`：9/9 通过
- `node tools/test_ui.js`：**92/92 通过**（新增 R1 回归 3 项）
- `python build.py`：签名校验通过，产物 PartFinder-Mobile-v10.1.0-rc2.apk
- 不采纳项：无

## 5. 遗留

- R1-02/R1-04 为纯 CSS 改动，DOM 断言无法覆盖，需 MuMu 多分辨率截图回归（最终版统一执行）。
