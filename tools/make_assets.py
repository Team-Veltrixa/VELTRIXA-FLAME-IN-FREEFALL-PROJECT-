"""Generates placeholder artwork into ../assets (logo, favicon, hero images, card images, team avatar, looping space video).
Replace any file with your own artwork using the same file name. Needs: pip install pillow numpy ; ffmpeg for the video."""
import subprocess, shutil, colorsys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'assets'
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(7)

def glow(size, centers, color, radius):
    w, h = size
    layer = Image.new('RGB', size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for cx, cy, r in centers:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    return layer.filter(ImageFilter.GaussianBlur(radius))

def add(a, b):
    return Image.fromarray(np.clip(np.asarray(a, np.int16) + np.asarray(b, np.int16), 0, 255).astype('uint8'))

def stars(img, n, seed=0):
    r = np.random.default_rng(seed); d = ImageDraw.Draw(img); w, h = img.size
    for _ in range(n):
        x, y = r.integers(0, w), r.integers(0, h); b = int(r.integers(90, 255)); s = 1 if r.random() < .85 else 2
        d.ellipse([x, y, x + s, y + s], fill=(b, b, min(255, b + 20)))
    return img

def scene(size, hue_a, hue_b, seed):
    w, h = size
    base = Image.new('RGB', size, (3, 6, 9))
    r = np.random.default_rng(seed)
    ca = tuple(int(c * 255 * .55) for c in colorsys.hsv_to_rgb(hue_a, .85, 1))
    cb = tuple(int(c * 255 * .45) for c in colorsys.hsv_to_rgb(hue_b, .8, 1))
    base = add(base, glow(size, [(r.integers(0, w), r.integers(0, h), h // 3) for _ in range(3)], ca, h // 3))
    base = add(base, glow(size, [(r.integers(0, w), r.integers(0, h), h // 4) for _ in range(2)], cb, h // 3))
    return stars(base, w * h // 2500, seed)

def flame(img, cx, cy, s, hue):
    w, h = img.size
    f = Image.new('RGB', img.size, (0, 0, 0)); d = ImageDraw.Draw(f)
    col = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue, .9, 1))
    d.ellipse([cx - s * .5, cy - s * .2, cx + s * .5, cy + s * 1.1], fill=col)
    d.polygon([(cx - s * .38, cy + s * .3), (cx, cy - s * 1.2), (cx + s * .38, cy + s * .3)], fill=col)
    f = f.filter(ImageFilter.GaussianBlur(s * .22))
    core = Image.new('RGB', img.size, (0, 0, 0)); ImageDraw.Draw(core).ellipse([cx - s * .22, cy, cx + s * .22, cy + s * .8], fill=(255, 240, 170))
    return add(add(img, f), core.filter(ImageFilter.GaussianBlur(s * .12)))

# hero + card images
for name, seed, ha, hb in [('hero-home', 1, .06, .75), ('hero-resources', 2, .08, .6), ('hero-about', 3, .05, .8)]:
    scene((1600, 600), ha, hb, seed).save(OUT / f'{name}.webp', quality=82)
for i, (name, hue) in enumerate([('resource-open-data', .08), ('resource-apis', .11), ('resource-tools', .03), ('resource-docs', .75), ('resource-learning', .6), ('resource-challenge', .13)]):
    im = scene((600, 300), hue, hue + .1, 10 + i)
    flame(im, 300, 150, 70, hue).save(OUT / f'{name}.webp', quality=82)

# lunar horizon (transparent top)
w, h = 1600, 260
hz = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(hz)
pts = [(0, h)] + [(x, 150 + int(28 * np.sin(x / 140) + 14 * np.sin(x / 41 + 1))) for x in range(0, w + 1, 8)] + [(w, h)]
d.polygon(pts, fill=(28, 32, 38, 255))
hz = hz.filter(ImageFilter.GaussianBlur(1.2)); hz.save(OUT / 'lunar-horizon.webp', quality=85)

# team avatar
av = Image.new('RGB', (200, 200), (8, 14, 21)); d = ImageDraw.Draw(av)
d.ellipse([30, 22, 170, 170], fill=(214, 220, 230)); d.ellipse([48, 52, 152, 140], fill=(14, 22, 38))
d.ellipse([60, 62, 110, 98], fill=(255, 130, 15)); d.rectangle([60, 160, 140, 200], fill=(214, 220, 230))
av.filter(ImageFilter.GaussianBlur(.6)).save(OUT / 'team-astronaut.webp', quality=85)

# logo + favicon
font = None
for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
    if Path(p).exists(): font = ImageFont.truetype(p, 84); break
logo = Image.new('RGBA', (600, 200), (0, 0, 0, 0)); d = ImageDraw.Draw(logo)
d.text((300, 100), 'VELTRIXA', fill=(255, 130, 15, 255), font=font or ImageFont.load_default(), anchor='mm')
logo.save(OUT / 'veltrixa-logo.png')
(OUT / 'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#030609"/><path d="M14 16h10l8 26 8-26h10L36 50h-8z" fill="#ff820f"/></svg>')

# looping starfield video
if shutil.which('ffmpeg'):
    W, H, FPS, N = 960, 400, 24, 144
    bg = np.asarray(scene((W, H), .07, .72, 5), np.uint8).astype(np.float32) * .55
    r = np.random.default_rng(3)
    layers = [(r.integers(0, W, 90), r.integers(0, H, 90), s, W // 1 * s // 4) for s in (1, 2, 3)]
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', '-an', str(OUT / 'space-video.mp4')], stdin=subprocess.PIPE)
    for f in range(N):
        t = f / N
        pulse = 1 + .08 * np.sin(2 * np.pi * t)
        fr = np.clip(bg * pulse, 0, 255)
        for xs, ys, s, _ in layers:
            x = ((xs - (s * W * t)) % W).astype(int)   # integer multiples of W per loop => seamless
            fr[ys, x] = 255 if s == 3 else 210
            if s >= 2: fr[(ys + 1) % H, x] = 190
        p.stdin.write(fr.astype(np.uint8).tobytes())
    p.stdin.close(); p.wait()
print('assets written to', OUT)
