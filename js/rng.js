/* =========================================================================
 * 确定性随机数：同一 seed 必须产出同一关卡（PRD §5.3 "确定性生成"）
 * mulberry32，32 位状态，跨平台一致。
 * ========================================================================= */
(function (global) {
  'use strict';

  function RNG(seed) {
    var s = (seed >>> 0) || 1;
    this.state = s;
    this.seed = s;
  }

  RNG.prototype.next = function () {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    var t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  RNG.prototype.range = function (a, b) {
    return a + (b - a) * this.next();
  };

  RNG.prototype.int = function (n) {
    return Math.floor(this.next() * n) % n;
  };

  RNG.prototype.pick = function (arr) {
    return arr[this.int(arr.length)];
  };

  RNG.prototype.chance = function (p) {
    return this.next() < p;
  };

  /** 按权重表抽一个 key；权重和会被自动归一。 */
  RNG.prototype.weighted = function (weights) {
    var keys = Object.keys(weights);
    var total = 0;
    var i;
    for (i = 0; i < keys.length; i++) total += Math.max(0, weights[keys[i]]);
    if (total <= 0) return keys[0];
    var r = this.next() * total;
    var acc = 0;
    for (i = 0; i < keys.length; i++) {
      acc += Math.max(0, weights[keys[i]]);
      if (r < acc) return keys[i];
    }
    return keys[keys.length - 1];
  };

  global.RR = global.RR || {};
  global.RR.RNG = RNG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
