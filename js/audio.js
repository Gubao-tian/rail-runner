/* =========================================================================
 * AudioEngine —— 纯合成音频，零素材（PRD R-16 / §12.1 免版权要求）
 *
 * - 所有音效与 BGM 用 WebAudio 振荡器实时合成，交付包不含音频文件
 * - 暂停时 BGM 衰减到 40%，恢复时还原（R-16 / 附录 C）
 * - 音效与音乐可独立关闭（§7.4）
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  function AudioEngine(settings) {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noise = null;
    this.unlocked = false;
    this.musicOn = false;
    this.ducked = false;
    this.nextNote = 0;
    this.noteIndex = 0;
    this.timer = null;
    this.settings = settings || { sfx: true, music: true };
    this.lastSfx = {};
  }

  AudioEngine.prototype.supported = function () {
    return !!(global.AudioContext || global.webkitAudioContext);
  };

  /** 必须在用户手势里调用一次（浏览器自动播放策略）。 */
  AudioEngine.prototype.unlock = function () {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') this.resume();
      return;
    }
    if (!this.supported()) return;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.55;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.0;
      this.musicBus.connect(this.master);

      this.buildNoise();
      this.unlocked = true;
    } catch (e) {
      this.ctx = null;
      this.unlocked = false;
    }
  };

  AudioEngine.prototype.buildNoise = function () {
    var ctx = this.ctx;
    var len = Math.floor(ctx.sampleRate * 0.4);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  };

  AudioEngine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
  };

  AudioEngine.prototype.now = function () {
    return this.ctx ? this.ctx.currentTime : 0;
  };

  /** 只有上下文真正在跑才发声：无手势时静音，避免浏览器自动播放警告刷屏 */
  AudioEngine.prototype.ready = function () {
    return !!this.ctx && this.ctx.state === 'running';
  };

  AudioEngine.prototype.tone = function (opt) {
    if (!this.ready() || !this.settings.sfx) return;
    var ctx = this.ctx;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t0 + (opt.dur || 0.15));
    }
    filter.type = opt.filter || 'lowpass';
    filter.frequency.setValueAtTime(opt.cutoff || 6000, t0);

    var peak = (opt.gain == null ? 0.2 : opt.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (opt.dur || 0.15));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + (opt.dur || 0.15) + 0.03);
  };

  AudioEngine.prototype.noiseBurst = function (opt) {
    if (!this.ready() || !this.settings.sfx || !this.noise) return;
    var ctx = this.ctx;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = this.noise;
    var filter = ctx.createBiquadFilter();
    filter.type = opt.filter || 'bandpass';
    filter.frequency.setValueAtTime(opt.freq || 900, t0);
    if (opt.freq1) filter.frequency.exponentialRampToValueAtTime(opt.freq1, t0 + (opt.dur || 0.2));
    filter.Q.value = opt.q || 1.2;
    var gain = ctx.createGain();
    var peak = opt.gain == null ? 0.18 : opt.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (opt.dur || 0.2));
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + (opt.dur || 0.2) + 0.05);
  };

  AudioEngine.prototype.sfx = function (name) {
    if (!this.ctx || !this.settings.sfx) return;
    var t = this.ctx.currentTime;
    // 同一音效 30ms 内不重复，避免连吃金币时爆音
    if (this.lastSfx[name] && t - this.lastSfx[name] < 0.03) return;
    this.lastSfx[name] = t;

    switch (name) {
      case 'jump':
        this.tone({ type: 'triangle', f0: 240, f1: 520, dur: 0.16, gain: 0.16, cutoff: 3000 });
        break;
      case 'land':
        this.tone({ type: 'sine', f0: 150, f1: 90, dur: 0.08, gain: 0.08 });
        break;
      case 'slide':
        // 更柔的摩擦声：更低的扫频、更长的尾巴、更小的音量
        this.noiseBurst({ freq: 1100, freq1: 240, dur: 0.36, gain: 0.09, filter: 'bandpass', q: 0.8 });
        break;
      case 'lane':
        this.tone({ type: 'square', f0: 880, f1: 660, dur: 0.05, gain: 0.05, cutoff: 2200 });
        break;
      case 'coin':
        this.tone({ type: 'sine', f0: 1046, f1: 1568, dur: 0.07, gain: 0.12 });
        this.tone({ type: 'sine', f0: 1568, f1: 2093, dur: 0.06, gain: 0.05, delay: 0.04 });
        break;
      case 'item':
        this.tone({ type: 'triangle', f0: 660, f1: 990, dur: 0.12, gain: 0.14 });
        this.tone({ type: 'triangle', f0: 990, f1: 1320, dur: 0.14, gain: 0.12, delay: 0.09 });
        break;
      case 'shield':
        this.tone({ type: 'sawtooth', f0: 300, f1: 600, dur: 0.25, gain: 0.1, cutoff: 1800 });
        break;
      case 'power':
        this.tone({ type: 'square', f0: 440, f1: 880, dur: 0.18, gain: 0.08, cutoff: 2400 });
        break;
      case 'hit':
        this.tone({ type: 'square', f0: 160, f1: 60, dur: 0.22, gain: 0.18, cutoff: 1200 });
        this.noiseBurst({ freq: 500, freq1: 120, dur: 0.2, gain: 0.16, filter: 'lowpass' });
        break;
      case 'death':
        this.tone({ type: 'sawtooth', f0: 220, f1: 55, dur: 0.7, gain: 0.16, cutoff: 1400 });
        this.noiseBurst({ freq: 700, freq1: 80, dur: 0.5, gain: 0.12, filter: 'lowpass' });
        break;
      case 'count':
        this.tone({ type: 'sine', f0: 523, dur: 0.09, gain: 0.1 });
        break;
      case 'go':
        this.tone({ type: 'sine', f0: 784, dur: 0.16, gain: 0.12 });
        break;
      case 'click':
        this.tone({ type: 'square', f0: 1200, dur: 0.03, gain: 0.05, cutoff: 4000 });
        break;
      case 'best':
        this.tone({ type: 'triangle', f0: 784, dur: 0.14, gain: 0.12 });
        this.tone({ type: 'triangle', f0: 1046, dur: 0.16, gain: 0.12, delay: 0.12 });
        this.tone({ type: 'triangle', f0: 1318, dur: 0.28, gain: 0.1, delay: 0.24 });
        break;
      default:
        break;
    }
  };

  /* ---------------- BGM ---------------- */

  var SCALE = [0, 3, 5, 7, 10]; // 小调五声
  var ROOT = 110; // A2

  AudioEngine.prototype.noteFreq = function (degree, octave) {
    var idx = degree % SCALE.length;
    var oct = octave + Math.floor(degree / SCALE.length);
    return ROOT * Math.pow(2, oct) * Math.pow(2, SCALE[idx] / 12);
  };

  AudioEngine.prototype.startMusic = function () {
    if (!this.ctx || !this.settings.music || this.musicOn) return;
    this.musicOn = true;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.noteIndex = 0;
    var self = this;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(this.ducked ? 0.012 : 0.03, this.ctx.currentTime, 0.3);
    this.timer = global.setInterval(function () { self.schedule(); }, 60);
    this.schedule();
  };

  AudioEngine.prototype.stopMusic = function () {
    this.musicOn = false;
    if (this.timer) {
      global.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
    }
  };

  AudioEngine.prototype.setDucked = function (ducked) {
    this.ducked = !!ducked;
    if (this.musicBus && this.ctx) {
      // 暂停衰减到 40%（R-16）
      this.musicBus.gain.setTargetAtTime(this.ducked ? 0.012 : 0.03, this.ctx.currentTime, 0.15);
    }
  };

  // 语义别名：游戏层用 setMusicDucked 表达"音乐衰减"
  AudioEngine.prototype.setMusicDucked = AudioEngine.prototype.setDucked;

  AudioEngine.prototype.schedule = function () {
    if (!this.ready() || !this.musicOn) return;
    var ctx = this.ctx;
    var step = 60 / 96 / 2; // 96 BPM 的八分音符
    var horizon = ctx.currentTime + 0.3;

    while (this.nextNote < horizon) {
      var i = this.noteIndex;
      var t = this.nextNote;

      // 低音：每两拍一次
      if (i % 4 === 0) {
        this.pluck(ROOT, t, 0.42, 0.12, 'sine', 400);
      }
      // 琶音
      var degree = [0, 2, 3, 4, 2, 3, 1, 2][i % 8];
      var freq = this.noteFreq(degree, 2);
      this.pluck(freq, t, 0.18, 0.035, 'triangle', 2400);
      // 每 8 步一次高音点缀
      if (i % 16 === 8) {
        this.pluck(this.noteFreq(degree, 3), t, 0.5, 0.02, 'sine', 3200);
      }

      this.noteIndex = (i + 1) % 64;
      this.nextNote += step;
    }
  };

  AudioEngine.prototype.pluck = function (freq, t, dur, gain, type, cutoff) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var f = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  AudioEngine.prototype.setSettings = function (settings) {
    this.settings = settings;
    if (!settings.music) this.stopMusic();
    else if (this.ctx && !this.musicOn) this.startMusic();
  };

  AudioEngine.prototype.vibrate = function (pattern) {
    if (!this.settings || !this.settings.vibrate) return;
    try {
      var nav = global.navigator;
      if (!nav || typeof nav.vibrate !== 'function') return;
      // 没有用户手势时浏览器会拒绝并打印错误，直接跳过
      if (nav.userActivation && nav.userActivation.hasBeenActive === false) return;
      nav.vibrate(pattern);
    } catch (e) { /* 忽略 */ }
  };

  global.RR.AudioEngine = AudioEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
