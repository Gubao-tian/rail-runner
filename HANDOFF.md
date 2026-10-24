# 交接说明 · 轨道无限跑酷 V2.2.4

> 完整副本的交接说明：源码、文档、测试、截图、git 历史均已就位。
> 与同级的 `runner3d/` 是**两个独立实现**（同一份 PRD，不同技术路线），文件不要混用。

## 这是什么

三轨无限跑酷，纯 Web（Canvas 2D），零依赖、零素材、离线可玩。
按 `docs/PRD-V2.0.md` 的 P0 需求实现，P1 全做，P2 未做。

- 在线版：https://gubao-tian.github.io/rail-runner/
- 仓库：https://github.com/Gubao-tian/rail-runner
- 当前版本：v2.2.4（tag 在 git 历史里）

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
- v2.2.1：配置单一数据源收尾（见下"V2.2.1 已完成的待办"），纯等价替换，行为零变化
- v2.2.2：重写角色腿部几何，消除罗圈腿（见下"V2.2.2 已完成的待办"）
- v2.2.3：跑动姿态增强——躯干前倾、重心弹跳、头部起伏、手臂两段链摆臂（见下"V2.2.3 已完成的待办"）
- v2.2.4：修复 V2.2.3 引入的角色侧倾 bug（见下"V2.2.4 已完成的待办"）

## V2.2.4 已完成的待办（修复角色侧倾）

V2.2.3 用 `ctx.rotate(lean)` 表达"躯干前倾"——但本作是背视角伪 3D，`rotate` 是**屏幕平面内的侧倾**，导致角色整体歪斜像摔倒（用户截图反馈"轨道发生变化了"，实为角色姿态歪斜误导；轨道代码与渲染经截图对比确认无变化）。

- **修复**：前倾改为物理正确的表达——躯干垂直投影缩短：肩/头按 `(1-cos(lean)) × 躯干长 × 4`（风格化放大）下降，躯干保持竖直。
- **回归防线**：`integration-test.mjs` 新增断言"活体渲染零旋转"——活体 `drawPlayer` 不得调用 `ctx.rotate`（死亡扑街的 -1.45 除外），防止再犯。断言 66 → 67。

## V2.2.3 已完成的待办（角色跑动姿态 / 去机械化）

视觉缺陷：角色像刚性小人——躯干恒竖直、手臂直臂硬摆、头钉死、阴影无离地反馈。

- **新增纯函数 `Renderer.runPose(phase, speed, crouch, airborne)`**：把姿态参数（前倾/弹跳/摆臂/肘弯曲）抽成可测试纯函数，约束收归 `config.player.run`（8 个键：`lean` / `bounceAmp` / `headBobAmp` / `armSwingAmp` / `armBend` / `armPhaseOffset` / `shadowScale` / `shadowLiftFade`）。
- **躯干前倾 + 弹跳**：绕髋部 `rotate(lean)` 前倾（速度越快前倾越大），重心按步频 `sin(2·phase)` 上下弹跳，让身体有重量感。
- **头部起伏**：头随重心轻微浮动（幅度小于身体、相位略滞后），不再钉死。
- **手臂两段链**：肩→肘→手，肘关节随摆动弯曲（前摆收肘、后摆展肘），对侧摆臂（左臂与右腿同相），替代原来的直臂正弦摆。
- **阴影反馈**：腾空时阴影随离地高度收缩并变淡（`shadowScale` / `shadowLiftFade`），直观传达"离地多高"。
- **新增断言**：`integration-test.mjs` 第 10 节——前倾非零且随速度增大、弹跳非零（整周期扫描）、蹲姿收敛、手臂摆随相位变化、有肘关节、头部起伏小于身体弹跳。总数 55 → 66。

## V2.2.2 已完成的待办（角色腿部 / 罗圈腿）

视觉缺陷：角色两腿从同一点发出、膝盖外鼓于"髋→踝连线"（膝内翻 = 罗圈腿），跑动时只甩小腿。

- **根因**：`render.js` 旧腿部代码 `moveTo(0, hipY)` 让两腿共用一个髋点（无骨盆）；膝盖横向偏移 `0.10` 大于髋→踝连线导致外鼓；跑动时膝盖钉死、仅脚部横向甩 ±0.34（髋宽 0.20 的 1.7 倍）。
- **修复**：把腿部几何抽成纯函数 `Renderer.legGeometry(side, phase, crouch, airborne, hipY)`，几何约束收归 `config.player.legs`：
  - 髋点分离（`hipHalfWidth: 0.085`）→ 有骨盆，两腿不再共点；
  - 膝盖略窄于髋（`kneeHalfWidth: 0.072`）→ 生理性轻微内收，膝盖不外鼓于髋→踝连线；
  - 摆动时膝盖按 `kneeSwingFollow: 0.42` 跟随，整条腿一起动；
  - 大腿粗 / 小腿细（`thighWidth 0.165` / `shinWidth 0.125`）形成收分，末端加脚掌（`footWidth` / `footHeight`）。
- **新增断言**：`integration-test.mjs` 第 9 节——膝盖横向位置不得外鼓于髋→踝连线（站立、跑动多相位、下蹲、腾空四种姿态均校验），以及大腿粗于小腿、髋点分离。总数 47 → 55。

## V2.2.1 已完成的待办（配置一致性）

审计发现 v2.2 只修了站姿骨骼高度，同类"配置写了但代码不用 / 代码写死"在别处仍存在：

- **`railHalfWidth` 接线**：`render.js` 画立柱时写死 `0.12`，改为读 `C.railHalfWidth`（该键此前是死配置）。
- **金币摆放几何收归 `config.coins`**：新增 `baseY` / `arcY` / `peakY` / `slideY` / `arcSpread` / `barSpread`，替换 `blocks.js` 里写死的 `1.05` / `1.45` / `1.62` / `2.2` / `1.6` / `0.55`（共 11 处）。
  - 注意：`1.05` 是**金币悬浮高度**、不是 `obstacle.bar.y0`；`2.2` 出现在 low 块、不是 `obstacle.bar.width`。二者只是数值巧合，故建独立键而非挂到障碍尺寸上。
- **道具悬浮高度**：`items.itemY: 1.15` 替换 `blocks.js` 写死的 `1.15`。
- **删除 `items.shieldDuration`**：护盾实现是一次性格挡布尔量（撞一次即消耗），没有时长语义，该键从未被引用。
- **提示文案改为推导**：`game.js` 里"换道 0.12 秒"→ `C.timing.laneSwitch`、"滑铲 0.55 秒"→ `C.player.slideDuration`、"滞空 0.69 秒"→ 由 `2*jumpImpulse/gravity` 推导。改配置后文案不再说谎。
- **新增断言**：`tools/integration-test.mjs` 第 8 节，11 项；其中含行为验证——临时改 `C.coins.baseY` 后生成的金币高度真的跟随，证明是"接线"而非数字巧合。

等价性证据：逻辑测试模拟总量与 v2.2.0 完全一致（20000 块地 / 55492 秒 / 8006 块每局）。

## V2.2.0 已完成的待办

- **暂停冻结**：`game.update` 仅在 `playing` 时推进粒子，`animTime` 在暂停时停摆 → 暂停时粒子与世界都不再动
- **帧率统计**：`sampleFps` 对 `dt<=0` 直接 return，不再把虚帧当 10000fps 计入均值
- **死配置清理**：删除 `items.dropWeight` / `world.poolBlocks` / `timing.restartAuto` / `coins.magnetPull` / `world.fogStart`（全仓仅 config 引用，确为死项）
- **站姿骨骼高度配置化**：`render.js` 的 0.72 / 1.34 / 1.56 / 0.48 改为读取 `config.player.standHipY` / `standShoulderY` / `standHeadY` / `standWidth`，跟随 config
- **死亡姿态**：`view.dead` 现在真正生效——角色死亡时整体绕脚部支点 `-1.45` 弧度向后倒地（"扑街"），不再直立
- **集成路径断言**：新增 `tools/integration-test.mjs`，覆盖 暂停/恢复/死亡/重开 全链路（36 项断言，含 dt=0 不污染、死配置删除、站姿高度、死亡旋转对照）

## 怎么验证（V2.2 新增）

```bash
node tools/integration-test.mjs     # 67 项断言：暂停/恢复/死亡/重开 集成路径 + V2.2~V2.2.4 修复点
node tools/logic-test.mjs           # 165 项断言（回归，无变化）
```

浏览器 `index.html?selftest=1` 仍跑 14 项运行时自检。

## 剩余提升空间（审计结论，按优先级）

- **P1 · 加 CI**：仓库无 `.github/`，232 项断言（集成 67 + 逻辑 165）目前纯手动跑。加 GitHub Actions 在 push/PR 自动跑，成本极低。
- **P1 · 自动化视觉回归**：历史上 z 轴渲染方向反了那个 bug，逻辑自检测不出、只有截图能发现；死亡姿态同样只验证了"变换被调用"，从未被真正看过。建议建 headless 截图基线做差异比对。
- **P2 · PRD 既定未做**：R-21 结算页分享图、R-22 每日固定种子挑战。
- **P3 · 移动端真机帧率实测**（README 已知限制，目前只做了 DPR 限制与低画质档）。
- **P3 · 模块化**：`js/game.js` 1104 行为最大文件，可按 输入 / 结算 / 遥测 拆分。

## 许可

MIT。美术与音频均为运行时程序化生成，无第三方素材，详见 `LICENSES.md`。