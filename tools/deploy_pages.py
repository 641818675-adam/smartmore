# -*- coding: utf-8 -*-
"""GitHub Pages 一键部署：设备码换令牌 → 推送 pwa-dist → 开启 Pages → 验证上线。"""
import json, os, time, urllib.request, urllib.parse, subprocess, sys

TMP = os.environ.get('TEMP', '/tmp')
DEV = os.path.join(TMP, 'pf_device.json')
REPO = '641818675-adam/SM-finder'
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pwa-dist')

def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', 'replace')
            return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')

print('[1/4] 读取授权令牌…')
TOKEN_FILE = os.path.join(TMP, 'pf_token')
if '--use-token-file' in sys.argv and os.path.exists(TOKEN_FILE):
    token = open(TOKEN_FILE, encoding='utf-8').read().strip()
    print('    已从授权轮询器取到令牌（不回显）')
else:
    dev = json.load(open(DEV, encoding='utf-8'))
    token, deadline = None, time.time() + 100
    while time.time() < deadline:
        data = urllib.parse.urlencode({
            'client_id': '178c6fc778ccc68e1d6a',
            'device_code': dev['device_code'],
            'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
        }).encode()
        req = urllib.request.Request('https://github.com/login/oauth/access_token', data=data,
            headers={'Accept': 'application/json'})
        resp = json.load(urllib.request.urlopen(req, timeout=20))
        if 'access_token' in resp:
            token = resp['access_token']
            break
        err = resp.get('error')
        if err == 'authorization_pending':
            time.sleep(dev.get('interval', 5)); continue
        if err == 'slow_down':
            time.sleep(10); continue
        print('!! 授权失败:', err); sys.exit(2)
    if not token:
        print('!! 设备码未授权或已过期（有效期约 15 分钟）。需要重新出码。'); sys.exit(3)
    open(TOKEN_FILE, 'w').write(token)
    print('    令牌获取成功（不回显）')

H = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'}

print('[2/4] 推送 pwa-dist → main（强制，仓库即站点根）')
st, body = http(f'https://api.github.com/repos/{REPO}', headers=H)
if st == 404:
    print('!! 仓库不存在或令牌无权访问:', REPO); sys.exit(4)
default_branch = json.loads(body).get('default_branch', 'main')

env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
env['GIT_AUTHOR_NAME'] = env['GIT_COMMITTER_NAME'] = '641818675-adam'
env['GIT_AUTHOR_EMAIL'] = env['GIT_COMMITTER_EMAIL'] = '641818675-adam@users.noreply.github.com'
url = f'https://x-access-token:{token}@github.com/{REPO}.git'
r = subprocess.run(['git', 'init', '-b', 'main', '.'], cwd=DIST, env=env,
                   capture_output=True, text=True)
r = subprocess.run(['git', 'add', '-A'], cwd=DIST, env=env, capture_output=True, text=True)
r = subprocess.run(['git', 'commit', '-m', 'PartFinder PWA v10.4.1'], cwd=DIST, env=env,
                   capture_output=True, text=True)
r = subprocess.run(['git', 'push', '-f', url, 'main:main'], cwd=DIST, env=env,
                   capture_output=True, text=True)
if r.returncode != 0:
    print('!! push 失败:\n', (r.stderr or r.stdout)[-800:]); sys.exit(5)
print('    推送成功')

print('[3/4] 开启 GitHub Pages（main / 根目录）')
data = json.dumps({'source': {'branch': 'main', 'path': '/'}}).encode()
st, body = http(f'https://api.github.com/repos/{REPO}/pages', data=data,
                headers=dict(H, **{'Content-Type': 'application/json'}), method='POST')
print('    Pages API:', st, ('已开启' if st in (201, 204) else body[:200] if st != 409 else '已存在'))

print('[4/4] 等待首次构建并验证上线…')
site = f'https://641818675-adam.github.io/SM-finder/index.html'
ok = False
for i in range(30):
    time.sleep(10)
    st, _ = http(site)
    print(f'    第 {i+1} 次探测: HTTP {st}')
    if st == 200:
        ok = True; break
print()
print('🎉 部署完成！手机地址：')
print('   ', site.replace('/index.html', '/'))
if not ok:
    print('   （Pages 还在构建，几分钟后再打开即可）')
