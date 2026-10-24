/* =========================================================================
 * 轨道无限跑酷 · GameConfig
 * PRD: 轨道无限跑酷-PRD-V2.0.md
 *
 * 硬约束（§0 读取说明 / §9.4）：所有手感数值必须集中在本文件。
 * 改数值不改代码；任何模块不得内置魔法数字。
 * ========================================================================= */
(function (global) {
  'use strict';

  var CONFIG = {
    version: '2.2.7',

    /* ---------------- 轨道与地块 ---------------- */
    lanes: 3,              // 三轨，禁止 1<->3 直跳
    laneWidth: 2.4,        // 单轨宽度（米）
    blockLength: 30,       // 地块长度统一（米）；前 3 块 = 0~90m
    trackHalfWidth: 3.6,   // 轨道外沿
    railHalfWidth: 0.12,

    /* ---------------- 速度曲线（§5.3 唯一权威） ---------------- */
    speed: {
      v0: 12.0,            // 起始速度 m/s
      vMax: 26.0,          // 渐近上限（非硬阈值）
      lambda: 600          // 距离衰减常数（米）
    },

    /* ---------------- 地块权重（附录 B 端点 + §5.3 双轨锚点） ---------------- */
    weightRamp: 1500,      // 权重线性插值终点
    weightEnd: {           // [0m, 1500m]
      empty: [0.40, 0.05],   // 从 empty 匀出给 item（道具掉率太低的反馈），其余类型绝对值不变
      low: [0.25, 0.21],
      bar: [0.22, 0.19],
      coin: [0.05, 0.12],
      item: [0.08, 0.13]
    },
    // §5.3 表格：双轨障碍权重不是简单线性，按表锚点分段线性
    doubleCurve: [
      [0, 0.00],
      [100, 0.00],
      [250, 0.06],
      [500, 0.14],
      [750, 0.20],
      [1000, 0.24],
      [1500, 0.30]
    ],
    doubleCap: 0.30,       // 双轨权重封顶

    /* ---------------- 时间参数 ---------------- */
    timing: {
      laneSwitch: 0.120,   // 换道插值 120ms
      hitStun: 0.300,      // 受击硬直
      judgeWindow: 0.120,  // 跳跃/滑铲判定窗口 ±120ms
      newbieJudgeScale: 1.5, // 新手保护区判定窗口放宽 1.5 倍
      prepare: 1.0,        // 准备阶段倒数（≤1s）
      deathSlowMo: 0.35,   // 死亡慢动作持续（真实时间）
      deathTimeScale: 0.25,// 死亡慢动作倍率
      deathFreeze: 0.55,   // 撞击后到结算面板出现的延迟
      highlight: 1.5,      // 撞击点高亮
      comboWindow: 2.0     // 连击窗口
    },

    /* ---------------- 角色 ---------------- */
    player: {
      jumpImpulse: 7.2,    // 起跳初速 m/s -> 顶点 1.23m，滞空 0.686s
      gravity: 21.0,
      slideDuration: 0.55,
      height: 1.70,        // 站立碰撞高
      slideHeight: 0.80,   // 滑铲碰撞高
      halfWidth: 0.45,
      halfDepth: 0.50,
      slideHalfDepth: 0.95, // 滑铲碰撞体更长（R-04 两套碰撞体）

      // 下蹲动作过渡（"柔和度"全在这里调）
      crouchIn: 0.09,      // 0 -> 完全是蹲姿所需时间（快，保证判定跟得上）
      crouchOut: 0.22,     // 起身回到站姿所需时间（慢，消除"弹起来"的突兀）
      crouchThreshold: 0.25, // 低于此值碰撞体回到站立；高于则仍算蹲着

      // 蹲姿形状：只降重心 + 屈膝，身体保持直立（不整体前倾）
      crouchHipY: 0.34,      // 蹲姿髋部高度（米，站姿 0.72）
      crouchShoulderY: 0.68, // 蹲姿肩部高度（米，站姿 1.34）
      crouchHeadY: 0.82,     // 蹲姿头部中心高度（米，站姿 1.56）
      crouchWidth: 0.58,     // 蹲姿躯干宽度（米，站姿 0.48）

      // 站姿骨架高度（米）：下蹲时按 crouch 权重过渡到上面的 crouch* 系列
      standHipY: 0.72,
      standShoulderY: 1.34,
      standHeadY: 1.56,
      standWidth: 0.48,

      /* ---------------- 腿部骨架（米） ----------------
       * 髋 → 膝 → 踝 两段链。关键约束：
       *   1) hipHalfWidth > 0 —— 有骨盆，两腿不从同一点发出；
       *   2) kneeHalfWidth 略窄于 hipHalfWidth —— 生理性轻微内收，
       *      膝盖不得外鼓于"髋→踝连线"，否则就是罗圈腿（膝内翻）；
       *   3) kneeSwingFollow > 0 —— 摆动时膝盖跟随，不再只甩小腿。
       */
      legs: {
        hipHalfWidth: 0.085,      // 髋关节半宽（骨盆）
        kneeHalfWidth: 0.072,     // 膝盖横向位置（略窄于髋 = 正常腿）
        ankleHalfWidth: 0.078,    // 踝关节横向位置
        ankleY: 0.03,             // 踝关节离地高度
        kneeHeightRatio: 0.42,    // 膝在 髋→踝 连线上的下落占比

        thighWidth: 0.165,        // 大腿描边宽（比小腿粗，形成收分）
        shinWidth: 0.125,         // 小腿描边宽

        runSwingX: 0.15,          // 跑动横向摆幅（原 0.34 过大，导致外张成 O 形）
        runSwingLift: 0.13,       // 跑动抬脚高度
        kneeSwingFollow: 0.42,    // 膝盖跟随摆动的比例

        crouchKneeOut: 0.05,      // 下蹲时膝盖外展（深蹲本就略开，原 0.16 过大）

        airSwingA: 0.17,          // 腾空时两腿姿态
        airSwingB: -0.11,
        airLiftA: 0.10,
        airLiftB: 0.17,

        footWidth: 0.12,          // 脚掌（从后方看到的宽度）
        footHeight: 0.055,
        footDrop: 0.03            // 脚掌相对踝关节下沉量
      },

      /* ---------------- 跑动姿态（让角色"活"起来，非刚性小人） ----------------
       * 这些都是"跑动感"的幅度参数，统一收归 config，可微调。
       * 幅度越大越夸张、越小越拘谨。默认值偏写实但保留卡通弹性。
       */
      run: {
        lean: 0.10,               // 躯干前倾（弧度，速度越快前倾越多）
        bounceAmp: 0.035,         // 重心上下起伏幅度（米，步频弹跳）
        headBobAmp: 0.018,        // 头部随重心起伏幅度（米，略滞后于身体）
        armSwingAmp: 0.85,        // 手臂摆动幅度（弧度，越大甩得越开）
        armBend: 0.35,            // 肘关节弯曲量（0=僵直直臂，>0 才有肘）
        armPhaseOffset: 0.5,      // 手臂与腿的相位差（对侧摆臂，≈0.5 个周期）
        shadowScale: 0.35,        // 阴影随腾空高度收缩的比例
        shadowLiftFade: 0.35      // 腾空越高阴影越淡（0~1）
      },

      /* ---------------- 跳跃姿态（起跳→滞空→落地三阶段） ----------------
       * 用 player.vy（竖直速度）驱动：上升期团身、顶点伸展、下降期准备落地、
       * 落地瞬间屈膝缓冲。值越大越夸张。
       */
      jump: {
        tuckKneeLift: 0.22,       // 起跳团身：膝盖/脚上收幅度（米）
        tuckArmSwing: 0.9,        // 起跳时手臂上摆（弧度，蓄力）
        stretchKneeDrop: 0.05,    // 顶点伸展：腿自然下垂略收
        landCrouch: 0.45          // 落地瞬间的屈膝缓冲权重（0~1）
      },

      /* ---------------- 滑铲姿态 ----------------
       * 身体后仰 + 双腿前伸 + 手臂向后撑地。slideT 进度驱动。
       */
      slide: {
        leanBack: 0.16,           // 身体后仰（肩/头向后退的量，米）
        legForward: 0.20,         // 双腿前伸（踝向前移，米）
        legLift: 0.16,            // 前伸腿抬高（米）
        armBack: 0.35             // 手臂向后摆撑地（米）
      }
    },

    /* ---------------- 障碍尺寸（形状区分，色盲友好） ---------------- */
    obstacle: {
      low: { height: 1.00, width: 2.00, depth: 1.20 },  // 三角：必须跳
      bar: { y0: 1.05, y1: 1.78, width: 2.20, depth: 0.60 } // 横杆：必须滑
    },

    /* ---------------- 输入 ---------------- */
    input: {
      debounce: 0.06,      // 同类指令冷却 60ms
      swipeMin: 26,        // 最小滑动距离（px）
      swipeMaxTime: 500,   // 滑动判定时间（ms）
      swipeAxisRatio: 1.2  // 主轴判定比
    },

    /* ---------------- 新手保护区（§5.4） ---------------- */
    newbie: {
      blocks: 3,           // 前 3 块
      minSafeLanes: 2
    },

    /* ---------------- 金币与连击 ---------------- */
    coins: {
      spacing: 3.6,
      value: 10,
      chainStep: 8,        // 每 8 连击 +1 倍率
      chainMax: 4,         // 倍率上限 5x (1+4)
      magnetRadius: 7.0,

      // 摆放几何（原写死在 blocks.js，现收归配置）
      baseY: 1.05,         // 默认金币悬浮高度
      arcY: 1.45,          // 低障碍上方金币弧线两端高度
      peakY: 1.62,         // 低障碍上方金币弧线顶点
      slideY: 0.55,        // 横杆下方金币高度（滑铲时吃到）
      arcSpread: 2.2,      // 低障碍上方金币前后铺开（米）
      barSpread: 1.6       // 横杆下方金币前后铺开（米）
    },

    /* ---------------- 道具（R-10 主动使用） ---------------- */
    items: {
      slots: 3,
      itemY: 1.15,          // 道具悬浮高度
      // 护盾是一次性格挡（撞一次即消耗），没有持续时间，故无 shieldDuration
      magnetDuration: 8.0,
      doubleDuration: 8.0,
      pityBlocks: 10        // 保底：连续 10 块地（300 米）没出道具则强制出一块
    },

    /* ---------------- 相机 ---------------- */
    camera: {
      height: 3.0,
      distance: 8.0,
      laneFollow: 0.35,    // 相机横向跟随比例
      focal: 0.78,         // 焦距 = 画布高 * focal
      zoomBySpeed: 0.05,   // 冲刺拉近（P1）
      shakeOnHit: 0.5
    },

    /* ---------------- 世界流 ---------------- */
    world: {
      viewDistance: 135,   // 逻辑保留距离
      despawnBehind: 40
    },

    /* ---------------- 计分 ---------------- */
    score: {
      distancePoints: 1,
      coinBase: 10
    },

    /* ---------------- 离线校验用玩家模型（PRD §9.3） ---------------- */
    analysis: {
      vision: 40,          // 完美玩家前方视野（米）
      reaction: 0.250,     // 反应时间（秒）
      batchBlocks: 100000  // 批量校验默认生成地块数
    },

    /* ---------------- 皮肤（按里程里程碑解锁） ---------------- */
    skins: [
      { id: 'classic', name: '原色', color: '#5ad1ff', accent: '#ffffff', unlockDistance: 0 },
      { id: 'ember', name: '余烬', color: '#ff8a3d', accent: '#ffe3c4', unlockDistance: 250 },
      { id: 'jade', name: '青玉', color: '#5ce1a6', accent: '#d9fff0', unlockDistance: 800 },
      { id: 'violet', name: '夜幕', color: '#b78cff', accent: '#f0e6ff', unlockDistance: 1500 }
    ],

    /* ---------------- 存档 ---------------- */
    save: {
      key: 'railrunner.save.v2',
      tmpKey: 'railrunner.save.v2.tmp',
      bakKey: 'railrunner.save.v2.bak',
      schemaVersion: 2
    },

    /* ---------------- 渲染 ---------------- */
    render: {
      quality: 'high',      // high | low
      maxDpr: 2,
      particles: 90
    }
  };

  global.RR = global.RR || {};
  global.RR.CONFIG = CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
