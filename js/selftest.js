/* =========================================================================
 * 自检（仅在 ?selftest=1 时运行）
 *
 * 在真实浏览器环境里验证：模块加载、生成约束、状态机、存档降级、
 * 以及"跑 30 秒"的集成模拟。结果同时写入 console 与页面。
 * ========================================================================= */
(function (global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);
  if (params.get('selftest') !== '1') return;

  function run() {
    var RR = global.RR;
    var results = [];
    var failed = 0;

    function ok(name, cond, detail) {
      if (!cond) failed++;
      results.push({ name: name, pass: !!cond, detail: detail || '' });
      console.log('[SELFTEST] ' + (cond ? 'PASS' : 'FAIL') + ' ' + name + (cond ? '' : ' :: ' + (detail || '')));
    }

    try {
      var C = RR.CONFIG;

      /* ---- 1. 模块齐全 ---- */
      ok('模块齐全', !!(RR.CONFIG && RR.RNG && RR.Difficulty && RR.Blocks && RR.Player &&
        RR.Collision && RR.SaveService && RR.Renderer && RR.AudioEngine && RR.InputManager));

      /* ---- 2. 生成 5000 块地 ---- */
      var rng = new RR.RNG(424242);
      var prev = null;
      var cursor = 0;
      var violations = 0;
      var twice = 0;
      var prevType = null;
      var newbieBad = 0;
      for (var i = 0; i < 5000; i++) {
        var b = RR.Blocks.generate({ index: i, startDist: cursor, rng: rng, prev: prev });
        if (RR.Blocks.validate(b).length) violations++;
        if (b.type === 'double' && prevType === 'double') twice++;
        if (i < 3 && (b.type === 'double' || b.safeLanes.length < 2)) newbieBad++;
        prevType = b.type;
        prev = b.meta;
        cursor += C.blockLength;
      }
      ok('5000 块地全部合法', violations === 0, violations + ' 块违规');
      ok('无连续双轨', twice === 0, twice + ' 次');
      ok('新手保护合规', newbieBad === 0, newbieBad + ' 块违规');

      /* ---- 3. 状态机 ---- */
      var p = new RR.Player({ lane: 1 });
      p.apply('jump');
      var jumpState = p.state;
      var rejected = p.apply('jump') === false && p.apply('slide') === false;
      ok('空中禁止二段跳/滑铲', jumpState === 'jumpUp' && rejected);

      p = new RR.Player({ lane: 1 });
      p.apply('left');
      var locked = p.state === 'switchLane' && p.apply('left') === false;
      var t = 0;
      while (p.state === 'switchLane' && t < 1) { p.step(1 / 120); t += 1 / 120; }
      ok('换道 120ms 并锁输入', locked && Math.abs(t - 0.12) < 0.02 && p.lane === 0);

      /* ---- 3.1 下蹲过渡 ---- */
      p = new RR.Player({ lane: 1 });
      p.apply('slide');
      var lowRightAway = p.box().y1 === RR.CONFIG.player.slideHeight;
      p.step(1 / 120);
      var easing = p.crouch > 0 && p.crouch < 1;
      ok('下蹲有缓动且判定即时', lowRightAway && easing, 'crouch=' + p.crouch.toFixed(3));

      /* ---- 3.2 换道被受击打断 ---- */
      p = new RR.Player({ lane: 1 });
      p.apply('right');
      p.step(0.075);
      p.hit();
      ok('受击后回到轨道中心',
        Math.abs(p.x - RR.Blocks.laneX(p.lane)) < 1e-9, 'lane=' + p.lane + ' x=' + p.x);

      /* ---- 3.3 埋点写盘节流 ---- */
      if (global.RR_GAME && global.RR_GAME.telemetry) {
        var tel = global.RR_GAME.telemetry;
        var before = tel.buffer.length;
        for (var q = 0; q < 20; q++) tel.log('selftest_probe', { i: q });
        ok('20 次埋点合并到一次节流写盘',
          tel.flushTimer !== null && tel.buffer.length >= before + 20,
          'timer=' + (tel.flushTimer !== null));
        tel.flushNow();
        ok('flushNow 立即落盘', tel.flushTimer === null);
      }

      /* ---- 4. 存档降级 ---- */
      var store = new RR.MemoryStorage();
      var svc = new RR.SaveService(store);
      svc.recordRun({ score: 999, distance: 777, coins: 12 });
      store.setItem(C.save.key, '{broken');
      var svc2 = new RR.SaveService(store);
      ok('损坏存档降级', svc2.lastLoadSource === 'backup' && svc2.data.bestScore === 999);

      /* ---- 5. 集成：用完美玩家跑 30 秒 ---- */
      var game = global.RR_GAME;
      if (!game) {
        ok('游戏实例存在', false, 'RR_GAME 未创建');
      } else {
        game.startRun();
        game.state = 'playing';
        var steps = 0;
        var maxD = 0;
        var died = false;
        var dt = 1 / 120;
        for (var s = 0; s < 120 * 120 && !died; s++) {
          steps++;
          // 简易 AI：看最近障碍，该跳跳该滑滑，双轨先换道
          var next = null;
          for (var bi = 0; bi < game.blocks.length; bi++) {
            var block = game.blocks[bi];
            if (block.endDist < game.distance - 2) continue;
            for (var oi = 0; oi < block.obstacles.length; oi++) {
              var abs = block.startDist + block.obstacles[oi].z;
              if (abs < game.distance - 1) continue;
              if (!next || abs < next.abs) next = { abs: abs, o: block.obstacles[oi], block: block };
            }
            break;
          }
          if (next && game.player.state !== 'switchLane' && game.player.state !== 'hit') {
            var rel = next.abs - game.distance;
            var impact = rel / Math.max(1, RR.Difficulty.speed(game.distance));
            if (next.block.type === 'double') {
              var safe = next.block.safeLanes[0];
              if (game.player.lane !== safe && rel > 6) {
                game.onCommand(game.player.lane < safe ? 'right' : 'left');
              }
            } else if (game.player.lane === next.o.lane) {
              if (next.o.kind === 'low' && impact <= 0.3 && impact > 0.02) game.onCommand('jump');
              if (next.o.kind === 'bar' && impact <= 0.17 && impact > 0.02) game.onCommand('slide');
            }
          }
          game.step(dt);
          maxD = Math.max(maxD, game.distance);
          if (game.player.isDead()) died = true;
          if (maxD > 420) break;
        }
        ok('集成模拟：跑过 300m 且不死', !died && maxD > 300,
          'died=' + died + ' maxD=' + Math.round(maxD));
        ok('计分随距离增长', game.score > 300, 'score=' + Math.round(game.score));
        ok('内存稳定（地块数量有界）', game.blocks.length < 40, 'blocks=' + game.blocks.length);
        game.toMenu();
      }
    } catch (err) {
      failed++;
      results.push({ name: '未捕获异常', pass: false, detail: String(err && err.stack || err) });
      console.error('[SELFTEST] EXCEPTION ' + (err && err.stack || err));
    }

    var total = results.length;
    var summary = failed === 0
      ? '[SELFTEST] ALL PASS ' + total + '/' + total
      : '[SELFTEST] FAILED ' + failed + '/' + total;
    console.log(summary);
    console.log('[SELFTEST] DONE');
    global.document.title = failed === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL';

    var box = global.document.createElement('pre');
    box.style.cssText = 'position:fixed;inset:8px;z-index:9999;background:rgba(0,0,0,.88);' +
      'color:#9f9;font:12px/1.5 monospace;padding:12px;overflow:auto;white-space:pre-wrap';
    box.textContent = summary + '\n\n' + results.map(function (r) {
      return (r.pass ? '✓ ' : '✗ ') + r.name + (r.pass ? '' : '  ' + r.detail);
    }).join('\n');
    global.document.body.appendChild(box);
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 120); });
  } else {
    global.setTimeout(run, 120);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
