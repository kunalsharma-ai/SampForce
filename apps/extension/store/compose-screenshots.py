"""Puts the company site and the extension side panel side by side at 1280 x 800, as the store listings ask.

Reads apps/extension/store/raw/<name>-site.png and <name>-panel.png (from apps/web/e2e/store-screenshots.spec.ts)
and writes apps/extension/store/<name>.png. Needs Pillow.
"""
from pathlib import Path

from PIL import Image

STORE = Path(__file__).resolve().parent
RAW = STORE / "raw"
BACKGROUND = (10, 14, 22)
DIVIDER = (60, 66, 78)
TOP = 18

for site_file in sorted(RAW.glob("*-site.png")):
    name = site_file.name[: -len("-site.png")]
    site = Image.open(site_file).convert("RGB")
    panel = Image.open(RAW / f"{name}-panel.png").convert("RGB")
    out = Image.new("RGB", (1280, 800), BACKGROUND)
    out.paste(site, (0, TOP))
    out.paste(Image.new("RGB", (2, site.height), DIVIDER), (site.width, TOP))
    out.paste(panel, (1280 - panel.width, TOP))
    out.save(STORE / f"{name}.png", optimize=True)
    print(f"wrote {name}.png")

finder = RAW / "screenshot-5-email-finder.png"
if finder.exists():
    Image.open(finder).convert("RGB").resize((1280, 800)).save(STORE / finder.name, optimize=True)
    print(f"wrote {finder.name}")
