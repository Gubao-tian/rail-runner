/* =========================================================================
 * InputManager —— 统一输入层（PRD R-01 / R-02）
 *
 * 键盘与触屏都先进入这里，再分发为五类指令：Jump / Slide / Left / Right / UseItem。
 * 原始输入不直接驱动角色（§9.2 边界）。
 * - 防抖：同类指令 60ms 冷却
 * - 触屏：滑动方向识别（主轴判定），轻点 = 跳
 * - 被丢弃的指令不排队（附录 A）
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  var KEY_MAP = {
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'slide', KeyS: 'slide',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    KeyQ: 'useItem', KeyE: 'useItem'
  };

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  function InputManager(opts) {
    this.canvas = opts.canvas;
    this.onCommand = opts.onCommand || function () {};
    this.onPause = opts.onPause || function () {};
    this.onRestart = opts.onRestart || function () {};
    this.onItem = opts.onItem || function () {};
    this.onBlur = opts.onBlur || function () {};
    this.onAnyInput = opts.onAnyInput || function () {};
    this.last = {};
    this.enabled = true;
    this.pointer = null;
    this.bind();
  }

  InputManager.prototype.bind = function () {
    var self = this;
    var doc = global.document;

    doc.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var code = e.code;

      if (code === 'Escape' || code === 'KeyP') {
        e.preventDefault();
        self.onPause();
        return;
      }
      if (code === 'KeyR') {
        e.preventDefault();
        self.onRestart();
        return;
      }
      if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
        e.preventDefault();
        self.onItem(parseInt(code.slice(5), 10) - 1);
        return;
      }
      var cmd = KEY_MAP[code];
      if (!cmd) return;
      e.preventDefault();
      self.onAnyInput();
      self.dispatch(cmd);
    }, { passive: false });

    if (!this.canvas) return;

    this.canvas.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      e.preventDefault();
      self.onAnyInput();
      self.pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: now(),
        consumed: false
      };
      if (self.canvas.setPointerCapture) {
        try { self.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    }, { passive: false });

    this.canvas.addEventListener('pointermove', function (e) {
      var p = self.pointer;
      if (!p || p.id !== e.pointerId || p.consumed) return;
      var dx = e.clientX - p.x;
      var dy = e.clientY - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < C.input.swipeMin) return;

      var absX = Math.abs(dx);
      var absY = Math.abs(dy);
      var cmd = null;
      if (absX > absY * C.input.swipeAxisRatio) cmd = dx > 0 ? 'right' : 'left';
      else if (absY > absX * C.input.swipeAxisRatio) cmd = dy > 0 ? 'slide' : 'jump';

      if (cmd) {
        p.consumed = true;
        self.dispatch(cmd);
      }
    }, { passive: true });

    var end = function (e) {
      var p = self.pointer;
      if (!p || p.id !== e.pointerId) return;
      self.pointer = null;
      if (p.consumed) return;
      var dt = now() - p.t;
      var dx = e.clientX - p.x;
      var dy = e.clientY - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dt > C.input.swipeMaxTime) return;
      if (dist > C.input.swipeMin) {
        // 松手太快没触发 move 的兜底
        var absX = Math.abs(dx);
        var absY = Math.abs(dy);
        if (absX > absY) self.dispatch(dx > 0 ? 'right' : 'left');
        else self.dispatch(dy > 0 ? 'slide' : 'jump');
      } else {
        self.dispatch('jump'); // 轻点 = 跳（单手可玩）
      }
    };

    this.canvas.addEventListener('pointerup', end, { passive: true });
    this.canvas.addEventListener('pointercancel', function (e) {
      if (self.pointer && self.pointer.id === e.pointerId) self.pointer = null;
    }, { passive: true });

    global.addEventListener('blur', function () { self.onBlur(); });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) self.onBlur();
    });
  };

  InputManager.prototype.dispatch = function (cmd) {
    if (!this.enabled) return false;
    var t = now();
    var gap = C.input.debounce * 1000;
    if (this.last[cmd] && t - this.last[cmd] < gap) return false;
    this.last[cmd] = t;
    this.onCommand(cmd);
    return true;
  };

  global.RR.InputManager = InputManager;
})(typeof globalThis !== 'undefined' ? globalThis : this);
