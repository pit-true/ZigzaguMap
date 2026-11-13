"""ハーネスが起動した AdvanceMap（32 ビット）のプロセスの中で、音を鳴らす関数を何もしないようにする。

- 対象: user32!MessageBeep、kernel32/kernelbase!Beep、winmm!PlaySoundA/W・sndPlaySoundA/W
  （メッセージボックスの警告音・Delphi の Beep・入力エラーの音はどれもここを通る）。
- 方法: 対象プロセス内に小さな関数（呼ばれた回数を数えて TRUE を返す）を置き、元の関数の先頭を
  そこへの jmp に書き換える。書き換えるのはこのプロセスのメモリだけで、ほかのプロセス・システムの音の設定には触れない。
- winmm.dll はメッセージボックスの音を出すときに初めて読み込まれることがあるので、先に対象プロセスで LoadLibraryW させてから書き換える。
- 呼ばれた回数（＝鳴るはずだった回数）は `Muter.counts()` で読める。
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import struct

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)

kernel32.OpenProcess.restype = wt.HANDLE
kernel32.VirtualAllocEx.restype = ctypes.c_void_p
kernel32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
kernel32.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
kernel32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.WriteProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.FlushInstructionCache.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t]
kernel32.CreateRemoteThread.restype = wt.HANDLE
kernel32.CreateRemoteThread.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.c_void_p]
kernel32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
kernel32.CloseHandle.argtypes = [wt.HANDLE]
psapi.EnumProcessModulesEx.argtypes = [wt.HANDLE, ctypes.POINTER(ctypes.c_void_p), wt.DWORD, ctypes.POINTER(wt.DWORD), wt.DWORD]
psapi.GetModuleBaseNameW.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.LPWSTR, wt.DWORD]

PROCESS_ALL = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400  # CREATE_THREAD | VM_OPERATION | VM_READ | VM_WRITE | QUERY_INFORMATION
LIST_MODULES_32BIT = 0x01
PAGE_EXECUTE_READWRITE = 0x40
MEM_COMMIT_RESERVE = 0x3000

# (モジュール, 関数, 引数のバイト数（stdcall の ret n）。None は元の関数の ret から読む)
# win32u の 2 つは、メッセージボックス（MessageBoxW）が自分で鳴らす音の入口（MessageBeep を通らない）。
TARGETS = [
    ("win32u.dll", "NtUserMessageBeep", None),
    ("win32u.dll", "NtUserPlayEventSound", None),
    ("user32.dll", "MessageBeep", 4),
    ("kernel32.dll", "Beep", 8),
    ("kernelbase.dll", "Beep", 8),
    ("winmm.dll", "PlaySoundW", 12),
    ("winmm.dll", "PlaySoundA", 12),
    ("winmm.dll", "sndPlaySoundW", 8),
    ("winmm.dll", "sndPlaySoundA", 8),
]


class Muter:
    def __init__(self, pid: int):
        self.pid = pid
        self.h = kernel32.OpenProcess(PROCESS_ALL, False, pid)
        if not self.h:
            raise ctypes.WinError(ctypes.get_last_error())
        self.patched: dict[str, int] = {}  # "module!func" -> 数える場所
        self._targets: dict[str, int] = {}  # "module!func" -> 書き換えた関数の位置（転送先が同じなら 2 度書かない）
        self.page = 0
        self.used = 0

    def close(self):
        if self.h:
            kernel32.CloseHandle(self.h)
            self.h = None

    # ------------------------------------------------------------ メモリ
    def read(self, addr: int, size: int) -> bytes:
        buf = ctypes.create_string_buffer(size)
        n = ctypes.c_size_t()
        if not kernel32.ReadProcessMemory(self.h, addr, buf, size, ctypes.byref(n)):
            raise ctypes.WinError(ctypes.get_last_error())
        return buf.raw[:n.value]

    def write(self, addr: int, data: bytes, code: bool = False):
        old = wt.DWORD()
        if code:
            kernel32.VirtualProtectEx(self.h, addr, len(data), PAGE_EXECUTE_READWRITE, ctypes.byref(old))
        n = ctypes.c_size_t()
        ok = kernel32.WriteProcessMemory(self.h, addr, data, len(data), ctypes.byref(n))
        if code:
            kernel32.VirtualProtectEx(self.h, addr, len(data), old.value, ctypes.byref(old))
            kernel32.FlushInstructionCache(self.h, addr, len(data))
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())

    def alloc(self, size: int) -> int:
        if not self.page or self.used + size > 4096:
            self.page = kernel32.VirtualAllocEx(self.h, None, 4096, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE)
            if not self.page or self.page >= 1 << 32:
                raise RuntimeError("対象プロセスに 32 ビットの場所を確保できません")
            self.used = 0
        addr = self.page + self.used
        self.used += (size + 15) & ~15
        return addr

    # ------------------------------------------------------------ モジュールと関数
    def modules(self) -> dict[str, int]:
        arr = (ctypes.c_void_p * 1024)()
        need = wt.DWORD()
        psapi.EnumProcessModulesEx(self.h, arr, ctypes.sizeof(arr), ctypes.byref(need), LIST_MODULES_32BIT)
        out = {}
        for i in range(min(need.value // ctypes.sizeof(ctypes.c_void_p), 1024)):
            base = arr[i]
            if not base:
                continue
            name = ctypes.create_unicode_buffer(260)
            psapi.GetModuleBaseNameW(self.h, base, name, 260)
            out[name.value.lower()] = base
        return out

    def export(self, base: int, name: str, mods: dict[str, int], depth: int = 0) -> int | None:
        """32 ビットの DLL の書き出し表から関数の位置を求める（別の DLL への転送もたどる）。"""
        lfanew = struct.unpack("<I", self.read(base + 0x3C, 4))[0]
        exp_rva, exp_size = struct.unpack("<II", self.read(base + lfanew + 0x78, 8))
        if not exp_rva:
            return None
        d = self.read(base + exp_rva, 40)
        n_names, f_rva, n_rva, o_rva = struct.unpack_from("<IIII", d, 24)
        names = struct.unpack(f"<{n_names}I", self.read(base + n_rva, 4 * n_names))
        want = name.encode()
        for i, rva in enumerate(names):
            if self.read(base + rva, len(want) + 1) != want + b"\0":
                continue
            ordi = struct.unpack("<H", self.read(base + o_rva + 2 * i, 2))[0]
            frva = struct.unpack("<I", self.read(base + f_rva + 4 * ordi, 4))[0]
            if exp_rva <= frva < exp_rva + exp_size:  # 転送（"DLL.関数"）
                fwd = self.read(base + frva, 128).split(b"\0", 1)[0].decode()
                dll, func = fwd.split(".", 1)
                tgt = mods.get(dll.lower() + ".dll")
                if tgt is None or depth > 3:
                    return None
                return self.export(tgt, func, mods, depth + 1)
            return base + frva
        return None

    def load_library(self, dll: str, mods: dict[str, int]) -> None:
        """対象プロセスに DLL を読み込ませる（winmm.dll を先に読ませて書き換えるため）。"""
        k32 = mods.get("kernel32.dll")
        fn = self.export(k32, "LoadLibraryW", mods) if k32 else None
        if not fn:
            return
        arg = self.alloc(2 * (len(dll) + 1))
        self.write(arg, (dll + "\0").encode("utf-16-le"))
        th = kernel32.CreateRemoteThread(self.h, None, 0, fn, arg, 0, None)
        if th:
            kernel32.WaitForSingleObject(th, 5000)
            kernel32.CloseHandle(th)

    # ------------------------------------------------------------ 書き換え
    def mute(self) -> list[str]:
        """まだ書き換えていない関数を書き換える。書き換えたものの名前を返す。"""
        mods = self.modules()
        if "winmm.dll" not in mods:
            self.load_library("winmm.dll", mods)
            mods = self.modules()
        done = []
        for mod, func, argbytes in TARGETS:
            key = f"{mod}!{func}"
            if key in self.patched or mod not in mods:
                continue
            addr = self.export(mods[mod], func, mods)
            if not addr or any(a == addr for a in self._targets.values()):
                continue
            if argbytes is None:
                argbytes = self._ret_bytes(addr)
                if argbytes is None:
                    continue
            counter = self.alloc(4)
            self.write(counter, b"\0\0\0\0")
            stub = self.alloc(16)
            # lock inc dword [counter] / mov eax, 1 / ret argbytes
            code = b"\xF0\xFF\x05" + struct.pack("<I", counter) + b"\xB8\x01\x00\x00\x00" + b"\xC2" + struct.pack("<H", argbytes)
            self.write(stub, code, code=True)
            self.write(addr, b"\xE9" + struct.pack("<i", stub - (addr + 5)), code=True)
            self.patched[key] = counter
            self._targets[key] = addr
            done.append(key)
        return done

    def _ret_bytes(self, addr: int) -> int | None:
        """システムコールの入口（数十バイト）から `ret n`（C2 n 00）を探し、n を返す。引数なしの `ret`（C3）なら 0。"""
        code = self.read(addr, 32)
        for i in range(len(code) - 2):
            if code[i] == 0xC2 and code[i + 2] == 0x00 and code[i + 1] % 4 == 0:
                return code[i + 1]
            if code[i] == 0xC3:
                return 0
        return None

    def counts(self) -> dict[str, int]:
        """書き換えた関数が呼ばれた回数（鳴らずに済んだ回数）。"""
        out = {}
        for key, counter in self.patched.items():
            try:
                out[key] = struct.unpack("<I", self.read(counter, 4))[0]
            except OSError:
                out[key] = -1
        return out

