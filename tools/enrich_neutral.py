# -*- coding: utf-8 -*-
"""把中性型号集合盖写到 products.json（数据管道一步，禁止手改 JSON）。

前置：python tools/extract_neutral.py   ← 从权威选型表提取 web/data/neutral_models.json
本步：material_code 命中中性集合，或 物料名称/描述含「中性」 → 打上 neutral: true。
未打标 = 原型。下游 app.js 选型钻取按 m.neutral 区分 中性/原型。
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
NEUTRAL = set(json.load(open(os.path.join(HERE, '..', 'web', 'data', 'neutral_models.json'), encoding='utf-8')))
PJ = os.path.join(HERE, '..', 'web', 'data', 'products.json')

d = json.load(open(PJ, encoding='utf-8'))
stamped = 0
by_series = {}
for m in d['materials']:
    code = (m.get('material_code') or '').strip()
    desc = (m.get('description') or '') + (m.get('material_name') or '')
    if code in NEUTRAL or '中性' in desc:
        m['neutral'] = True
        stamped += 1
        k = m.get('product_category', '') + '/' + (code.split('-')[0] if code else '?')
        by_series[k] = by_series.get(k, 0) + 1
    else:
        m.pop('neutral', None)

json.dump(d, open(PJ, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'已标记中性物料 {stamped} 条 / 共 {len(d["materials"])} 条')
for k in sorted(by_series):
    print('  ', k, by_series[k])
