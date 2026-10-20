/* =========================================================================
 * Game —— 编排层：全局状态机 / 世界流 / 碰撞 / 计分 / 存档 / UI
 *
 * 全局状态（R-13 / 附录 A.2）：menu → prepare → playing ⇄ paused → dead
 * 每帧只做：状态推进 → 固定步长模拟 → 渲染 → HUD
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;
  var S = global.RR.States;
  var CMD = global.RR.Commands;
  var D = global.RR.Difficulty;
  var Collision = global.RR.Collision;

  var FIXED = 1 / 120;
  var ITEM_META = {
    shield: { glyph: '盾', color: '#5ad1ff', name: '护盾' },
    magnet: { glyph: '磁', color: '#b78cff', name: '磁铁' },
    double: { glyph: '×2', color: '#ffd166', name: '双倍' }
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  function fmt(n) {
    return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function Game() {
    this.canvas = document.getElementById('game');
    this.renderer = new global.RR.Renderer(this.canvas);
    this.telemetry = new global.RR.Telemetry();
    this.save = new global.RR.SaveService();
    this.audio = new global.RR.AudioEngine(this.save.data.settings);
    this.player = new global.RR.Player({ lane: 1 });

    this.state = 'menu';
    this.time = 0;
    this.lastTs = 0;
    this.acc = 0;
    this.timeScale = 1;
    this.shake = 0;
    this.speed = C.speed.v0;
    this.runPhase = 0;
    this.particles = [];
    this.blocks = [];
    this.inventory = [];
    this.effects = { shield: false, magnet: 0, double: 0 };
    this.chain = 0;
    this.comboT = 0;
    this.multiplier = 1;
    this.coinCount = 0;
    this.score = 0;
    this.distance = 0;
    this.deathT = 0;
    this.highlight = null;
    this.deathInfo = null;
    this.deathAttribution = null;
    this.runResult = null;
    this.deadT = 0;
    this.prepareT = 0;
    this.prepareShown = 0;
    this.lastJumpAt = -99;
    this.lastSlideAt = -99;

    this.ui = {};
    this.hudCache = {};
    this.returnScreen = 'menu';

    this.bindDom();
    this.bindInput();
    this.applySettings(this.save.data.settings);
    this.resetWorld(true);
    this.showScreen('menu');
    this.updateMenuInfo();

    this.telemetry.log('session_start', {
      version: C.version,
      device: this.isTouch() ? 'touch' : 'desktop',
      tier: this.save.data.bestDistance > 0 ? 'returning' : 'new'
    });

    var self = this;
    this._loop = function (ts) { self.loop(ts); };
    global.requestAnimationFrame(this._loop);
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                             */
  /* ------------------------------------------------------------------ */

  Game.prototype.isTouch = function () {
    return !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  };

  Game.prototype.bindDom = function () {
    var ids = [
      'hud', 'score', 'dist', 'coins', 'best', 'tier', 'items', 'effects',
      'btn-pause', 'countdown', 'toast',
      'screen-menu', 'screen-pause', 'screen-dead', 'screen-settings',
      'menu-best', 'menu-gap', 'btn-start', 'btn-settings-menu',
      'btn-resume', 'btn-restart-pause', 'btn-home-pause',
      'dead-score', 'dead-dist', 'dead-coins', 'dead-best-value',
      'dead-reason-title', 'dead-reason-hint', 'dead-detail', 'dead-hint',
      'btn-retry', 'btn-home',
      'set-sfx', 'set-music', 'set-vibrate', 'set-quality', 'skin-list',
      'btn-close-settings', 'btn-clear-save', 'btn-reset-save'
    ];
    for (var i = 0; i < ids.length; i++) {
      this.ui[ids[i]] = document.getElementById(ids[i]);
    }

    var self = this;

    this.ui['btn-start'].addEventListener('click', function () {
      self.audio.unlock();
      self.audio.sfx('click');
      self.startRun();
    });

    this.ui['btn-settings-menu'].addEventListener('click', function () {
      self.audio.sfx('click');
      self.openSettings('menu');
    });

    this.ui['btn-resume'].addEventListener('click', function () {
      self.audio.sfx('click');
      self.resume();
    });
    this.ui['btn-restart-pause'].addEventListener('click', function () {
      self.audio.sfx('click');
      self.startRun();
    });
    this.ui['btn-home-pause'].addEventListener('click', function () {
      self.audio.sfx('click');
      self.toMenu();
    });

    this.ui['btn-pause'].addEventListener('click', function (e) {
      e.stopPropagation();
      self.togglePause();
    });

    this.ui['btn-retry'].addEventListener('click', function (e) {
      e.stopPropagation();
      self.audio.sfx('click');
      self.startRun();
    });
    this.ui['btn-home'].addEventListener('click', function (e) {
      e.stopPropagation();
      self.audio.sfx('click');
      self.toMenu();
    });

    this.ui['screen-dead'].addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      self.startRun();
    });

    this.ui['btn-close-settings'].addEventListener('click', function () {
      self.audio.sfx('click');
      self.closeSettings();
    });

    this.ui['set-sfx'].addEventListener('change', function (e) {
      self.save.setSetting('sfx', e.target.checked);
      self.applySettings(self.save.data.settings);
    });
    this.ui['set-music'].addEventListener('change', function (e) {
      self.save.setSetting('music', e.target.checked);
      self.applySettings(self.save.data.settings);
    });
    this.ui['set-vibrate'].addEventListener('change', function (e) {
      self.save.setSetting('vibrate', e.target.checked);
      self.applySettings(self.save.data.settings);
    });
    this.ui['set-quality'].addEventListener('change', function (e) {
      self.save.setSetting('quality', e.target.value);
      self.applySettings(self.save.data.settings);
    });

    this.ui['btn-reset-save'].addEventListener('click', function () {
      if (!global.confirm('清空本地存档（金币、最高分、皮肤）？此操作不可撤销。')) return;
      self.save.reset();
      self.telemetry.clear();
      self.applySettings(self.save.data.settings);
      self.updateMenuInfo();
      self.renderSkins();
      self.toast('存档已清空');
    });

    this.ui['screen-settings'].addEventListener('click', function (e) {
      if (e.target === self.ui['screen-settings']) self.closeSettings();
    });

    // 触屏按钮：道具栏
    this.ui.items.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-slot]') : null;
      if (!btn) return;
      e.stopPropagation();
      self.useSlot(parseInt(btn.getAttribute('data-slot'), 10));
    });

    // 皮肤选择
    if (this.ui['skin-list']) {
      this.ui['skin-list'].addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-skin]') : null;
        if (!btn) return;
        self.selectSkin(btn.getAttribute('data-skin'));
        self.audio.sfx('click');
      });
    }

    global.addEventListener('resize', function () { self.renderer.resize(); });

    // 键盘 Space 会触发"当前聚焦按钮"的默认点击，点完一律失焦
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn && btn.blur) btn.blur();
    });

    // 任意手势解锁音频
    var unlock = function () { self.audio.unlock(); if (self.save.data.settings.music) self.audio.startMusic(); };
    global.addEventListener('pointerdown', unlock, { once: true });
    global.addEventListener('keydown', unlock, { once: true });
  };

  Game.prototype.bindInput = function () {
    var self = this;
    this.input = new global.RR.InputManager({
      canvas: this.canvas,
      onCommand: function (cmd) { self.onCommand(cmd); },
      onPause: function () { self.togglePause(); },
      onRestart: function () { self.onRestartKey(); },
      onItem: function (i) { self.useSlot(i); },
      onBlur: function () { self.autoPause(); },
      onAnyInput: function () { self.audio.unlock(); }
    });
  };

  /* ------------------------------------------------------------------ */
  /* 世界                                                               */
  /* ------------------------------------------------------------------ */

  Game.prototype.resetWorld = function (demo) {
    this.distance = 0;
    this.score = 0;
    this.coinCount = 0;
    this.chain = 0;
    this.comboT = 0;
    this.multiplier = 1;
    this.speed = C.speed.v0;
    this.blocks = [];
    this.particles = [];
    this.inventory = [];
    this.effects = { shield: false, magnet: 0, double: 0 };
    this.nextBlockIndex = 0;
    this.prevMeta = null;
    this.cursor = 0;
    this.deathT = 0;
    this.deadT = 0;
    this.deathInfo = null;
    this.deathAttribution = null;
    this.runResult = null;
    this.highlight = null;
    this.timeScale = 1;
    this.shake = 0;
    this.lastJumpAt = -99;
    this.lastSlideAt = -99;
    this.rejectedInputs = 0;
    this.player.reset(1);

    this.seed = demo
      ? 20261020
      : (((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    this.rng = new global.RR.RNG(this.seed);
    this.ensureBlocks();
  };

  Game.prototype.ensureBlocks = function () {
    var guard = 64;
    while (this.cursor < this.distance + C.world.viewDistance && guard-- > 0) {
      var block = global.RR.Blocks.generate({
        index: this.nextBlockIndex,
        startDist: this.cursor,
        rng: this.rng,
        prev: this.prevMeta
      });
      if (block.item) {
        var meta = ITEM_META[block.item.kind] || ITEM_META.shield;
        block.item.glyph = meta.glyph;
        block.item.color = meta.color;
      }
      this.blocks.push(block);
      this.prevMeta = block.meta;
      this.cursor += C.blockLength;
      this.nextBlockIndex++;

      if (this.nextBlockIndex > 1 && global.RR.Blocks.validate(block).length) {
        // 运行时二次校验：理论上不会发生，发生则记录而不是崩溃
        this.telemetry.log('block_invalid', { index: block.index, type: block.type });
      }
    }
  };

  Game.prototype.pruneBlocks = function () {
    while (this.blocks.length && this.blocks[0].endDist < this.distance - C.world.despawnBehind) {
      this.blocks.shift();
    }
  };

  /* ------------------------------------------------------------------ */
  /* 输入                                                               */
  /* ------------------------------------------------------------------ */

  Game.prototype.onCommand = function (cmd) {
    if (this.state === 'menu') {
      if (cmd === 'jump') this.startRun();
      return;
    }
    if (this.state === 'dead') {
      this.startRun();
      return;
    }
    if (this.state !== 'playing') return;

    if (cmd === 'useItem') {
      this.useFirstItem();
      return;
    }

    var accepted = this.player.apply(cmd);
    if (accepted) {
      // 只记被接受的指令：被丢的指令按局计数，避免把环形缓冲刷满
      this.telemetry.log('input_cmd', { cmd: cmd, d: this.distance });
    } else {
      this.rejectedInputs = (this.rejectedInputs || 0) + 1;
    }

    if (!accepted) return;

    if (cmd === 'jump') {
      this.audio.sfx('jump');
      this.lastJumpAt = this.time;
    } else if (cmd === 'slide') {
      this.audio.sfx('slide');
      this.lastSlideAt = this.time;
    } else if (cmd === 'left' || cmd === 'right') {
      this.audio.sfx('lane');
    }
  };

  Game.prototype.onRestartKey = function () {
    if (this.state === 'dead' || this.state === 'paused') this.startRun();
  };

  Game.prototype.useFirstItem = function () {
    for (var i = 0; i < this.inventory.length; i++) {
      if (this.inventory[i].count > 0) {
        this.useSlot(i);
        return;
      }
    }
  };

  Game.prototype.useSlot = function (index) {
    if (this.state !== 'playing') return;
    var st = this.player.state;
    // 附录 A：换道 / 受击 / 死亡下 UseItem 一律丢弃，不排队
    if (st === S.SWITCH || st === S.HIT || st === S.DEATH) return;
    var slot = this.inventory[index];
    if (!slot || slot.count <= 0) return;

    slot.count--;
    if (slot.count <= 0) this.inventory.splice(index, 1);
    this.applyItem(slot.kind);
    this.audio.sfx('power');
    this.telemetry.log('item_use', { item_id: slot.kind });
    this.renderInventory();
  };

  Game.prototype.applyItem = function (kind) {
    if (kind === 'shield') {
      this.effects.shield = true;
      this.audio.sfx('shield');
    } else if (kind === 'magnet') {
      this.effects.magnet = C.items.magnetDuration;
    } else if (kind === 'double') {
      this.effects.double = C.items.doubleDuration;
    }
  };

  Game.prototype.pickupItem = function (block) {
    var item = block.item;
    if (!item || item.taken) return;
    item.taken = true;
    var kind = item.kind;
    var slot = null;
    for (var i = 0; i < this.inventory.length; i++) {
      if (this.inventory[i].kind === kind && this.inventory[i].count < 9) { slot = this.inventory[i]; break; }
    }
    if (slot) slot.count++;
    else if (this.inventory.length < C.items.slots) this.inventory.push({ kind: kind, count: 1 });
    else { this.score += 120; } // 背包满：折算分数，不浪费

    this.audio.sfx('item');
    this.burst(item.x, item.y, item.dist, ITEM_META[kind].color, 14);
    this.telemetry.log('item_pickup', { item_id: kind });
    this.renderInventory();
  };

  /* ------------------------------------------------------------------ */
  /* 每步模拟                                                           */
  /* ------------------------------------------------------------------ */

  Game.prototype.step = function (dt) {
    var speed = D.speed(this.distance);
    this.speed = speed;
    this.distance += speed * dt;
    this.runPhase += speed * dt * 1.15;

    if (!this.player.isDead()) {
      this.player.step(dt);
      this.score += speed * dt * C.score.distancePoints;
      this.drainPlayerEvents();
      this.checkCollisions();
      this.updateCoins(dt);
      this.updateItems();
      this.updateEffects(dt);
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) {
          this.comboT = 0;
          this.chain = 0;
          this.multiplier = 1;
        }
      }
    }

    this.ensureBlocks();
    this.pruneBlocks();
  };

  Game.prototype.drainPlayerEvents = function () {
    var events = this.player.drainEvents();
    for (var i = 0; i < events.length; i++) {
      if (events[i].type === 'land') this.audio.sfx('land');
    }
  };

  Game.prototype.updateCoins = function (dt) {
    var box = this.player.box();
    var magnet = this.effects.magnet > 0;
    for (var i = 0; i < this.blocks.length; i++) {
      var block = this.blocks[i];
      if (!block.coins.length) continue;
      if (block.startDist - this.distance > 30) continue;
      for (var j = 0; j < block.coins.length; j++) {
        var coin = block.coins[j];
        if (coin.taken) continue;
        var rel = coin.dist - this.distance;
        if (rel > 26) continue;

        if (magnet && rel < C.coins.magnetRadius && rel > -4) {
          var k = 1 - Math.exp(-dt * 9);
          coin.dist += (this.distance - coin.dist) * k;
          coin.x += (this.player.x - coin.x) * k;
          coin.y += ((this.player.y + 0.95) - coin.y) * k;
        }

        if (Collision.coinHit(box, coin, this.distance)) {
          this.collectCoin(coin);
        }
      }
    }
  };

  Game.prototype.collectCoin = function (coin) {
    coin.taken = true;
    this.chain++;
    this.comboT = C.timing.comboWindow;
    this.multiplier = 1 + Math.min(Math.floor(this.chain / C.coins.chainStep), C.coins.chainMax);
    var gain = C.score.coinBase * this.multiplier * (this.effects.double > 0 ? 2 : 1);
    this.score += gain;
    this.coinCount++;
    this.audio.sfx('coin');
    this.burst(coin.x, coin.y, coin.dist, '#ffd166', 5);
  };

  Game.prototype.updateItems = function () {
    var box = this.player.box();
    for (var i = 0; i < this.blocks.length; i++) {
      var block = this.blocks[i];
      var item = block.item;
      if (!item || item.taken) continue;
      var rel = item.dist - this.distance;
      if (rel > 8 || rel < -4) continue;
      if (Math.abs(item.x - box.x) > 1.5) continue;
      if (Collision.coinHit(box, item, this.distance, 1.1)) this.pickupItem(block);
    }
  };

  Game.prototype.updateEffects = function (dt) {
    if (this.effects.magnet > 0) this.effects.magnet = Math.max(0, this.effects.magnet - dt);
    if (this.effects.double > 0) this.effects.double = Math.max(0, this.effects.double - dt);
  };

  /* ------------------------------------------------------------------ */
  /* 碰撞与死亡                                                         */
  /* ------------------------------------------------------------------ */

  Game.prototype.checkCollisions = function () {
    var p = this.player;
    if (p.isDead()) return;
    var box = p.box();

    for (var i = 0; i < this.blocks.length; i++) {
      var block = this.blocks[i];
      if (block.startDist - this.distance > 6 || block.endDist - this.distance < -6) continue;
      var judge = block.index < C.newbie.blocks ? C.timing.newbieJudgeScale : 1;
      for (var j = 0; j < block.obstacles.length; j++) {
        var obs = block.obstacles[j];
        if (obs.hitDone) continue;
        var abs = block.startDist + obs.z;
        if (Math.abs(abs - this.distance) > 6) continue;
        if (Collision.overlaps(box, obs, abs, this.distance, judge).hit) {
          this.onObstacleHit(block, obs, abs);
          return;
        }
      }
    }
  };

  Game.prototype.onObstacleHit = function (block, obs, abs) {
    if (this.effects.shield) {
      this.effects.shield = false;
      obs.hitDone = true;
      this.player.hit();
      this.audio.sfx('hit');
      this.audio.vibrate(50);
      this.shake = C.camera.shakeOnHit;
      this.burst(obs.x, obs.y1, abs, '#8fe3ff', 20);
      this.telemetry.log('shield_break', { obstacle: obs.kind, lane: obs.lane });
      this.renderInventory();
      return;
    }
    this.die(block, obs, abs);
  };

  Game.prototype.die = function (block, obs, abs) {
    this.deathT = 0;
    this.deathInfo = {
      block: block,
      obstacle: obs,
      abs: abs,
      speed: D.speed(this.distance),
      lane: obs.lane,
      kind: obs.kind,
      state: this.player.state,
      distance: this.distance,
      blockIndex: block.index
    };
    this.deathAttribution = this.explainDeath(block, obs);
    this.player.die();
    this.timeScale = C.timing.deathTimeScale;
    this.audio.sfx('death');
    this.audio.setMusicDucked(true);
    this.audio.vibrate([30, 50, 90]);
    this.shake = 0.9;
    this.burst(obs.x, obs.y1, abs, '#ff5d6c', 34);
    this.highlight = {
      blockIndex: block.index,
      obstacleLane: obs.lane,
      phase: 0,
      until: this.time + C.timing.highlight
    };

    // 结算即存（R-12）：不等面板出现
    this.runResult = this.save.recordRun({
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      coins: this.coinCount
    });

    this.telemetry.log('run_end', {
      distance: this.distance,
      score: this.score,
      coins: this.coinCount,
      rejected_inputs: this.rejectedInputs || 0,
      duration: this.time - (this.runStartTime || 0)
    });
    this.telemetry.log('death_detail', {
      obstacle_type: obs.kind,
      lane: obs.lane,
      speed: this.deathInfo.speed,
      delta_ms: 0,
      block: block.index,
      state: this.player.state
    });

    if (this.runResult.unlockedSkins.length) {
      this.runResult.unlockedSkins.forEach(function (skin) {
        this.telemetry.log('skin_unlock', { skin_id: skin.id, cost: 0 });
      }, this);
    }

    // 结算即落盘：不等 1 秒节流
    this.telemetry.flushNow();
  };

  Game.prototype.explainDeath = function (block, obs) {
    var p = this.player;
    var airborne = p.y > 0.02;
    var title = '撞上了';
    var hint = '';

    if (block.type === 'double') {
      if (p.state === S.SWITCH) {
        title = '换道时机不对';
        hint = '换道要 0.12 秒才完成，看到双轨障碍就要更早按方向键。';
      } else if (block.safeLanes.indexOf(p.lane) < 0) {
        title = '没有换到安全轨';
        hint = '双轨障碍左右各堵一条，只有一条安全轨。';
      } else {
        title = '撞上侧向障碍';
        hint = '换道时身体会经过中间轨道，别在最后一刻变道。';
      }
      return { title: title, hint: hint };
    }

    var isLow = obs.kind === 'low';
    if (isLow) {
      if (p.state === S.JUMP_UP || p.state === S.JUMP_DOWN || airborne) {
        if (p.vy < 0 || p.y < 0.45) {
          title = '起跳过早';
          hint = '跳跃滞空约 0.69 秒，太早跳会落在障碍上。等它再近一点。';
        } else {
          title = '起跳过晚';
          hint = '起跳后还没抬到障碍高度，试着提前 0.05~0.1 秒。';
        }
      } else if (this.time - this.lastJumpAt < 1.4) {
        title = '起跳过早';
        hint = '你跳了，但落地时正好撞上。跳跃只持续 0.69 秒。';
      } else {
        title = '没有起跳';
        hint = '橙色三角是需要跳过去的低障碍。';
      }
    } else {
      if (p.state === S.SLIDE) {
        title = '滑铲过晚';
        hint = '横杆需要全程压低身体，提前 0.1 秒开始滑。';
      } else if (this.time - this.lastSlideAt < 1.4) {
        title = '滑铲过早';
        hint = '滑铲只持续 0.55 秒，太早滑会站起来撞上横杆。';
      } else {
        title = '没有滑铲';
        hint = '黄色横梁需要滑铲通过。';
      }
    }
    return { title: title, hint: hint };
  };

  /* ------------------------------------------------------------------ */
  /* 全局状态流转                                                       */
  /* ------------------------------------------------------------------ */

  Game.prototype.startRun = function () {
    this.resetWorld(false);
    this.state = 'prepare';
    this.prepareT = C.timing.prepare;
    this.prepareShown = 0;
    this.showScreen(null);
    this.audio.setMusicDucked(false);
    this.audio.unlock();
    if (this.save.data.settings.music) this.audio.startMusic();
    this.runStartTime = this.time;
    this.telemetry.log('run_start', { seed: this.seed, best: this.save.data.bestDistance });
    this.updateHud(true);
  };

  Game.prototype.beginPlaying = function () {
    this.state = 'playing';
    this.prepareT = 0;
    this.acc = 0;
    this.setCountdown('');
    this.audio.sfx('go');
    this.toast('GO');
  };

  Game.prototype.finishRun = function () {
    this.state = 'dead';
    this.deadT = 0;
    this.timeScale = 0;
    this.showScreen('dead');
    this.fillDeadPanel();
    this.audio.setMusicDucked(true);
  };

  Game.prototype.toMenu = function () {
    this.state = 'menu';
    this.audio.setMusicDucked(false);
    this.resetWorld(true);
    this.showScreen('menu');
    this.updateMenuInfo();
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  };

  Game.prototype.pause = function () {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.showScreen('pause');
    this.audio.setMusicDucked(true);
    this.audio.sfx('click');
    this.telemetry.log('run_pause', { distance: this.distance });
    this.telemetry.flushNow();
  };

  Game.prototype.resume = function () {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.showScreen(null);
    this.audio.setMusicDucked(false);
    this.lastTs = 0;
  };

  Game.prototype.autoPause = function () {
    if (this.state === 'playing') this.pause();
  };

  /* ------------------------------------------------------------------ */
  /* 主循环                                                             */
  /* ------------------------------------------------------------------ */

  Game.prototype.loop = function (ts) {
    var self = this;
    global.requestAnimationFrame(this._loop);

    if (!this.lastTs) this.lastTs = ts;
    var dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    this.time += dt;

    this.update(dt);
    this.render();
    this.sampleFps(dt);
  };

  Game.prototype.update = function (dt) {
    this.shake = Math.max(0, this.shake - dt * 2.4);

    if (this.state === 'menu') {
      this.distance += 6.5 * dt;
      this.speed = 6.5;
      this.runPhase += dt * 8;
      this.ensureBlocks();
      this.pruneBlocks();
    } else if (this.state === 'prepare') {
      this.prepareT -= dt;
      this.runPhase += dt * 12;
      var n = Math.max(0, Math.ceil(this.prepareT * 3));
      if (n !== this.prepareShown) {
        this.prepareShown = n;
        this.setCountdown(n > 0 ? String(n) : 'GO');
        if (n > 0) this.audio.sfx('count');
      }
      if (this.prepareT <= 0) this.beginPlaying();
    } else if (this.state === 'playing') {
      if (this.player.isDead()) {
        this.deathT += dt;
        this.timeScale = this.deathT < C.timing.deathSlowMo ? C.timing.deathTimeScale : 0;
        if (this.deathT >= C.timing.deathFreeze) this.finishRun();
      }
      this.acc += dt * this.timeScale;
      var guard = 8;
      while (this.acc >= FIXED && guard-- > 0) {
        this.step(FIXED);
        this.acc -= FIXED;
      }
      if (guard <= 0) this.acc = 0;
    } else if (this.state === 'dead') {
      this.deadT += dt;
    }

    this.updateParticles(dt);
    this.updateHud(false);
  };

  Game.prototype.sampleFps = function (dt) {
    var s = this.fps || (this.fps = { frames: 0, acc: 0, sampleT: 0, avg: 60, min: 60 });
    s.frames++;
    s.acc += 1 / Math.max(dt, 0.0001);
    s.sampleT += dt;
    if (s.sampleT >= 5) {
      var avg = s.acc / Math.max(1, s.frames);
      s.avg = avg;
      s.min = Math.min(s.min, avg);
      this.telemetry.log('fps_sample', { avg_fps: avg, min_fps: s.min });
      s.frames = 0;
      s.acc = 0;
      s.sampleT = 0;
    }
  };

  /* ------------------------------------------------------------------ */
  /* 粒子                                                               */
  /* ------------------------------------------------------------------ */

  Game.prototype.burst = function (x, y, z, color, count) {
    var n = Math.min(count, C.render.particles - this.particles.length);
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = 1.5 + Math.random() * 5;
      this.particles.push({
        x: x,
        y: Math.max(0.1, y || 0.6),
        z: z,
        vx: Math.cos(ang) * sp * 0.6,
        vy: 1.5 + Math.random() * 4,
        vz: Math.sin(ang) * sp,
        life: 0.45 + Math.random() * 0.5,
        maxLife: 0.95,
        size: 0.05 + Math.random() * 0.06,
        color: color
      });
    }
  };

  Game.prototype.updateParticles = function (dt) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 14 * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.35; }
    }
  };

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  Game.prototype.skin = function () {
    var id = this.save.data.settings.skin;
    for (var i = 0; i < C.skins.length; i++) {
      if (C.skins[i].id === id) return C.skins[i];
    }
    return C.skins[0];
  };

  Game.prototype.render = function () {
    var highlight = null;
    if (this.highlight && this.time < this.highlight.until) {
      highlight = {
        blockIndex: this.highlight.blockIndex,
        obstacleLane: this.highlight.obstacleLane,
        phase: this.time
      };
    }
    this.renderer.draw({
      distance: this.distance,
      speed: this.state === 'menu' ? C.speed.v0 : this.speed,
      blocks: this.blocks,
      player: this.player,
      particles: this.particles,
      time: this.time,
      state: this.state,
      shake: this.shake,
      skin: this.skin(),
      shield: this.effects.shield,
      runPhase: this.runPhase,
      crouch: this.player.crouch,
      dead: this.player.isDead(),
      highlight: highlight
    });
  };

  /* ------------------------------------------------------------------ */
  /* HUD 与面板                                                         */
  /* ------------------------------------------------------------------ */

  Game.prototype.updateHud = function (force) {
    var score = Math.floor(this.score);
    var dist = Math.floor(this.distance);
    var c = this.hudCache;
    if (force || c.score !== score) { this.ui.score.textContent = fmt(score); c.score = score; }
    if (force || c.dist !== dist) { this.ui.dist.textContent = dist + ' m'; c.dist = dist; }
    if (force || c.coins !== this.coinCount) { this.ui.coins.textContent = this.coinCount; c.coins = this.coinCount; }
    if (force || c.best !== this.save.data.bestScore) {
      this.ui.best.textContent = fmt(this.save.data.bestScore);
      c.best = this.save.data.bestScore;
    }
    var tier = D.tier(this.distance);
    if (force || c.tier !== tier.id) { this.ui.tier.textContent = tier.name; c.tier = tier.id; }

    this.renderInventory();
    this.renderEffects(force);
  };

  Game.prototype.renderInventory = function () {
    var sig = this.inventory.map(function (s) { return s.kind + s.count; }).join('|');
    if (sig === this.hudCache.invSig) return;
    this.hudCache.invSig = sig;

    var html = '';
    for (var i = 0; i < C.items.slots; i++) {
      var slot = this.inventory[i];
      if (slot) {
        var meta = ITEM_META[slot.kind];
        html += '<button class="item-slot filled" data-slot="' + i + '" title="' + meta.name + '（' + (i + 1) + '）">' +
          '<span class="glyph" style="color:' + meta.color + '">' + meta.glyph + '</span>' +
          '<span class="count">' + slot.count + '</span></button>';
      } else {
        html += '<button class="item-slot" data-slot="' + i + '" disabled><span class="glyph">·</span></button>';
      }
    }
    this.ui.items.innerHTML = html;
  };

  Game.prototype.renderEffects = function (force) {
    var chips = [];
    if (this.effects.shield) chips.push('<span class="chip shield">护盾</span>');
    if (this.effects.magnet > 0) chips.push('<span class="chip magnet">磁铁 ' + this.effects.magnet.toFixed(1) + 's</span>');
    if (this.effects.double > 0) chips.push('<span class="chip double">双倍 ' + this.effects.double.toFixed(1) + 's</span>');
    if (this.multiplier > 1) chips.push('<span class="chip combo">×' + this.multiplier + '</span>');
    var html = chips.join('');
    if (force || html !== this.hudCache.effects) {
      this.ui.effects.innerHTML = html;
      this.hudCache.effects = html;
    }
  };

  Game.prototype.showScreen = function (name) {
    var map = {
      menu: this.ui['screen-menu'],
      pause: this.ui['screen-pause'],
      dead: this.ui['screen-dead']
    };
    var key;
    for (key in map) {
      if (!map[key]) continue;
      map[key].classList.toggle('hidden', key !== name);
    }
    var hideHud = name === 'menu';
    this.ui.hud.classList.toggle('hidden', hideHud);
    if (name !== 'dead') this.ui['screen-dead'].classList.add('hidden');
    if (name) {
      this.ui['screen-menu'].classList.toggle('hidden', name !== 'menu');
    }
  };

  Game.prototype.setCountdown = function (text) {
    var el = this.ui.countdown;
    if (!el) return;
    if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  };

  Game.prototype.toast = function (text) {
    var el = this.ui.toast;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    if (this._toastTimer) global.clearTimeout(this._toastTimer);
    var self = this;
    this._toastTimer = global.setTimeout(function () { el.classList.remove('show'); }, 900);
  };

  Game.prototype.updateMenuInfo = function () {
    var best = this.save.data.bestScore;
    var bestDist = this.save.data.bestDistance;
    if (this.ui['menu-best']) {
      this.ui['menu-best'].textContent = best > 0
        ? '最高 ' + fmt(best) + ' 分 · ' + fmt(bestDist) + ' m'
        : '还没有记录，先跑一局';
    }
    if (this.ui['menu-gap']) {
      this.ui['menu-gap'].textContent = best > 0
        ? '目标：超过 ' + fmt(bestDist) + ' m'
        : '三轨 · 五指令 · 零教程';
    }
  };

  Game.prototype.fillDeadPanel = function () {
    var r = this.runResult || { bestScore: false, bestDistance: false };
    var info = this.deathInfo || {};
    var attr = this.deathAttribution || { title: '撞上了', hint: '' };

    this.ui['dead-score'].textContent = fmt(this.score);
    this.ui['dead-dist'].textContent = Math.floor(this.distance) + ' m';
    this.ui['dead-coins'].textContent = String(this.coinCount);
    this.ui['dead-best-value'].textContent = r.bestScore
      ? '新纪录！'
      : '最高 ' + fmt(this.save.data.bestScore);
    this.ui['dead-reason-title'].textContent = attr.title;
    this.ui['dead-reason-hint'].textContent = attr.hint;

    var laneName = ['左', '中', '右'][info.lane] || '?';
    var kindName = info.kind === 'low' ? '低障碍' : '高横杆';
    this.ui['dead-detail'].textContent =
      '第 ' + ((info.blockIndex || 0) + 1) + ' 块地 · ' + laneName + '轨 ' + kindName +
      ' · ' + (info.speed || 0).toFixed(1) + ' m/s';

    this.ui['dead-hint'].textContent = '点击任意处 / 空格 再来一局';
    this.deadT = 0;

    if (r.unlockedSkins && r.unlockedSkins.length) {
      var names = r.unlockedSkins.map(function (s) { return s.name; }).join('、');
      this.toast('解锁皮肤：' + names);
      this.audio.sfx('best');
      this.renderSkins();
    } else if (r.bestScore) {
      this.audio.sfx('best');
    }
  };

  /* ------------------------------------------------------------------ */
  /* 设置与皮肤                                                         */
  /* ------------------------------------------------------------------ */

  Game.prototype.applySettings = function (s) {
    this.audio.setSettings(s);
    this.renderer.setQuality(s.quality === 'low' ? 'low' : 'high');
    if (this.ui['set-sfx']) this.ui['set-sfx'].checked = s.sfx;
    if (this.ui['set-music']) {
      this.ui['set-music'].checked = s.music;
      if (this.audio.ctx && s.music) this.audio.startMusic();
    }
    if (this.ui['set-vibrate']) this.ui['set-vibrate'].checked = s.vibrate;
    if (this.ui['set-quality']) this.ui['set-quality'].value = s.quality;
    this.renderSkins();
  };

  Game.prototype.openSettings = function (from) {
    this.returnScreen = from || 'menu';
    this.ui['screen-settings'].classList.remove('hidden');
    this.applySettings(this.save.data.settings);
  };

  Game.prototype.closeSettings = function () {
    this.ui['screen-settings'].classList.add('hidden');
    if (this.returnScreen === 'menu') this.updateMenuInfo();
  };

  Game.prototype.renderSkins = function () {
    if (!this.ui['skin-list']) return;
    var best = this.save.data.bestDistance;
    var current = this.save.data.settings.skin;
    var unlocked = this.save.data.unlockedSkins;
    var html = '';
    for (var i = 0; i < C.skins.length; i++) {
      var skin = C.skins[i];
      var has = unlocked.indexOf(skin.id) >= 0 || best >= skin.unlockDistance;
      var active = skin.id === current;
      html += '<button class="skin' + (active ? ' active' : '') + (has ? '' : ' locked') +
        '" data-skin="' + skin.id + '" ' + (has ? '' : 'disabled') + '>' +
        '<span class="dot" style="background:' + skin.color + '"></span>' +
        '<span class="name">' + skin.name + '</span>' +
        '<span class="req">' + (has ? (active ? '使用中' : '可用') : skin.unlockDistance + ' m') + '</span>' +
        '</button>';
    }
    this.ui['skin-list'].innerHTML = html;
  };

  Game.prototype.selectSkin = function (id) {
    var best = this.save.data.bestDistance;
    var skin = null;
    for (var i = 0; i < C.skins.length; i++) if (C.skins[i].id === id) skin = C.skins[i];
    if (!skin) return;
    if (this.save.data.unlockedSkins.indexOf(id) < 0 && best < skin.unlockDistance) return;
    this.save.setSetting('skin', id);
    this.renderSkins();
  };

  global.RR.Game = Game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
