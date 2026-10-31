'use strict';

/* =========================================================
   core.js — 純函式（分類 / 統計 / 時段 / 分色）
   瀏覽器：window.BreakfastCore；Node：require('./core.js')
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BreakfastCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const HOT_SOURCES = ['手動訂單', '官網', '官網訂單'];

  function isHotSource(src) {
    const s = String(src == null ? '' : src).trim();
    return HOT_SOURCES.some(h => s.includes(h));
  }

  function isNoAdd(r) {
    return !!(r && r.vegan === '不加購');
  }

  function isAddon(r) {
    if (!r) return false;
    if (/加購/.test(String(r.eggMilk || ''))) return true;
    return r.vegan === '加購';
  }

  function isHotRoom(r) {
    if (!r) return false;
    if (!r.source && !r.vegan && !r.eggMilk) return r.breakfastType === 'hot'; // 純 legacy 房：無來源/全素/蛋奶欄位
    if (isNoAdd(r)) return false;
    return isAddon(r) || isHotSource(r.source);
  }

  function isPlatformRoom(r) {
    return !isHotRoom(r);
  }

  function isNoMeal(r) {
    return !!(r && r.mealTime === '不用餐');
  }

  function computeHotPending(rooms, statusOf) {
    let n = 0;
    for (const r of (rooms || [])) {
      if (!isHotRoom(r)) continue;
      if (isNoMeal(r)) continue;
      if (statusOf(r) !== 'completed') n++;
    }
    return n;
  }

  function computeHotPeople(rooms, statusOf) {
    const zero = () => ({ adult: 0, kid: 0, people: 0 });
    const total = zero();
    const pending = zero();
    for (const r of (rooms || [])) {
      if (!isHotRoom(r)) continue;
      if (isNoMeal(r)) continue;
      const adult = Number(r.adult) || 0;
      const kid = (Number(r.child) || 0) + (Number(r.infant) || 0);
      total.adult += adult; total.kid += kid; total.people += adult + kid;
      if (statusOf(r) !== 'completed') {
        pending.adult += adult; pending.kid += kid; pending.people += adult + kid;
      }
    }
    return { total, pending };
  }

  function computeStats(rooms, statusOf) {
    let hot = 0, normal = 0, addon = 0, completed = 0;
    for (const r of (rooms || [])) {
      if (isAddon(r)) addon++;
      if (isHotRoom(r)) hot++;
      else normal++;
      if (statusOf(r) === 'completed') completed++;
    }
    return { hot, normal, addon, completed, pending: rooms.length - completed, total: rooms.length };
  }

  function normalizeSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots.map(s => String(s == null ? '' : s).trim()).filter(Boolean);
  }

  function addSlot(slots, label) {
    const list = Array.isArray(slots) ? slots.slice() : [];
    const clean = String(label == null ? '' : label).trim();
    if (!clean) return list;
    if (list.some(x => x && String(x.label || '').trim() === clean)) return list;
    list.push({ label: clean, enabled: true });
    return list;
  }

  function enabledSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots.filter(x => x && x.enabled && String(x.label || '').trim())
      .map(x => String(x.label).trim());
  }

  function timeOf(label) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(label == null ? '' : label).trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 1 || h > 12 || min < 0 || min > 59 || min % 5 !== 0) return null;
    return { h, m: min };
  }

  function sortSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots.slice().sort((a, b) => {
      const ta = timeOf(a && a.label), tb = timeOf(b && b.label);
      if (ta && tb) return ta.h - tb.h || ta.m - tb.m;
      if (ta) return -1;
      if (tb) return 1;
      return 0;
    });
  }

  function groupKeyOf(r) {
    if (r && r.orderId && String(r.orderId).trim()) return 'order:' + String(r.orderId).trim();
    return 'src:' + String(r && r.source ? r.source : '').trim();
  }

  function assignGroupColors(rooms, palette) {
    const map = {};
    const groupColor = {};
    let i = 0;
    for (const r of (rooms || [])) {
      const k = groupKeyOf(r);
      if (!(k in groupColor)) { groupColor[k] = palette[i % palette.length]; i++; }
      map[String(r.roomNumber == null ? '' : r.roomNumber).trim()] = groupColor[k];
    }
    return map;
  }

  function roomKeyOf(r) {
    return String(r && r.roomNumber != null ? r.roomNumber : '').trim();
  }

  function roomNumberCmp(a, b) {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    const bothNum = !isNaN(na) && !isNaN(nb) && String(na) === a && String(nb) === b;
    if (bothNum) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function sortRoomsGrouped(list) {
    const rooms = (list || []).slice();
    rooms.sort((x, y) => roomNumberCmp(roomKeyOf(x), roomKeyOf(y)));
    const named = new Map();
    const unnamed = [];
    for (const r of rooms) {
      const name = String(r && r.guestName ? r.guestName : '').trim();
      if (!name) { unnamed.push(r); continue; }
      if (!named.has(name)) named.set(name, []);
      named.get(name).push(r);
    }
    const groups = [...named.values()];
    groups.sort((a, b) => roomNumberCmp(roomKeyOf(a[0]), roomKeyOf(b[0])));
    return groups.flat().concat(unnamed);
  }

  function sortRoomsByMealTime(list) {
    const rooms = (list || []).slice();
    rooms.sort((x, y) => {
      const tx = timeOf(x && x.mealTime);
      const ty = timeOf(y && y.mealTime);
      if (tx && ty) {
        const d = tx.h - ty.h || tx.m - ty.m;
        if (d !== 0) return d;
      } else if (tx) return -1;
      else if (ty) return 1;
      return roomNumberCmp(roomKeyOf(x), roomKeyOf(y));
    });
    return rooms;
  }

  // 尚未用餐優先：未完成者在前、已完成者在後，同組內依房號
  function sortRoomsPendingFirst(list, isDone) {
    const rooms = (list || []).slice();
    const done = typeof isDone === 'function' ? isDone : () => false;
    rooms.sort((x, y) => {
      const dx = done(x) ? 1 : 0;
      const dy = done(y) ? 1 : 0;
      if (dx !== dy) return dx - dy;
      return roomNumberCmp(roomKeyOf(x), roomKeyOf(y));
    });
    return rooms;
  }

  // 清空房號清單；settings（備料比例等）與 daily（用餐紀錄）原樣保留
  function clearRooms(state) {
    return Object.assign({}, state, { rooms: [] });
  }

  /* ===== 房號備註（自由文字，與 rooms/daily/settings 完全分離） =====
     notes = { '2026-10-25': { '201': { eaten:'1大已吃', veg:'1人全素' } } } */
  const NOTE_FIELDS = ['eaten', 'veg'];
  const NOTE_MAX = 300;

  function cleanNoteText(v) {
    return String(v == null ? '' : v).trim().slice(0, NOTE_MAX);
  }

  function noteGet(notes, dateKey, roomNo, field) {
    const day = notes && notes[dateKey];
    const rec = day && day[String(roomNo)];
    const v = rec && rec[field];
    return typeof v === 'string' ? v : '';
  }

  // 空值會刪掉該欄；該房無備註刪房號 key；該日無備註刪日期 key
  function noteSet(notes, dateKey, roomNo, field, value) {
    const next = Object.assign({}, notes || {});
    const day = Object.assign({}, next[dateKey] || {});
    const key = String(roomNo);
    const rec = Object.assign({}, day[key] || {});
    const clean = cleanNoteText(value);
    if (clean) rec[field] = clean;
    else delete rec[field];
    if (Object.keys(rec).length) day[key] = rec;
    else delete day[key];
    if (Object.keys(day).length) next[dateKey] = day;
    else delete next[dateKey];
    return next;
  }

  function noteCount(notes, dateKey, roomNo) {
    const day = notes && notes[dateKey];
    const rec = day && day[String(roomNo)];
    if (!rec) return 0;
    return NOTE_FIELDS.filter(f => rec[f]).length;
  }

  function migrateNote(notes, dateKey, from, to) {
    const f = String(from), t = String(to);
    if (f === t) return notes;
    const day = notes && notes[dateKey];
    if (!day || !day[f]) return notes;
    const next = Object.assign({}, notes);
    const nd = Object.assign({}, day);
    nd[t] = nd[f];
    delete nd[f];
    next[dateKey] = nd;
    return next;
  }

  function clearNotesForDate(notes, dateKey) {
    const next = Object.assign({}, notes || {});
    delete next[dateKey];
    return next;
  }

  function sanitizeNotes(notes) {
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {};
    const out = {};
    for (const dk of Object.keys(notes)) {
      const day = notes[dk];
      if (!day || typeof day !== 'object' || Array.isArray(day)) continue;
      const d = {};
      for (const rk of Object.keys(day)) {
        const rec = day[rk];
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        const r = {};
        for (const f of NOTE_FIELDS) {
          const v = cleanNoteText(rec[f]);
          if (v) r[f] = v;
        }
        if (Object.keys(r).length) d[String(rk)] = r;
      }
      if (Object.keys(d).length) out[String(dk)] = d;
    }
    return out;
  }

  return {
    HOT_SOURCES, isHotSource, isNoAdd, isAddon, isHotRoom, isPlatformRoom,
    isNoMeal, computeHotPending, computeHotPeople, computeStats, normalizeSlots,
    addSlot, enabledSlots, sortSlots, timeOf, groupKeyOf, assignGroupColors,
    sortRoomsGrouped, sortRoomsByMealTime, sortRoomsPendingFirst, clearRooms,
    NOTE_FIELDS, NOTE_MAX, noteGet, noteSet, noteCount, migrateNote,
    clearNotesForDate, sanitizeNotes
  };
});