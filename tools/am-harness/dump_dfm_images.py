"""Extract images (TImage Picture.Data, image lists, glyphs, icons) embedded in the
Delphi form resources. Reads the memory image saved by dump_dfm.py (inventory/_ref/img.pkl).
Output: shots/icons_dfm/<Form>__<Object>__<Prop>[_n].png"""
import io, pickle, re, struct
from PIL import Image
import dump_dfm as d
from am import WORK

OUT = WORK / "shots/icons_dfm"
OUT.mkdir(parents=True, exist_ok=True)
chunks = pickle.load(open(WORK / "inventory/_ref/img.pkl", "rb"))
saved = []


def save_blob(form, obj, prop, data):
    name = f"{form}__{obj}__{prop}".replace(".", "_")
    # Picture.Data: shortstring class name + payload
    if prop.endswith("Picture.Data") or prop.endswith("Data") and data[:1] and 1 < data[0] < 20 and data[1:2] == b"T":
        n = data[0]
        cls = data[1:1 + n].decode("ascii", "replace")
        payload = data[1 + n:]
        if cls == "TBitmap":
            payload = payload[4:]  # size prefix
        try:
            img = Image.open(io.BytesIO(payload))
            img.save(OUT / f"{name}.png")
            saved.append((name, cls, img.size))
            return
        except Exception as e:
            saved.append((name, cls, f"unreadable {e}"))
            return
    if prop in ("Glyph.Data", "Bitmap") or prop.endswith("Glyph.Data"):
        try:
            img = Image.open(io.BytesIO(data[4:]))
            img.save(OUT / f"{name}.png"); saved.append((name, "glyph", img.size)); return
        except Exception:
            pass
    if prop == "Icon.Data":
        try:
            img = Image.open(io.BytesIO(data[4:] if data[:2] != b"\0\0" else data))
            img.save(OUT / f"{name}.png"); saved.append((name, "icon", img.size)); return
        except Exception as e:
            saved.append((name, "icon", f"unreadable {e}")); return
    if prop == "Bitmap" or "ImageList" in prop:
        (OUT / f"{name}.bin").write_bytes(data)
        saved.append((name, "raw", len(data)))


# A parser variant that captures binary values with their property path
class Cap(d.R):
    pass


def value(r, form, obj, prop):
    t = r.b[r.p]
    if t == 10:
        r.p += 1
        n = struct.unpack("<I", r.take(4))[0]
        data = r.take(n)
        save_blob(form, obj, prop, data)
        return
    if t == 14:  # collection: recurse to catch item pictures
        r.p += 1
        k = 0
        while True:
            if r.b[r.p] == 0:
                r.p += 1; break
            if r.b[r.p] in (2, 3, 4):
                d.value(r)
            if r.b[r.p] == 1:
                r.p += 1
            while r.b[r.p] != 0:
                pn = r.sstr()
                value(r, form, obj, f"{prop}{k}.{pn}")
            r.p += 1
            k += 1
        return
    d.value(r)


def obj(r, form):
    if r.b[r.p] & 0xF0 == 0xF0:
        flags = r.u8() & 0x0F
        if flags & 2:
            d.value(r)
    cls = r.sstr(); name = r.sstr()
    while r.b[r.p] != 0:
        pn = r.sstr()
        value(r, form, name or cls, pn)
    r.p += 1
    while r.b[r.p] != 0:
        obj(r, form)
    r.p += 1
    return cls


seen = set()
for base, b in chunks:
    for m in re.finditer(b"TPF0", b):
        r = d.R(b, m.end())
        try:
            # peek class name for form label
            p0 = r.p
            if r.b[r.p] & 0xF0 == 0xF0:
                pass
            r2 = d.R(b, m.end()); form = None
            if r2.b[r2.p] & 0xF0 != 0xF0:
                form = r2.sstr()
            if form in seen or not form:
                continue
            seen.add(form)
            obj(r, form)
        except Exception as e:
            print("fail", form, e)
for s in saved:
    print(s)
