# V2.1.0 · 补齐 Python 离线校验

本次不改玩法与手感，只把 PRD §9.3 的原始方案补上：**用第二套语言独立复核同一份关卡**。

**在线试玩**：<https://gubao-tian.github.io/rail-runner/>

## 新增

**`tools/validate.py`** —— Python 离线校验器，三项检查：

1. **静态规则**：三轨全封、连续双轨、新手区约束、道具是否只落在安全轨
2. **完美玩家可解性**：视野 40m / 反应 250ms / 换道 120ms 的模型下，每块地是否存在可行策略
3. **类型分布**：实测占比 vs 连排禁令下的平稳分布（只观察，不阻断）

数据不是复制参数，而是从同一份源头导出：

```bash
node tools/export-config.mjs                 # js/config.js  → build/config.json
node tools/dump-blocks.mjs 100000 20261020   # 真实生成器   → build/blocks.json
python tools/validate.py                     # → docs/validation-report.md / .csv
```

退出码：`0` 通过、`1` 有违例或无解、`2` 缺输入文件。

**配置新增 `analysis` 段**：把 PRD §9.3 的完美玩家模型（视距 40m、反应 250ms、批量 10 万块）从前只写在文档里，改成 `js/config.js` 里的可调参数。

## 验证

| 种子 | 地块数 | 静态违例 | 无解地块 | 分布偏差（平均 / 最大） |
| --- | ---: | ---: | ---: | --- |
| 20261020 | 100000 | 0 | 0 | 0.022 / 0.046 |
| 999 | 100000 | 0 | 0 | 0.023 / 0.050 |
| 7 | 100000 | 0 | 0 | 0.021 / 0.042 |

Node 侧 165 项断言同时保持全绿；浏览器自检 14/14。

## 顺手修的

`.gitignore` 之前是用 ANSI 追加的，混了 GBK 中文注释，已重写为无 BOM 的 UTF-8，并补上 `build/`。

## 尚未处理（仍是已知问题，计划 V2.2）

- 暂停时粒子仍在动
- 帧率统计把恢复首帧的 `dt=0` 当成 10000fps 计入均值
- 5 个从未被引用的配置项（`dropWeight` / `poolBlocks` / `restartAuto` / `magnetPull` / `fogStart`）
- 站姿骨骼高度写死在 `js/render.js`
- 死亡没有姿态表现（`view.dead` 传了但没用）
- 暂停 / 恢复 / 结算 / 重开缺自动化断言

## 许可

MIT。
