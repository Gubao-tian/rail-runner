/* =========================================================================
 * 导出 GameConfig 为 JSON，供 Python 离线校验器读取
 *
 * 只有一份配置源（js/config.js）；这里做的是"翻译"，不是复制参数。
 * 用法：node tools/export-config.mjs [输出路径]
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  const sandbox = { console, Math, JSON, Object, Array, Number, Boolean, isFinite };
  vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/rng.js', 'js/difficulty.js', 'js/blocks.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.RR.CONFIG;
}

/** 校验器友好的稳定结构：只暴露 Python 侧需要的字段。 */
export function exportShape(CONFIG) {
  return {
    version: CONFIG.version,
    lanes: CONFIG.lanes,
    block: { length: CONFIG.blockLength, laneWidth: CONFIG.laneWidth },
    speed: { v0: CONFIG.speed.v0, vMax: CONFIG.speed.vMax, lambda: CONFIG.speed.lambda },
    timing: {
      laneSwitch: CONFIG.timing.laneSwitch,
      judgeWindow: CONFIG.timing.judgeWindow,
      hitStun: CONFIG.timing.hitStun
    },
    weights: {
      ramp: CONFIG.weightRamp,
      end: CONFIG.weightEnd,
      doubleCurve: CONFIG.doubleCurve,
      doubleCap: CONFIG.doubleCap
    },
    newbie: { blocks: CONFIG.newbie.blocks, minSafeLanes: CONFIG.newbie.minSafeLanes },
    analysis: { vision: CONFIG.analysis.vision, reaction: CONFIG.analysis.reaction },
    // 生成器的连排禁令：上一个类型为 key 时，下一个不能是同名类型
    noRepeat: ['double', 'low', 'bar']
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2] || path.join(ROOT, 'build', 'config.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(exportShape(loadConfig()), null, 2) + '\n', 'utf8');
  console.log('已导出 ' + path.relative(ROOT, out));
}
