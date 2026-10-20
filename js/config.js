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
    version: '2.0.1',

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
      empty: [0.45, 0.08],
      low: [0.25, 0.22],
      bar: [0.22, 0.20],
      coin: [0.05, 0.12],
      item: [0.03, 0.08]
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
      restartAuto: 3.0,    // 结算页 3 秒后自动可重开
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
      crouchWidth: 0.58      // 蹲姿躯干宽度（米，站姿 0.48）
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
      magnetPull: 26.0
    },

    /* ---------------- 道具（R-10 主动使用） ---------------- */
    items: {
      slots: 3,
      shieldDuration: 12.0,
      magnetDuration: 8.0,
      doubleDuration: 8.0,
      dropWeight: 0.12
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
      despawnBehind: 40,
      poolBlocks: 8,       // R-06 预实例化 5 块，这里取 8 留余量
      fogStart: 95
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
