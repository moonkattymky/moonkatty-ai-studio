#!/usr/bin/env python3
"""Builds comparison sheets (reference crop vs implementation) and the 6x2 contact sheet.
Usage: python3 tools/compose.py <reference.png> <out_dir>   (needs Pillow)"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
ref_path, out = sys.argv[1], sys.argv[2]
# phone bounds inside the approved 1536x1024 reference image (x0, y0, x1, y1)
B = {1: (6, 30, 292, 612), 2: (301, 30, 564, 612), 3: (573, 30, 810, 612), 4: (819, 30, 1054, 612), 5: (1062, 30, 1297, 612), 6: (1305, 30, 1530, 612),
     7: (6, 645, 260, 1024), 8: (268, 645, 518, 1024), 9: (526, 645, 771, 1024), 10: (783, 645, 1052, 1024), 11: (1059, 645, 1304, 1024), 12: (1311, 645, 1530, 1024)}
NAMES = ['ГЛАВНАЯ', 'AI-АГЕНТЫ', 'ЗАДАЧИ', 'КОНТЕНТ', 'АНАЛИТИКА', 'ФИНАНСЫ', 'ИГРЫ', 'НОВОСТИ', 'СОЦСЕТИ', 'УВЕДОМЛЕНИЯ', 'НАСТРОЙКИ', 'ЕЩЁ']
SLUGS = ['glavnaya', 'ai-agenty', 'zadachi', 'kontent', 'analitika', 'finansy', 'igry', 'novosti', 'sotsseti', 'uvedomleniya', 'nastroyki', 'eshche']
def font(sz):
    for f in ['/usr/share/fonts/truetype/inter/Inter-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    import glob
    c = glob.glob('/usr/share/fonts/**/Inter*Bold*.ttf', recursive=True) + glob.glob('/usr/share/fonts/**/DejaVuSans-Bold.ttf', recursive=True)
    return ImageFont.truetype(c[0], sz) if c else ImageFont.load_default()
ref = Image.open(ref_path).convert('RGB')
os.makedirs(out + '/compare', exist_ok=True)
H = 1500
def rounded(im, r):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    bg = Image.new('RGB', im.size, (8, 10, 24)); bg.paste(im, (0, 0), m); return bg
shots = []
for i in range(1, 13):
    impl = Image.open(f'{out}/screens/{i:02d}-{SLUGS[i-1]}.png').convert('RGB'); shots.append(impl)
    r = ref.crop(B[i])
    # bottom-row reference phones are cut off; compare only the matching top part of the implementation
    full_h = 582
    frac = (B[i][3] - B[i][1]) / full_h
    impl_c = impl.crop((0, 0, impl.width, int(impl.height * min(1, frac + 0.01))))
    rr = r.resize((int(r.width * H * frac / r.height), int(H * frac)), Image.LANCZOS)
    ii = impl_c.resize((int(impl_c.width * H * frac / impl_c.height), int(H * frac)), Image.LANCZOS)
    W = rr.width + ii.width + 90
    sheet = Image.new('RGB', (W, rr.height + 110), (6, 8, 20)); d = ImageDraw.Draw(sheet)
    d.text((30, 25), f'{i}. {NAMES[i-1]} — reference (approved)', fill=(230, 235, 255), font=font(30))
    d.text((rr.width + 60, 25), 'implementation (393×852 @3x)', fill=(230, 235, 255), font=font(30))
    sheet.paste(rr, (30, 80)); sheet.paste(rounded(ii, 40), (rr.width + 60, 80))
    sheet.save(f'{out}/compare/{i:02d}-{SLUGS[i-1]}.png')
# contact sheet 6x2 like the reference
tw, th = 393, 852
gap, lab = 24, 56
cs = Image.new('RGB', (6 * tw + 7 * gap, 2 * (th + lab) + 3 * gap), (5, 8, 22)); d = ImageDraw.Draw(cs)
for k, im in enumerate(shots):
    cx, cy = gap + (k % 6) * (tw + gap), gap + (k // 6) * (th + lab + gap)
    txt = f'{k+1}. {NAMES[k]}'; f = font(26); w = d.textlength(txt, font=f)
    d.text((cx + (tw - w) / 2, cy + 10), txt, fill=(240, 244, 255), font=f)
    cs.paste(rounded(im.resize((tw, th), Image.LANCZOS), 44), (cx, cy + lab))
cs.save(f'{out}/all-12.png')
print('compare sheets + all-12.png written to', out)
