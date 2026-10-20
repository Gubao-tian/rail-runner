/* =========================================================================
 * Telemetry —— 本地埋点（PRD §8.3 / §7.5）
 *
 * 不联网、不上传；JSONL 追加到 localStorage 环形缓冲（最多 400 条）。
 * 设置里可一键清除。任何异常都静默吞掉，绝不影响对局。
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'railrunner.telemetry.v2';
  var MAX = 400;

  function Telemetry() {
    this.buffer = [];
    this.enabled = true;
    this.load();
  }

  Telemetry.prototype.load = function () {
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.buffer = arr.slice(-MAX);
    } catch (e) {
      this.buffer = [];
    }
  };

  Telemetry.prototype.flush = function () {
    try {
      if (!global.localStorage) return;
      global.localStorage.setItem(KEY, JSON.stringify(this.buffer.slice(-MAX)));
    } catch (e) { /* 忽略配额/隐私模式 */ }
  };

  Telemetry.prototype.log = function (event, data) {
    if (!this.enabled) return;
    try {
      var rec = { t: Date.now(), e: event };
      if (data) {
        Object.keys(data).forEach(function (k) {
          var v = data[k];
          if (v === null || v === undefined) return;
          if (typeof v === 'number') rec[k] = Math.round(v * 1000) / 1000;
          else if (typeof v === 'string') rec[k] = v.slice(0, 80);
          else if (typeof v === 'boolean') rec[k] = v;
        });
      }
      this.buffer.push(rec);
      if (this.buffer.length > MAX) this.buffer.splice(0, this.buffer.length - MAX);
      this.flush();
    } catch (e) { /* 忽略 */ }
  };

  Telemetry.prototype.clear = function () {
    this.buffer = [];
    try {
      if (global.localStorage) global.localStorage.removeItem(KEY);
    } catch (e) { /* 忽略 */ }
  };

  Telemetry.prototype.dump = function () {
    return this.buffer.slice();
  };

  global.RR.Telemetry = Telemetry;
})(typeof globalThis !== 'undefined' ? globalThis : this);
