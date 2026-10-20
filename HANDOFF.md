# 交接说明 · 轨道无限跑酷 V2.2.0

> 完整副本的交接说明：源码、文档、测试、截图、git 历史均已就位。
> 与同级的 `runner3d/` 是**两个独立实现**（同一份 PRD，不同技术路线），文件不要混用。

## 这是什么

三轨无限跑酷，纯 Web（Canvas 2D），零依赖、零素材、离线可玩。
按 `docs/PRD-V2.0.md` 的 P0 需求实现，P1 全做，P2 未做。

- 在线版：https://gubao-tian.github.io/rail-runner/
- 仓库：https://github.com/Gubao-tian/rail-runner
- 当前版本：v2.2.0（tag 在 git 历史里）

## 怎么跑

- 双击 `index.html`（Chrome / Edge），无需安装、无需构建
- 或：`python -m http.server 8771`，打开 http://127.0.0.1:8771

## 怎么验证

```bash
node tools/logic-test.mjs            # 165 项断言 + 6x240km 完美玩家模拟
node tools/balance-report.mjs        # 密度统计 -> docs/balance-report.md
node tools/export-config.mjs         # -> build/config.json
node tools/dump-blocks.mjs 100000    # -> build/blocks.json
python tools/validate.py             # Python 独立复核 -> docs/validation-report.md
```

浏览器打开 `index.html?selftest=1` 会跑 14 项运行时自检。

## 版本要点

- v2.0.1：修掉两个 P1（换道受击错位、埋点写盘放大）
- v2.1.0：补齐 PRD §9.3 的 Python 离线校验器；`js/config.js` 增加 `analysis` 段
- v2.2.0：修复 V2.1 交接单列出的 6 项待办（见下"已完成"）

## V2.2.0 已完成的待办

- **暂停冻结**：`game.update` 仅在 `playing` 时推进粒子，`animTime` 在暂停时停摆 → 暂停时粒子与世界都不再动
- **帧率统计**：`sampleFps` 对 `dt<=0` 直接 return，不再把虚帧当 10000fps 计入均值
- **死配置清理**：删除 `items.dropWeight` / `world.poolBlocks` / `timing.restartAuto` / `coins.magnetPull` / `world.fogStart`（全仓仅 config 引用，确为死项）
- **站姿骨骼高度配置化**：`render.js` 的 0.72 / 1.34 / 1.56 / 0.48 改为读取 `config.player.standHipY` / `standShoulderY` / `standHeadY` / `standWidth`，跟随 config
- **死亡姿态**：`view.dead` 现在真正生效——角色死亡时整体绕脚部支点 `-1.45` 弧度向后倒地（"扑街"），不再直立
- **集成路径断言**：新增 `tools/integration-test.mjs`，覆盖 暂停/恢复/死亡/重开 全链路（36 项断言，含 dt=0 不污染、死配置删除、站姿高度、死亡旋转对照）

## 怎么验证（V2.2 新增）

```bash
node tools/integration-test.mjs     # 36 项断言：暂停/恢复/死亡/重开 集成路径 + V2.2 修复点
node tools/logic-test.mjs           # 165 项断言（回归，无变化）
```

浏览器 `index.html?selftest=1` 仍跑 14 项运行时自检。

## 许可

MIT。美术与音频均为运行时程序化生成，无第三方素材，详见 `LICENSES.md`。