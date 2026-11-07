#!/usr/bin/env python3
"""Generate the Hermes app icon set: a bold "H" with a rising crossbar on an indigo gradient.

    uv run --with pillow python scripts/make-icons.py

Writes assets/icon.png, android-icon-{background,foreground,monochrome}.png, splash-icon.png, favicon.png.
The mark is built from thick rounded strokes so it stays legible down to launcher/notification sizes.
"""

import pathlib

from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets"
S = 2048  # supersample, downscaled at the end
TOP, BOTTOM = (124, 58, 237), (67, 56, 202)  # violet -> indigo (#7C3AED -> #4338CA)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size  # diagonal sweep
            px[x, y] = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    return img


def mark(size: int, color=(255, 255, 255, 255)) -> Image.Image:
    """The "H" on a transparent square, scaled to fit inside `size`."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bar = S * 0.155  # stroke thickness
    x1, x2 = S * 0.28, S * 0.72 - bar  # left edges of the two uprights
    top, bottom = S * 0.20, S * 0.80
    for x in (x1, x2):
        d.rounded_rectangle([x, top, x + bar, bottom], radius=bar / 2, fill=color)
    # Crossbar rises left-to-right (speed / the messenger), with round caps that overlap the uprights.
    a = (x1 + bar / 2, S * 0.60)
    b = (x2 + bar / 2, S * 0.40)
    d.line([a, b], fill=color, width=round(bar * 1.05))
    for p in (a, b):
        r = bar * 0.46
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)
    layer = layer.crop(layer.getbbox())
    scale = size / max(layer.size)
    layer = layer.resize((round(layer.width * scale), round(layer.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(layer, ((size - layer.width) // 2, (size - layer.height) // 2), layer)
    return canvas


def save(img: Image.Image, name: str, size: int):
    img.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name)
    print("wrote", name, size)


def main():
    OUT.mkdir(exist_ok=True)
    N = 1024
    bg = gradient(N)
    save(bg, "android-icon-background.png", N)

    def padded(color: tuple[int, int, int, int], frac: float) -> Image.Image:
        canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        m = mark(round(N * frac), color)
        canvas.alpha_composite(m, ((N - m.width) // 2, (N - m.height) // 2))
        return canvas

    white, black = (255, 255, 255, 255), (0, 0, 0, 255)
    # Adaptive foreground / monochrome: content inside the central 66% safe zone.
    save(padded(white, 0.50), "android-icon-foreground.png", N)
    save(padded(black, 0.50), "android-icon-monochrome.png", N)
    # Legacy/store icon: full-bleed gradient with the mark on top.
    icon = bg.convert("RGBA")
    icon.alpha_composite(padded(white, 0.56))
    save(icon.convert("RGB"), "icon.png", N)
    save(padded(white, 0.70), "splash-icon.png", N)
    fav = bg.convert("RGBA")
    fav.alpha_composite(padded(white, 0.62))
    save(fav.convert("RGB"), "favicon.png", 96)


if __name__ == "__main__":
    main()
