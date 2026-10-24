/* =========================================================================
 * 集成测试（无需浏览器）
 * 覆盖 V2.2 待办里的"暂停 / 恢复 / 死亡 / 重开"集成路径，以及：
 *   - 暂停时粒子冻结、世界冻结
 *   - dt=0 虚帧不污染帧率均值（不再出现 10000fps）
 *   - 5 个死配置项已删除
 *   - 站姿骨架高度改为跟随 config.player.*
 *   - 死亡姿态：view.dead 触发 -1.45 的"扑街"旋转（渲染对照验证）
 *
 * 运行：node tools/integration-test.mjs
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* 最小 DOM / 画布 / 浏览器环境 Mock                                   */
/* ------------------------------------------------------------------ */
const grad = { addColorStop() {} };
const calls = [];                       // 记录画布调用，用于断言死亡旋转等变换
const ctx2d = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
    if (prop === 'measureText') return () => ({ width: 0 });
    if (prop === 'canvas') return { width: 960, height: 540 };
    return (...args) => { calls.push({ fn: prop, args }); };
  },
  set() { return true; }
});

function makeEl() {
  const el = {
    style: {},
    _text: '',
    _html: '',
    _classes: new Set(),
    value: '',
    checked: false,
    offsetWidth: 0,
    _children: [],
    classList: {
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
      toggle(c, on) {
        if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); }
        else { on ? el._classes.add(c) : el._classes.delete(c); }
      }
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { el._children.push(c); },
    getBoundingClientRect() { return { width: 960, height: 540, left: 0, top: 0 }; },
    getContext() { return ctx2d; },
    closest() { return null; },
    blur() {},
    set textContent(v) { el._text = String(v); },
    get textContent() { return el._text; },
    set innerHTML(v) { el._html = String(v); },
    get innerHTML() { return el._html; }
  };
  return el;
}

const elements = new Map();
const documentMock = {
  readyState: 'complete',
  hidden: false,
  title: '',
  body: makeEl(),
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  },
  createElement() { return makeEl(); },
  addEventListener() {},
  removeEventListener() {}
};

// 部分全局（如 Node 22 的 navigator）只读，用 defineProperty 兜底
function setGlobal(name, value) {
  try { globalThis[name] = value; }
  catch (e) {
    try { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); } catch (e2) { /* 忽略 */ }
  }
}

setGlobal('RR', {});
setGlobal('document', documentMock);
setGlobal('window', globalThis);
setGlobal('devicePixelRatio', 1);
setGlobal('requestAnimationFrame', () => 0);
setGlobal('cancelAnimationFrame', () => {});
setGlobal('matchMedia', () => ({ matches: false }));
setGlobal('location', { search: '' });
setGlobal('navigator', { vibrate() {} });
setGlobal('confirm', () => true);
setGlobal('addEventListener', () => {});
setGlobal('removeEventListener', () => {});
// 故意不提供 localStorage：SaveService 自动降级到内存档，Telemetry 静默

/* ------------------------------------------------------------------ */
/* 加载游戏源码（经典脚本，挂到 globalThis.RR）                         */
/* ------------------------------------------------------------------ */
const SOURCES = [
  'js/config.js',
  'js/rng.js',
  'js/difficulty.js',
  'js/blocks.js',
  'js/fsm.js',
  'js/save.js',
  'js/collision.js',
  'js/audio.js',
  'js/input.js',
  'js/telemetry.js',
  'js/render.js',
  'js/game.js'
];
const SRC = new Map();
for (const f of SOURCES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  SRC.set(f, code);
  // 直接 eval：IIFE 内的 'use strict' 仅作用于自身，副作用（挂 RR）落在 globalThis
  (0, eval)(code);
}

const RR = globalThis.RR;
const C = RR.CONFIG;

/* ------------------------------------------------------------------ */
/* 断言工具                                                            */
/* ------------------------------------------------------------------ */
let passed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) passed++;
  else failures.push(name + (detail ? ' -> ' + detail : ''));
}
function near(name, actual, expected, tol) {
  ok(name, Math.abs(actual - expected) <= tol, `got ${actual}, want ${expected}±${tol}`);
}
function section(t) { console.log('\n— ' + t + ' —'); }

/* ------------------------------------------------------------------ */
section('0. 配置整洁（V2.2 死配置清理 + 站姿高度配置化）');

ok('版本号已升到 2.2.2', C.version === '2.2.2', C.version);
ok('timing.restartAuto 已删除', C.timing.restartAuto === undefined);
ok('coins.magnetPull 已删除', C.coins.magnetPull === undefined);
ok('items.dropWeight 已删除', C.items.dropWeight === undefined);
ok('world.poolBlocks 已删除', C.world.poolBlocks === undefined);
ok('world.fogStart 已删除', C.world.fogStart === undefined);
ok('站姿高度已进入 config.player',
  C.player.standHipY === 0.72 && C.player.standShoulderY === 1.34 && C.player.standHeadY === 1.56);

/* ------------------------------------------------------------------ */
section('1. 生命周期：menu → prepare → playing');

const game = new RR.Game();
ok('初始状态为 menu', game.state === 'menu', game.state);
game.startRun();
ok('startRun 后进入 prepare', game.state === 'prepare', game.state);
game.beginPlaying();
ok('beginPlaying 后进入 playing', game.state === 'playing', game.state);
ok('开局清空了粒子', game.particles.length === 0);

/* ------------------------------------------------------------------ */
section('2. 暂停冻结：粒子与世界都停住');

game.burst(0, 1, 40, '#ffffff', 8);
ok('对局中可产生粒子', game.particles.length > 0);
const p0 = game.particles[0];
const x0 = p0.x, y0 = p0.y, z0 = p0.z, life0 = p0.life;
const distBefore = game.distance;

game.pause();
ok('pause 后状态为 paused', game.state === 'paused', game.state);
for (let i = 0; i < 20; i++) game.update(0.016);

ok('暂停时世界距离冻结', game.distance === distBefore, `${game.distance} vs ${distBefore}`);
ok('暂停时粒子位置冻结', game.particles[0] &&
  game.particles[0].x === x0 && game.particles[0].y === y0 &&
  game.particles[0].z === z0 && game.particles[0].life === life0,
  '粒子仍在演化');

/* ------------------------------------------------------------------ */
section('3. 恢复：回到 playing 且世界继续推进');

game.resume();
ok('resume 后回到 playing', game.state === 'playing', game.state);
ok('resume 重置了 lastTs（避免恢复瞬间巨帧）', game.lastTs === 0);
const distAtResume = game.distance;
game.update(0.016);
ok('恢复后距离继续增长', game.distance > distAtResume, `${game.distance} vs ${distAtResume}`);

// togglePause 双向
game.togglePause();
ok('togglePause 在 playing 下进入 paused', game.state === 'paused', game.state);
game.togglePause();
ok('togglePause 在 paused 下回到 playing', game.state === 'playing', game.state);

/* ------------------------------------------------------------------ */
section('4. 死亡：慢动作 → 结算面板（dead）');

// 直接构造一次撞击死亡
const fakeBlock = { index: 7, type: 'bar', startDist: 200, endDist: 230, item: null, obstacles: [], coins: [], safeLanes: [0, 1, 2] };
const fakeObs = { lane: 1, kind: 'bar', x: 0, y1: 1.78, z: 0 };
game.die(fakeBlock, fakeObs, 200);
ok('die 后角色进入死亡态', game.player.isDead() === true);
ok('die 后全局状态仍 playing（处于死亡慢动作）', game.state === 'playing', game.state);

let guard = 0;
while (game.state !== 'dead' && guard++ < 200) game.update(0.02);
ok('死亡慢动作后进入 dead', game.state === 'dead', game.state);
ok('结算即存：runResult 已生成', !!game.runResult);
ok('死亡归因已生成', !!game.deathAttribution && typeof game.deathAttribution.title === 'string');

/* ------------------------------------------------------------------ */
section('5. 死亡姿态：view.dead 触发"扑街"旋转');

function rotateSeen(angle, tol) {
  return calls.some(c => c.fn === 'rotate' && Math.abs(c.args[0] - angle) <= (tol === undefined ? 0.01 : tol));
}

// 死亡态渲染：应施加 -1.45 的向后倒地旋转
calls.length = 0;
let lastView = null;
const origDraw = game.renderer.draw;
game.renderer.draw = function (view) { lastView = view; return origDraw.call(this, view); };
let threw = false;
try { game.render(); } catch (e) { threw = true; console.log('  render threw:', e && e.stack || e); }
ok('带死亡态的渲染不抛错', threw === false);
ok('渲染视图携带 dead=true', lastView && lastView.dead === true);
ok('死亡态渲染施加了 -1.45 的扑街旋转', rotateSeen(-1.45));

// 活体态渲染（对照）：不应出现死亡旋转
calls.length = 0;
const game2 = new RR.Game();
game2.startRun();
game2.beginPlaying();
let threw2 = false;
try { game2.render(); } catch (e) { threw2 = true; }
ok('活体态渲染不抛错', threw2 === false);
ok('活体态渲染不施加死亡旋转', !rotateSeen(-1.45));

/* ------------------------------------------------------------------ */
section('6. 重开：回到可玩态');

game.startRun();
game.beginPlaying();
ok('重开后回到 playing', game.state === 'playing', game.state);
ok('重开后距离归零', game.distance === 0);
ok('重开后角色复活', game.player.isDead() === false);
ok('重开后粒子清空', game.particles.length === 0);

/* ------------------------------------------------------------------ */
section('7. dt=0 虚帧不再污染帧率均值');

game.fps = undefined;
for (let i = 0; i < 100; i++) game.sampleFps(0);
ok('连续 dt=0 帧被跳过（不创建 fps 统计）', game.fps === undefined);

game.fps = undefined;
for (let i = 0; i < 400; i++) game.sampleFps(0.016);
ok('正常帧窗口均值 ≈ 真实 fps（62.5）', game.fps && Math.abs(game.fps.avg - 62.5) < 1.0,
  game.fps ? `avg=${game.fps.avg}` : 'no fps');

/* ------------------------------------------------------------------ */
section('8. 配置单一数据源（P0 一致性：配置值不再写死在代码里）');

const renderSrc = SRC.get('js/render.js');
const blocksSrc = SRC.get('js/blocks.js');
const gameSrc = SRC.get('js/game.js');

ok('render.js 使用 C.railHalfWidth（立柱宽度）', /railHalfWidth/.test(renderSrc));
ok('render.js 不再写死立柱宽度 0.12',
  !/hw\s*-\s*0\.12/.test(renderSrc) && !/hw\s*\+\s*0\.12/.test(renderSrc));

ok('config.coins 新增金币摆放参数',
  C.coins.baseY === 1.05 && C.coins.arcY === 1.45 && C.coins.peakY === 1.62 &&
  C.coins.slideY === 0.55 && C.coins.arcSpread === 2.2 && C.coins.barSpread === 1.6);
ok('config.items.itemY 存在', C.items.itemY === 1.15);
ok('items.shieldDuration 已删除（护盾为一次性格挡，无时长语义）',
  C.items.shieldDuration === undefined);

ok('blocks.js 不再写死金币高度 1.05', !/1\.05/.test(blocksSrc));
ok('blocks.js 不再写死金币弧线/横杆金币参数（2.2 / 1.6 / 0.55）',
  !/\b2\.2\b/.test(blocksSrc) && !/\b1\.6\b/.test(blocksSrc) && !/\b0\.55\b/.test(blocksSrc));

ok('game.js 提示不再写死换道时长 0.12', !/换道要 0\.12 秒/.test(gameSrc));
ok('game.js 提示不再写死滑铲时长 0.55', !/滑铲只持续 0\.55 秒/.test(gameSrc));
ok('game.js 提示不再写死滞空 0.69（改为按 jumpImpulse/gravity 推导）', !/0\.69 秒/.test(gameSrc));

// 行为验证：改配置后生成的金币高度真的跟着变——证明是"接线"而不是数字巧合
const baseY0 = C.coins.baseY;
C.coins.baseY = 9.99;
let prevB = null, hitBaseY = false;
const rngB = new RR.RNG(12345);
for (let i = 0; i < 200 && !hitBaseY; i++) {
  const b = RR.Blocks.generate({ index: i, startDist: i * C.blockLength, rng: rngB, prev: prevB });
  prevB = b;
  if (b.coins && b.coins.some(function (c) { return c.y === 9.99; })) hitBaseY = true;
}
C.coins.baseY = baseY0;
ok('改 C.coins.baseY 后生成的金币高度跟随（证明已接线而非巧合）', hitBaseY);

/* ------------------------------------------------------------------ */
section('9. 角色腿部几何：不得是罗圈腿（膝盖不得外鼓于髋→踝连线）');

const L = C.player.legs;
const proto = RR.Renderer.prototype;

// 膝盖相对"髋→踝连线"的外鼓量（>0 = 罗圈腿）。side 用于把坐标换成"向外为正"。
function bowOf(hipX, kneeX, ankleX, hipY, kneeY, ankleY, side) {
  const t = (hipY - kneeY) / (hipY - ankleY);
  const lineLat = hipX * side + (ankleX * side - hipX * side) * t;
  return (kneeX * side) - lineLat;
}

// 反向验证：这条断言对"旧几何"（髋 0 / 膝 ±0.10 / 踝 ±0.10）确实会报警——有牙齿
const oldBow = bowOf(0, 0.10, 0.10, 0.72, 0.4325, 0.03, 1);
ok('断言对旧几何确实报警（有牙齿）', oldBow > 0.01, 'oldBow=' + oldBow.toFixed(4));

ok('config.player.legs 存在', !!L);
ok('Renderer 暴露 legGeometry（几何可被断言）', typeof proto.legGeometry === 'function');

if (L && typeof proto.legGeometry === 'function') {
  ok('有骨盆宽度（两腿髋点分离，不从同一点发出）', L.hipHalfWidth > 0.05);
  ok('膝盖不比髋更靠外（生理性略内收）', L.kneeHalfWidth < L.hipHalfWidth);

  let maxBow = -Infinity;
  const rend = new RR.Renderer(documentMock.getElementById('cv'));
  for (let ci = 0; ci <= 10; ci++) {
    const crouch = ci / 10;
    for (let pi = 0; pi < 24; pi++) {
      const phase = (pi / 24) * Math.PI * 2;
      for (const air of [false, true]) {
        for (const side of [-1, 1]) {
          const g = rend.legGeometry(side, phase, crouch, air, 0.72);
          // 允许下蹲时按 crouchKneeOut 有意外展（深蹲膝盖本就略开）
          const bow = bowOf(g.hipX, g.kneeX, g.ankleX, g.hipY, g.kneeY, g.ankleY, side)
            - L.crouchKneeOut * crouch;
          if (bow > maxBow) maxBow = bow;
        }
      }
    }
  }
  ok('全相位/全蹲姿下膝盖都不外鼓（无罗圈腿）', maxBow <= 1e-9, 'maxBow=' + maxBow.toFixed(4));

  // 摆动幅度不应远大于髋宽（否则跑起来两腿外张成 O 形）
  ok('跑动摆幅不超过髋宽的 1.5 倍', L.runSwingX <= L.hipHalfWidth * 2 * 1.5,
    `runSwingX=${L.runSwingX}, hipWidth=${(L.hipHalfWidth * 2).toFixed(3)}`);
  ok('膝盖跟随摆动（不再只甩小腿）', L.kneeSwingFollow > 0.2);
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(56));
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  failures.forEach((f) => console.log('  ✗ ' + f));
}
process.exit(failures.length ? 1 : 0);
