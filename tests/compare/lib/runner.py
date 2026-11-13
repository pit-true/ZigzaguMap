"""シナリオの実行（両アプリ）と比較。"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import stat
import time
import traceback

from .drivers import AdvanceMapDriver, StepResult, ZigzaguDriver
from .judge import ALL_RESULTS, ERROR, FAIL, PASS, PENDING, SPEC, UNSUP, compare  # noqa: F401


def scenario_hash(scn: dict) -> str:
    return hashlib.sha1(json.dumps(scn["steps"], sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def work_rom(cfg, dst: pathlib.Path) -> pathlib.Path:
    """未編集の ROM から作業用のコピーを作る（元のファイルは開かない）。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.chmod(stat.S_IWRITE | stat.S_IREAD)
    shutil.copyfile(cfg.romOriginal, dst)
    dst.chmod(stat.S_IWRITE | stat.S_IREAD)
    return dst


def run_app(driver_cls, cfg, scn, out_dir: pathlib.Path, log) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    rom = work_rom(cfg, out_dir / "rom.gba")
    drv = driver_cls(cfg, out_dir, rom)
    steps: list[dict] = []
    started = False
    try:
        drv.start()
        started = True
        for i, st in enumerate(scn["steps"]):
            if st.get("only") and st["only"] != drv.name:
                # 片方のアプリだけで行う手順（仕様上の違い。理由はシナリオの expectedDifference）
                steps.append({"op": st["op"], "status": "omitted", "note": f"{st['only']} だけの手順", "obs": {}})
                log(f"    [{drv.label}] {i:02d} {st['op']:<16} omitted")
                continue
            r: StepResult = drv.run_step(st)
            log(f"    [{drv.label}] {i:02d} {st['op']:<16} {r.status} {r.note[:100]}")
            steps.append({"op": st["op"], "status": r.status, "note": r.note, "obs": r.obs, "seconds": r.seconds})
            if r.status == "error" and st["op"] in ("openRom", "selectMap"):
                # ここで止まると以降は意味がないので打ち切る
                for st2 in scn["steps"][i + 1:]:
                    steps.append({"op": st2["op"], "status": "skipped", "note": "前の手順のエラーで打ち切り", "obs": {}})
                break
    except Exception as e:  # noqa: BLE001
        steps.append({"op": "(起動)" if not started else "(実行)", "status": "error",
                      "note": f"{type(e).__name__}: {e}", "trace": traceback.format_exc(), "obs": {}})
    finally:
        try:
            drv.stop()
        except Exception as e:  # noqa: BLE001
            log(f"    [{drv.label}] 片付けで例外: {e}")
        # ROM の作業用コピーは結果に残さない（大きいので）
        try:
            rom.unlink()
        except OSError:
            pass
    res = {"app": drv.name, "steps": steps, "started": started}
    if getattr(drv, "sound", None) is not None:
        res["mutedSounds"] = drv.sound
    (out_dir / "steps.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def run_scenario(cfg, scn: dict, run_dir: pathlib.Path, only_zz: bool, log) -> dict:
    sdir = run_dir / scn["name"]
    sdir.mkdir(parents=True, exist_ok=True)
    h = scenario_hash(scn)
    cache = cfg.resultsDir / "am-cache" / scn["name"]
    am = None
    t0 = time.time()
    if only_zz:
        meta = cache / "meta.json"
        if meta.exists() and json.loads(meta.read_text(encoding="utf-8")).get("hash") == h:
            shutil.copytree(cache, sdir / "advancemap", dirs_exist_ok=True)
            am = json.loads((sdir / "advancemap" / "steps.json").read_text(encoding="utf-8"))
            # キャッシュ内の絶対パスを結果フォルダ内のものへ付け替える
            for s in am["steps"]:
                for k in ("image", "window"):
                    if s.get("obs", {}).get(k):
                        s["obs"][k] = str(sdir / "advancemap" / pathlib.Path(s["obs"][k]).name)
            log("  AdvanceMap: 前回の結果を使う")
        else:
            log("  AdvanceMap: 前回の結果がない（またはシナリオが変わった）ので比べない")
    else:
        log("  AdvanceMap を実行")
        am = run_app(AdvanceMapDriver, cfg, scn, sdir / "advancemap", log)
        if am["started"] and not any(s["status"] == "error" for s in am["steps"]):
            if cache.exists():
                shutil.rmtree(cache)
            shutil.copytree(sdir / "advancemap", cache)
            (cache / "meta.json").write_text(json.dumps({"hash": h}), encoding="utf-8")
    log("  ZigzaguMap を実行")
    zz = run_app(ZigzaguDriver, cfg, scn, sdir / "zigzagu", log)
    cmp = compare(scn, am, zz, sdir, run_dir, cfg.lang())
    result = {"name": scn["name"], "title": scn.get("title", ""), "source": scn.get("source", ""),
              "issues": scn.get("issues", []), "hash": h, "verdict": cmp["verdict"], "counts": cmp["counts"],
              "rows": cmp["rows"], "seconds": round(time.time() - t0, 1), "amFromCache": only_zz}
    (sdir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def rejudge_scenario(cfg, scn: dict, run_dir: pathlib.Path) -> dict:
    """前の実行の結果（advancemap/zigzagu の steps.json）を、いまの判定とシナリオの理由書きで判定し直す（アプリは動かさない）。
    手順そのものを変えたシナリオには使えない（ステップの数と並びが同じときだけ）。"""
    sdir = run_dir / scn["name"]
    am = json.loads((sdir / "advancemap" / "steps.json").read_text(encoding="utf-8"))
    zz = json.loads((sdir / "zigzagu" / "steps.json").read_text(encoding="utf-8"))
    if len(zz["steps"]) != len(scn["steps"]) or [s["op"] for s in zz["steps"]] != [s["op"] for s in scn["steps"]]:
        raise ValueError(f"{scn['name']}: シナリオの手順が実行したときと違うので判定し直せません")
    old = json.loads((sdir / "result.json").read_text(encoding="utf-8"))
    cmp = compare(scn, am, zz, sdir, run_dir, cfg.lang())
    old.update(verdict=cmp["verdict"], counts=cmp["counts"], rows=cmp["rows"], hash=scenario_hash(scn), title=scn.get("title", ""))
    (sdir / "result.json").write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")
    return old
