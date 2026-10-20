/* =========================================================================
 * Renderer —— Canvas 伪 3D 透视渲染（零贴图、纯几何）
 *
 * 相机在角色后上方，沿 +z 观察；世界坐标 x 横向 / y 向上 / z 前进。
 * 只读取数据，不改变游戏状态。
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 960;
    this.h = 540;
    this.dpr = 1;
    this.quality = C.render.quality;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var canvas = this.canvas;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
    var w = Math.max(320, rect.width || global.innerWidth || 960);
    var h = Math.max(240, rect.height || global.innerHeight || 540);
    var dpr = Math.min(global.devicePixelRatio || 1, C.render.maxDpr);
    if (this.quality === 'low') dpr = Math.min(dpr, 1);

    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.horizon = h * 0.5;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer.prototype.setQuality = function (q) {
    this.quality = q;
    this.resize();
  };

  Renderer.prototype.makeCamera = function (view) {
    var speed = view.speed || C.speed.v0;
    var ratio = clamp((speed - C.speed.v0) / (C.speed.vMax - C.speed.v0), 0, 1);
    var zoom = ratio * C.camera.zoomBySpeed * 14;
    var px = view.player ? view.player.x : 0;
    var shake = view.shake || 0;
    return {
      x: px * C.camera.laneFollow + (Math.random() - 0.5) * shake * 0.6,
      y: C.camera.height + (Math.random() - 0.5) * shake * 0.4,
      z: -(C.camera.distance - zoom),
      f: this.h * C.camera.focal,
      shake: shake
    };
  };

  Renderer.prototype.project = function (cam, x, y, z) {
    var dz = z - cam.z;
    if (dz <= 0.6) return null;
    var s = cam.f / dz;
    return {
      x: this.w / 2 + (x - cam.x) * s,
      y: this.horizon - (y - cam.y) * s,
      s: s
    };
  };

  Renderer.prototype.face = function (cam, pts, fill, stroke, lineWidth) {
    var screen = [];
    for (var i = 0; i < pts.length; i++) {
      var p = this.project(cam, pts[i][0], pts[i][1], pts[i][2]);
      if (!p) return;
      screen.push(p);
    }
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    for (var j = 1; j < screen.length; j++) ctx.lineTo(screen[j].x, screen[j].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1.5;
      ctx.stroke();
    }
  };

  /* ---------------- 背景 ---------------- */

  Renderer.prototype.drawSky = function (cam, time) {
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var hz = this.horizon;

    var g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, '#05060f');
    g.addColorStop(0.42, '#120f2e');
    g.addColorStop(0.74, '#2c1540');
    g.addColorStop(1, '#5d2340');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hz + 2);

    // 星星
    if (this.quality === 'high') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (var i = 0; i < 46; i++) {
        var sx = ((i * 1973.7) % w);
        var sy = ((i * 733.1) % (hz * 0.75));
        var tw = 0.5 + 0.5 * Math.sin(time * 1.7 + i);
        ctx.globalAlpha = 0.15 + tw * 0.45;
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    // 落日
    var sunX = w * 0.5 - cam.x * 6;
    var sunY = hz - h * 0.09;
    var sunR = h * 0.17;
    var sg = ctx.createRadialGradient(sunX, sunY, sunR * 0.1, sunX, sunY, sunR);
    sg.addColorStop(0, 'rgba(255,190,120,0.95)');
    sg.addColorStop(0.55, 'rgba(255,120,90,0.55)');
    sg.addColorStop(1, 'rgba(255,80,90,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // 复古横条
    ctx.fillStyle = 'rgba(10,6,20,0.55)';
    for (var b = 0; b < 6; b++) {
      var by = sunY + b * sunR * 0.16 - sunR * 0.1;
      ctx.fillRect(sunX - sunR, by, sunR * 2, 3 + b * 1.4);
    }

    this.drawMountains(cam, hz, 0.22, '#1a1230', 0.9);
    this.drawMountains(cam, hz, 0.13, '#0f0b22', 1.6);
  };

  Renderer.prototype.drawMountains = function (cam, hz, scale, color, speedFactor) {
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var offset = (cam.z * 2 + cam.x * 3) * speedFactor;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, hz + 2);
    for (var x = 0; x <= w + 40; x += 40) {
      var k = (x + offset) * 0.006;
      var y = hz - (Math.sin(k) * 0.5 + Math.sin(k * 2.3 + 1.7) * 0.3 + 1) * h * scale * 0.5;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w + 40, hz + 2);
    ctx.closePath();
    ctx.fill();
  };

  Renderer.prototype.drawGround = function (cam) {
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var hz = this.horizon;

    var g = ctx.createLinearGradient(0, hz, 0, h);
    g.addColorStop(0, '#191030');
    g.addColorStop(0.4, '#120b24');
    g.addColorStop(1, '#07050f');
    ctx.fillStyle = g;
    ctx.fillRect(0, hz, w, h - hz);

    // 赛道面：从相机脚下开始，避免画面底部出现"悬空"缺口
    var near = cam.z + 1.2;
    var far = 170;
    var half = C.trackHalfWidth;
    this.face(cam, [
      [-half, 0, near], [half, 0, near], [half, 0, far], [-half, 0, far]
    ], '#1d1533', null);

    // 外沿发光边
    this.face(cam, [
      [-half - 0.18, 0, near], [-half, 0, near], [-half, 0, far], [-half - 0.18, 0, far]
    ], 'rgba(93,225,255,0.35)', null);
    this.face(cam, [
      [half, 0, near], [half + 0.18, 0, near], [half + 0.18, 0, far], [half, 0, far]
    ], 'rgba(93,225,255,0.35)', null);

    // 车道线（虚线）
    var laneW = C.laneWidth;
    for (var l = 0; l < C.lanes - 1; l++) {
      var lx = -half + laneW * (l + 1);
      for (var z = near; z < far; z += 7) {
        this.face(cam, [
          [lx - 0.05, 0.01, z], [lx + 0.05, 0.01, z],
          [lx + 0.05, 0.01, z + 3.6], [lx - 0.05, 0.01, z + 3.6]
        ], 'rgba(150,190,255,0.16)', null);
      }
    }
  };

  /** 速度感的横向条纹（贴地） */
  Renderer.prototype.drawStripes = function (cam, distance) {
    var half = C.trackHalfWidth;
    var near = cam.z + 1.2;
    var base = Math.ceil(distance / 12) * 12;
    for (var i = 0; i < 14; i++) {
      var z = base + i * 12 - distance;
      if (z < near || z > 165) continue;
      var a = clamp(0.16 * (1 - z / 150), 0, 0.16);
      if (a <= 0.005) continue;
      this.face(cam, [
        [-half, 0.005, z], [half, 0.005, z],
        [half, 0.005, z + 0.5], [-half, 0.005, z + 0.5]
      ], 'rgba(120,200,255,' + a.toFixed(3) + ')', null);
    }
  };

  /* ---------------- 障碍 ---------------- */

  Renderer.prototype.drawObstacle = function (cam, obs, absDist, distance, highlight) {
    var rel = absDist - distance;
    if (rel < -6 || rel > 160) return;
    var zNear = rel - obs.depth / 2;
    var zFar = rel + obs.depth / 2;
    if (zNear < cam.z + 1.2) return;

    var x = obs.x;
    var hw = obs.width / 2;

    if (obs.kind === 'low') {
      var top = obs.y1;
      // 侧面（有厚度感）
      this.face(cam, [
        [x + hw, 0, zNear], [x + hw, 0, zFar], [x, top, zFar], [x, top, zNear]
      ], '#b8402a', null);
      // 正面三角
      this.face(cam, [
        [x - hw, 0, zNear], [x + hw, 0, zNear], [x, top, zNear]
      ], '#ff6b3d', 'rgba(255,220,200,0.85)', 2);
      // 内部斜纹
      this.face(cam, [
        [x - hw * 0.45, 0, zNear - 0.01], [x - hw * 0.16, 0, zNear - 0.01],
        [x + hw * 0.18, top * 0.86, zNear - 0.01], [x - hw * 0.11, top * 0.86, zNear - 0.01]
      ], 'rgba(20,10,0,0.35)', null);
    } else {
      var y0 = obs.y0;
      var y1 = obs.y1;
      // 底面
      this.face(cam, [
        [x - hw, y0, zNear], [x + hw, y0, zNear], [x + hw, y0, zFar], [x - hw, y0, zFar]
      ], '#a87b18', null);
      // 正面横杆
      this.face(cam, [
        [x - hw, y0, zNear], [x + hw, y0, zNear], [x + hw, y1, zNear], [x - hw, y1, zNear]
      ], '#ffd166', 'rgba(60,40,0,0.9)', 2);
      // 警示斜纹
      var stripes = 5;
      for (var s = 0; s < stripes; s++) {
        var sx = x - hw + (s + 0.2) * (obs.width / stripes);
        var sw = (obs.width / stripes) * 0.34;
        this.face(cam, [
          [sx, y0 + 0.06, zNear - 0.01], [sx + sw, y0 + 0.06, zNear - 0.01],
          [sx + sw * 0.62, y1 - 0.06, zNear - 0.01], [sx - sw * 0.1, y1 - 0.06, zNear - 0.01]
        ], 'rgba(40,26,0,0.55)', null);
      }
      // 立柱
      this.face(cam, [
        [x - hw - 0.12, 0, zNear], [x - hw, 0, zNear], [x - hw, y1, zNear], [x - hw - 0.12, y1, zNear]
      ], '#7a5a12', null);
      this.face(cam, [
        [x + hw, 0, zNear], [x + hw + 0.12, 0, zNear], [x + hw + 0.12, y1, zNear], [x + hw, y1, zNear]
      ], '#7a5a12', null);
    }

    if (highlight) {
      var pulse = 0.45 + 0.55 * Math.abs(Math.sin(highlight.phase * 7));
      var box = this.project(cam, x, obs.y1, zNear);
      var box2 = this.project(cam, x, 0, zNear);
      if (box && box2) {
        var pad = 14;
        var hh = Math.abs(box2.y - box.y) + pad * 2;
        var ww = Math.max(18, obs.width * box.s) + pad;
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255,60,80,' + (0.35 + 0.5 * pulse).toFixed(2) + ')';
        this.ctx.lineWidth = 3;
        this.ctx.globalAlpha = 0.9;
        roundRectPath(this.ctx, box.x - ww / 2, box.y - pad, ww, hh, 8);
        this.ctx.stroke();
        this.ctx.restore();
      }
    }
  };

  /* ---------------- 金币 / 道具 ---------------- */

  Renderer.prototype.drawCoin = function (cam, coin, time) {
    var p = this.project(cam, coin.x, coin.y, coin.dist - (cam.distance || 0));
    if (!p) return;
    var r = 0.34 * p.s;
    if (r < 1.4) return;
    var spin = Math.max(0.25, Math.abs(Math.cos(time * 3 + coin.phase)));
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(r / 4, 0.55, 1);

    if (this.quality === 'high' && r > 4) {
      var glow = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 2.1);
      glow.addColorStop(0, 'rgba(255,220,120,0.42)');
      glow.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    var g = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.45, '#ffd447');
    g.addColorStop(1, '#d99416');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, Math.max(1, r * spin), r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,205,0.95)';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.stroke();

    // 高光
    ctx.globalAlpha *= 0.8;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(p.x - r * 0.22 * spin, p.y - r * 0.3, Math.max(0.6, r * 0.22 * spin), Math.max(0.6, r * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawItem = function (cam, item, time) {
    var z = item.dist - (cam.distance || 0);
    var p = this.project(cam, item.x, item.y + Math.sin(time * 2.2) * 0.12, z);
    if (!p) return;
    var s = p.s;
    var r = 0.42 * s;
    if (r < 2) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(time * 1.6) * 0.25);
    var g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, item.color || '#7ef0ff');
    g.addColorStop(1, '#3b7bff');
    ctx.fillStyle = g;
    roundRectPath(ctx, -r, -r, r * 2, r * 2, r * 0.36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.2, r * 0.1);
    ctx.stroke();

    ctx.fillStyle = 'rgba(8,12,28,0.9)';
    ctx.font = 'bold ' + Math.round(r * 1.05) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.glyph || '?', 0, r * 0.05);
    ctx.restore();
  };

  /* ---------------- 角色 ---------------- */

  Renderer.prototype.drawPlayer = function (cam, player, view) {
    var ctx = this.ctx;
    var base = this.project(cam, player.x, 0, 0);
    if (!base) return;
    var s = base.s;
    var airborne = player.y > 0.01;
    // 蹲姿权重：0 = 站姿，1 = 蹲姿。再做一次 smoothstep，让起落都不"顿"。
    var rawCrouch = view.crouch == null ? (player.state === 'slide' ? 1 : 0) : view.crouch;
    rawCrouch = clamp(rawCrouch, 0, 1);
    var k = rawCrouch * rawCrouch * (3 - 2 * rawCrouch);

    // 影子：下蹲时更宽、更扁
    ctx.save();
    var shadowSquash = clamp(1 - player.y * 0.35, 0.4, 1);
    ctx.globalAlpha = 0.45 * shadowSquash;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(
      base.x,
      base.y,
      (0.5 + 0.16 * k) * s,
      (0.16 + 0.05 * k) * s * shadowSquash,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    var skin = view.skin || C.skins[0];
    var body = skin.color;
    var accent = skin.accent;
    var phase = view.runPhase || 0;

    ctx.save();
    ctx.translate(base.x, base.y - player.y * s);
    ctx.scale(s, -s); // 以"米"为单位，y 向上

    // 蹲姿：只降重心 + 屈膝，身体保持直立，不做整体前倾
    var P = C.player;
    var hipY = lerp(0.72, P.crouchHipY, k);
    var shoulderY = lerp(1.34, P.crouchShoulderY, k);
    var headY = lerp(1.56, P.crouchHeadY, k);
    var headR = lerp(0.17, 0.155, k);
    var torsoW = lerp(0.48, P.crouchWidth, k);

    var legAmp = 0.85 * (1 - 0.75 * k);
    var swing = airborne ? 0.5 : Math.sin(phase) * legAmp;
    var swing2 = airborne ? -0.3 : Math.sin(phase + Math.PI) * legAmp;

    // 腿：站立时前后摆；蹲下时髋 → 膝 → 脚 折起来（膝盖外展）
    ctx.strokeStyle = body;
    ctx.lineWidth = lerp(0.16, 0.14, k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var li = 0; li < 2; li++) {
      var side = li === 0 ? -1 : 1;
      var ph = li === 0 ? swing : swing2;
      var footX = side * (0.10 + 0.09 * k) + Math.sin(ph) * 0.34 * (1 - k);
      var footY = 0.03 + Math.max(0, Math.sin(ph)) * 0.10 * (1 - k);
      var kneeX = side * (0.10 + 0.16 * k);
      var kneeY = (hipY + footY) * 0.55 + 0.02;
      ctx.moveTo(0, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(footX, footY);
    }
    ctx.stroke();

    // 躯干：变矮、变宽，但始终竖直
    ctx.fillStyle = body;
    var torsoTop = shoulderY + 0.06;
    var torsoBottom = hipY - 0.06;
    var torsoH = torsoTop - torsoBottom;
    roundRectPath(ctx, -torsoW / 2, torsoBottom, torsoW, torsoH, lerp(0.18, 0.15, k));
    ctx.fill();

    // 胸甲高光
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    var chestH = torsoH * 0.46;
    roundRectPath(ctx, -torsoW * 0.27, torsoTop - chestH - 0.05, torsoW * 0.54, chestH, 0.1);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 手臂：贴着身体两侧下垂，蹲下时更贴身
    ctx.strokeStyle = body;
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    var armAmp = 0.9 * (1 - 0.55 * k);
    var armSwing = airborne ? -0.6 : Math.sin(phase + Math.PI) * armAmp;
    var armSwing2 = airborne ? 0.7 : Math.sin(phase) * armAmp;
    var armLen = lerp(0.34, 0.30, k);
    var armOut = lerp(0.02, 0.10, k);
    ctx.moveTo(0, shoulderY - 0.02);
    ctx.lineTo(Math.sin(armSwing) * armLen - armOut, shoulderY - 0.02 - Math.cos(armSwing) * armLen);
    ctx.moveTo(0, shoulderY - 0.02);
    ctx.lineTo(Math.sin(armSwing2) * armLen + armOut, shoulderY - 0.02 - Math.cos(armSwing2) * armLen);
    ctx.stroke();

    // 头
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // 护盾光圈：跟着重心走
    if (view.shield) {
      ctx.strokeStyle = 'rgba(120,220,255,0.85)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(0, (hipY + headY) * 0.5, 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------------- 粒子 ---------------- */

  Renderer.prototype.drawParticles = function (cam, particles, distance) {
    var ctx = this.ctx;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var z = p.z - distance;
      var proj = this.project(cam, p.x, p.y, z);
      if (!proj) continue;
      var r = Math.max(1.2, p.size * proj.s);
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* ---------------- 后期 ---------------- */

  Renderer.prototype.drawPost = function (view) {
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var hz = this.horizon;

    // 远处雾化
    var fog = ctx.createLinearGradient(0, hz - 6, 0, hz + h * 0.16);
    fog.addColorStop(0, 'rgba(60,26,52,0.95)');
    fog.addColorStop(1, 'rgba(60,26,52,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, hz - 6, w, h * 0.2);

    // 速度线
    var speed = view.speed || C.speed.v0;
    var ratio = clamp((speed - C.speed.v0) / (C.speed.vMax - C.speed.v0), 0, 1);
    if (ratio > 0.25 && this.quality === 'high') {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,220,255,' + (0.05 + ratio * 0.12).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      var cx = w / 2;
      var cy = hz;
      for (var i = 0; i < 14; i++) {
        var ang = (i / 14) * Math.PI * 2 + (view.time || 0) * 0.6;
        var r0 = h * 0.35 + (i % 3) * 20;
        var r1 = r0 + h * 0.16 * ratio;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.7);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 暗角
    var v = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, h * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  };

  /* ---------------- 主入口 ---------------- */

  Renderer.prototype.draw = function (view) {
    var ctx = this.ctx;
    var cam = this.makeCamera(view);
    cam.distance = view.distance;

    ctx.clearRect(0, 0, this.w, this.h);

    this.drawSky(cam, view.time || 0);
    this.drawGround(cam);
    this.drawStripes(cam, view.distance);

    // 远 → 近
    var blocks = view.blocks || [];
    var order = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var relStart = b.startDist - view.distance;
      if (relStart > 160 || b.endDist - view.distance < -8) continue;
      order.push(b);
    }
    order.sort(function (a, b) { return b.startDist - a.startDist; });

    for (var oi = 0; oi < order.length; oi++) {
      var block = order[oi];
      // 金币/道具先画（在障碍后面）
      for (var ci = 0; ci < block.coins.length; ci++) {
        if (block.coins[ci].taken) continue;
        this.drawCoin(cam, block.coins[ci], view.time || 0);
      }
      if (block.item && !block.item.taken) {
        this.drawItem(cam, block.item, view.time || 0);
      }
      var hl = null;
      if (view.highlight && view.highlight.blockIndex === block.index) {
        hl = view.highlight;
      }
      for (var k = 0; k < block.obstacles.length; k++) {
        var obs = block.obstacles[k];
        if (obs.hitDone) continue;
        var abs = block.startDist + obs.z;
        var isHl = hl && hl.obstacleLane === obs.lane;
        this.drawObstacle(cam, obs, abs, view.distance, isHl ? hl : null);
      }
    }

    if (view.player) {
      this.drawPlayer(cam, view.player, view);
    }

    this.drawParticles(cam, view.particles || [], view.distance);
    this.drawPost(view);
  };

  global.RR.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
