"""実フォルダ（ND・Chronos）の写しを使うテストの部品。

  from lib import config, fixtures, snapshot
  from lib.app import Zigzagu
  from lib.builder import build_fixture, build_nd_dpe

  cfg = config.load()                       # tests/realcopy/local.config.json
  fx = fixtures.get(cfg, "nd")              # "nd" / "chronos"
  fixtures.make_copy(fx, reuse=False)       # <copyRoot>/nd/ に写す
  with Zigzagu(cfg, "nd") as z:             # --automation <空きポート> --profile <copyRoot>/profiles/nd --mute-audio
      z.open_fixture(fx)
      z.call({"cmd": "selectMap", "bank": 3, "map": 0})
      z.export()
  r = build_fixture(fx, cfg.copyRoot / "logs" / "x")   # r.ok, r.log, r.errors
"""
