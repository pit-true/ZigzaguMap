"""Read Delphi form resources (TPF0 blobs) out of the running AdvanceMap process
(the exe is UPX-packed, but its memory image is unpacked) and convert them to
text DFM. Output: inventory/_ref/dfm/<FormClass>.txt"""
import ctypes, struct, re, time, pathlib, sys
from am import AM, kernel32, WORK

OUT = WORK / "inventory/_ref/dfm"


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p), ("AllocationProtect", ctypes.c_ulong),
                ("PartitionId", ctypes.c_ushort), ("RegionSize", ctypes.c_size_t), ("State", ctypes.c_ulong),
                ("Protect", ctypes.c_ulong), ("Type", ctypes.c_ulong)]


def read_image(am):
    hp = am._hproc()
    kernel32.VirtualQueryEx.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    kernel32.VirtualQueryEx.restype = ctypes.c_size_t
    chunks = []
    addr = 0x400000
    while addr < 0x2000000:
        mbi = MEMORY_BASIC_INFORMATION()
        if not kernel32.VirtualQueryEx(hp, addr, ctypes.byref(mbi), ctypes.sizeof(mbi)):
            break
        size = mbi.RegionSize
        if mbi.State == 0x1000 and mbi.AllocationBase == 0x400000:
            buf = ctypes.create_string_buffer(size)
            n = ctypes.c_size_t()
            kernel32.ReadProcessMemory(hp, addr, buf, size, ctypes.byref(n))
            chunks.append((addr, buf.raw[:n.value]))
        elif mbi.AllocationBase != 0x400000 and addr > 0x400000:
            break
        addr += size
    return chunks


class R:
    def __init__(self, b, p):
        self.b, self.p = b, p

    def u8(self):
        v = self.b[self.p]; self.p += 1; return v

    def take(self, n):
        v = self.b[self.p:self.p + n]; self.p += n; return v

    def sstr(self):
        n = self.u8(); return self.take(n).decode("cp932", "replace")

    def i(self, fmt):
        n = struct.calcsize(fmt); v = struct.unpack(fmt, self.take(n))[0]; return v


def value(r):
    t = r.u8()
    if t == 0: return "<null>"
    if t == 1:
        items = []
        while True:
            if r.b[r.p] == 0: r.p += 1; break
            items.append(value(r))
        return "(" + " ".join(items) + ")"
    if t == 2: return str(r.i("<b"))
    if t == 3: return str(r.i("<h"))
    if t == 4: return str(r.i("<i"))
    if t == 5:
        raw = r.take(10)
        m = int.from_bytes(raw[:8], "little"); e = int.from_bytes(raw[8:], "little")
        sign = -1 if e & 0x8000 else 1; e &= 0x7FFF
        return repr(sign * m * 2.0 ** (e - 16383 - 63)) if m else "0.0"
    if t == 6: return repr(r.sstr())
    if t == 7: return r.sstr()  # ident
    if t == 8: return "False"
    if t == 9: return "True"
    if t == 10:
        n = r.i("<I"); data = r.take(n); return f"{{binary {n} bytes}}"
    if t == 11:
        s = []
        while True:
            x = r.sstr()
            if not x: break
            s.append(x)
        return "[" + ", ".join(s) + "]"
    if t == 12:
        n = r.i("<I"); return repr(r.take(n).decode("cp932", "replace"))
    if t == 13: return "nil"
    if t == 14:
        out = []
        while True:
            if r.b[r.p] == 0: r.p += 1; break
            if r.b[r.p] in (2, 3, 4):
                out.append("[" + value(r) + "]")
            if r.b[r.p] == 1:
                r.p += 1
            props = []
            while r.b[r.p] != 0:
                name = r.sstr(); props.append(f"{name} = {value(r)}")
            r.p += 1
            out.append("item " + "; ".join(props) + " end")
        return "<" + " | ".join(out) + ">"
    if t == 15: return str(r.i("<f"))
    if t == 16: return str(r.i("<q") / 10000)
    if t == 17: return str(r.i("<d"))
    if t == 18:
        n = r.i("<I"); return repr(r.take(n * 2).decode("utf-16-le", "replace"))
    if t == 19: return str(r.i("<q"))
    if t == 20:
        n = r.i("<I"); return repr(r.take(n).decode("utf-8", "replace"))
    raise ValueError(f"vt {t} at {r.p}")


def obj(r, depth, out):
    flags = 0
    if r.b[r.p] & 0xF0 == 0xF0:
        flags = r.u8() & 0x0F
        if flags & 2: value(r)
    cls = r.sstr(); name = r.sstr()
    out.append("  " * depth + f"object {name}: {cls}")
    while r.b[r.p] != 0:
        pn = r.sstr()
        out.append("  " * (depth + 1) + f"{pn} = {value(r)}")
    r.p += 1
    while r.b[r.p] != 0:
        obj(r, depth + 1, out)
    r.p += 1
    out.append("  " * depth + "end")
    return cls


def main():
    am = AM()
    try:
        am.start(rom=None)
        time.sleep(2)
        chunks = read_image(am)
    finally:
        am.shutdown()
    import pickle
    pickle.dump(chunks, open(OUT.parent / "img.pkl", "wb"))
    OUT.mkdir(parents=True, exist_ok=True)
    seen = set()
    for base, b in chunks:
        for m in re.finditer(b"TPF0", b):
            r = R(b, m.end())
            out = []
            try:
                cls = obj(r, 0, out)
            except Exception as e:
                print("fail at", hex(base + m.start()), e)
                continue
            if cls in seen:
                continue
            seen.add(cls)
            (OUT / f"{cls}.txt").write_text("\n".join(out), encoding="utf-8")
            print(cls, len(out))


if __name__ == "__main__":
    main()
