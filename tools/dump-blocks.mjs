/* =========================================================================
 * 批量导出地块，供 Python 离线校验器做无解率与分布检查
 *
 * 用的是游戏里同一份 Blocks.generate（同种子 = 同关卡），不是重实现。
 * 用法：node tools/dump-blocks.mjs [数量] [种子] [输出路径]
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadRR() {
  const sandbox = { console, Math, JSON, Object, Array, Number, Boolean, isFinite };
  vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/rng.js', 'js/difficulty.js', 'js/blocks.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.RR;
}

const RR = loadRR();
const C = RR.CONFIG;

const count = parseInt(process.argv[2] || String(C.analysis.batchBlocks), 10);
const seed = parseInt(process.argv[3] || '20261020', 10);
const out = process.argv[4] || path.join(ROOT, 'build', 'blocks.json');

const rng = new RR.RNG(seed);
const blocks = [];
let cursor = 0;
let prev = null;

for (let i = 0; i < count; i++) {
  const b = RR.Blocks.generate({ index: i, startDist: cursor, rng, prev });
  blocks.push({
    index: b.index,
    startDist: b.startDist,
    type: b.type,
    safeLanes: b.safeLanes,
    blockedLanes: b.obstacles.map((o) => o.lane),
    kinds: b.obstacles.map((o) => o.kind),
    newbie: b.index < C.newbie.blocks,
    obstacleCount: b.obstacles.length,
    hasItem: !!b.item,
    itemLane: b.item ? b.item.lane : null
  });
  prev = b.meta;
  cursor += C.blockLength;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ seed, count, blockLength: C.blockLength, blocks }), 'utf8');
console.log('已导出 ' + blocks.length + ' 块地 → ' + path.relative(ROOT, out) + '（种子 ' + seed + '）');
