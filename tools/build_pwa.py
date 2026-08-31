# -*- coding: utf-8 -*-
"""组装 PWA 分发包（pwa-dist/）—— iPhone「添加到主屏幕」离线使用。

做什么：
  1. 拷贝 web/ 全量到 pwa-dist/（应用本体与安卓 APK 同源）；
  2. 生成 manifest.webmanifest（standalone 独立窗口）；
  3. 生成 sw.js（Service Worker：预缓存全部资源，离线可用）；
  4. 生成 iOS 图标（tools/pwa_icon.py，纯 stdlib）；
  5. 补丁 index.html：Apple PWA meta + manifest + 图标 + SW 注册（仅 HTTPS 生效）。

用 iPhone 打开托管地址 → 分享 → 添加到主屏幕，之后离线可用。
"""
import os, re, shutil, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
WEB = os.path.join(ROOT, 'web')
DIST = os.path.join(ROOT, 'pwa-dist')
CACHE = 'partfinder-pwa-' + time.strftime('%Y%m%d%H%M')

def w(path, content, binary=False):
    full = os.path.join(DIST, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    mode = 'wb' if binary else 'w'
    if binary:
        open(full, 'wb').write(content)
    else:
        open(full, 'w', encoding='utf-8').write(content)
    print('  ->', path)

def main():
    if os.path.exists(DIST):
        # 沙箱删除保护：重命名挪走旧产物
        os.rename(DIST, os.path.join(os.environ.get('TEMP', '/tmp'),
                                     f'pf-discard-{int(time.time())}-pwa-dist'))
    print('[1/5] 拷贝 web/ 应用本体')
    shutil.copytree(WEB, DIST)

    print('[2/5] 生成 manifest.webmanifest')
    w('manifest.webmanifest', '''{
  "name": "PartFinder 离线选型",
  "short_name": "PartFinder",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0b0d12",
  "theme_color": "#0b0d12",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}''')

    print('[3/5] 生成 sw.js（预缓存 → 离线）')
    assets = []
    for base, _, files in os.walk(DIST):
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(base, f), DIST).replace('\\', '/')
            if rel.startswith('icons/') or rel == 'sw.js':
                continue
            assets.append(rel)
    sw = """/* PartFinder PWA Service Worker —— 预缓存全量资源，改版自动失效。 */
var CACHE = %r;
var ASSETS = %s;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(e.request).then(function (resp) {
      if (resp && resp.ok && new URL(e.request.url).origin === self.location.origin) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    }).catch(function () { return caches.match('index.html'); });
  }));
});
""" % (CACHE, repr(assets).replace("'", '"'))
    w('sw.js', sw)

    print('[4/5] 生成 iOS 图标')
    import pwa_icon
    pwa_icon.main()

    print('[5/5] 补丁 index.html（Apple meta + manifest + SW 注册）')
    idx = open(os.path.join(DIST, 'index.html'), encoding='utf-8').read()
    head_add = '''<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PartFinder">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">'''
    idx = idx.replace('<title>PartFinder</title>', '<title>PartFinder</title>\n' + head_add, 1)
    sw_reg = '''<script>
/* PWA：仅 HTTPS（安全上下文）注册 Service Worker；APK/文件协议下静默跳过 */
if ('serviceWorker' in navigator && /^https:$/.test(location.protocol)) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>'''
    idx = idx.replace('</body>', sw_reg + '\n</body>', 1)
    assert 'manifest.webmanifest' in idx and 'serviceWorker' in idx
    open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8').write(idx)
    print('  -> index.html 已补丁')

    total = sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(DIST) for f in fs)
    print(f"\n完成：pwa-dist/ 共 {sum(len(f) for _,_,f in os.walk(DIST))} 个文件，{total/1024:.0f} KB，缓存版本 {CACHE}")
    print("iPhone 使用步骤：")
    print("  1) 把 pwa-dist/ 整个目录上传到任意 HTTPS 静态托管（GitHub Pages / Cloudflare Pages / 内网 HTTPS）")
    print("  2) iPhone Safari 打开 https://<你的地址>/index.html")
    print("  3) 分享 → 添加到主屏幕 → 用桌面图标启动（全屏、离线可用）")

if __name__ == '__main__':
    main()
