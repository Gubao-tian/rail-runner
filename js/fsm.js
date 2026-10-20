/* =========================================================================
 * PlayerStateMachine —— 七状态互斥（PRD R-03 / R-04 / R-05 / 附录 A）
 *
 * 只负责：状态流转、换道插值、垂直物理、碰撞体。
 * 不负责：碰撞检测、计分、渲染、UI（§9.2 边界）。
 *
 * 附录 A 矩阵是唯一权威：单元格 = 执行指令后的主状态，null = 丢弃且不排队。
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  var S = {
    RUN: 'run',
    JUMP_UP: 'jumpUp',
    JUMP_DOWN: 'jumpDown',
    SLIDE: 'slide',
    SWITCH: 'switchLane',
    HIT: 'hit',
    DEATH: 'death'
  };

  var CMD = {
    JUMP: 'jump',
    SLIDE: 'slide',
    LEFT: 'left',
    RIGHT: 'right',
    USE_ITEM: 'useItem'
  };

  // 附录 A：行 = 当前主状态，列 = 指令
  var MATRIX = {
    run: { jump: S.JUMP_UP, slide: S.SLIDE, left: S.SWITCH, right: S.SWITCH, useItem: S.RUN },
    jumpUp: { jump: null, slide: null, left: S.SWITCH, right: S.SWITCH, useItem: S.JUMP_UP },
    jumpDown: { jump: null, slide: null, left: S.SWITCH, right: S.SWITCH, useItem: S.JUMP_DOWN },
    slide: { jump: null, slide: null, left: S.SWITCH, right: S.SWITCH, useItem: S.SLIDE },
    switchLane: { jump: null, slide: null, left: null, right: null, useItem: null },
    hit: { jump: null, slide: null, left: null, right: null, useItem: null },
    death: { jump: null, slide: null, left: null, right: null, useItem: null }
  };

  function laneX(lane) {
    return (lane - 1) * C.laneWidth;
  }

  function Player(opts) {
    opts = opts || {};
    this.events = [];
    this.reset(opts.lane == null ? 1 : opts.lane);
  }

  Player.prototype.reset = function (lane) {
    this.lane = lane == null ? 1 : lane;
    this.targetLane = this.lane;
    this.x = laneX(this.lane);
    this.y = 0;
    this.vy = 0;
    this.state = S.RUN;
    this.slideT = 0;
    this.crouch = 0;      // 0 = 站姿，1 = 蹲姿（带缓动，只影响姿态与碰撞体高度）
    this.switchT = 0;
    this.switchFrom = this.x;
    this.hitT = 0;
    this.returnState = S.RUN;
    this.events.length = 0;
  };

  Player.prototype.emit = function (type, data) {
    this.events.push({ type: type, data: data || null });
  };

  Player.prototype.drainEvents = function () {
    var out = this.events.slice();
    this.events.length = 0;
    return out;
  };

  /** 主状态的“回到哪个状态”（换道结束用） */
  Player.prototype.resolveReturn = function () {
    if (this.y > 0) return this.vy > 0 ? S.JUMP_UP : S.JUMP_DOWN;
    if (this.slideT > 0) return S.SLIDE;
    return S.RUN;
  };

  /**
   * 施加一条指令。返回 true 表示被接受。
   * 被丢弃的指令不排队、不延迟执行（R-02 / 附录 A）。
   */
  Player.prototype.apply = function (cmd) {
    var row = MATRIX[this.state];
    if (!row || row[cmd] === undefined) return false;
    if (row[cmd] === null) return false;

    var p = C.player;

    if (cmd === CMD.JUMP) {
      if (this.state !== S.RUN) return false;
      this.vy = p.jumpImpulse;
      this.y = Math.max(this.y, 0.02);
      this.state = S.JUMP_UP;
      this.emit('jump');
      return true;
    }

    if (cmd === CMD.SLIDE) {
      if (this.state !== S.RUN) return false;
      this.slideT = p.slideDuration;
      this.state = S.SLIDE;
      this.emit('slide');
      return true;
    }

    if (cmd === CMD.LEFT || cmd === CMD.RIGHT) {
      var dir = cmd === CMD.LEFT ? -1 : 1;
      var target = this.lane + dir;
      // 边界：只允许相邻换道，1<->3 直跳不可能发生
      if (target < 0 || target > C.lanes - 1) return false;
      this.switchFrom = this.x;
      this.targetLane = target;
      this.switchT = 0;
      this.returnState = this.state;
      this.state = S.SWITCH;
      this.emit('switch', { from: this.lane, to: target });
      return true;
    }

    if (cmd === CMD.USE_ITEM) {
      // 状态不变，效果由 Game 处理；换道/受击/死亡下矩阵为 null，走不到这里
      this.emit('useItem');
      return true;
    }

    return false;
  };

  Player.prototype.step = function (dt) {
    if (this.state === S.DEATH) return;

    var p = C.player;

    // 垂直物理：跳跃全程有效（含换道期间）
    if (this.y > 0 || this.vy > 0) {
      this.vy -= p.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        if (this.vy < 0) this.vy = 0;
      }
    }

    // 滑铲计时：换道期间也继续走
    if (this.slideT > 0) {
      this.slideT = Math.max(0, this.slideT - dt);
    }

    if (this.state === S.JUMP_UP && this.vy <= 0) {
      this.state = S.JUMP_DOWN;
    } else if (this.state === S.JUMP_DOWN && this.y <= 0) {
      this.state = S.RUN;
      this.emit('land');
    } else if (this.state === S.SLIDE && this.slideT <= 0) {
      this.state = S.RUN;
    } else if (this.state === S.HIT) {
      this.hitT -= dt;
      if (this.hitT <= 0) {
        this.hitT = 0;
        this.state = S.RUN;
        this.emit('recover');
      }
    } else if (this.state === S.SWITCH) {
      this.switchT += dt;
      var t = Math.min(1, this.switchT / C.timing.laneSwitch);
      var e = t * t * (3 - 2 * t); // smoothstep：起止都稳
      this.x = this.switchFrom + (laneX(this.targetLane) - this.switchFrom) * e;
      if (t >= 1) {
        this.lane = this.targetLane;
        this.x = laneX(this.lane);
        this.state = this.resolveReturn();
      }
    }

    // 下蹲过渡：进入快（判定要跟得上），离开慢（不"弹起来"）
    if (this.state === S.SLIDE) {
      this.crouch += dt / Math.max(0.001, p.crouchIn);
    } else {
      this.crouch -= dt / Math.max(0.001, p.crouchOut);
    }
    this.crouch = this.crouch < 0 ? 0 : (this.crouch > 1 ? 1 : this.crouch);
  };

  /**
   * 是否处于"低姿态"：滑铲中，或起身过渡尚未结束。
   * 空中一律按站立算——跳起来就不能再钻横杆。
   * 这样"看起来蹲着"和"判定为蹲着"不会互相打脸。
   */
  Player.prototype.isLow = function () {
    if (this.y > 0.001) return false;
    return this.state === S.SLIDE || this.crouch > C.player.crouchThreshold;
  };

  /** 当前碰撞体（两套：常规 / 滑铲，R-04） */
  Player.prototype.box = function () {
    var p = C.player;
    var low = this.isLow();
    return {
      x: this.x,
      lane: this.lane,
      y0: this.y,
      y1: this.y + (low ? p.slideHeight : p.height),
      hw: p.halfWidth,
      hd: low ? p.slideHalfDepth : p.halfDepth,
      sliding: low
    };
  };

  /** 把换道瞬间结算到最近的一条轨道，消除"两轨之间"的中间态 */
  Player.prototype.snapToNearestLane = function () {
    var best = this.lane;
    var bestDist = Math.abs(this.x - laneX(this.lane));
    for (var l = 0; l < C.lanes; l++) {
      var d = Math.abs(this.x - laneX(l));
      if (d < bestDist) {
        bestDist = d;
        best = l;
      }
    }
    this.lane = best;
    this.targetLane = best;
    this.x = laneX(best);
    this.switchFrom = this.x;
    this.switchT = 0;
    return best;
  };

  Player.prototype.hit = function () {
    // 受击会打断换道：先把位置结算到最近轨道，否则角色会永久卡在两轨之间，
    // 而后续换道又用 lane 计算目标，两者失同步。
    if (this.state === S.SWITCH) this.snapToNearestLane();
    this.state = S.HIT;
    this.hitT = C.timing.hitStun;
    this.vy = 0;
    this.y = 0;
    this.slideT = 0;
    this.emit('hit');
  };

  Player.prototype.die = function () {
    this.state = S.DEATH;
    this.emit('death');
  };

  Player.prototype.isDead = function () {
    return this.state === S.DEATH;
  };

  Player.prototype.isAirborne = function () {
    return this.y > 0.001;
  };

  global.RR.Player = Player;
  global.RR.States = S;
  global.RR.Commands = CMD;
  global.RR.Matrix = MATRIX;
})(typeof globalThis !== 'undefined' ? globalThis : this);
