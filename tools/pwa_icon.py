# -*- coding: utf-8 -*-
"""零依赖 PNG 图标生成（无 Pillow，纯 stdlib）。
绘制 PartFinder「取景框」图标：蓝色对角渐变底 + 白色四角框标 + 中部横线，
四角圆角透明。输出 180（apple-touch-icon）/192/512 三档。
"""
import zlib, struct, os, math

def clamp(v): return max(0, min(255, int(v)))

def pixel(x, y, size):
    # 对角渐变底：#3D6BFF → #142F8F
    t = (x + y) / (2 * size)
    r = clamp(0x3D + (0x14 - 0x3D) * t)
    g = clamp(0x6B + (0x2F - 0x6B) * t)
    b = clamp(0xFF + (0x8F - 0xFF) * t)
    # 圆角（半径 size*0.22）
    rad = size * 0.22
    cx = min(x, size - 1 - x); cy = min(y, size - 1 - y)
    if cx < rad and cy < rad:
        dx, dy = rad - cx, rad - cy
        if dx * dx + dy * dy > rad * rad:
            return (0, 0, 0, 0)
    # 取景框：四角白色框标（臂长 22%，粗 7%），留 12% 边距
    m = size * 0.12; arm = size * 0.20; th = max(3, round(size * 0.055))
    def in_corner_brick(px, py):
        return (px < m + arm and py < m + th)
    white = False
    if in_corner_brick(x - m, y - m): white = True                      # 左上横
    if in_corner_brick(size - 1 - x - m, y - m): white = True           # 右上横
    if in_corner_brick(x - m, size - 1 - y - m): white = True           # 左下横
    if in_corner_brick(size - 1 - x - m, size - 1 - y - m): white = True  # 右下横
    if in_corner_brick(y - m, x - m): white = True                      # 左上竖
    if in_corner_brick(size - 1 - y - m, x - m): white = True           # 左下竖
    if in_corner_brick(y - m, size - 1 - x - m): white = True           # 右上竖
    if in_corner_brick(size - 1 - y - m, size - 1 - x - m): white = True  # 右下竖
    # 中部横线（高 6%，长 64%，居中）
    bar_h = max(3, round(size * 0.06))
    if abs(y - size / 2) < bar_h / 2 and size * 0.18 < x < size * 0.82:
        white = True
    if white:
        return (255, 255, 255, 255)
    return (r, g, b, 255)

def write_png(path, size):
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            raw += bytes(pixel(x, y, size))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(png)
    print('icon ->', path, size, 'px')

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'pwa-dist', 'icons')
    for size in (180, 192, 512):
        write_png(os.path.join(out, f'icon-{size}.png'), size)

if __name__ == '__main__':
    main()
