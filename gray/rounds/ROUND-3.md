# 灰度迭代记录 — 第 3 轮（rc3 → 10.1.0 正式版）

> 日期：2026-08-30 ｜ 基线：10.1.0-rc3 ｜ 产物：10.1.0（转正）
> 数据来源：**模拟面板 50 份（simulated=true，均分 3.54★，好评率 48%）** + 自动化仪器（104 项断言、perf.js）。
> 三轮趋势：3.12★ → 2.78★（探入新交互区，暴露 P1×2）→ 3.54★（回升），符合灰度 program 的正常曲线。

## 1. 反馈摘要（模拟面板）

| Finding | 优先级 | 问题 | 证据 |
|---------|--------|------|------|
| R3-03 | P2 | 客户表单按输入法「完成/回车」不提交 | 表单无 Enter 链路 |
| R3-04 | P2 | 顶栏标题与系统状态栏时间重叠（v10.0.0 起既有缺陷，真机回归发现） | 真机截图对比；WebView env(safe-area-inset-top)=0 未兜底 |
| R3-NA1/2/3 | P3 | 三项**不采纳**：散客字样、客户搜索过滤、选中态跨会话持久化 | 与桌面版对等原则冲突，见 findings/round-3.json |

## 2. 变更点（10.1.0）

| # | 变更 | 文件 | 对应反馈 |
|---|------|------|----------|
| 1 | 确认弹层主动作提取为 `confirmModalOk()`；删除已选客户时 toast 明确「已同时取消报价选择」 | web/js/app.js | R3-01 |
| 2 | 加载更多步进递增（首次 +30，其后 +60），新增 `resetShown()` 统一重置分页游标（9 处调用点收敛） | web/js/app.js | R3-02 |
| 3 | 客户表单 Enter 提交：提取 `handleCustEnter()` 接入全局 keydown；输入框加 `enterkeyhint="done"` | web/js/app.js | R3-03 |
| 4 | 顶栏/详情栏 padding 改为 `calc(max(env(safe-area-inset-top), 34px) + …)` 兜底无 cutout 设备 | web/css/app.css | R3-04 |
| 5 | 新增 8 项回归断言（R3 DOM 可测部分） | tools/test_ui.js | 验证 |

## 3. 改进依据

- R3-01：报错/提示必须覆盖「连带影响」，否则用户感知为数据丢失（findings/round-3.json R3-01）。
- R3-02：交互效率公式——到达上限所需交互次数从 ~20 降到 ~9（30+60×n）；大列表渲染仍按 30/60 分块 innerHTML，perf.js 探针确认无回退（套包解析 8ms / JSON 解析 3ms）。
- R3-03：Android 输入法 action 与表单提交是移动端表单基线（HIG/MD 表单规范）。
- R3-04：真机截图证据（v101_home.png 重叠 → v101_home2.png 修复后），经旧版截图 r01_home.png 对比确认为既有缺陷，纳入本轮一并修复。
- 不采纳三项均记录在 findings/round-3.json，等待桌面版先行决策后同步（任务 1 的对等约束）。

## 4. 验证结果

- `node tools/test_core.js`：9/9 通过
- `node tools/test_ui.js`：**104/104 通过**
- `node tools/perf.js`：搜索 0.4–3.55ms / 套包 60 次 8ms / JSON 3ms，无回退
- `python build.py`：签名校验通过，产物 PartFinder-Mobile-v10.1.0.apk
- **MuMu 真机回归**（v10.1.0 最终包）：安装 Success；冷启动 744ms/499ms；logcat 6111 行 FATAL=0 / ANR=0 / am_crash=0 / am_anr=0 / JS 控制台错误=0；客户页/详情页/选型页渲染截图确认；R3-04 修复后真机复核通过
- 环境遗留（R3-NA4）：MuMu 无法复现浅色模式与竖屏 sheet 形态，留待真机抽检
- 转正结论：三轮迭代闭环完成，无未处理 P0/P1
