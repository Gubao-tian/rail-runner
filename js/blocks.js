/* =========================================================================
 * BlockGenerator —— 抽取 + 拼接 + 校验（PRD §9.2 / R-06 / R-07 / 附录 B）
 *
 * 纯数据层：不碰 DOM、不碰渲染、不做位移。
 * 输出 {index, startDist, endDist, type, safeLanes, obstacles[], coins[], item, meta}
 *
 * 硬约束（§0）：
 *   1. 任意地块不得三轨全封（最多 2 条轨道有障碍）
 *   2. 不得连续两块双轨障碍
 *   3. 新手保护区（前 3 块）：无双轨、每块 ≥2 条安全轨、第 1 块纯金币
 *   4. 道具只出现在安全轨道；双轨块不得与道具同块
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;
  var D = global.RR.Difficulty;

  var TYPES = ['empty', 'low', 'bar', 'double', 'coin', 'item'];

  function laneX(lane) {
    return (lane - 1) * C.laneWidth;
  }

  function makeObstacle(kind, lane, z) {
    var spec = C.obstacle[kind];
    var isLow = kind === 'low';
    return {
      kind: kind,
      lane: lane,
      x: laneX(lane),
      z: z,
      width: spec.width,
      depth: spec.depth,
      y0: isLow ? 0 : spec.y0,
      y1: isLow ? spec.height : spec.y1
    };
  }

  function pushCoin(block, lane, z, y) {
    block.coins.push({
      lane: lane,
      x: laneX(lane),
      dist: block.startDist + z,
      y: y == null ? C.coins.baseY : y,
      taken: false,
      phase: (block.index * 7 + block.coins.length * 3) % 6.283
    });
  }

  /** 依据距离 + 前一块 + 新手区，给出允许的类型权重。 */
  function allowedWeights(dist, prev, index) {
    var w = D.weights(dist);
    if (index < C.newbie.blocks) w.double = 0;
    if (prev) {
      if (prev.type === 'double') w.double = 0;  // 不得连续两块双轨
      if (prev.type === 'low') w.low = 0;        // 不得连续两块同类
      if (prev.type === 'bar') w.bar = 0;
    }
    var sum = 0;
    Object.keys(w).forEach(function (k) { sum += w[k]; });
    if (sum <= 0) { w = { empty: 1, low: 0, bar: 0, double: 0, coin: 0, item: 0 }; }
    return w;
  }

  function pickType(dist, rng, prev, index) {
    return rng.weighted(allowedWeights(dist, prev, index));
  }

  function otherTwo(safe) {
    var out = [];
    for (var i = 0; i < C.lanes; i++) if (i !== safe) out.push(i);
    return out;
  }

  function buildCoinBlock(block, rng) {
    var lane = 1;
    var n = Math.floor((C.blockLength - 6) / C.coins.spacing) + 1;
    for (var i = 0; i < n; i++) {
      pushCoin(block, lane, 4 + i * C.coins.spacing, C.coins.baseY);
    }
  }

  function buildLowBlock(block, rng) {
    var lane = rng.int(C.lanes);
    block.obstacles.push(makeObstacle('low', lane, C.blockLength * 0.5));
    block.safeLanes = [0, 1, 2].filter(function (l) { return l !== lane; });
    // 障碍上方 3 枚金币：跳对了顺手吃掉（风险-回报）
    pushCoin(block, lane, C.blockLength * 0.5 - C.coins.arcSpread, C.coins.arcY);
    pushCoin(block, lane, C.blockLength * 0.5, C.coins.peakY);
    pushCoin(block, lane, C.blockLength * 0.5 + C.coins.arcSpread, C.coins.arcY);
    // 旁边安全轨的直线金币（新手区保证至少 2 条安全轨）
    var safe = rng.pick(block.safeLanes);
    for (var i = 0; i < 3; i++) pushCoin(block, safe, C.blockLength * 0.62 + i * C.coins.spacing, C.coins.baseY);
    block.meta = { type: 'low', lane: lane, kind: 'low' };
  }

  function buildBarBlock(block, rng, prev) {
    var lane = rng.int(C.lanes);
    // 附录 B：横杆不得与上一块的低障碍同轨
    if (prev && prev.type === 'low' && prev.lane === lane) {
      lane = (lane + 1 + rng.int(C.lanes - 1)) % C.lanes;
    }
    block.obstacles.push(makeObstacle('bar', lane, C.blockLength * 0.5));
    block.safeLanes = [0, 1, 2].filter(function (l) { return l !== lane; });
    // 横杆下方金币：滑铲吃到
    pushCoin(block, lane, C.blockLength * 0.5 - C.coins.barSpread, C.coins.slideY);
    pushCoin(block, lane, C.blockLength * 0.5 + C.coins.barSpread, C.coins.slideY);
    var safe = rng.pick(block.safeLanes);
    for (var i = 0; i < 3; i++) pushCoin(block, safe, C.blockLength * 0.62 + i * C.coins.spacing, C.coins.baseY);
    block.meta = { type: 'bar', lane: lane, kind: 'bar' };
  }

  function buildDoubleBlock(block, rng) {
    var kind = rng.chance(0.5) ? 'low' : 'bar';
    var safe = rng.int(C.lanes);
    var blocked = otherTwo(safe);
    var z = C.blockLength * 0.5;
    blocked.forEach(function (lane) {
      block.obstacles.push(makeObstacle(kind, lane, z));
    });
    block.safeLanes = [safe];
    // 安全轨金币 + 顶部提示金币
    for (var i = 0; i < 4; i++) pushCoin(block, safe, 8 + i * C.coins.spacing, C.coins.baseY);
    block.meta = { type: 'double', lane: safe, kind: kind };
  }

  function buildEmptyBlock(block, rng) {
    block.safeLanes = [0, 1, 2];
    if (rng.chance(0.5)) {
      var lane = rng.int(C.lanes);
      var n = 4;
      for (var i = 0; i < n; i++) pushCoin(block, lane, 6 + i * C.coins.spacing, C.coins.baseY);
    }
    block.meta = { type: 'empty', lane: -1, kind: 'none' };
  }

  function buildItemBlock(block, rng) {
    block.safeLanes = [0, 1, 2];
    var lane = rng.int(C.lanes);
    block.item = {
      lane: lane,
      x: laneX(lane),
      dist: block.startDist + C.blockLength * 0.72,
      y: C.items.itemY,
      taken: false,
      // 拾取前就能看见是什么道具（护盾 / 磁铁 / 双倍）
      kind: rng.weighted({ shield: 0.4, magnet: 0.3, double: 0.3 })
    };
    var coinLane = (lane + 1) % C.lanes;
    for (var i = 0; i < 3; i++) pushCoin(block, coinLane, 8 + i * C.coins.spacing, C.coins.baseY);
    block.meta = { type: 'item', lane: lane, kind: 'none' };
  }

  /**
   * 生成一块地。
   * @param {{index:number,startDist:number,rng:RR.RNG,prev:object|null}} opts
   */
  function generate(opts) {
    var index = opts.index;
    var startDist = opts.startDist;
    var rng = opts.rng;
    var prev = opts.prev || null;

    var block = {
      index: index,
      startDist: startDist,
      endDist: startDist + C.blockLength,
      type: 'empty',
      safeLanes: [0, 1, 2],
      obstacles: [],
      coins: [],
      item: null,
      meta: { type: 'empty', lane: -1, kind: 'none' }
    };

    var type;
    if (index === 0) type = 'coin';           // §5.4 第 1 块纯金币
    else if (index === 1) type = 'low';       // §5.4 第 2 块教跳
    else if (index === 2) type = 'bar';       // §5.4 第 3 块教滑
    else type = pickType(startDist, rng, prev, index);

    block.type = type;

    if (type === 'coin') buildCoinBlock(block, rng);
    else if (type === 'low') buildLowBlock(block, rng);
    else if (type === 'bar') buildBarBlock(block, rng, prev);
    else if (type === 'double') buildDoubleBlock(block, rng);
    else if (type === 'item') buildItemBlock(block, rng);
    else buildEmptyBlock(block, rng);

    block.safeLanes = block.safeLanes.slice().sort(function (a, b) { return a - b; });
    // 统一 meta：下一块地的约束只关心 类型 / 障碍轨道 / 障碍种类
    block.meta = {
      type: type,
      lane: block.obstacles.length ? block.obstacles[0].lane : (block.item ? block.item.lane : -1),
      kind: block.obstacles.length ? block.obstacles[0].kind : 'none'
    };
    return block;
  }

  /** 校验一块地，返回违规描述数组（空数组 = 合法）。用于运行时断言与离线测试。 */
  function validate(block) {
    var problems = [];
    var blocked = {};
    block.obstacles.forEach(function (o) {
      blocked[o.lane] = true;
      if (o.z - o.depth / 2 < 0 || o.z + o.depth / 2 > C.blockLength) {
        problems.push('obstacle-out-of-bounds:' + o.z);
      }
    });
    var blockedCount = Object.keys(blocked).length;
    if (blockedCount >= C.lanes) problems.push('all-lanes-blocked');

    if (block.type === 'double' && blockedCount !== 2) problems.push('double-needs-2-blocked');
    if (block.type !== 'double' && blockedCount > 1) problems.push('too-many-blocked');

    if (block.index < C.newbie.blocks) {
      if (block.type === 'double') problems.push('newbie-double');
      if (block.safeLanes.length < C.newbie.minSafeLanes) problems.push('newbie-safe-lanes');
      if (block.index === 0 && (block.obstacles.length !== 0 || block.coins.length === 0)) {
        problems.push('newbie-first-block-coins');
      }
    }

    if (block.item && block.safeLanes.indexOf(block.item.lane) < 0) problems.push('item-not-safe');
    if (block.item && blockedCount > 0) problems.push('item-with-obstacle');

    return problems;
  }

  global.RR.Blocks = {
    TYPES: TYPES,
    generate: generate,
    validate: validate,
    allowedWeights: allowedWeights,
    laneX: laneX,
    makeObstacle: makeObstacle
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
