"""両アプリのステップの結果を突き合わせて判定する。

シナリオの書き方による読み替え（どれも理由を書き、summary に一覧で出す。黙って外さない）:
- expectedDifference: 文字列（ステップ全体）か {欄: 理由}（compareFields）。違っても「仕様上の違い」。
  menu.state のような辞書の欄は {欄: {項目: 理由}} で、違う項目ごとに理由を書ける（理由の無い項目が違えば失敗）。
- pending: 同じ形。要判断の結論待ちの違いを「保留」にする（issue 番号を書く）。
- only: "zigzagu" / "advancemap"。片方のアプリだけで行う手順（理由は expectedDifference）。
  ZigzaguMap だけの compareFields は `expected`（AdvanceMap の調査記録の値）と比べる。
"""
from __future__ import annotations

import fnmatch
import pathlib
import re

from . import imagecmp, ops
from .normalize import norm_value

PASS, FAIL, UNSUP, ERROR = "合格", "失敗", "未対応", "エラー"
SPEC, PENDING = "仕様上の違い", "保留"
ALL_RESULTS = (PASS, FAIL, UNSUP, ERROR, SPEC, PENDING)


def _rel(p, root):
    if not p:
        return None
    try:
        return pathlib.Path(p).resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(p)


def _reason(st: dict, key: str, field: str | None = None):
    v = st.get(key)
    if isinstance(v, dict):
        return v.get(field) if field is not None else None
    return v or None


def expected_reason(st: dict, field: str | None = None):
    """このステップ（compareFields なら欄）に書いた「仕様上の違い」の理由。"""
    return _reason(st, "expectedDifference", field)


def excuse(result: str, st: dict, field: str | None = None) -> tuple[str, str | None]:
    """失敗を、シナリオに書いた理由で「仕様上の違い」か「保留」に読み替える。(結果, 理由)"""
    if result != FAIL:
        return result, None
    why = expected_reason(st, field)
    if isinstance(why, str) and why:
        return SPEC, why
    why = _reason(st, "pending", field)
    if isinstance(why, str) and why:
        return PENDING, why
    return result, None


class Judge:
    def __init__(self, scn: dict, am: dict | None, zz: dict, sdir: pathlib.Path, root: pathlib.Path, lang=None):
        self.scn, self.am, self.zz, self.sdir, self.root = scn, am, zz, sdir, root
        self.tr = lang.translate if lang else (lambda v: v)
        self.pair = lang.pair_ok if lang else (lambda a, b: False)
        self.rows: list[dict] = []
        self.taints: dict[str, str] = {}
        self.counts = {k: 0 for k in ALL_RESULTS}

    # ------------------------------------------------------------------ helpers
    def tainted(self, scope):
        return self.taints.get("all") or self.taints.get(scope)

    def finish(self, row, result, reason=None):
        if reason:
            row["reason"] = reason
        row["result"] = result
        self.counts[result] += 1
        self.rows.append(row)

    def verdict(self) -> str:
        c = self.counts
        for k in (FAIL, ERROR, UNSUP, PENDING):
            if c[k]:
                return k
        return PASS

    # ------------------------------------------------------------------ main
    def run(self) -> dict:
        for side, res, label in (("am", self.am, "AdvanceMap"), ("zz", self.zz, "ZigzaguMap")):
            if res and not res["started"]:
                note = res["steps"][-1]["note"] if res["steps"] else ""
                kind = ERROR if side == "am" else FAIL
                self.counts[kind] += 1
                return {"verdict": kind, "counts": self.counts,
                        "rows": [{"i": -1, "op": "(起動)", "result": kind, "detail": f"{label} が起動できません: {note}"}]}
        am_steps = self.am["steps"] if self.am else []
        zz_steps = self.zz["steps"]
        for i, st in enumerate(self.scn["steps"]):
            a = am_steps[i] if i < len(am_steps) else {"status": "missing", "note": "AdvanceMap の結果なし", "obs": {}}
            z = zz_steps[i] if i < len(zz_steps) else {"status": "skipped", "note": "結果なし", "obs": {}}
            row = {"i": i, "op": st["op"], "step": st, "am": a["status"], "zz": z["status"],
                   "amNote": a.get("note", ""), "zzNote": z.get("note", "")}
            if st.get("only"):
                self.one_side(i, st, a, z, row)
            elif not ops.OPS[st["op"]].get("observe"):
                self.action(i, st, a, z, row)
            else:
                self.observe(i, st, a, z, row)
        return {"verdict": self.verdict(), "rows": self.rows, "counts": self.counts}

    # ------------------------------------------------------------------ 片方だけの手順
    def one_side(self, i, st, a, z, row):
        only = st["only"]
        reason = expected_reason(st) if isinstance(expected_reason(st), str) else None
        reason = reason or "（理由が書かれていない）"
        side = z if only == "zigzagu" else a
        label = "ZigzaguMap" if only == "zigzagu" else "AdvanceMap"
        if not ops.OPS[st["op"]].get("observe"):
            if side["status"] == "error":
                row["detail"] = f"{label} の操作に失敗: {side['note']}"
                self.finish(row, FAIL if only == "zigzagu" else ERROR)
                self.taints["all"] = f"ステップ {i} が失敗"
            else:
                row["detail"] = f"{label} だけで行う手順"
                self.finish(row, SPEC, reason)
            return
        if only != "zigzagu":
            row["detail"] = "AdvanceMap だけの観察は比べない"
            self.finish(row, SPEC, reason)
            return
        if z["status"] != "ok":
            row["detail"] = f"ZigzaguMap で読めない: {z.get('note', '')}"
            self.finish(row, FAIL)
            return
        if st["op"] == "compareFields":
            want = st.get("expected", {})
            fields, bad = [], False
            for f in st["fields"]:
                zv = z["obs"].get("fields", {}).get(f, {})
                if "value" not in zv:
                    fr = {"field": f, "result": FAIL, "detail": zv.get("unsupported") or zv.get("error", "")}
                else:
                    same = norm_value(want.get(f)) == norm_value(zv["value"])
                    fr = {"field": f, "result": PASS if same else FAIL, "advancemap": want.get(f), "zigzagu": zv["value"],
                          "detail": "AdvanceMap の調査記録の値と比べた"}
                bad |= fr["result"] == FAIL
                fields.append(fr)
            row.update(fields=fields, detail="; ".join(f"{x['field']}: {x['result']}" for x in fields) + "（ZigzaguMap だけ）")
            self.finish(row, FAIL if bad else SPEC, None if bad else reason)
            return
        if st["op"] == "expectDialog":
            zd = z["obs"].get("dialogs", [])
            ok = bool(zd) == bool(st.get("present", True))
            text = st.get("text")
            if ok and text:
                ok = any(text in " ".join([d.get("title", "")] + d.get("texts", [])) for d in zd)
            row.update(zigzagu=zd, detail="ZigzaguMap だけで確かめた" if ok else f"ZigzaguMap のダイアログが期待と違う: {zd}")
            self.finish(row, SPEC if ok else FAIL, reason if ok else None)
            return
        row["detail"] = "ZigzaguMap だけの画像は比べない"
        self.finish(row, SPEC, reason)

    # ------------------------------------------------------------------ 状態を変える操作
    def action(self, i, st, a, z, row):
        if a["status"] == "error" and ("all" in self.taints or z["status"] == "unsupported"):
            # どうせ比べられない場面での AdvanceMap 側の失敗は「未対応」に数える
            row["detail"] = f"比べられない手順（ZigzaguMap: {z.get('note', '')}／AdvanceMap も失敗: {a['note']}）"
            self.finish(row, UNSUP)
            self.taints.setdefault("all", f"ステップ {i}（{st['op']}）が未対応")
        elif a["status"] == "error":
            row["detail"] = f"AdvanceMap 側の操作に失敗: {a['note']}"
            self.finish(row, ERROR)
            self.taints["all"] = f"ステップ {i} で AdvanceMap 側がエラー"
        elif z["status"] == "error":
            row["detail"] = f"ZigzaguMap がエラーを返した: {z['note']}"
            res, why = excuse(FAIL, st)
            self.finish(row, res, why)
            if res == FAIL:
                self.taints["all"] = f"ステップ {i} で ZigzaguMap 側が失敗"
        elif "unsupported" in (a["status"], z["status"]) or a["status"] == "missing":
            row["detail"] = z["note"] if z["status"] == "unsupported" else a["note"]
            self.finish(row, UNSUP)
            for t in ops.taints_of(st):
                self.taints.setdefault(t, f"ステップ {i}（{st['op']}）が未対応")
        elif "skipped" in (a["status"], z["status"]):
            row.update(result=UNSUP, detail="打ち切り")
            self.rows.append(row)
        elif isinstance(expected_reason(st), str):
            # 両方で通ったが、やり方が違う手順（AdvanceMap だけ保存の確認に答える、など）。理由を一覧に出す
            row["detail"] = a.get("note") or z.get("note") or "実行"
            self.finish(row, SPEC, expected_reason(st))
        else:
            row["result"] = "実行"
            if z["status"] == "emulated":
                row["detail"] = "ZigzaguMap は代用: " + z["note"]
                # 代用は画面のマウス操作を通らないので、ステータスバーの表示は比べられない
                self.taints.setdefault("status", f"ステップ {i}（{st['op']}）を ZigzaguMap では代用した")
            self.rows.append(row)

    # ------------------------------------------------------------------ 比べる操作
    def observe(self, i, st, a, z, row):
        if a["status"] == "error" and ("all" in self.taints or z["status"] == "unsupported"):
            row["detail"] = f"比べられない手順（AdvanceMap 側も失敗: {a['note']}）"
            return self.finish(row, UNSUP)
        if a["status"] == "error":
            row["detail"] = f"AdvanceMap 側で読めない: {a['note']}"
            return self.finish(row, ERROR)
        if z["status"] == "error":
            row["detail"] = f"ZigzaguMap がエラーを返した: {z['note']}"
            return self.finish(row, *excuse(FAIL, st))
        if z["status"] == "unsupported" or a["status"] in ("unsupported", "missing", "skipped") or z["status"] == "skipped":
            row["detail"] = z["note"] if z["status"] == "unsupported" else a["note"]
            return self.finish(row, UNSUP)
        getattr(self, "obs_" + st["op"])(i, st, a, z, row)

    def obs_compareFile(self, i, st, a, z, row):
        self.obs_snapshot(i, dict(st, name=pathlib.Path(st["path"]).stem), a, z, row)

    def obs_snapshot(self, i, st, a, z, row):
        why = self.tainted("image")
        if why:
            row["detail"] = f"前の手順が未対応のため比べない（{why}）"
            return self.finish(row, UNSUP)
        diff = self.sdir / f"{st['name']}.diff.png"
        cmp = imagecmp.compare(a["obs"]["image"], z["obs"]["image"], diff, st.get("compare"),
                               a["obs"].get("base"), z["obs"].get("base"))
        ok = cmp["ok"]
        r = self.root
        row.update(image=cmp, files={"advancemap": _rel(a["obs"]["image"], r), "zigzagu": _rel(z["obs"]["image"], r),
                                     "diff": _rel(diff, r), "advancemapWindow": _rel(a["obs"].get("window"), r),
                                     "zigzaguWindow": _rel(z["obs"].get("window"), r)})
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
        why = expected_reason(st)
        if ok and cmp.get("diffPixels") and isinstance(why, str):
            # 許した範囲の違いがあった（maxDiffRatio など）
            row["detail"] += f"（違う画素の割合 {cmp.get('diffRatio')}）"
            return self.finish(row, SPEC, why)
        self.finish(row, *excuse(PASS if ok else FAIL, st))

    def obs_compareFields(self, i, st, a, z, row):
        fields = []
        for f in st["fields"]:
            av = a["obs"].get("fields", {}).get(f, {})
            zv = z["obs"].get("fields", {}).get(f, {})
            fr = {"field": f}
            why = self.tainted(ops.scope_of(st, f))
            if "value" not in av:
                # AdvanceMap 側で読めない欄は失敗に数えない
                fr.update(result=UNSUP, detail=av.get("error") or av.get("unsupported", ""))
            elif "value" not in zv:
                fr.update(result=UNSUP, detail=zv.get("unsupported", ""), advancemap=av["value"])
            elif why:
                fr.update(result=UNSUP, detail=f"前の手順が未対応のため比べない（{why}）", advancemap=av["value"], zigzagu=zv["value"])
            else:
                self._field(st, f, av["value"], zv["value"], fr)
            fields.append(fr)
        rs = [x["result"] for x in fields]
        res = next((k for k in (FAIL, UNSUP, PENDING, SPEC) if k in rs), PASS)
        row.update(fields=fields, detail="; ".join(f"{x['field']}: {x['result']}" for x in fields))
        reasons = [f"{x['field']}: {x['reason']}" for x in fields if x.get("reason")]
        self.finish(row, res, "; ".join(reasons) or None)

    def _pair_keys(self, av: dict, at: dict, zv: dict) -> dict:
        """辞書の欄（menu.state など）で、ZigzaguMap に無いキーを、階層の段ごとに「同じ文言・読み替えた文言・同じ言語ファイルの
        キーの旧・新の組」で ZigzaguMap のキーへ付け替える（「マップの移動」→「マップコネクション」のように文脈で決まるもの）。"""
        out, free = {}, [k for k in zv if k not in at]
        for (rk, v), tk in zip(av.items(), at.keys()):
            if tk in zv:
                out[tk] = at[tk]
                continue
            rs, ts = rk.split("/"), tk.split("/")
            hit = next((zk for zk in free if len(zk.split("/")) == len(rs) and all(
                z == t or z == r or self.pair(r, z) for r, t, z in zip(rs, ts, zk.split("/")))), None)
            if hit:
                free.remove(hit)
            out[hit or tk] = at[tk]
        return out

    def _field(self, st, f, av, zv, fr):
        at = self.tr(av)
        if isinstance(av, dict) and isinstance(zv, dict):
            at = self._pair_keys(av, at, zv)
        na, nz = norm_value(at), norm_value(zv)
        # 読み替え表は旧文言の一致だけで引くので、言語ファイルに無い文字列（項目名など）を別のキーの文言に変えることがある。
        # 読み替える前の値が同じなら一致とみなす。
        same = na == nz or norm_value(av) == nz or self.pair(av, zv)
        fr.update(advancemap=av, zigzagu=zv)
        if at != av:
            fr["advancemapTranslated"] = at
        per = expected_reason(st, f)
        if not same and isinstance(na, dict) and isinstance(nz, dict):
            dk = [k for k in sorted(set(na) | set(nz)) if na.get(k) != nz.get(k)]
            fr["diffKeys"] = dk[:40]
            if isinstance(per, dict):
                # 違う項目ごとの理由（キーはワイルドカード可。理由の無い項目が違えば失敗）。
                # 値が文字列なら仕様上の違い、{"pending": 理由} なら保留（要判断）
                why = {k: next((v for pat, v in per.items() if fnmatch.fnmatchcase(k, pat)), None) for k in dk}
                rest = [k for k in dk if why[k] is None]
                if rest:
                    fr.update(result=FAIL, diffKeys=rest[:40])
                    return
                pend = {k: v["pending"] for k, v in why.items() if isinstance(v, dict)}
                spec = {k: v for k, v in why.items() if isinstance(v, str)}
                groups: dict[str, list[str]] = {}
                for k, v in (pend or spec).items():
                    groups.setdefault(v, []).append(k)
                fr.update(result=PENDING if pend else SPEC,
                          reason=" / ".join(f"{v}（{', '.join(ks[:6])}{' ほか' if len(ks) > 6 else ''}）" for v, ks in groups.items()))
                if pend and spec:
                    fr["specReason"] = " / ".join(sorted(set(spec.values())))
                return
        res, reason = excuse(PASS if same else FAIL, st, f)
        fr["result"] = res
        if reason:
            fr["reason"] = reason

    def obs_expectDialog(self, i, st, a, z, row):
        raw, zd = a["obs"].get("dialogs", []), z["obs"].get("dialogs", [])
        ad = self.tr(raw)
        same, why = compare_dialogs(ad, zd, st, raw, self.pair)
        row.update(advancemap=ad, zigzagu=zd, detail="一致" if same else why)
        title_why = expected_reason(st, "title")
        if not same and isinstance(title_why, str):
            # 題名だけの違い（アプリ名など）は、理由を書いてあれば題名を除いて比べる
            strip = lambda ds: [dict(d, title="") for d in ds]
            same2, why2 = compare_dialogs(strip(ad), strip(zd), st, strip(raw), self.pair)
            if same2:
                row["detail"] = "題名だけが違う"
                return self.finish(row, SPEC, title_why)
            row["detail"] = why2
        self.finish(row, *excuse(PASS if same else FAIL, st))


def compare(scn, am, zz, sdir, root, lang=None) -> dict:
    return Judge(scn, am, zz, sdir, root, lang).run()


# ---------------------------------------------------------------------------- ダイアログ
def _button(b: str) -> str:
    """ボタンの文字列（アクセスキーの表記「(&Y)」「(Y)」「&」を除く。表示は同じ）。"""
    from .langmap import menu_norm
    return norm_value(re.sub(r"\([A-Z]\)$", "", menu_norm(b)))


def _dialog_key(d: dict, full: bool, texts: bool = True) -> dict:
    k = {"title": norm_value(d.get("title", ""))}
    if full:
        if texts:
            k["texts"] = norm_value(d.get("texts", []))
        k["buttons"] = [_button(b) for b in d.get("buttons", [])]
    return k


def _dialog_diff(a: dict, z: dict, r: dict | None, pair) -> str | None:
    """ダイアログ 1 件どうしを比べる。同じなら None、違えば説明。"""
    full = a.get("cls") == "#32770" and z.get("cls") in ("app", "native")
    # ファイルのダイアログは Windows の部品の見出し（「ファイル名(&N):」など）を比べない
    texts = z.get("cls") != "native"
    ka, kz = _dialog_key(a, full, texts), _dialog_key(z, full, texts)
    if ka != kz and r is not None:
        # 読み替える前の文言で一致するならそれでよい（題名・本文ごとに、読み替えた方か元の方）
        kr = _dialog_key(r, full, texts)
        ka = {k: (kr[k] if kr.get(k) == kz.get(k) else v) for k, v in ka.items()}
        # 題名は、旧・新が同じキーの組なら同じ文言とみなす
        if pair and ka["title"] != kz["title"] and pair(r.get("title", ""), z.get("title", "")):
            ka["title"] = kz["title"]
        # 本文も 1 行ずつ、旧・新の組（値を入れて組み立てた文言を含む）なら同じとみなす
        rt, zt = r.get("texts", []), z.get("texts", [])
        if pair and "texts" in ka and ka["texts"] != kz.get("texts") and len(rt) == len(zt) and all(
                norm_value(x) == norm_value(y) or pair(x, y) for x, y in zip(rt, zt)):
            ka["texts"] = kz["texts"]
    return None if ka == kz else f"AdvanceMap {ka}、ZigzaguMap {kz}"


def compare_dialogs(ad: list, zd: list, step: dict, raw: list | None = None, pair=None) -> tuple[bool, str]:
    """開いているダイアログを比べる。AdvanceMap のメッセージボックス（#32770）と ZigzaguMap のダイアログは題名・本文・ボタン、
    AdvanceMap の VCL のフォームや ZigzaguMap の別ウィンドウは題名だけ。present（有無）と text（部分一致）も見る。"""
    want = step.get("present")
    if want is not None and bool(ad) != bool(want):
        return True, "AdvanceMap 側が期待と違う（比べない）"
    if bool(ad) != bool(zd):
        return False, f"ダイアログの有無が違う（AdvanceMap {len(ad)} 件、ZigzaguMap {len(zd)} 件）"
    if len(ad) != len(zd):
        return False, f"ダイアログの数が違う（AdvanceMap {len(ad)} 件、ZigzaguMap {len(zd)} 件）"
    # 並び（AdvanceMap は手前からの順を逆にしたもの、ZigzaguMap は開いた順）は信用しきれないので、組で探す
    left = list(range(len(zd)))
    for i, a in enumerate(ad):
        first_why = None
        for j in left:
            why = _dialog_diff(a, zd[j], raw[i] if raw is not None else None, pair)
            if why is None:
                left.remove(j)
                break
            first_why = first_why or why
        else:
            return False, f"{i + 1} 件目に当たるものが無い（{first_why}）"
    text = step.get("text")
    if text and not any(text in " ".join([z.get("title", "")] + z.get("texts", [])) for z in zd):
        return False, f"ZigzaguMap のダイアログに「{text}」がない"
    return True, "一致"
