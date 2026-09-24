# Recolours the supplied logo (gold script, black tagline, white background)
# into single-colour transparent PNGs for public/brand/.
#   pip install pillow numpy
#   python design/brand/make-logos.py design/brand/kencole-logo-original.jpg public/brand
# Gold is not used on the site: ochre is reserved for government charges.
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]; out = sys.argv[2]
rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
darkest = rgb.min(axis=2)                      # gold's blue channel and black text are both low
alpha = (255.0 - darkest) / (255.0 - 70.0)      # full gold (~50–70) and black (0) → 1
alpha = np.clip(alpha, 0, 1)
alpha[alpha < 0.10] = 0                         # JPEG noise in the white background

rows = np.where(alpha.sum(axis=1) > 3)[0]
# The gap between the script and the tagline: the longest run of empty rows inside the ink.
empty = [r for r in range(rows.min(), rows.max()) if alpha[r].sum() <= 3]
runs, start = [], None
for r in range(rows.min(), rows.max() + 1):
    if alpha[r].sum() <= 3:
        start = r if start is None else start
    elif start is not None:
        runs.append((start, r)); start = None
gap = max(runs, key=lambda x: x[1] - x[0])
print("ink rows", rows.min(), rows.max(), "gap", gap)

def save(a, name, colour, pad=4):
    ys, xs = np.where(a > 0)
    y0, y1, x0, x1 = max(ys.min() - pad, 0), ys.max() + pad + 1, max(xs.min() - pad, 0), xs.max() + pad + 1
    a = a[y0:y1, x0:x1]
    img = np.zeros((a.shape[0], a.shape[1], 4), np.uint8)
    img[..., :3] = colour
    img[..., 3] = (a * 255).round().astype(np.uint8)
    Image.fromarray(img, "RGBA").save(f"{out}/{name}.png", optimize=True)
    print(name, img.shape[1], "x", img.shape[0])

script = alpha.copy(); script[gap[0]:] = 0
full = alpha
WHITE, INK = (255, 255, 255), (12, 27, 42)
save(full, "kencole-logo-white", WHITE)
save(full, "kencole-logo-ink", INK)
save(script, "kencole-wordmark-white", WHITE)
save(script, "kencole-wordmark-ink", INK)

# The script's brush strokes go hairline below about 80px tall. For the header,
# a copy with every stroke thickened by a few source pixels keeps it legible.
from PIL import ImageFilter
small = Image.open(f"{out}/kencole-wordmark-white.png")
r, g, b, a = small.split()
Image.merge("RGBA", (r, g, b, a.filter(ImageFilter.MaxFilter(7)))).save(f"{out}/kencole-wordmark-white-small.png", optimize=True)
print("kencole-wordmark-white-small (for sizes under ~80px tall)")
