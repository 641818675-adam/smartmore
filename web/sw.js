/*
  Service Worker —— 让主屏 Web App 完全离线可用。

  设计前提：本应用无任何外部 API、无远端写入，所有资源都是静态且随版本整体替换。
  因此策略取最简的「缓存优先 + 版本整体失效」，不做 stale-while-revalidate：
  数据集与代码必须版本一致，混用新旧会让套包解析对不上。

  仅在 http/https 下生效。Android 壳跑在 file:// 上，navigator.serviceWorker
  不存在，index.html 的注册逻辑会直接跳过，原生路径不受任何影响。

  CACHE 名与 js/core/store.js 的 APP_VERSION、build.py 的 VERSION_NAME 保持同步。
*/
var CACHE = 'pf-v10.8.0';

var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',

  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',

  './js/core/util.js',
  './js/core/icons.js',
  './js/core/store.js',
  './js/search.js',
  './js/data.js',
  './js/contract.js',
  './js/customer.js',
  './js/ui/primitives.js',
  './js/ui/modal.js',
  './js/views/chrome.js',
  './js/views/results.js',
  './js/views/config.js',
  './js/views/rival.js',
  './js/views/customers.js',
  './js/views/saved.js',
  './js/views/detail.js',
  './js/app.js',

  './data/products.json',
  './data/competitor.json',
  './data/neutral_models.json',

  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // 逐个 add：单个资源 404 不应让整次装配失败（否则永远装不上）
      .then(function (c) {
        return Promise.all(ASSETS.map(function (u) {
          return c.add(new Request(u, { cache: 'reload' }))['catch'](function () {
            /* 缺失资源留给 fetch 阶段回源，不阻塞安装 */
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches['delete'](k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                                  // 无写请求，放行
  if (new URL(req.url).origin !== self.location.origin) return;      // 不接管跨域

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // 运行期补录（例如首装漏掉的资源），只收成功的同源响应
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () {
        // 离线且未命中：导航请求兜回首页，其余交给调用方的错误分支
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
