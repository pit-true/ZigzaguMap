r"""Create an isolated AdvanceMap copy + ROM copy for one worker.

usage: python make_worker.py NAME [--reset-rom] [--work DIR] [--am-src DIR] [--rom-orig FILE] [--stub EXE]
  -> <work>\am192_NAME\        copy of <am-src> (default <work>\am192); the ini points at the ROM copy
  -> <work>\rom\BPRJ_NAME.gba  copy of the untouched <rom-orig> (default <work>\rom\BPRJ_orig.gba)
Then run scripts with:  set ZZM_AM_DIR=<work>\am192_NAME & set ZZM_ROM=<work>\rom\BPRJ_NAME.gba

<work> defaults to %ZZM_WORK% (or the current directory). The source AdvanceMap and the
original ROM are only read, never opened by AdvanceMap or changed.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import re
import shutil
import stat


def prep_ini(am_dir: pathlib.Path, rom: pathlib.Path | None, stub: pathlib.Path | None = None):
    """Forget the recent-file list, point the first entry at `rom`, and (optionally)
    replace the script editor with a stub that only logs its command line."""
    p = pathlib.Path(am_dir) / "Ini/AdvanceMap.ini"
    t = p.read_bytes().decode("cp932")
    t = re.sub(r"LetzteDatei\d=.*\r?\n", "", t)
    if stub:
        t = re.sub(r"ScriptEditor=.*", lambda m: "ScriptEditor=" + str(stub), t)
    if rom:
        t = t.replace("Splitter=232\r\n", "Splitter=232\r\nLetzteDatei1=" + str(rom) + "\r\n")
    p.write_bytes(t.encode("cp932"))


def reset_view_settings(am_dir):
    """Turn off grid/zoom/object view toggles in a worker ini (they persist between runs)."""
    p = pathlib.Path(am_dir) / "Ini/AdvanceMap.ini"
    t = p.read_bytes().decode("cp932")
    t = re.sub(r"(Gitter|MapDoppelt|PaletteDoppelt|GehDoppelt|EventsDoppelt|GehPaletteDoppelt|ZeigeSprites)=1", r"\1=0", t)
    p.write_bytes(t.encode("cp932"))


def copy_rom(src: pathlib.Path, dst: pathlib.Path):
    """Writable copy of an (untouched) ROM."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.chmod(stat.S_IWRITE | stat.S_IREAD)
    shutil.copyfile(src, dst)
    dst.chmod(stat.S_IWRITE | stat.S_IREAD)


def make_am_copy(src: pathlib.Path, dst: pathlib.Path):
    if not dst.exists():
        shutil.copytree(src, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--reset-rom", action="store_true")
    ap.add_argument("--work", default=os.environ.get("ZZM_WORK", os.getcwd()))
    ap.add_argument("--am-src")
    ap.add_argument("--rom-orig")
    ap.add_argument("--stub")
    a = ap.parse_args()
    work = pathlib.Path(a.work)
    am_dir = work / f"am192_{a.name}"
    rom = work / "rom" / f"BPRJ_{a.name}.gba"
    make_am_copy(pathlib.Path(a.am_src) if a.am_src else work / "am192", am_dir)
    if a.reset_rom or not rom.exists():
        copy_rom(pathlib.Path(a.rom_orig) if a.rom_orig else work / "rom/BPRJ_orig.gba", rom)
    prep_ini(am_dir, rom, pathlib.Path(a.stub) if a.stub else None)
    print(f"ZZM_AM_DIR={am_dir}")
    print(f"ZZM_ROM={rom}")


if __name__ == "__main__":
    main()
