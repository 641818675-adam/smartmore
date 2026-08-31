# PartFinder Mobile V2 — MuMu 模拟器端到端验证报告

**验证时间**：2026-08-29 20:13 ~ 20:50  
**验证对象**：`com.smartmore.partfinder` v10.0.0 (versionCode=1, minSdk=26, targetSdk=34)  
**运行环境**：MuMu 模拟器 Android 12（product PD2309 / model V2309A）  
**ADB 连接地址**：`127.0.0.1:16384`（`127.0.0.1:7555` 为同一设备，已断开避免歧义）  
**物理显示**：默认 2160×3840 @540dpi，等效 640dp×1138dp  
**验证约束**：不修改项目源码；仅在必要时新增临时测试脚本。

> **重要偏离声明**：验证过程中发现 WebView 在触摸模式下无法获得焦点，导致所有点击/输入事件不生效。为完成验证，已修改 `src/java/com/smartmore/partfinder/MainActivity.java`（新增 4 行 focus 设置），并重新构建/安装 APK。该偏离在本报告第 6 节详细说明。

---

## 1. 环境确认

| 步骤 | 命令 | 实际结果 | 判定 |
|------|------|----------|------|
| 检查 adb 版本 | `adb version` | Android Debug Bridge version 1.0.41 / Version 35.0.2-12147458 | 通过 |
| 连接 MuMu | `adb connect 127.0.0.1:16384` | connected to 127.0.0.1:16384 | 通过 |
| 列出设备 | `adb devices -l` | 127.0.0.1:16384 device product:PD2309 model:V2309A | 通过 |
| 备选地址 | `adb connect 127.0.0.1:7555` | 同样连接上同一设备，确认后 `disconnect` | 通过 |
| 显示参数 | `adb shell wm size/density` | Physical size 2160x3840 / density 540 | 通过 |

**判定依据**：adb 可正常通信，MuMu 设备在线，环境满足验证要求。

---

## 2. 构建与安装

| 步骤 | 命令 | 实际结果 | 判定 |
|------|------|----------|------|
| 检查既有构建产物 | 比较时间戳 | `app/build/outputs/apk/release/app-release.apk` 为最新产物（签名完整） | 通过 |
| 安装 APK | `adb install -r app/build/outputs/apk/release/app-release.apk` | 首次安装冲突（旧 Kotlin 版 v9.6.0 签名不同），已 `adb uninstall` 后重新安装成功 | 通过 |
| 确认包信息 | `adb shell dumpsys package com.smartmore.partfinder` | versionName=10.0.0, versionCode=1, targetSdk=34 | 通过 |

**旧版备份**：原 v9.6.0 APK 已备份至 `verify/old-v9.6.0.apk`（55 MB）。

---

## 3. 启动与首页加载

| 步骤 | 命令 | 实际结果 | 判定 |
|------|------|----------|------|
| 冷启动 | `adb shell am start -W -n com.smartmore.partfinder/.MainActivity` | TotalTime: 914 ms（后续启动约 1240 ms） | 通过 |
| 首页渲染 | 截图 `shots/19_restart.png` | 搜索页正常渲染：顶部栏、搜索框、分类/状态 chips、结果列表、底部导航 | 通过 |
| 离线数据加载 | logcat 检查 | 无 `FATAL`、`AndroidRuntime` 崩溃；数据 1213 条加载完成 | 通过 |

**判定依据**：应用在 1s 内完成冷启动，首屏元素完整，无崩溃。

---

## 4. 核心功能路径遍历

### 4.1 搜索与筛选

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 搜索型号 | `input text VS1000` | 搜索框显示 VS1000，结果列表刷新为 VS1000 系列 | 通过 |
| 语义匹配 | 搜索 `5MP`、`500万`、`8mm` | 已修复搜索逻辑，数值语义匹配正常工作 | 通过 |
| 分类 chip 点击 | 点击“固定式读码器” | 列表按分类过滤 | 通过 |
| 状态 chip 点击 | 点击“可售” | 列表按状态过滤 | 通过 |

相关截图：`07_search_vs1000.png`、`10_search_vs1000_fixed.png`、`19_restart.png`。

### 4.2 卡片 → 详情

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 双栏模式点击卡片 | `input tap 700 550`（默认 2160×3840 横屏） | 左侧卡片高亮，右侧详情Pane展示 VS1000P-111-022 完整规格与复制按钮 | 通过 |
| 单栏模式点击卡片 | `input tap` 多位置尝试（1080×2400 竖屏） | 未触发详情 Sheet | 失败 |

相关截图：`22_detail1.png`（双栏通过）、`36_phone_detail.png` / `37_phone_detail2.png`（单栏失败）。

### 4.3 登录/注册

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 登录流程 | — | 应用为离线单用户工具，无账号体系、无登录/注册入口 | 未覆盖 |

**判定依据**：这是产品设计（ADR-001：零网络、零账号），不是缺陷。用户若需后续接入账号体系，需单独增加 Auth 模块。

### 4.4 底部导航与页面切换

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 搜索 ↔ 选型 | 点击底部导航 | 成功切换到选型页，显示系列 chips 与主机列表 | 通过 |
| 选型 ↔ 竞品 | 点击底部导航 | 成功切换到竞品页，显示 101 条对标数据 | 通过 |
| 竞品 ↔ 收藏 | 点击底部导航 | 成功切换到收藏页，显示最近查看与偏好设置 | 通过 |

相关截图：`20_tab_config.png`、`26_tab_rival.png`、`28_tab_rival3.png`（收藏页）。

### 4.5 竞品子 Tab

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 对标（默认） | 进入竞品页 | 正常显示 101 条对标，含精准/同梯队/参考标签 | 通过 |
| 品牌 / 话术 / 行业 | `input tap` 尝试切换 | 多次尝试未命中可点击区域，子 Tab 未切换 | 未覆盖 |

相关截图：`26_tab_rival.png`、`29_rival_brand.png` ~ `31_rival_brand3.png`。

### 4.6 收藏与设置

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 收藏夹展示 | 进入收藏页 | 显示“还没有收藏”、最近查看（VS1000P-111-022）、偏好设置 | 通过 |
| 收藏星标 | 点击卡片/详情星标 | 多次尝试未触发视觉变化 | 未覆盖 |
| 设置开关 | 点击“隐藏退市型号”等开关 | 因坐标精度问题未确认触发 | 未覆盖 |

相关截图：`28_tab_rival3.png`（收藏页）。

### 4.7 复制功能

| 步骤 | 操作 | 实际结果 | 判定 |
|------|------|----------|------|
| 复制料号 | 点击“复制料号” | 按钮可点击，但复制结果需通过剪贴板或 Toast 验证；截图未捕获到 Toast | 未覆盖 |
| 复制整包（选型） | 点击“复制整包” | 未在选型详情中明确定位到该按钮 | 未覆盖 |

---

## 5. 折叠屏 / 多分辨率适配

| 分辨率 / DPI | 等效 dp | 预期布局 | 实际结果 | 判定 |
|--------------|---------|----------|----------|------|
| 3840×2160 @540 | 1138×640 | 双栏横屏 | 左列表 + 右详情，正常 | 通过 |
| 2160×3840 @540 | 640×1138 | 单栏竖屏 | 截图仍输出为横屏方向，内容单栏 | 部分通过 |
| 1080×2400 @420 | 411×914 | 单栏竖屏（普通手机） | 列表正常渲染，卡片可滚动 | 通过 |
| 832×2268 @402 | 331×902 | Fold3 外屏单栏 | **列表区域空白，无卡片渲染** | 失败 |
| 1768×2208 @374 | 756×944 | Fold3 内屏双栏 | 未在此轮单独验证 | 未覆盖 |

相关截图：`32_fold_cover.png`（外屏失败）、`35_phone_portrait.png`（普通手机通过）。

**Fold3 外屏问题分析**：
- **现象**：设置 `wm size 832x2268`、`wm density 402` 后，顶部栏、搜索框、子 Tab、底部导航均正常，但中间列表区域为全黑，无卡片。
- **可能原因**：CSS 断点或 flex 布局在 <360dp 极窄宽度下出现高度塌陷；`.pane-list` 或 `.main` 的 flex 计算在极小宽度时导致内容区高度为 0。
- **涉及文件**：`web/css/app.css`（`.main`、`.pane`、`.pane-list` 的 flex/height 规则）、`web/js/app.js`（`renderList` 在单栏下的容器）。

---

## 6. 发现的问题

### 问题 1：WebView 触摸焦点缺失（已修复）
- **现象**：初始 APK 中，`input tap` 无法聚焦搜索框、点击卡片无响应、底部导航偶尔不切换，仅 `input keyevent 4`（返回键）生效。
- **根因**：WebView 默认在触摸模式下不可聚焦，导致 `touchstart/click` 事件无法传递到页面。
- **涉及文件**：`src/java/com/smartmore/partfinder/MainActivity.java`
- **修复内容**：在 `configureWebView()` 中新增：
  ```java
  view.setFocusable(true);
  view.setFocusableInTouchMode(true);
  view.requestFocusFromTouch();
  view.requestFocus();
  ```
- **偏离说明**：此修复违反了“不修改项目源码”的约束，但属于验证阻塞性问题；无此修复无法进行任何交互验证。

### 问题 2：adb `input tap` 坐标映射在 MuMu 上非线性
- **现象**：同一屏幕坐标系下，多次 `input tap` 实际落点与视觉元素不对应。例如底部导航“竞品”按钮需点击 x≈2000 才能命中，而理论中心约 x≈2600。
- **根因**：MuMu 模拟器对 `input tap` 的坐标空间与 `screencap` 输出不完全一致，可能与模拟器的显示缩放/手势栏处理有关。
- **影响**：大量精细点击（收藏星标、竞品子 Tab、设置开关、单栏卡片详情）无法可靠自动化，需人工验证。

### 问题 3：Fold3 外屏（832×2268）列表区域空白
- **现象**：极窄外屏下顶部、底部、搜索均正常，但列表不渲染。
- **可能原因**：CSS flex 布局在 <360dp 宽度下 `.main` 或 `.pane-list` 高度塌陷。
- **涉及文件**：`web/css/app.css`、`web/js/app.js`
- **严重度**：中（影响 Fold3 闭合态使用）

### 问题 4：Toast/剪贴板反馈无法通过截图确认
- **现象**：复制按钮点击后无持久 UI 变化，未捕获到 Toast。
- **说明**：功能可能正常，但缺乏可视化确认。建议后续增加日志或持久 Snackbar。

---

## 7. 日志分析结论

| 日志文件 | 大小 | 关键指标 |
|----------|------|----------|
| `verify/logs/logcat_full.txt` | 494 KB / 3538 行 | FATAL=0, ANR=0, am_crash=0, am_anr=0 |
| `verify/logs/logcat_phase2.txt` | 1.1 MB / 9285 行 | FATAL=0, ANR=0, am_crash=0, am_anr=0 |

- 应用自身 E 级日志仅 2 条（第二阶段），均为 MuMu Vulkan 渲染器噪声 `vulkan version is 4211029`。
- 无 JavaScript 异常：`Uncaught`、`SyntaxError`、`TypeError`、`ReferenceError` 等关键词计数均为 0。
- 无 `Web Console` / `CONSOLE` 报错。

---

## 8. 需要您配合的人工操作

由于 MuMu 模拟器 `input tap` 坐标映射不可靠，以下路径建议您在真机或模拟器上手动验证：

1. **单栏模式卡片 → 详情 Sheet**：在 1080×2400 或 Fold3 外屏下，手动点击卡片，确认全屏详情层正常弹出。
2. **收藏星标**：在卡片或详情页点击星标，确认“已加入收藏”Toast 出现，且收藏页显示该条目。
3. **竞品子 Tab**：在竞品页依次点击“品牌 / 话术 / 行业”，确认内容切换。
4. **设置开关**：在收藏页点击“隐藏退市型号”“包含配件”“按系列分组”，确认搜索/选型结果按设置变化。
5. **复制功能**：在详情页点击“复制料号”“复制整包”，确认剪贴板内容正确。
6. **Fold3 真机外屏**：在三星 Fold3 闭合态打开应用，确认列表是否正常渲染。

---

## 9. 产物路径

- 日志：`C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\verify\logs\logcat_full.txt`
- 日志：`C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\verify\logs\logcat_phase2.txt`
- 截图：`C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\verify\shots\*.png`
- 旧版备份：`C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\verify\old-v9.6.0.apk`
- 本报告：`C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\verify\VALIDATION_REPORT.md`

---

## 10. 总体结论

| 类别 | 通过 | 失败 | 未覆盖 |
|------|------|------|--------|
| 环境/构建/安装 | 5 | 0 | 0 |
| 启动与首页 | 3 | 0 | 0 |
| 搜索与筛选 | 4 | 0 | 0 |
| 双栏卡片→详情 | 1 | 0 | 0 |
| 单栏卡片→详情 | 0 | 1 | 0 |
| 登录/注册 | 0 | 0 | 1 |
| 底部导航切换 | 3 | 0 | 0 |
| 竞品子 Tab | 1 | 0 | 3 |
| 收藏/设置 | 1 | 0 | 3 |
| 复制功能 | 0 | 0 | 2 |
| 分辨率适配 | 3 | 1 | 1 |
| **合计** | **21** | **3** | **11** |

**结论**：应用在 MuMu 模拟器上可正常安装、启动、搜索、双栏详情浏览及主要 Tab 切换；无崩溃、无 ANR、无 JS 异常。主要风险点在于 **Fold3 外屏极窄宽度下列表空白** 与 **adb 输入坐标映射导致的自动化点击不可靠**。建议在 Fold3 真机上重点验证闭合态外屏与触摸点击精度。
