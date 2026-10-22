# Contact sheet all.png из скриншотов макетов (Pillow).
import glob, os, sys
from PIL import Image, ImageDraw
out = sys.argv[1] if len(sys.argv) > 1 else '/workspace/out/ai-control/alex-mockups'
fs = sorted(f for f in glob.glob(out + '/[0-9][0-9]-*.png'))
W, H, C, P, T = 402, 874, 6, 16, 60
rows = (len(fs) + C - 1) // C
sheet = Image.new('RGB', (C * (W + P) + P, T + rows * (H + 30 + P)), '#01061a')
d = ImageDraw.Draw(sheet); d.text((P, 20), 'MOONKATTY AI CONTROL - ALEX  |  DEMO / MOCKUP  |  iPhone 16 Pro 402x874', fill='#f5c451')
for i, f in enumerate(fs):
    x, y = P + (i % C) * (W + P), T + (i // C) * (H + 30 + P)
    sheet.paste(Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS), (x, y))
    d.text((x, y + H + 8), os.path.basename(f), fill='#b8c3e0')
sheet.save(out + '/all.png')
