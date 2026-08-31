# PartFinder Mobile → iOS 迁移方案评估

日期：2026-08-30
对象：`PartFinderMobileV2`（v10.5.0）
结论前置：**走"Web 层复用 + iOS 原生壳"，不要原生重写，也不要上跨平台框架。**

---

## 0. 先纠正前提：这不是一个"Java/Kotlin Android 应用"

扫描结果决定了整道题的解法：

| 层 | 规模 | 说明 |
|---|---|---|
| Android 原生层 | **1 个 Java 文件，302 行** | `MainActivity.java`，零第三方依赖 |
| 业务层 | `web/` 目录，约 3000 行 JS + 1300 行 CSS | 单页应用，全部业务逻辑在此 |
| 数据集 | 891 KB `products.json`（1213 条物料） | 通过 XHR 加载 |
| 原生桥接 | **7 个方法** | copy / paste / toast / screenWidthDp / getPref / setPref / reportOverlay |

`MainActivity.java` 的注释里写得很清楚：

> 应用本体是 assets/web 下的单页应用，原生层只负责承载，不参与业务。

**所以迁移对象不是"把一个 Android 应用移植到 iOS"，而是"给一个已经能跑的 Web 应用换一个 iOS 外壳"。** 方案 1、2 的成本因此从"数周"塌缩到"数小时"。

---

## 1. 三条路径对比

### 1.1 路径 A：原生重写（Swift / SwiftUI）

| 维度 | 评估 |
|---|---|
| 可复用 | **0%**。现有代码是 JS + HTML + CSS，Swift 一行都用不上 |
| 必须重写 | 搜索索引与模糊匹配、选型三级下钻、套包解析（contract.js）、竞品对比、客户管理、收藏、设置 —— 全部 |
| 业务逻辑风险 | **极高**。套包解析（必需线缆/配件规则）是业务核心，重写即等于重新实现一遍业务规则，无测试可对照的部分极易出错 |
| 工期 | 数周，且需要持续与 Android 版对齐 |
| 评分 | **2 / 10** |

**平台差异清单（若真走这条路，这些全部要从零做）：**

| 能力 | Android 现状 | iOS 对应 | 差异程度 |
|---|---|---|---|
| 本地存储 | SharedPreferences | UserDefaults | 低，键值结构一致 |
| 通知 | 未使用 | UNUserNotificationCenter | 不适用 |
| 推送 | 未使用 | APNs + 付费账号 | **免费账号无法使用** |
| 权限 | 未申请任何危险权限 | 需逐个声明用途文案 | 不适用 |
| 后台任务 | 未使用 | BGTaskScheduler（iOS 极其受限） | 不适用 |
| 返回导航 | 硬件返回键 + `onBackPressed` 逐层退出 | 无硬件返回键，靠屏幕边缘手势 / 页面内按钮 | **中，需设计** |
| 生命周期 | Activity（configChanges 全部自管） | UIViewController / SceneDelegate | 中 |
| 折叠屏连续态 | `screenWidthDp` + 不重建 | iPad 分屏、Stage Manager | 低 |

**判断：为一个已经跑通的 Web 应用重写全部 UI 与业务逻辑，是把 100% 的既有资产清零去换 0 收益。**

### 1.2 路径 B：跨平台重构（Flutter / React Native / KMP）

| 框架 | 迁移成本 | 可共享 | 评分 |
|---|---|---|---|
| **Flutter** | 高。要把 Web 层（JS）重写为 Dart，UI 全部重画；302 行 Java 反而无所谓（它本来就没什么） | 0%（现有是 JS，不是 Dart） | **3 / 10** |
| **React Native** | 中高。JS 技能可复用，但 RN 组件 ≠ DOM 组件，`web/` 的 1300 行 CSS 全部作废，需改为 StyleSheet | 部分思维可迁移，代码几乎不可复用 | **4 / 10** |
| **Kotlin Multiplatform** | 无意义。**KMP 共享的是 Kotlin 业务逻辑，而本项目没有 Kotlin 业务逻辑**——业务在 JS 里 | 0% | **1 / 10** |

**关键认知：跨平台框架解决的是"一份代码跑两个原生端"的问题。你这个项目已经用 Web 技术解决了一次，再上一遍框架等于付两次入场费换同样的结果。**

附加阻碍：你的环境 **npm 被代理拦截、装不了新包**，Flutter / RN / KMP 的 SDK 与依赖链都要联网获取 —— 这条路径在当前网络条件下本身就走不通。

### 1.3 路径 C：Web 层复用 + iOS 原生壳 ✅

| 维度 | 评估 |
|---|---|
| 可复用 | **~100%** 业务层（web/ 全部代码 + 数据集） |
| 必须新写 | 一个 WKWebView 壳，约 150–200 行 Swift |
| 业务逻辑风险 | **近乎为零** —— 同一份 JS 在两个平台上跑 |
| 工期 | 1–2 天（含适配与真机验证） |
| 依赖 | 零第三方库，延续项目现有的"零依赖"约束 |
| 评分 | **9 / 10** |

---

## 2. 推荐路径详解：WKWebView 壳

### 2.1 七个桥接方法的 iOS 映射

WKWebView 的桥接机制是 `WKScriptMessageHandler`，JS 侧通过
`window.webkit.messageHandlers.<name>.postMessage(...)` 调用。

⚠️ **与 Android 最大的差异：`postMessage` 是单向异步的，没有同步返回值。**
Android 的 `paste()` 和 `getPref()` 是同步返回 String 的，这两个在 iOS 上必须改设计。

| 桥接方法 | Android | iOS 实现 | 改动 |
|---|---|---|---|
| `copy(text)` | ClipboardManager | `UIPasteboard.general.string = text` | 直接对应 |
| `paste()` | ClipboardManager | `UIPasteboard.general.string ?? ""` | **需改为异步回调** |
| `toast(msg)` | Toast | **不需要** —— JS 层 `PFUtil.toast()` 已完整实现，删掉桥接分支即可 | 删除 |
| `screenWidthDp()` | widthPixels / density | `UIScreen.main.bounds.width`（iOS 的 point 即 dp 等价，无需换算） | 直接对应 |
| `getPref(k)` | SharedPreferences | `UserDefaults.standard.string(forKey:)` | **需预注入为 JS 全局量** |
| `setPref(k,v)` | SharedPreferences | `UserDefaults.standard.set(_, forKey:)` | 单向写入，无返回值问题 |
| `reportOverlay(b)` | 供返回键逐层退出 | **不需要** —— iOS 无硬件返回键；且详情页已有可见关闭按钮（`detail.js:180` 的 `.icon-btn back`），弹层有关闭按钮与遮罩点击 | 删除 |

**`getPref` 的解法（优雅，且架构已经预留）**：
启动时用 `WKUserScript` 在 document-start 把 UserDefaults 全量注入为 JS 全局对象，
JS 侧读取走内存（同步，零延迟），写入同时更新内存对象并 `postMessage` 落盘。

值得注意的是，`data.js` 现有的三级兜底 **天然就是为这种场景设计的**：

```
原生 SharedPreferences  →  localStorage  →  进程内存
```

iOS 上只需把第一级换成 UserDefaults，即使 WKWebView 的 localStorage 在 `file://` 下不可靠，也会自动降级，不会丢功能。

### 2.2 真正的硬骨头：`file://` 下 XHR 被禁

`data.js:45` 用 `XMLHttpRequest` 加载 `data/products.json`。
Android 靠 `setAllowUniversalAccessFromFileURLs(true)` 开了口子，**iOS 的 WKWebView 没有对应开关**，同源策略下 `file://` 的 XHR 一律拒绝。

三种解法：

| 解法 | 做法 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **B1 数据集内联** ✅ | 把 891KB `products.json` 转成 `data/products.js`（`window.__PF_DATA = {...}`），用 `<script>` 引入 | 零原生代码、零私有 API；Android 端可同时受益（能关掉 `setAllowUniversalAccessFromFileURLs` 这个安全口子） | `web/` 需要改一处 `loadJSON`；首屏多一次 891KB 字面量解析（约 10ms，可忽略） | **推荐** |
| B2 自定义 Scheme | `WKURLSchemeHandler` 注册 `pf://` 提供整个 web 目录 | 约 40 行 Swift；Capacitor 现行方案 | localStorage / 安全上下文行为在自定义 scheme 下历史上有坑，需实测 | 备选 |
| B3 内嵌本地 HTTP 服务 | 起一个 `http://127.0.0.1:port` 服务 web 目录 | localhost 是安全上下文 → XHR / localStorage / 剪贴板 API 全部原生可用，`web/` **一行不用改** | 需手写约 200 行 Swift HTTP 服务器（无第三方依赖的前提下）；引入网络栈 | 想零 JS 改动时选它 |

**推荐 B1**：改动集中、可测（你有 210 项测试兜底）、延续零依赖约束，且顺手把 Android 的安全口子也补上了。

### 2.3 已定位的 iOS 适配缺陷（无论走哪条路都要修）

| # | 问题 | 位置 | 后果 | 修法 |
|---|---|---|---|---|
| 1 | `backdrop-filter` **缺 `-webkit-` 前缀** | `components.css:19, 421, 575`；`views.css:219`（共 4 处） | iOS Safari / WKWebView 上毛玻璃**完全失效**，顶栏与底栏变成纯色/半透明怪异色块 | 补 `-webkit-backdrop-filter` |
| 2 | `.field input` 字号 15px | `components.css:529` | 低于 iOS 的 16px 阈值，**聚焦时整页自动放大**，键盘收起后可能不复原 | 提到 16px（搜索框已是 16px，无此问题） |
| 3 | `user-scalable=no` | `index.html:5` | iOS 10+ 出于无障碍**忽略此项**，挡不住第 2 条的自动缩放 | 靠改字号解决，不要依赖 viewport |
| 4 | 无 Service Worker | — | PWA 路线无法离线 | PWA 路线才需要补 |

**已经开箱可用的部分**（不用动）：
- `env(safe-area-inset-*)` 已全面使用 → 刘海屏 / 灵动岛自适应自动生效
- 44px 触控目标已达标
- 详情页有可见关闭按钮 → 不依赖硬件返回键
- `PFUtil.copyText` 已有 `execCommand` DOM 兜底 → 无原生桥时复制仍可用

---

## 3. 零改造的即时方案（今天就能用）

在动手写 Swift 之前，你可以先用这两条路径把应用跑在 iPhone 上验证。

### 3.1 局域网 Web 服务（0 行代码改动）

```bash
cd PartFinderMobileV2/web && python -m http.server 8000
```

iPhone 与电脑连同一 WiFi，Safari 访问 `http://192.168.x.x:8000`。

| 项 | 说明 |
|---|---|
| 可行性 | ✅ 立即可用。应用本来就完全离线，没有任何外部 API 依赖 |
| 剪贴板 | ⚠️ `http://192.168.x.x` 不是安全上下文，`navigator.clipboard` 不可用 —— 但 `copyText` 的 `execCommand` 兜底会接管，**复制功能正常**。`paste()` 在 Safari 无安全上下文时读不到，导入客户需手动粘贴 |
| 局限 | 电脑必须开机且同网；**不能离线**；地址栏占屏；iPhone 休眠后可能被系统回收 |
| 用途 | **开发期调试首选** —— 改 CSS/JS 即时生效，不用反复打包签名 |

### 3.2 Safari「添加到主屏幕」（PWA 封装）

在 3.1 基础上点分享 → 添加到主屏幕。

- 得到桌面图标、全屏无地址栏的独立窗口
- 已有 `theme-color` meta → 状态栏配色自动生效
- **但 Service Worker 需要安全上下文**：`http://192.168.x.x` 下注册不了 → **无法离线**
- 要做到离线必须 HTTPS，自签证书 iPhone 又不信任

**结论：PWA 路线在这个项目上"能用但不彻底"——它解决得了图标和全屏，解决不了离线。而离线是这个工具的核心价值（销售现场没网）。**

### 3.3 远程 / 云手机

| 方案 | 判断 |
|---|---|
| 云手机（红手指、雷电云等） | ❌ 不可行。大多是 Android 实例，你要的是 iOS；且把客户数据放第三方云不符合你的业务性质 |
| Mac 远程桌面 / 云 Mac | ✅ 有用，但这是**构建工具**而非运行方案，见第 5 节 |

---

## 4. iOS 本地安装分发：四种方式对比

| 方式 | 有效期 | 设备数 | App ID 配额 | 需 Mac | 费用 | 自动续签 |
|---|---|---|---|---|---|---|
| **免费 Apple ID 自签** | **7 天** | 最多 **3 台** | 10 个（7 天滚动） | 是（每次续签都要连） | ¥0 | ❌ 手动 |
| **AltStore / SideStore** | 7 天循环，自动续 | 受免费账号 3 台限制 | 同上 | 首次需要（装 AltServer） | ¥0 | ✅ |
| **TestFlight** | 构建 90 天 | 内部最多 100 人 | — | 是（上传） | **$99/年** | — |
| **付费开发者账号** | **1 年** | **100 台/设备类型/年** | 无实际限制 | 是 | **$99/年** | — |

### 补充说明

- **免费账号的功能禁区**：推送通知（APNs）、Apple Pay、iCloud、Game Center、应用内购买、TestFlight、App Store 分发 —— 全部不可用。本应用一项都不需要，无影响。
- **AltStore / SideStore 的区别**：AltStore 需要电脑在同一 WiFi 下开着 AltServer 才能续签；**SideStore 可以在设备上自行续签**，不依赖电脑长期在线，更适合移动场景。
- **欧盟 DMA 侧载不适用**：iOS 17.4+ 的第三方应用商店 / 网页分发**仅限欧盟区 Apple ID**。你在国内，走不了这条路。
- **Windows 签名工具**（如"苹果签名安装助手""开心上架 AppUploader"）可以用免费 Apple ID 在 Windows 上生成 7 天证书并重签 IPA —— **但它解决不了"IPA 从哪来"的问题，构建仍然必须过 macOS/Xcode**。

### 给你的建议

> **上付费 $99/年账号。**

理由不是技术而是业务：这是你在客户现场用的销售工具。**7 天有效期意味着它可能在见客户的当场失效**，而这个失效时机你无法预判。$99 换一年不用想这件事，对一个生产力工具来说不贵。

如果坚持零成本：**SideStore**（能在设备端自行续签，不依赖电脑在线）。

---

## 5. 最大前置门槛：你需要一台 Mac

Xcode 只能跑在 macOS 上，**编译 iOS 应用必须过 macOS**，这一步无法绕过。

若你没有 Mac，三条路：

| 方案 | 成本 | 说明 |
|---|---|---|
| **二手 Mac mini（M1）** | 约 2000–3000 元 | 长期最划算，一次投入永久解决，还能真机调试 |
| **云 Mac 租赁**（MacinCloud / MacStadium 等） | 约 $20–80/月，或按小时 | 够用，但每次改东西都要上传/重连，体验割裂 |
| **GitHub Actions macOS runner** | 免费层仅限公开仓库 | ❌ 不适合：源码含客户数据与业务逻辑，不能公开 |

**关键缓解**：因为业务全在 `web/` 里，**Swift 壳写完之后基本不用再改**。日常迭代 CSS/JS 完全可以走第 3.1 节的局域网调试（即时生效），等改动稳定了再打包签名一次。这把"每改一行就要重签"的成本降到了可接受范围。

---

## 6. 实施步骤

### 阶段 0｜今天就能做（0 成本验证）

1. `cd web && python -m http.server 8000`
2. iPhone 同 WiFi，Safari 打开 `http://<电脑IP>:8000`
3. 走一遍主流程：搜索 → 详情 → 收藏 → 选型下钻 → 客户 → 导入导出
4. 记录 iOS 上的视觉问题（毛玻璃失效、输入框缩放应当立刻可见）

### 阶段 1｜修 iOS 适配缺陷（约 1 小时）

1. 补 4 处 `-webkit-backdrop-filter`
2. `.field input` 字号 15px → 16px
3. 跑 `tools/test_ui.js` + `test_design.js` 确认回归（当前 210 项应全绿）

### 阶段 2｜解除 `file://` XHR 限制（约 1 小时）

1. 把 `data/products.json` 转为 `data/products.js`（`window.__PF_DATA = {...}`）
2. `data.js` 的 `loadCatalog()` 改为优先读全局量，XHR 作为兜底
3. `index.html` 增加 `<script src="data/products.js">`（**必须排在 `js/data.js` 之前**）
4. 回归测试 + Android 端重新打包验证（此改动对 Android 同样生效，且可关掉 `setAllowUniversalAccessFromFileURLs`）

### 阶段 3｜写 iOS 壳（约 1 天，需 Mac）

1. Xcode 新建 iOS App（Swift / UIKit，不用 SwiftUI——WKWebView 在 UIKit 下更直接）
2. 把 `web/` 整个目录加入 Bundle Resource
3. 实现 `MainViewController`：
   - `WKWebView` + `WKWebViewConfiguration`
   - `WKScriptMessageHandler` 处理 `copy` / `setPref` / `paste`
   - `WKUserScript` 在 document-start 注入 UserDefaults 快照
   - `loadFileURL(_, allowingReadAccessTo:)` 加载 `index.html`
4. 边到边布局 + 忽略安全区（CSS 已用 `env()` 自行处理）
5. 状态栏样式跟随深浅色
6. 图标：复用 `src/res/drawable/ic_launcher_*.xml` 的思路，导出 iOS 尺寸资源

### 阶段 4｜签名与真机调试

1. Xcode → Settings → Accounts → 添加 Apple ID（免费显示 `Personal Team`）
2. iPhone 打开 **设置 → 隐私与安全性 → 开发者模式**（iOS 16+ 必做，需重启）
3. 数据线连接，点「信任此电脑」
4. Target → Signing & Capabilities → 勾选 Automatically manage signing → Team 选 Personal Team
5. Xcode Run → 首次安装后需到 **设置 → 通用 → VPN 与设备管理** 手动信任
6. Safari → 开发 → `<你的iPhone>` → 选中 WKWebView，可远程审查元素（这是调试 Web 层的关键手段）

### 阶段 5｜数据迁移

| 数据 | 现状 | 迁移方式 |
|---|---|---|
| **客户数据** | 已有导出/导入通道（`data-cust-export` 导出 JSON 到剪贴板、`importModal` 从剪贴板导入） | ✅ **直接复制粘贴即可**，无需额外开发 |
| **意反馈记录** | `feedback_log` 存 SharedPreferences | 低频，建议接受重建；或复用剪贴板导出 |
| **收藏夹** | 存 SharedPreferences | ⚠️ **目前没有导出通道** —— 要么新增一个导出按钮，要么在 iOS 上重建（你自用，量应该不大） |
| **设置项** | 极少 | 重新设置即可 |

**建议顺手给收藏加一个导出/导入**，这不只是为迁移——换机、备份都用得上。

---

## 7. 风险与待确认

| 项 | 状态 |
|---|---|
| WKWebView 在 `file://` 下 localStorage 可靠性 | 需实测。已设计三级兜底，最坏情况降级到 UserDefaults 桥接 |
| `paste()` 改异步后对"导入客户"流程的影响 | 该流程由按钮触发，异步无感知，风险低 |
| 891KB 内联 JSON 的首屏耗时 | 预估约 10ms，需真机实测确认 |
| 你是否有 Mac | **待确认，这是整个计划的前置开关** |
| iPhone 型号与 iOS 版本 | 影响开发者模式入口与 `env()` 表现，建议 iOS 16+ |

---

## 8. 一句话结论

**你这个应用的原生层只有 302 行且零依赖，业务 100% 在 Web 层。所以正确答案不是"迁移"，是"换壳"：**

1. 今天先用 **局域网 + Safari** 在 iPhone 上跑起来验证（0 改动）
2. 修 2 个 iOS 适配缺陷（毛玻璃前缀、输入框 16px）
3. 把 891KB 数据集内联进 JS，解除 `file://` XHR 限制
4. 写约 150 行 Swift 的 WKWebView 壳 → 真离线、真桌面图标
5. 花 $99 买开发者账号，一年不用想续签的事

**方案 1（原生重写）和方案 2（跨平台）在这个项目上都应当直接否决** —— 它们的收益是零，成本是数周，且会让 Android 版和 iOS 版从此开始分叉漂移。
