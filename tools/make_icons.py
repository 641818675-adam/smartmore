#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PWA 图标栅格化器 —— 零依赖（只用 zlib/struct/math）。

为什么自己写：本机装不上 Pillow，而 apple-touch-icon 不接受 SVG，
PWA 必须要位图。图形定义与 src/res/drawable/ic_launcher_foreground.xml
逐条对齐（取景框四角 + 扫描线 + 4 根条码），配色沿用 launcher 背景渐变，
保证 Android 桌面图标与 iOS 主屏图标是同一个品牌形象。

用法: python tools/make_icons.py
产出: web/icons/icon-{180,192,512}.png
"""
import math
import os
import struct
import zlib

# ---- 品牌参数（与 ic_launcher_*.xml / tokens.css 对齐）----
GRAD_TOP = (0x1E, 0x6B, 0xFF)   # android:startColor #1E6BFF（angle=270 → 顶部）
GRAD_BOT = (0x0A, 0x2F, 0x6B)   # android:endColor   #0A2F6B（底部）
INK = (0xFF, 0xFF, 0xFF)        # strokeColor #FFFFFF
STROKE_W = 5.0                  # strokeWidth 5（108 画布单位）

# 内容在 108 画布上的包围盒：x/y ∈ [32, 76]，中心 (54, 54)
BOX_MIN, BOX_MAX = 32.0, 76.0
CENTER = (BOX_MIN + BOX_MAX) / 2.0
BOX_SIDE = BOX_MAX - BOX_MIN

# 内容占图标边长的比例。adaptive icon 只露中心 72/108=67%，
# 但 iOS 主屏图标是满幅+系统圆角遮罩，需自己留白；
# 0.60 同时落在 maskable 的 80% 安全圈内，可复用为 maskable。
CONTENT_FRAC = 0.60

# 线段：((x1,y1),(x2,y2))
SEGMENTS = [
    # 取景框四角的直边
    ((32, 48), (32, 38)), ((38, 32), (48, 32)),   # 左上
    ((60, 32), (70, 32)), ((76, 38), (76, 48)),   # 右上
    ((32, 60), (32, 70)), ((38, 76), (48, 76)),   # 左下
    ((60, 76), (70, 76)), ((76, 70), (76, 60)),   # 右下
    ((37, 54), (71, 54)),                          # 扫描线
    ((42, 42), (42, 66)), ((50, 42), (50, 66)),    # 条码
    ((58, 42), (58, 66)), ((66, 42), (66, 66)),
]

# 圆角：(cx, cy, r, 起始角, 终止角)，角度用数学约定（y 向下，故为屏幕坐标系）
ARCS = [
    (38, 38, 6, 180, 270),   # 左上
    (70, 38, 6, 270, 360),   # 右上
    (38, 70, 6,  90, 180),   # 左下
    (70, 70, 6,   0,  90),   # 右下
]


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    dx, dy = wx - t * vx, wy - t * vy
    return math.hypot(dx, dy)


def arc_dist(px, py, cx, cy, r, a0, a1):
    dx, dy = px - cx, py - cy
    d = math.hypot(dx, dy)
    ang = math.degrees(math.atan2(dy, dx)) % 360.0
    lo, hi = a0 % 360.0, a1 % 360.0
    inside = (lo <= ang <= hi) if lo <= hi else (ang >= lo or ang <= hi)
    if inside:
        return abs(d - r)
    # 落在弧段外：退化为到两端点的距离（等效 round cap）
    best = 1e9
    for a in (a0, a1):
        ex = cx + r * math.cos(math.radians(a))
        ey = cy + r * math.sin(math.radians(a))
        best = min(best, math.hypot(px - ex, py - ey))
    return best


def build(size):
    """返回 size×size 的 RGB 行列表。"""
    scale = CONTENT_FRAC * size / BOX_SIDE
    off = size / 2.0 - CENTER * scale
    half = STROKE_W / 2.0 * scale          # 描边半宽（像素）
    aa = 0.9                                # 抗锯齿过渡带宽（像素）

    # 预先把几何变换到像素坐标，并算出各图元的包围盒用于快速剔除
    prims = []
    pad = half + aa + 1.0
    for (ax, ay), (bx, by) in SEGMENTS:
        A = (ax * scale + off, ay * scale + off)
        B = (bx * scale + off, by * scale + off)
        bb = (min(A[0], B[0]) - pad, min(A[1], B[1]) - pad,
              max(A[0], B[0]) + pad, max(A[1], B[1]) + pad)
        prims.append(('s', A + B, bb))
    for cx, cy, r, a0, a1 in ARCS:
        C = (cx * scale + off, cy * scale + off)
        R = r * scale
        bb = (C[0] - R - pad, C[1] - R - pad, C[0] + R + pad, C[1] + R + pad)
        prims.append(('a', (C[0], C[1], R, a0, a1), bb))

    rows = []
    for y in range(size):
        py = y + 0.5
        # 背景竖向渐变（angle=270：顶 → 底）
        t = py / size
        bg = tuple(int(round(GRAD_TOP[i] + (GRAD_BOT[i] - GRAD_TOP[i]) * t)) for i in range(3))
        active = [p for p in prims if p[2][1] <= py <= p[2][3]]
        row = bytearray()
        for x in range(size):
            px = x + 0.5
            d = 1e9
            for kind, g, bb in active:
                if px < bb[0] or px > bb[2]:
                    continue
                dd = seg_dist(px, py, *g) if kind == 's' else arc_dist(px, py, *g)
                if dd < d:
                    d = dd
                    if d <= half - aa:
                        break
            if d >= half + aa:
                row += bytes(bg)
            else:
                cov = min(1.0, max(0.0, (half + aa - d) / (2 * aa)))
                row += bytes(int(round(bg[i] + (INK[i] - bg[i]) * cov)) for i in range(3))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))
    raw = b''.join(b'\x00' + r for r in rows)          # 每行前置 filter type 0
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8bit truecolor，无 alpha
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, 'web', 'icons')
    os.makedirs(out, exist_ok=True)
    for size in (180, 192, 512):
        path = os.path.join(out, 'icon-%d.png' % size)
        write_png(path, size, build(size))
        print('  %-22s %6.1f KB' % ('icons/icon-%d.png' % size,
                                    os.path.getsize(path) / 1024.0))


if __name__ == '__main__':
    main()
