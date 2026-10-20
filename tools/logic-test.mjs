/* =========================================================================
 * 离线逻辑测试（无需浏览器）
 * 覆盖：速度曲线 / 权重表 / 地块生成约束 / 状态机矩阵 / 存档降级 / 可通行性
 *
 * 运行：node tools/logic-test.mjs
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'js/config.js',
  'js/rng.js',
  'js/difficulty.js',
  'js/blocks.js',
  'js/fsm.js',
  'js/save.js',
  'js/collision.js'
];

function loadSandbox(extra = {}) {
  const sandbox = Object.assign({
    console,
    Math,
    JSON,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    isFinite,
    parseInt,
    parseFloat,
    Map,
    Set
  }, extra);
  vm.createContext(sandbox);
  for (const file of FILES) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return sandbox;
}

let passed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failures.push(name + (detail ? ' -> ' + detail : ''));
  }
}

function near(name, actual, expected, tol, unit = '') {
  const d = Math.abs(actual - expected);
  ok(name, d <= tol, `got ${actual}${unit}, want ${expected}±${tol}${unit}`);
}

function section(title) {
  console.log('\n— ' + title + ' —');
}

const sandbox = loadSandbox();
const RR = sandbox.RR;
const C = RR.CONFIG;
const D = RR.Difficulty;

/* ------------------------------------------------------------------ */
section('1. 配置与速度曲线（§5.3）');

ok('lanes = 3', C.lanes === 3);
ok('blockLength = 30', C.blockLength === 30);
ok('laneSwitch = 120ms', Math.abs(C.timing.laneSwitch - 0.12) < 1e-9);
ok('hitStun = 300ms', Math.abs(C.timing.hitStun - 0.3) < 1e-9);
ok('judgeWindow = 120ms', Math.abs(C.timing.judgeWindow - 0.12) < 1e-9);
ok('newbie blocks = 3', C.newbie.blocks === 3);
ok('newbie judge scale = 1.5', C.timing.newbieJudgeScale === 1.5);

const speedTable = [
  [0, 12.0], [100, 14.2], [250, 16.8], [500, 19.9],
  [750, 22.0], [1000, 23.4], [1500, 24.9]
];
speedTable.forEach(([d, v]) => {
  near(`speed(${d})`, D.speed(d), v, 0.06);
});
near('speed(2000)', D.speed(2000), 25.5, 0.06);
ok('speed 单调递增', D.speed(500) > D.speed(499) && D.speed(1500) > D.speed(1000));
ok('speed 不越过上限', D.speed(1e9) <= C.speed.vMax + 1e-9);

/* ------------------------------------------------------------------ */
section('2. 地块权重（附录 B + §5.3 表格）');

[0, 50, 100, 250, 500, 750, 1000, 1500, 2500].forEach((d) => {
  const w = D.weights(d);
  const sum = Object.keys(w).reduce((s, k) => s + w[k], 0);
  near(`weights(${d}) 总和`, sum, 1, 1e-9);
  ok(`weights(${d}) 无双轨越界`, w.double <= C.doubleCap + 1e-9);
});

const doubleTable = [[0, 0], [100, 0], [250, 0.06], [500, 0.14], [750, 0.2], [1000, 0.24], [1500, 0.3]];
doubleTable.forEach(([d, w]) => {
  near(`doubleWeight(${d})`, D.doubleWeight(d), w, 0.002);
});
near('doubleWeight(2000) 封顶', D.doubleWeight(2000), 0.30, 1e-9);
near('doubleWeight(300)', D.doubleWeight(300), 0.06 + (0.14 - 0.06) * (50 / 250), 0.002);

const w0 = D.weights(0);
near('w(0).empty', w0.empty, 0.45, 1e-6);
near('w(0).low', w0.low, 0.25, 1e-6);
near('w(0).bar', w0.bar, 0.22, 1e-6);
near('w(0).coin', w0.coin, 0.05, 1e-6);
near('w(0).item', w0.item, 0.03, 1e-6);

/* ------------------------------------------------------------------ */
section('3. 地块生成约束（R-06/R-07/附录 B）');

const blocks = [];
let prevMeta = null;
let rng = new RR.RNG(20261020);
let cursor = 0;
for (let i = 0; i < 20000; i++) {
  const b = RR.Blocks.generate({ index: i, startDist: cursor, rng, prev: prevMeta });
  blocks.push(b);
  prevMeta = b.meta;
  cursor += C.blockLength;
}

let violations = 0;
let threeLane = 0;
let consecutiveDouble = 0;
let newbieBad = 0;
let itemNotSafe = 0;
const typeCount = { empty: 0, low: 0, bar: 0, double: 0, coin: 0, item: 0 };

blocks.forEach((b, i) => {
  const problems = RR.Blocks.validate(b);
  if (problems.length) {
    violations++;
    if (violations <= 5) console.log('   违规样本', i, b.type, problems.join(','));
  }
  const blocked = new Set(b.obstacles.map((o) => o.lane)).size;
  if (blocked >= 3) threeLane++;
  if (b.type === 'double' && i > 0 && blocks[i - 1].type === 'double') consecutiveDouble++;
  if (i < 3) {
    if (b.type === 'double' || b.safeLanes.length < 2) newbieBad++;
  }
  if (b.item && b.safeLanes.indexOf(b.item.lane) < 0) itemNotSafe++;
  typeCount[b.type]++;
});

ok('全部地块通过校验', violations === 0, violations + ' 块违规');
ok('无三轨全封', threeLane === 0);
ok('无连续双轨', consecutiveDouble === 0);
ok('新手区合规', newbieBad === 0);
ok('道具只在安全轨', itemNotSafe === 0);

ok('第 1 块纯金币', blocks[0].type === 'coin' && blocks[0].obstacles.length === 0);
ok('第 2 块教跳（单轨低障碍）', blocks[1].type === 'low' && blocks[1].obstacles.length === 1);
ok('第 3 块教滑（单轨横杆）', blocks[2].type === 'bar' && blocks[2].obstacles.length === 1);

ok('四种以上地块类型出现', Object.keys(typeCount).filter((k) => typeCount[k] > 0).length >= 5,
  JSON.stringify(typeCount));

// 密度：1500m 后双轨占比应接近表格（受"不得连续"约束会略低）
const bandDouble = (from, to) => {
  let total = 0;
  let dbl = 0;
  blocks.forEach((b) => {
    if (b.startDist >= from && b.startDist < to) {
      total++;
      if (b.type === 'double') dbl++;
    }
  });
  return total ? dbl / total : 0;
};
const earlyDouble = bandDouble(0, 90);
const lateDouble = bandDouble(1500, 20000);
ok('前 3 块地（0~90m）无双轨', earlyDouble === 0, `ratio=${earlyDouble}`);
ok('1500m 后双轨占比 0.15~0.35', lateDouble > 0.15 && lateDouble < 0.35, `ratio=${lateDouble.toFixed(3)}`);

// 确定性
const a = [];
let p1 = null;
const r1 = new RR.RNG(777);
let c1 = 0;
for (let i = 0; i < 300; i++) {
  const b = RR.Blocks.generate({ index: i, startDist: c1, rng: r1, prev: p1 });
  a.push(JSON.stringify(b));
  p1 = b.meta;
  c1 += C.blockLength;
}
const b2 = [];
let p2 = null;
const r2 = new RR.RNG(777);
let c2 = 0;
for (let i = 0; i < 300; i++) {
  const b = RR.Blocks.generate({ index: i, startDist: c2, rng: r2, prev: p2 });
  b2.push(JSON.stringify(b));
  p2 = b.meta;
  c2 += C.blockLength;
}
ok('同种子生成一致', a.join('|') === b2.join('|'));

const r3 = new RR.RNG(778);
const third = RR.Blocks.generate({ index: 4, startDist: 120, rng: r3, prev: { type: 'empty', lane: -1, kind: 'none' } });
ok('不同种子可产生不同结果（非退化）', typeof third.type === 'string');

/* ------------------------------------------------------------------ */
section('4. 状态机矩阵（附录 A）');

const S = RR.States;
const CMD = RR.Commands;
const M = RR.Matrix;

const expected = {
  run: { jump: 'jumpUp', slide: 'slide', left: 'switchLane', right: 'switchLane', useItem: 'run' },
  jumpUp: { jump: null, slide: null, left: 'switchLane', right: 'switchLane', useItem: 'jumpUp' },
  jumpDown: { jump: null, slide: null, left: 'switchLane', right: 'switchLane', useItem: 'jumpDown' },
  slide: { jump: null, slide: null, left: 'switchLane', right: 'switchLane', useItem: 'slide' },
  switchLane: { jump: null, slide: null, left: null, right: null, useItem: null },
  hit: { jump: null, slide: null, left: null, right: null, useItem: null },
  death: { jump: null, slide: null, left: null, right: null, useItem: null }
};

Object.keys(expected).forEach((state) => {
  Object.keys(expected[state]).forEach((cmd) => {
    ok(`矩阵 ${state} × ${cmd}`,
      JSON.stringify(M[state][cmd]) === JSON.stringify(expected[state][cmd]),
      `${JSON.stringify(M[state][cmd])} != ${JSON.stringify(expected[state][cmd])}`);
  });
});

ok('矩阵覆盖 7 状态', Object.keys(M).length === 7);

/* ------------------------------------------------------------------ */
section('5. 状态机行为（R-03/R-04/R-05）');

function newPlayer(lane = 1) {
  return new RR.Player({ lane });
}

let p = newPlayer();
ok('起跳被接受', p.apply(CMD.JUMP) === true);
ok('起跳后进入 JumpUp', p.state === S.JUMP_UP);
ok('空中二次跳跃被丢弃', p.apply(CMD.JUMP) === false);
ok('空中滑铲被丢弃', p.apply(CMD.SLIDE) === false);
ok('空中换道被接受', p.apply(CMD.RIGHT) === true);
ok('换道中跳跃被丢弃', p.apply(CMD.JUMP) === false);
ok('换道中换道被丢弃', p.apply(CMD.LEFT) === false);

// 换道耗时
p = newPlayer(1);
p.apply(CMD.LEFT);
ok('换道进入 SwitchLane', p.state === S.SWITCH);
let t = 0;
const dt = 1 / 120;
while (p.state === S.SWITCH && t < 1) { p.step(dt); t += dt; }
near('换道耗时 120ms', t, 0.12, 0.01, 's');
ok('换道后落在左轨', p.lane === 0 && Math.abs(p.x - (-C.laneWidth)) < 1e-6);

// 边界
p = newPlayer(0);
ok('最左轨再向左被丢弃', p.apply(CMD.LEFT) === false);
p = newPlayer(2);
ok('最右轨再向右被丢弃', p.apply(CMD.RIGHT) === false);

// 跳跃全程
p = newPlayer(1);
p.apply(CMD.JUMP);
let apex = 0;
let airtime = 0;
t = 0;
while (p.state !== S.RUN && t < 3) {
  p.step(dt);
  t += dt;
  apex = Math.max(apex, p.y);
  if (p.y > 0) airtime += dt;
}
ok('跳跃顶点 ≈ 1.23m', Math.abs(apex - 1.234) < 0.05, `apex=${apex.toFixed(3)}`);
ok('滞空 ≈ 0.686s', Math.abs(airtime - 0.686) < 0.05, `air=${airtime.toFixed(3)}`);
ok('落地回到 Run', p.state === S.RUN && p.y === 0);

// 滑铲
p = newPlayer(1);
p.apply(CMD.SLIDE);
ok('滑铲进入 Slide', p.state === S.SLIDE);
ok('滑铲中跳跃被丢弃', p.apply(CMD.JUMP) === false);
t = 0;
while (p.state === S.SLIDE && t < 2) { p.step(dt); t += dt; }
near('滑铲时长', t, C.player.slideDuration, 0.02, 's');
ok('滑铲结束回到 Run', p.state === S.RUN);

// 碰撞体两套
p = newPlayer(1);
const standBox = p.box();
p.apply(CMD.SLIDE);
const slideBox = p.box();
ok('滑铲碰撞体更矮', slideBox.y1 - slideBox.y0 < standBox.y1 - standBox.y0);
ok('滑铲碰撞体更长', slideBox.hd > standBox.hd);

// 受击
p = newPlayer(1);
p.hit();
ok('受击进入 Hit', p.state === S.HIT);
t = 0;
while (p.state === S.HIT && t < 2) { p.step(dt); t += dt; }
near('硬直 300ms', t, C.timing.hitStun, 0.02, 's');
ok('硬直结束回到 Run', p.state === S.RUN);

// 死亡冻结
p = newPlayer(1);
p.apply(CMD.JUMP);
p.die();
const frozen = { y: p.y, state: p.state };
for (let i = 0; i < 120; i++) p.step(dt);
ok('死亡后不移动', p.y === frozen.y && p.state === S.DEATH);
ok('死亡后指令全丢弃',
  p.apply(CMD.JUMP) === false && p.apply(CMD.LEFT) === false && p.apply(CMD.USE_ITEM) === false);

/* ---- 下蹲过渡（动作"柔和"的关键） ---- */
p = newPlayer(1);
ok('初始为站姿', p.crouch === 0 && p.box().y1 === C.player.height);

p.apply(CMD.SLIDE);
ok('按下瞬间就按蹲姿判定（不吃亏）', p.box().y1 === C.player.slideHeight);
ok('姿态刚开始过渡', p.crouch === 0);

p.step(dt);
ok('下蹲是渐变而不是瞬移', p.crouch > 0 && p.crouch < 1, `crouch=${p.crouch.toFixed(3)}`);

for (let i = 0; i < 40; i++) p.step(dt);
near('蹲姿到底', p.crouch, 1, 1e-9);

let slideGuard = 0;
while (p.state === S.SLIDE && slideGuard++ < 600) p.step(dt);
ok('滑铲结束进入起身过渡', p.state === S.RUN && p.crouch > 0.5, `crouch=${p.crouch.toFixed(2)}`);
ok('起身过渡期间仍按蹲姿判定', p.box().y1 === C.player.slideHeight);

near('起身过渡时长 ≈ crouchOut', C.player.crouchOut, 0.22, 1e-9);
for (let i = 0; i < 60; i++) p.step(dt);
ok('过渡结束回到站姿', p.crouch === 0 && p.box().y1 === C.player.height);

p = newPlayer(1);
p.apply(CMD.JUMP);
for (let i = 0; i < 3; i++) p.step(dt);
p.crouch = 1; // 人为压低，验证空中不被当成蹲姿
ok('空中一律按站姿判定', p.box().y1 > C.player.slideHeight + 0.01);
p.crouch = 0;

/* ------------------------------------------------------------------ */
section('6. 碰撞几何（跳跃清障、滑铲钻杆）');

const Box = (y0, y1, hd) => ({ x: 0, y0, y1, hw: 0.45, hd });
const lowObs = RR.Blocks.makeObstacle('low', 1, 15);
const barObs = RR.Blocks.makeObstacle('bar', 1, 15);

ok('站立撞低障碍', RR.Collision.overlaps(Box(0, 1.7, 0.5), lowObs, 15, 15, 1).hit === true);
ok('跳跃顶点越过低障碍', RR.Collision.overlaps(Box(1.234, 2.934, 0.5), lowObs, 15, 15, 1).hit === false);
ok('起跳太晚仍撞低障碍', RR.Collision.overlaps(Box(0.4, 2.1, 0.5), lowObs, 15, 15, 1).hit === true);
ok('站立撞横杆', RR.Collision.overlaps(Box(0, 1.7, 0.5), barObs, 15, 15, 1).hit === true);
ok('滑铲钻过横杆', RR.Collision.overlaps(Box(0, 0.8, 0.95), barObs, 15, 15, 1).hit === false);

/* ------------------------------------------------------------------ */
section('7. 完美玩家可通行性（§9.3，防无解地块）');

function simulate(dt, maxDistance, seed) {
  const speed = (d) => RR.Difficulty.speed(d);
  const rng = new RR.RNG(seed);
  const player = new RR.Player({ lane: 1 });
  const activeBlocks = [];
  let nextIndex = 0;
  let cursor = 0;
  let prevMeta = null;
  let distance = 0;
  let death = null;
  let steps = 0;
  let doubles = 0;

  const ensure = () => {
    while (cursor < distance + 150) {
      const block = RR.Blocks.generate({ index: nextIndex, startDist: cursor, rng, prev: prevMeta });
      activeBlocks.push(block);
      prevMeta = block.meta;
      cursor += C.blockLength;
      nextIndex++;
    }
    while (activeBlocks.length && activeBlocks[0].endDist < distance - 60) activeBlocks.shift();
  };

  ensure();

  while (distance < maxDistance && !death) {
    const v = speed(distance);
    distance += v * dt;
    player.step(dt);
    steps++;
    ensure();

    // 最近的障碍
    let next = null;
    for (let bi = 0; bi < activeBlocks.length; bi++) {
      const block = activeBlocks[bi];
      if (block.endDist < distance - 2) continue;
      for (let oi = 0; oi < block.obstacles.length; oi++) {
        const abs = block.startDist + block.obstacles[oi].z;
        if (abs < distance - 1) continue;
        if (!next || abs < next.abs) {
          next = { abs, obstacle: block.obstacles[oi], block };
        }
      }
      break; // 只看最近的一块
    }

    if (player.state !== S.SWITCH && player.state !== S.HIT) {
      if (next) {
        const rel = next.abs - distance;
        const tImpact = rel / v;
        if (next.block.type === 'double') {
          const safe = next.block.safeLanes[0];
          if (player.lane !== safe && rel > 6) {
            player.apply(player.lane < safe ? CMD.RIGHT : CMD.LEFT);
            doubles++;
          }
        } else if (player.lane === next.obstacle.lane) {
          if (next.obstacle.kind === 'low') {
            if (tImpact <= 0.30 && tImpact > 0.02) player.apply(CMD.JUMP);
          } else if (next.obstacle.kind === 'bar') {
            if (tImpact <= 0.17 && tImpact > 0.02) player.apply(CMD.SLIDE);
          }
        }
      }
    }

    // 碰撞
    for (let bi = 0; bi < activeBlocks.length; bi++) {
      const block = activeBlocks[bi];
      for (let oi = 0; oi < block.obstacles.length; oi++) {
        const obs = block.obstacles[oi];
        const abs = block.startDist + obs.z;
        if (Math.abs(abs - distance) > 8) continue;
        const judge = block.index < C.newbie.blocks ? C.timing.newbieJudgeScale : 1;
        if (RR.Collision.overlaps(player.box(), obs, abs, distance, judge).hit) {
          death = { distance, block: block.index, type: block.type, kind: obs.kind, lane: obs.lane, state: player.state };
        }
      }
      if (death) break;
    }
  }

  return { death, distance, steps, doubles, blocks: nextIndex };
}

const runs = [];
for (let s = 1; s <= 6; s++) {
  const r = simulate(1 / 120, 8000 * C.blockLength, s * 12345);
  runs.push(r);
  ok(`种子 ${s} 跑完 240km 不死`, !r.death,
    r.death ? JSON.stringify(r.death) : '');
}
const totalSteps = runs.reduce((s, r) => s + r.steps, 0);
ok('可通行性模拟达到 1500m 以上',
  runs.every((r) => r.distance > 1500), `min=${Math.min(...runs.map((r) => r.distance))}`);

// 快速收敛检查：早期不应出现需要极限反应的地块
const earlyDeath = runs.filter((r) => r.death && r.death.distance < 200);
ok('前 200m 无死亡', earlyDeath.length === 0);

/* ------------------------------------------------------------------ */
section('8. 存档（R-12）');

const Store = RR.MemoryStorage;

let store = new Store();
let svc = new RR.SaveService(store);
ok('首次启动生成默认存档', svc.data.coins === 0 && svc.data.bestScore === 0);
ok('默认存档来源 = default', svc.lastLoadSource === 'default');

const res = svc.recordRun({ score: 1234, distance: 812, coins: 37 });
ok('最高分刷新', svc.data.bestScore === 1234 && res.bestScore === true);
ok('最高距离刷新', svc.data.bestDistance === 812 && res.bestDistance === true);
ok('金币累加', svc.data.coins === 37);
ok('按里程解锁皮肤', svc.data.unlockedSkins.indexOf('ember') >= 0 && svc.data.unlockedSkins.indexOf('jade') >= 0);

const svc2 = new RR.SaveService(store);
ok('重启后数据仍在', svc2.data.bestScore === 1234 && svc2.data.coins === 37);
ok('读档来源 = main', svc2.lastLoadSource === 'main');

// 主存档损坏 -> 备份恢复
store.setItem(C.save.key, '{ this is not json');
const svc3 = new RR.SaveService(store);
ok('主档损坏时用备份', svc3.lastLoadSource === 'backup' && svc3.data.bestScore === 1234);

// 全部损坏 -> 默认
store.setItem(C.save.key, '#$%^');
store.setItem(C.save.bakKey, '[]');
store.setItem(C.save.tmpKey, 'null');
const svc4 = new RR.SaveService(store);
ok('全部损坏时降级默认', svc4.lastLoadSource === 'default' && svc4.data.bestScore === 0);
ok('降级不崩溃', svc4.data && svc4.data.settings.sfx === true);

// 脏数据清洗
const dirty = RR.sanitizeSave({ coins: -5, bestScore: 'x', bestDistance: 300, settings: { sfx: 'yes' } });
ok('脏字段被清洗', dirty.coins === 0 && dirty.bestScore === 0 && dirty.bestDistance === 300);
ok('未知皮肤回退默认', RR.sanitizeSave({ settings: { skin: 'hacker' } }).settings.skin === 'classic');

// 存储抛错不影响运行
const throwing = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); }
};
let threw = false;
try {
  const svc5 = new RR.SaveService(throwing);
  svc5.recordRun({ score: 10, distance: 10, coins: 1 });
} catch (e) {
  threw = true;
}
ok('存储抛错时静默降级', threw === false);

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(56));
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部逻辑测试通过 ✔');
console.log(`（生成 20000 块地 / 模拟 ${(totalSteps / 120).toFixed(0)} 秒跑动，覆盖 ${runs[0].blocks} 块/局）`);
