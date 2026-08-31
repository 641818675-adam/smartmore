# -*- coding: utf-8 -*-
"""后台：轮询设备码授权（≤14 分钟）→ 拿到令牌后自动完成 Pages 部署。"""
import json, os, time, urllib.request, urllib.parse, subprocess, sys

TMP = os.environ.get('TEMP', '/tmp')
HERE = os.path.dirname(os.path.abspath(__file__))
dev = json.load(open(os.path.join(TMP, 'pf_device.json'), encoding='utf-8'))
print('等待授权… user_code =', dev['user_code'], flush=True)

token = None
deadline = time.time() + 14 * 60
while time.time() < deadline:
    data = urllib.parse.urlencode({
        'client_id': '178c6fc778ccc68e1d6a',
        'device_code': dev['device_code'],
        'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
    }).encode()
    try:
        req = urllib.request.Request('https://github.com/login/oauth/access_token', data=data,
            headers={'Accept': 'application/json'})
        resp = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:
        print('网络抖动:', type(e).__name__, flush=True); time.sleep(8); continue
    if 'access_token' in resp:
        token = resp['access_token']; break
    err = resp.get('error')
    if err == 'authorization_pending':
        time.sleep(dev.get('interval', 5)); continue
    if err == 'slow_down':
        time.sleep(10); continue
    print('授权失败:', err, flush=True); sys.exit(2)
if not token:
    print('超时：14 分钟内未完成授权', flush=True); sys.exit(3)

open(os.path.join(TMP, 'pf_token'), 'w').write(token)
print('授权成功，令牌已存（不回显）。开始部署…', flush=True)
r = subprocess.run([sys.executable, os.path.join(HERE, 'deploy_pages.py'), '--use-token-file'],
                   capture_output=True, text=True)
print(r.stdout, flush=True)
if r.returncode != 0:
    print(r.stderr[-500:], flush=True); sys.exit(1)
