/* =========================================================================
 * 启动入口
 * - 捕获未处理异常，给出可读提示而不是白屏
 * - 暴露 window.RR_GAME 供调试 / 自检 / 自动化验收
 * ========================================================================= */
(function (global) {
  'use strict';

  function fail(err) {
    console.error('[RUNTIME_ERROR]', err && (err.stack || err));
    var el = global.document.getElementById('boot-error');
    if (!el) {
      el = global.document.createElement('pre');
      el.id = 'boot-error';
      el.style.cssText = 'position:fixed;inset:0;margin:0;padding:16px;z-index:99999;' +
        'background:#160a10;color:#ffb4b4;font:12px/1.6 monospace;overflow:auto;white-space:pre-wrap';
      global.document.body.appendChild(el);
    }
    el.textContent = '游戏启动失败：\n\n' + String(err && (err.stack || err));
  }

  global.addEventListener('error', function (e) {
    if (e && e.error) fail(e.error);
  });

  function boot() {
    if (global.__RR_BOOTED) return;
    global.__RR_BOOTED = true;
    try {
      global.RR_GAME = new global.RR.Game();
      if (global.console && console.info) {
        console.info('[RR] booted v' + global.RR.CONFIG.version);
      }
      // 调试/截图用：?autoplay=1 直接开局
      try {
        var params = new URLSearchParams(global.location.search);
        if (params.get('autoplay') === '1') {
          global.setTimeout(function () {
            if (global.RR_GAME) global.RR_GAME.startRun();
          }, 50);
        }
      } catch (e) { /* 忽略 */ }
    } catch (err) {
      fail(err);
    }
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
