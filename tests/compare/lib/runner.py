"""シナリオの実行（両アプリ）と比較。"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import stat
import time
import traceback

from . import imagecmp, ops
from .drivers import AdvanceMapDriver, StepResult, ZigzaguDriver
from .normalize import norm_value

PASS, FAIL, UNSUP, ERROR = "合格", "失敗", "未対応", "エラー"


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


def _rel(p, root):
    if not p:
        return None
    try:
        return pathlib.Path(p).resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(p)


def compare(scn: dict, am: dict | None, zz: dict, sdir: pathlib.Path, root: pathlib.Path, lang=None) -> dict:
    """ステップごとに両者を突き合わせる。`lang`（LangMap）があれば、AdvanceMap 側の文字列を新しい文言へ読み替えてから比べる。"""
    tr = lang.translate if lang else (lambda v: v)
    steps = scn["steps"]
    rows, taints = [], {}  # taints: scope -> 理由
    counts = {PASS: 0, FAIL: 0, UNSUP: 0, ERROR: 0}
    am_steps = am["steps"] if am else []
    zz_steps = zz["steps"]
    # 起動そのものの失敗
    for side, res, label in (("am", am, "AdvanceMap"), ("zz", zz, "ZigzaguMap")):
        if res and not res["started"]:
            note = res["steps"][-1]["note"] if res["steps"] else ""
            kind = ERROR if side == "am" else FAIL
            counts[kind] += 1
            return {"verdict": kind, "rows": [{"i": -1, "op": "(起動)", "result": kind, "detail": f"{label} が起動できません: {note}"}],
                    "counts": counts}

    def tainted(scope):
        if "all" in taints:
            return taints["all"]
        return taints.get(scope)

    for i, st in enumerate(steps):
        a = am_steps[i] if i < len(am_steps) else ({"status": "missing", "note": "AdvanceMap の結果なし", "obs": {}})
        z = zz_steps[i] if i < len(zz_steps) else {"status": "skipped", "note": "結果なし", "obs": {}}
        spec = ops.OPS[st["op"]]
        row = {"i": i, "op": st["op"], "step": st, "am": a["status"], "zz": z["status"],
               "amNote": a.get("note", ""), "zzNote": z.get("note", "")}
        if not spec.get("observe"):
            # 状態を変える操作
            if a["status"] == "error" and ("all" in taints or z["status"] == "unsupported"):
                # どうせ比べられない場面での AdvanceMap 側の失敗は「未対応」に数える
                row["result"] = UNSUP
                row["detail"] = f"比べられない手順（ZigzaguMap: {z.get('note', '')}／AdvanceMap も失敗: {a['note']}）"
                counts[UNSUP] += 1
                taints.setdefault("all", f"ステップ {i}（{st['op']}）が未対応")
            elif a["status"] == "error":
                row["result"] = ERROR
                row["detail"] = f"AdvanceMap 側の操作に失敗: {a['note']}"
                counts[ERROR] += 1
                taints["all"] = f"ステップ {i} で AdvanceMap 側がエラー"
            elif z["status"] == "error":
                row["result"] = FAIL
                row["detail"] = f"ZigzaguMap がエラーを返した: {z['note']}"
                counts[FAIL] += 1
                taints["all"] = f"ステップ {i} で ZigzaguMap 側が失敗"
            elif "unsupported" in (a["status"], z["status"]) or a["status"] == "missing":
                row["result"] = UNSUP
                row["detail"] = z["note"] if z["status"] == "unsupported" else a["note"]
                counts[UNSUP] += 1
                for t in ops.taints_of(st):
                    taints.setdefault(t, f"ステップ {i}（{st['op']}）が未対応")
            elif z["status"] == "skipped" or a["status"] == "skipped":
                row["result"] = UNSUP
                row["detail"] = "打ち切り"
            else:
                row["result"] = "実行"
                if z["status"] == "emulated":
                    row["detail"] = "ZigzaguMap は代用: " + z["note"]
                    # 代用は画面のマウス操作を通らないので、ステータスバーの表示は比べられない
                    taints.setdefault("status", f"ステップ {i}（{st['op']}）を ZigzaguMap では代用した")
            rows.append(row)
            continue

        # ---- 比べる操作
        if a["status"] == "error" and ("all" in taints or z["status"] == "unsupported"):
            row.update(result=UNSUP, detail=f"比べられない手順（AdvanceMap 側も失敗: {a['note']}）")
            counts[UNSUP] += 1
            rows.append(row)
            continue
        if a["status"] in ("error",):
            row.update(result=ERROR, detail=f"AdvanceMap 側で読めない: {a['note']}")
            counts[ERROR] += 1
            rows.append(row)
            continue
        if z["status"] == "error":
            row.update(result=FAIL, detail=f"ZigzaguMap がエラーを返した: {z['note']}")
            counts[FAIL] += 1
            rows.append(row)
            continue
        if z["status"] == "unsupported" or a["status"] in ("unsupported", "missing", "skipped") or z["status"] == "skipped":
            row.update(result=UNSUP, detail=z["note"] if z["status"] == "unsupported" else a["note"])
            counts[UNSUP] += 1
            rows.append(row)
            continue
        if st["op"] == "snapshot":
            why = tainted("image")
            if why:
                row.update(result=UNSUP, detail=f"前の手順が未対応のため比べない（{why}）")
                counts[UNSUP] += 1
                rows.append(row)
                continue
            name = st["name"]
            diff = sdir / f"{name}.diff.png"
            cmp = imagecmp.compare(a["obs"]["image"], z["obs"]["image"], diff, st.get("compare"),
                                  a["obs"].get("base"), z["obs"].get("base"))
            ok = cmp["ok"]
            row.update(result=PASS if ok else FAIL, image=cmp,
                       files={"advancemap": _rel(a["obs"]["image"], root), "zigzagu": _rel(z["obs"]["image"], root),
                              "diff": _rel(diff, root), "advancemapWindow": _rel(a["obs"].get("window"), root),
                              "zigzaguWindow": _rel(z["obs"].get("window"), root)})
            if ok:
                row["detail"] = f"一致（{cmp['sizeA'][0]}x{cmp['sizeA'][1]}）"
            else:
                d = []
                if not cmp["sameSize"]:
                    d.append(f"大きさが違う（AdvanceMap {cmp['sizeA'][0]}x{cmp['sizeA'][1]}、ZigzaguMap {cmp['sizeB'][0]}x{cmp['sizeB'][1]}）")
                if cmp.get("mode") == "overlayCells":
                    d.append(f"重ね描き（イベント）のあるマスが違う: AdvanceMap だけ {cmp['onlyA'][:12]}、ZigzaguMap だけ {cmp['onlyB'][:12]}")
                elif cmp["diffCells"]:
                    head = ", ".join(f"({x},{y})" for x, y in cmp["cells"][:12])
                    d.append(f"違うマス {cmp['diffCells']} 個（違う画素 {cmp['diffPixels']}）: {head}{' …' if cmp['diffCells'] > 12 else ''}")
                row["detail"] = "。".join(d)
            counts[PASS if ok else FAIL] += 1
            rows.append(row)
            continue
        if st["op"] == "compareFields":
            fields = []
            any_fail = any_unsup = False
            for f in st["fields"]:
                av = a["obs"].get("fields", {}).get(f, {})
                zv = z["obs"].get("fields", {}).get(f, {})
                fr = {"field": f}
                why = tainted(ops.scope_of(st, f))
                if "value" not in av:
                    fr.update(result=ERROR if "error" in av else UNSUP, detail=av.get("error") or av.get("unsupported", ""))
                elif "value" not in zv:
                    fr.update(result=UNSUP, detail=zv.get("unsupported", ""), advancemap=av["value"])
                    any_unsup = True
                elif why:
                    fr.update(result=UNSUP, detail=f"前の手順が未対応のため比べない（{why}）", advancemap=av["value"], zigzagu=zv["value"])
                    any_unsup = True
                else:
                    at = tr(av["value"])
                    na, nz = norm_value(at), norm_value(zv["value"])
                    same = na == nz
                    fr.update(result=PASS if same else FAIL, advancemap=av["value"], zigzagu=zv["value"])
                    if at != av["value"]:
                        fr["advancemapTranslated"] = at
                    if not same and isinstance(na, dict) and isinstance(nz, dict):
                        keys = sorted(set(na) | set(nz))
                        fr["diffKeys"] = [k for k in keys if na.get(k) != nz.get(k)][:40]
                    any_fail |= not same
                if fr["result"] == ERROR:
                    any_fail = any_fail  # AdvanceMap 側で読めない欄は失敗に数えない
                    any_unsup = True
                fields.append(fr)
            res = FAIL if any_fail else (UNSUP if any_unsup else PASS)
            row.update(result=res, fields=fields,
                       detail="; ".join(f"{x['field']}: {x['result']}" for x in fields))
            counts[res] += 1
            rows.append(row)
            continue
        if st["op"] == "expectDialog":
            ad, zd = tr(a["obs"].get("dialogs", [])), z["obs"].get("dialogs", [])
            same, why = compare_dialogs(ad, zd, st)
            row.update(result=PASS if same else FAIL, advancemap=ad, zigzagu=zd, detail="一致" if same else why)
            counts[PASS if same else FAIL] += 1
            rows.append(row)
            continue

    if counts[FAIL]:
        verdict = FAIL
    elif counts[ERROR]:
        verdict = ERROR
    elif counts[UNSUP]:
        verdict = UNSUP
    else:
        verdict = PASS
    return {"verdict": verdict, "rows": rows, "counts": counts}


def _button(b: str) -> str:
    """ボタンの文字列（アクセスキーの表記「(&Y)」「(Y)」「&」を除く。表示は同じ）。"""
    import re
    from .langmap import menu_norm
    return norm_value(re.sub(r"\([A-Z]\)$", "", menu_norm(b)))


def _dialog_key(d: dict, full: bool, texts: bool = True) -> dict:
    k = {"title": norm_value(d.get("title", ""))}
    if full:
        if texts:
            k["texts"] = norm_value(d.get("texts", []))
        k["buttons"] = [_button(b) for b in d.get("buttons", [])]
    return k


def compare_dialogs(ad: list, zd: list, step: dict) -> tuple[bool, str]:
    """開いているダイアログを比べる。AdvanceMap のメッセージボックス（#32770）と ZigzaguMap のダイアログは題名・本文・ボタン、
    AdvanceMap の VCL のフォームや ZigzaguMap の別ウィンドウは題名だけ。present（有無）と text（部分一致）も見る。"""
    want = step.get("present")
    if want is not None and bool(ad) != bool(want):
        return True, "AdvanceMap 側が期待と違う（比べない）"
    if bool(ad) != bool(zd):
        return False, f"ダイアログの有無が違う（AdvanceMap {len(ad)} 件、ZigzaguMap {len(zd)} 件）"
    if len(ad) != len(zd):
        return False, f"ダイアログの数が違う（AdvanceMap {len(ad)} 件、ZigzaguMap {len(zd)} 件）"
    for i, (a, z) in enumerate(zip(ad, zd)):
        full = a.get("cls") == "#32770" and z.get("cls") in ("app", "native")
        # ファイルのダイアログは Windows の部品の見出し（「ファイル名(&N):」など）を比べない
        texts = z.get("cls") != "native"
        ka, kz = _dialog_key(a, full, texts), _dialog_key(z, full, texts)
        if ka != kz:
            return False, f"{i + 1} 件目が違う（AdvanceMap {ka}、ZigzaguMap {kz}）"
    text = step.get("text")
    if text and not any(text in " ".join([z.get("title", "")] + z.get("texts", [])) for z in zd):
        return False, f"ZigzaguMap のダイアログに「{text}」がない"
    return True, "一致"


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
