/* =========================================================================
 * SaveService —— 原子写入 / 损坏降级 / 结算即存（PRD R-12）
 *
 * Web 版把 Unity 的"临时文件 + 改名"映射为：
 *   1) 写 tmp 键
 *   2) 写主键（提交点）
 *   3) 写备份键
 *   4) 删除 tmp 键
 * 读档顺序：主键 → 备份键 → tmp 键 → 默认存档；任何一步解析失败都降级，绝不抛错。
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.RR.CONFIG;

  function defaultSave() {
    return {
      version: C.save.schemaVersion,
      coins: 0,
      bestScore: 0,
      bestDistance: 0,
      totalRuns: 0,
      totalDistance: 0,
      unlockedSkins: ['classic'],
      settings: {
        sfx: true,
        music: true,
        vibrate: true,
        quality: 'high',
        skin: 'classic'
      },
      createdAt: 0,
      updatedAt: 0
    };
  }

  function isNumber(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
  }

  function asInt(n, def) {
    return isNumber(n) ? Math.floor(n) : def;
  }

  function asBool(v, def) {
    return typeof v === 'boolean' ? v : def;
  }

  var SKIN_IDS = C.skins.map(function (s) { return s.id; });

  /** 把任意脏数据洗成合法存档；结构不对时返回 null（由调用方降级）。 */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var d = defaultSave();
    var out = {
      version: C.save.schemaVersion,
      coins: asInt(raw.coins, d.coins),
      bestScore: asInt(raw.bestScore, d.bestScore),
      bestDistance: Math.floor(isNumber(raw.bestDistance) ? raw.bestDistance : d.bestDistance),
      totalRuns: asInt(raw.totalRuns, d.totalRuns),
      totalDistance: Math.floor(isNumber(raw.totalDistance) ? raw.totalDistance : d.totalDistance),
      unlockedSkins: d.unlockedSkins.slice(),
      settings: {
        sfx: asBool(raw.settings && raw.settings.sfx, d.settings.sfx),
        music: asBool(raw.settings && raw.settings.music, d.settings.music),
        vibrate: asBool(raw.settings && raw.settings.vibrate, d.settings.vibrate),
        quality: (raw.settings && (raw.settings.quality === 'low' || raw.settings.quality === 'high'))
          ? raw.settings.quality : d.settings.quality,
        skin: d.settings.skin
      },
      createdAt: asInt(raw.createdAt, 0),
      updatedAt: asInt(raw.updatedAt, 0)
    };

    if (Array.isArray(raw.unlockedSkins)) {
      raw.unlockedSkins.forEach(function (id) {
        if (SKIN_IDS.indexOf(id) >= 0 && out.unlockedSkins.indexOf(id) < 0) out.unlockedSkins.push(id);
      });
    }
    var wantSkin = raw.settings && raw.settings.skin;
    out.settings.skin = out.unlockedSkins.indexOf(wantSkin) >= 0 ? wantSkin : 'classic';
    return out;
  }

  /** localStorage 不可用时的内存降级（无痕模式等）。 */
  function MemoryStorage() {
    this.map = Object.create(null);
  }
  MemoryStorage.prototype.getItem = function (k) {
    return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null;
  };
  MemoryStorage.prototype.setItem = function (k, v) {
    this.map[k] = String(v);
  };
  MemoryStorage.prototype.removeItem = function (k) {
    delete this.map[k];
  };

  function probeStorage() {
    try {
      var st = global.localStorage;
      if (!st) return null;
      var probe = '__rr_probe__';
      st.setItem(probe, '1');
      var ok = st.getItem(probe) === '1';
      st.removeItem(probe);
      return ok ? st : null;
    } catch (e) {
      return null;
    }
  }

  function SaveService(storage) {
    this.storage = storage || probeStorage() || new MemoryStorage();
    this.persistent = this.storage !== null && !(this.storage instanceof MemoryStorage);
    this.data = defaultSave();
    this.lastLoadSource = 'none';
    this.load();
  }

  SaveService.prototype.load = function () {
    var self = this;
    var order = [
      { key: C.save.key, name: 'main' },
      { key: C.save.bakKey, name: 'backup' },
      { key: C.save.tmpKey, name: 'temp' }
    ];

    for (var i = 0; i < order.length; i++) {
      var raw = null;
      try {
        raw = this.storage.getItem(order[i].key);
      } catch (e) {
        raw = null;
      }
      if (!raw) continue;
      var parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = null;
      }
      var clean = parsed ? sanitize(parsed) : null;
      if (clean) {
        this.data = clean;
        this.lastLoadSource = order[i].name;
        return this.data;
      }
    }

    // 全部失败：降级为默认存档，并立刻写回，避免每次启动都走降级路径
    this.data = defaultSave();
    this.lastLoadSource = 'default';
    this.persist();
    return this.data;
  };

  SaveService.prototype.persist = function () {
    var d = this.data;
    d.version = C.save.schemaVersion;
    d.updatedAt = Date.now();
    if (!d.createdAt) d.createdAt = d.updatedAt;

    var json;
    try {
      json = JSON.stringify(d);
    } catch (e) {
      return false;
    }

    try {
      var st = this.storage;
      st.setItem(C.save.tmpKey, json);       // 1) 临时文件
      st.setItem(C.save.key, json);          // 2) 提交
      if (st.getItem(C.save.key) !== json) { // 3) 回读校验
        return false;
      }
      st.setItem(C.save.bakKey, json);       // 4) 备份
      st.removeItem(C.save.tmpKey);          // 5) 清理
      return true;
    } catch (e) {
      return false;
    }
  };

  /** 结算即存：合并本局结果。 */
  SaveService.prototype.recordRun = function (run) {
    var d = this.data;
    var isBestScore = run.score > d.bestScore;
    var isBestDistance = run.distance > d.bestDistance;

    d.coins += Math.max(0, Math.floor(run.coins || 0));
    d.bestScore = Math.max(d.bestScore, Math.floor(run.score || 0));
    d.bestDistance = Math.max(d.bestDistance, Math.floor(run.distance || 0));
    d.totalRuns += 1;
    d.totalDistance += Math.max(0, Math.floor(run.distance || 0));

    var unlocked = [];
    C.skins.forEach(function (skin) {
      if (d.bestDistance >= skin.unlockDistance && d.unlockedSkins.indexOf(skin.id) < 0) {
        d.unlockedSkins.push(skin.id);
        unlocked.push(skin);
      }
    });

    this.persist();
    return { bestScore: isBestScore, bestDistance: isBestDistance, unlockedSkins: unlocked };
  };

  SaveService.prototype.reset = function () {
    this.data = defaultSave();
    this.persist();
    return this.data;
  };

  SaveService.prototype.setSetting = function (key, value) {
    this.data.settings[key] = value;
    this.persist();
  };

  global.RR.SaveService = SaveService;
  global.RR.MemoryStorage = MemoryStorage;
  global.RR.sanitizeSave = sanitize;
  global.RR.defaultSave = defaultSave;
})(typeof globalThis !== 'undefined' ? globalThis : this);
