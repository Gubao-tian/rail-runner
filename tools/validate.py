# -*- coding: utf-8 -*-
"""轨道无限跑酷 · Python 离线校验器（PRD §9.3）

三项检查，全部数据来自游戏同一份 GameConfig 与同一套生成器：

  1. 静态规则：三轨全封 / 双轨连排 / 新手保护 / 道具只落安全轨
  2. 完美玩家可解性：视野 40m、反应 250ms、换道 120ms 的模型下，是否存在可行策略
  3. 类型分布：实测占比 vs 连排禁令下的平稳分布

校验思路移植自另一份实现（runner3d/tools/validate.py），数据接口按本项目的导出格式重写。

用法:
  node tools/export-config.mjs        # build/config.json
  node tools/dump-blocks.mjs 100000   # build/blocks.json
  python tools/validate.py            # 可选参数：blocks 路径

输出:
  docs/validation-report.md
  docs/validation.csv
退出码:
  0 = 通过，1 = 有违例或无解，2 = 缺少输入文件
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_BLOCKS = os.path.join(ROOT, "build", "blocks.json")
DEFAULT_CONFIG = os.path.join(ROOT, "build", "config.json")
REPORT_PATH = os.path.join(ROOT, "docs", "validation-report.md")
CSV_PATH = os.path.join(ROOT, "docs", "validation.csv")

TYPES = ["empty", "low", "bar", "double", "coin", "item"]


def load_json(path, hint):
    if not os.path.exists(path):
        print("缺少 %s" % path)
        print("请先运行：%s" % hint)
        sys.exit(2)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def speed_at(cfg, d):
    s = cfg["speed"]
    return s["v0"] + (s["vMax"] - s["v0"]) * (1.0 - math.exp(-max(d, 0.0) / s["lambda"]))


def double_weight(cfg, d):
    curve = cfg["weights"]["doubleCurve"]
    cap = cfg["weights"]["doubleCap"]
    if d <= curve[0][0]:
        return curve[0][1]
    for i in range(1, len(curve)):
        x0, y0 = curve[i - 1]
        x1, y1 = curve[i]
        if d <= x1:
            t = (d - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + (y1 - y0) * min(max(t, 0.0), 1.0)
    return min(curve[-1][1], cap)


def weights_at(cfg, d):
    """与 js/difficulty.js 一致的权重：线性端点 + 双轨曲线，再归一化。"""
    ramp = cfg["weights"]["ramp"]
    t = min(max(d, 0.0), ramp) / ramp if ramp > 0 else 1.0
    w = {}
    for k, (a, b) in cfg["weights"]["end"].items():
        w[k] = a + (b - a) * t
    w["double"] = min(double_weight(cfg, d), cfg["weights"]["doubleCap"])
    total = sum(max(v, 0.0) for v in w.values()) or 1.0
    return {k: max(v, 0.0) / total for k, v in w.items()}


def stationary(w, bans):
    """连排禁令下的平稳分布：P(src→dst) ∝ w[dst]，dst 不能是被禁的同名类型。"""
    states = list(w.keys())
    trans = {}
    for src in states:
        ban = src if src in bans else None
        allowed = {t: w[t] for t in states if t != ban}
        z = sum(allowed.values()) or 1.0
        trans[src] = {t: v / z for t, v in allowed.items()}

    pi = {s: 1.0 / len(states) for s in states}
    for _ in range(3000):
        nxt = {s: 0.0 for s in states}
        for src, p in pi.items():
            for dst, q in trans[src].items():
                nxt[dst] += p * q
        delta = max(abs(nxt[s] - pi[s]) for s in states)
        pi = nxt
        if delta < 1e-13:
            break
    return pi


def static_rules(cfg, blocks):
    errs = []
    prev_type = None
    for b in blocks:
        blocked = set(b["blockedLanes"])
        if len(blocked) >= 3:
            errs.append((b["index"], "三轨全封"))
        if b["type"] == "double" and prev_type == "double":
            errs.append((b["index"], "连续两块双轨"))
        if b.get("newbie"):
            if len(blocked) > 1:
                errs.append((b["index"], "新手区出现双轨"))
            if len(b["safeLanes"]) < cfg["newbie"]["minSafeLanes"]:
                errs.append((b["index"], "新手区安全轨不足"))
        if b.get("hasItem"):
            lane = b.get("itemLane")
            if lane is None or lane not in b["safeLanes"]:
                errs.append((b["index"], "道具落在非安全轨"))
        prev_type = b["type"]
    return errs


def solvability(cfg, blocks):
    """完美玩家模型：看得见（vision）、反应得过来（reaction）。

    对每个有障碍的地块，从安全轨里挑换道次数最少的；若「进入视野到撞击」的时间
    不够「反应 + 换道耗时 × 次数」，判为来不及（单轨障碍还有跳/滑，故只对有
    双轨障碍要求换道）。
    """
    vision = cfg["analysis"]["vision"]
    reaction = cfg["analysis"]["reaction"]
    lane_switch = cfg["timing"]["laneSwitch"]
    block_len = cfg["block"]["length"]

    unsolved = []
    cur_lane = cfg["lanes"] // 2
    last_cross = 0.0

    for b in blocks:
        blocked = set(b["blockedLanes"])
        safe = set(b["safeLanes"])
        if len(blocked) >= cfg["lanes"]:
            unsolved.append((b["index"], "三轨全封，任何策略都过不去"))
            continue
        if not safe:
            unsolved.append((b["index"], "没有安全轨"))
            continue

        cross_d = b["startDist"] + block_len * 0.5
        v = speed_at(cfg, cross_d)

        if len(blocked) >= 2:
            best = min(safe, key=lambda l: abs(l - cur_lane))
            switches = abs(best - cur_lane)
            visible_at = cross_d - vision
            slack = max(0.0, cross_d - max(visible_at, last_cross)) / v
            need = reaction + switches * lane_switch
            if slack < need:
                unsolved.append((b["index"], "反应不及：距离 %.0fm，需要 %.3fs，只有 %.3fs"
                                 % (cross_d, need, slack)))
            else:
                cur_lane = best
        last_cross = cross_d

    return unsolved


def distribution(cfg, blocks, band_blocks=500, start_index=None):
    """按「500 块」一段统计实测占比，与段中点距离处的平稳分布比较。"""
    start_index = cfg["newbie"]["blocks"] if start_index is None else start_index
    rows = []
    for i in range(start_index, len(blocks) - band_blocks + 1, band_blocks):
        band = blocks[i:i + band_blocks]
        mid = band[len(band) // 2]["startDist"]
        expected = stationary(weights_at(cfg, mid), set(cfg["noRepeat"]))
        counts = defaultdict(int)
        for b in band:
            counts[b["type"]] += 1
        obs = {t: counts[t] / float(len(band)) for t in TYPES}
        diff = max(abs(obs[t] - expected[t]) for t in TYPES)
        rows.append({
            "from_m": band[0]["startDist"],
            "to_m": band[-1]["startDist"] + cfg["block"]["length"],
            "obs": obs,
            "expected": expected,
            "max_diff": diff
        })
    return rows


def main():
    blocks_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BLOCKS
    data = load_json(blocks_path, "node tools/dump-blocks.mjs")
    cfg = load_json(DEFAULT_CONFIG, "node tools/export-config.mjs")
    blocks = data["blocks"]

    errs = static_rules(cfg, blocks)
    unsolved = solvability(cfg, blocks)
    bands = distribution(cfg, blocks)
    worst = max(bands, key=lambda r: r["max_diff"]) if bands else None
    mean_diff = (sum(r["max_diff"] for r in bands) / len(bands)) if bands else 0.0
    coverage_m = blocks[-1]["startDist"] + cfg["block"]["length"] if blocks else 0

    # 分布偏差是抽样噪声（每段 500 块，200 段取最大值），只报告不阻断；
    # 阻断条件只有：静态规则违例、完美玩家无解。
    ok = not errs and not unsolved
    drift = worst is not None and worst["max_diff"] > 0.08

    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    lines = []
    lines.append("# 离线校验报告（Python）")
    lines.append("")
    lines.append("> 由 `python tools/validate.py` 生成；数据来自 `node tools/dump-blocks.mjs`，")
    lines.append("> 与游戏共用同一份 `js/config.js` 和同一套 `js/blocks.js` 生成器。")
    lines.append("")
    lines.append("- 种子：`%d`" % data["seed"])
    lines.append("- 地块数：%d（覆盖 %.0f m / %.1f km）"
                 % (len(blocks), coverage_m, coverage_m / 1000.0))
    lines.append("- 版本：%s" % cfg.get("version", "?"))
    lines.append("")
    lines.append("## 1. 静态规则")
    lines.append("")
    if errs:
        lines.append("**%d 处违例**：" % len(errs))
        lines.append("")
        for idx, why in errs[:20]:
            lines.append("- 第 %d 块：%s" % (idx + 1, why))
    else:
        lines.append("全部通过：无三轨全封、无连续双轨、新手区合规、道具只落在安全轨。")
    lines.append("")
    lines.append("## 2. 完美玩家可解性")
    lines.append("")
    lines.append("模型：前方视野 %d m、反应 %.0f ms、换道 %.0f ms。"
                 % (cfg["analysis"]["vision"], cfg["analysis"]["reaction"] * 1000,
                    cfg["timing"]["laneSwitch"] * 1000))
    lines.append("")
    if unsolved:
        lines.append("**%d 块无解**（阈值 0）：" % len(unsolved))
        lines.append("")
        for idx, why in unsolved[:20]:
            lines.append("- 第 %d 块：%s" % (idx + 1, why))
    else:
        lines.append("无解地块 **0** —— 每块地都至少存在一条在反应时间内可行的策略。")
    lines.append("")
    lines.append("## 3. 类型分布")
    lines.append("")
    if worst:
        lines.append("每 500 块一段，实测 vs 平稳分布：平均偏差 **%.3f**，最大 **%.3f**。"
                     % (mean_diff, worst["max_diff"]))
        lines.append("")
        if drift:
            lines.append("> 注意：最大偏差超过 0.08，可能是抽样噪声，也可能是权重改动后的真实偏移。")
            lines.append("> 分布只作观察，不影响 PASS/FAIL。")
            lines.append("")
        lines.append("| 区间 (m) | 双轨 实测/期望 | 单轨低障碍 | 单轨横杆 | 金币 | 道具 | 空地 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for r in bands[::max(1, len(bands) // 12)]:
            o, e = r["obs"], r["expected"]
            lines.append("| %.0f–%.0f | %.3f / %.3f | %.3f / %.3f | %.3f / %.3f | %.3f / %.3f | %.3f / %.3f | %.3f / %.3f |"
                         % (r["from_m"], r["to_m"],
                            o["double"], e["double"], o["low"], e["low"], o["bar"], e["bar"],
                            o["coin"], e["coin"], o["item"], e["item"], o["empty"], e["empty"]))
    lines.append("")
    lines.append("## 结论")
    lines.append("")
    lines.append("**%s**" % ("PASS" if ok else "FAIL"))
    lines.append("")

    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["from_m", "to_m", "max_diff"] + ["obs_" + t for t in TYPES] + ["exp_" + t for t in TYPES])
        for r in bands:
            w.writerow([r["from_m"], r["to_m"], round(r["max_diff"], 4)]
                       + [round(r["obs"][t], 4) for t in TYPES]
                       + [round(r["expected"][t], 4) for t in TYPES])

    print("静态规则违例: %d" % len(errs))
    print("无解地块: %d" % len(unsolved))
    if worst:
        print("分布偏差: 平均 %.3f / 最大 %.3f（仅观察）" % (mean_diff, worst["max_diff"]))
    print("报告: docs/validation-report.md / docs/validation.csv")
    print("结论: %s" % ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
