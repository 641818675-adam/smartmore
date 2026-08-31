# -*- coding: utf-8 -*-
"""解析选型表 → 中性型号集合。

规则（依据业务方口径）：
  1. 「以下为中性机型」(含变体「…机型，中性」「…（中性暂无库存…）」) 标记之后、
     **同一系列组内**的型号全部为中性；组边界 = 空行 / 下一组头（出现新料号的无标记数据行）/ 下一个标记。
  2. 描述/名称中含「中性」的型号为中性（如「基础版（中性）」）。
  3. 显式否定行（「无中性型号」「不支持贴牌」）排除该组。
"""
import openpyxl, json, re

XLSX = r'C:\Users\znsn2\Downloads\VN&VE&FST&VAL 智能传感器型号选型表_V9_20241118 (1).xlsx'
OUT = r'C:\Users\znsn2\Desktop\PartFinder_V9.0\PartFinderMobileV2\web\data\neutral_models.json'

wb = openpyxl.load_workbook(XLSX, data_only=True)

def cs(v):
    return str(v).strip() if v is not None else ''

CODE_RE = re.compile(r'^[A-Z][A-Z0-9]{1,9}(-[A-Za-z0-9]{1,4}){0,4}$')
PART_NO_RE = re.compile(r'^\d{8}$')

def row_cells(row):
    return [cs(v) for v in row]

def is_marker(cells):
    j = ' '.join(cells)
    return ('以下为' in j and '中性' in j)

def is_negation(cells):
    j = ' '.join(cells)
    return ('无中性' in j) or ('不支持贴牌' in j)

def is_blank(cells):
    return not any(cells)

def model_codes(cells):
    return [c for c in cells if CODE_RE.match(c)]

neutral = {}
report = []

for name in wb.sheetnames:
    ws = wb[name]
    grid = [row_cells(r) for r in ws.iter_rows(values_only=True)]
    i = 0
    while i < len(grid):
        cells = grid[i]
        if is_marker(cells):
            # 中性区段：向下吞行，直到 空行 / 否定行 / 下一个标记 / 表尾
            j = i + 1
            while j < len(grid):
                c2 = grid[j]
                if is_blank(c2) or is_marker(c2) or is_negation(c2):
                    break
                for code in model_codes(c2):
                    if code not in neutral:
                        neutral[code] = (name, j + 1)
                        report.append((name, j + 1, code, '区段'))
                j += 1
            i = j
        else:
            # 规则 2：行内描述/名称含「中性」→ 该行型号为中性
            joined = ' '.join(cells)
            if '中性' in joined and not is_negation(cells):
                for code in model_codes(cells):
                    if code not in neutral:
                        neutral[code] = (name, i + 1)
                        report.append((name, i + 1, code, '描述含中性'))
            i += 1

models = sorted(neutral)
print('中性型号总数（全表去重）:', len(models))
print(models)
json.dump(models, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('已写出', OUT)
