/* =========================================================================
 * Collision —— 纯几何判定（PRD R-04 / §9.3 判定窗口）
 *
 * 世界坐标：x 横向，y 向上，距离沿赛道前进。
 * 玩家固定在"当前已跑距离"处，障碍以绝对距离表示。
 * ========================================================================= */
(function (global) {
  'use strict';

  /**
   * @param {object} box      玩家碰撞体 {x,y0,y1,hw,hd}
   * @param {object} obstacle 障碍 {x,z,width,depth,y0,y1}
   * @param {number} obstacleAbs 障碍中心的绝对距离
   * @param {number} playerDist  玩家中心绝对距离
   * @param {number} judgeScale  判定宽容倍率（新手区 1.5）
   */
  function overlaps(box, obstacle, obstacleAbs, playerDist, judgeScale) {
    var forgive = 1 / (judgeScale || 1);
    var halfW = (obstacle.width * forgive) / 2;
    var halfD = (obstacle.depth * forgive) / 2;

    var zHit = (obstacleAbs - halfD) < (playerDist + box.hd) &&
               (obstacleAbs + halfD) > (playerDist - box.hd);
    var xHit = Math.abs(box.x - obstacle.x) < (halfW + box.hw * forgive);
    var yHit = box.y0 < obstacle.y1 && box.y1 > obstacle.y0;

    return {
      hit: zHit && xHit && yHit,
      z: zHit,
      x: xHit,
      y: yHit
    };
  }

  /** 判断某个金币是否被吃到（金币半径给一点吸附感）。 */
  function coinHit(box, coin, playerDist, radius) {
    var r = radius == null ? 0.85 : radius;
    if (Math.abs(coin.dist - playerDist) > r + box.hd) return false;
    if (Math.abs(coin.x - box.x) > r + box.hw) return false;
    if (coin.y < box.y0 - 0.45 || coin.y > box.y1 + 0.45) return false;
    return true;
  }

  global.RR.Collision = {
    overlaps: overlaps,
    coinHit: coinHit
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
