/* =========================================================================
 * DifficultyManager —— 只输出速度与权重，不碰物体（PRD §9.2 边界）
 *
 * 速度：v(d) = v0 + (vMax - v0) * (1 - e^(-d/λ))          §5.3
 * 权重：empty/low/bar/coin/item 按附录 B 端点线性插值；
 *       double 按 §5.3 表格锚点分段线性（表格比"线性"这句话更具体）；
 *       归一化保证总和 = 1.00，并封顶 double <= 0.30。
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** 双轨权重：按 §5.3 表格锚点分段线性，超出 1500m 保持封顶值。 */
  function doubleWeight(d) {
    var curve = C.doubleCurve;
    if (d <= curve[0][0]) return curve[0][1];
    for (var i = 1; i < curve.length; i++) {
      var x0 = curve[i - 1][0], y0 = curve[i - 1][1];
      var x1 = curve[i][0], y1 = curve[i][1];
      if (d <= x1) {
        var t = (d - x0) / (x1 - x0 || 1);
        return lerp(y0, y1, clamp(t, 0, 1));
      }
    }
    return curve[curve.length - 1][1];
  }

  /** 某距离处的速度（m/s）。 */
  function speed(d) {
    var s = C.speed;
    if (d <= 0) return s.v0;
    return s.v0 + (s.vMax - s.v0) * (1 - Math.exp(-d / s.lambda));
  }

  /** 某距离处的归一化地块权重。 */
  function weights(d) {
    var t = clamp(d / C.weightRamp, 0, 1);
    var w = {};
    Object.keys(C.weightEnd).forEach(function (k) {
      var e = C.weightEnd[k];
      w[k] = lerp(e[0], e[1], t);
    });
    w.double = Math.min(doubleWeight(d), C.doubleCap);

    var sum = 0;
    Object.keys(w).forEach(function (k) { sum += Math.max(0, w[k]); });
    if (sum <= 0) return { empty: 1, low: 0, bar: 0, double: 0, coin: 0, item: 0 };
    Object.keys(w).forEach(function (k) { w[k] = Math.max(0, w[k]) / sum; });
    return w;
  }

  /** 距下一个难度台阶还有多远（HUD 用）。 */
  function tier(d) {
    if (d < 90) return { id: 'tutorial', name: '教学区' };
    if (d < 400) return { id: 'build', name: '建立' };
    if (d < 900) return { id: 'pressure', name: '压力' };
    if (d < 1500) return { id: 'expert', name: '高手' };
    return { id: 'limit', name: '极限' };
  }

  global.RR.Difficulty = {
    speed: speed,
    weights: weights,
    doubleWeight: doubleWeight,
    tier: tier,
    clamp: clamp,
    lerp: lerp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
