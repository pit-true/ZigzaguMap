"""ツールバーの「オブジェクトの表示」のアイコン（32×32 の PNG）を、主人公の小さなドット絵から作る。

元の絵（apps/desktop/src/assets/hero-source.png、16×16）の背景色（左上の画素の色）を透過にし、
絵のある範囲を切り出して最近傍で 2 倍にし、右下へずらしたぼかしの影を付けて 32×32 に収める。

    python scripts/make-hero-icon.py
"""
import pathlib

from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/desktop/src/assets/hero-source.png"
OUTPUT = ROOT / "apps/desktop/src/assets/toolbar-hero.png"
SIZE = 32
SCALE = 2
SHADOW_OFFSET = (1, 1)
SHADOW_ALPHA = 110  # 0〜255
SHADOW_BLUR = 0.8


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    background = src.getpixel((0, 0))
    for py in range(src.height):
        for px in range(src.width):
            if src.getpixel((px, py)) == background:
                src.putpixel((px, py), (0, 0, 0, 0))
    sprite = src.crop(src.getbbox())
    sprite = sprite.resize((sprite.width * SCALE, sprite.height * SCALE), Image.NEAREST)

    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # 影と絵の両方が 32×32 に収まる位置（左上寄り）に置く。
    x = (SIZE - sprite.width - SHADOW_OFFSET[0]) // 2
    y = (SIZE - sprite.height - SHADOW_OFFSET[1]) // 2
    alpha = sprite.getchannel("A").point(lambda a: SHADOW_ALPHA if a else 0)
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", sprite.size, (0, 0, 0, 255)), (x + SHADOW_OFFSET[0], y + SHADOW_OFFSET[1]), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    out.alpha_composite(shadow)
    out.alpha_composite(sprite, (x, y))
    out.save(OUTPUT, optimize=True)
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} バイト")


if __name__ == "__main__":
    main()
