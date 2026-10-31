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

  /* ===== 批次文字指令 =====
     一行一間房；句子順序不限，抓房號、幾大幾小、加購、素食、不用餐、時間、已吃/未吃。
     解析結果只回傳 patch，不直接改資料，讓畫面先顯示確認表。 */
  const CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const CN_NUM = '[0-9零〇一二兩两三四五六七八九十]+';

  function normalizeCommandText(v) {
    return String(v == null ? '' : v)
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：]/g, ':')
      .replace(/\u3000/g, ' ');
  }

  function cnToInt(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (!/^[零〇一二兩两三四五六七八九十]+$/.test(s)) return null;
    if (s.includes('十')) {
      const parts = s.split('十');
      if (parts.length > 2) return null;
      const tens = parts[0] === '' ? 1 : CN_DIGIT[parts[0]];
      const ones = parts[1] === '' ? 0 : CN_DIGIT[parts[1]];
      if (tens == null || ones == null) return null;
      return tens * 10 + ones;
    }
    let n = 0;
    for (const ch of s) {
      if (CN_DIGIT[ch] == null) return null;
      n = n * 10 + CN_DIGIT[ch];
    }
    return n;
  }

  // 抓出句中的 3~4 位房號 token（可帶 N）
  function roomTokens(text) {
    const re = /(?:^|[^\d])(\d{3,4})([Nn])?(?!\d)/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const no = m[1] + (m[2] ? 'N' : '');
      out.push({ at: m.index + (m[0].length - no.length), no, digits: m[1], hasN: !!m[2] });
    }
    return out;
  }

  // 一行可能連續講了好幾間房（201 ... 202 ...），用 3 位房號自動拆句；
  // 後面單獨出現的 4 位數字視為用餐時間（例：0830 = 08:30），不當房號。
  function splitRoomCommands(text) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split(/\n|[;；]/);
    const out = [];
    for (const raw of lines) {
      const line = normalizeCommandText(raw).trim();
      if (!line) continue;
      const tokens = roomTokens(line);
      if (!tokens.length) { out.push(line); continue; }
      const starts = [tokens[0]];
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.digits.length === 4 && !t.hasN) continue;
        starts.push(t);
      }
      if (starts.length <= 1) { out.push(line); continue; }
      for (let i = 0; i < starts.length; i++) {
        const start = i === 0 ? 0 : starts[i].at;
        const end = i + 1 < starts.length ? starts[i + 1].at : line.length;
        const seg = line.slice(start, end).trim();
        if (seg) out.push(seg);
      }
    }
    return out;
  }

  function collectCounts(text, re) {
    const vals = [];
    for (const m of text.matchAll(re)) {
      const n = cnToInt(m[1]);
      if (n != null) vals.push(n);
    }
    return [...new Set(vals)];
  }

  function mealLabel(r) {
    if (!r) return '—';
    if (isNoAdd(r)) return '不加購';
    if (isAddon(r)) {
      const s = String(r.eggMilk || '') + ' ' + String(r.vegan || '');
      const type = /全素/.test(s) ? '全素' : /蛋奶/.test(s) ? '蛋奶' : '正常';
      return `加購（${type}）`;
    }
    const parts = [r.eggMilk, r.vegan].filter(x => x && x !== '加購' && x !== '不加購');
    return parts.length ? parts.join(' ') : '未設定';
  }

  function parseRoomCommand(line, rooms) {
    const text = normalizeCommandText(line).trim();
    const errors = [];
    const tokens = roomTokens(text);
    const firstNum = text.match(/\d+/);
    if (!firstNum) return { ok: false, line, errors: ['找不到房號（請把 3~4 位房號放在最前面）'] };
    if (firstNum[0].length < 3 || firstNum[0].length > 4) {
      return { ok: false, line, errors: ['房號要放在最前面（3~4 位數字），例：201 2大1小'] };
    }
    if (!tokens.length) return { ok: false, line, errors: ['找不到房號（請把 3~4 位房號放在最前面）'] };
    const first = tokens[0];
    const inputRoomNumber = first.no;
    const extraRooms = tokens.slice(1).filter(t => t.digits.length !== 4 || t.hasN);
    if (extraRooms.length) return { ok: false, line, roomNumber: inputRoomNumber, errors: ['一句只能一間房，請分行輸入'] };
    const roomKey = v => String(v == null ? '' : v).trim().replace(/[Nn]$/, '');
    const roomOf = r => String(r && r.roomNumber != null ? r.roomNumber : '').trim();
    const room = (rooms || []).find(r => roomOf(r) === inputRoomNumber)
      || (rooms || []).find(r => roomKey(roomOf(r)) === roomKey(inputRoomNumber));
    if (!room) return { ok: false, line, roomNumber: inputRoomNumber, errors: [`房號 ${inputRoomNumber} 不在目前清單`] };
    const roomNumber = roomOf(room);

    // 房號已抓出，其餘文字才拿來判斷人數／餐點／時間，避免把房號數字誤當時間
    const rest = (text.slice(0, first.at) + ' ' + text.slice(first.at + first.no.length)).trim();

    // 人數（中文數字也支援：二大一小）
    const adultVals = collectCounts(rest, new RegExp(`(${CN_NUM})\\s*(?:個)?\\s*(?:大人|成人|大)`, 'g'))
      .concat(collectCounts(rest, new RegExp(`(?:大人|成人)\\s*(${CN_NUM})\\s*(?:位|人)?`, 'g')));
    const childVals = collectCounts(rest, new RegExp(`(${CN_NUM})\\s*(?:個)?\\s*(?:小孩|孩童|小朋友|兒童|童|小)`, 'g'))
      .concat(collectCounts(rest, new RegExp(`(?:小孩|孩童|小朋友|兒童)\\s*(${CN_NUM})\\s*(?:位|人)?`, 'g')));
    const infantVals = collectCounts(rest, new RegExp(`(${CN_NUM})\\s*(?:個)?\\s*(?:嬰幼兒|嬰兒|寶寶|嬰)`, 'g'))
      .concat(collectCounts(rest, new RegExp(`(?:嬰幼兒|嬰兒|寶寶)\\s*(${CN_NUM})\\s*(?:位|人)?`, 'g')));
    const uniq = arr => [...new Set(arr)];
    const adultU = uniq(adultVals), childU = uniq(childVals), infantU = uniq(infantVals);
    if (adultU.length > 1) errors.push('大人數量不明確');
    if (childU.length > 1) errors.push('小孩數量不明確');
    if (infantU.length > 1) errors.push('嬰幼兒數量不明確');
    let adult = adultU[0] ?? null, child = childU[0] ?? null, infant = infantU[0] ?? null;
    if (adult == null && child == null && infant == null) {
      const people = uniq(collectCounts(rest, new RegExp(`(${CN_NUM})\\s*(?:人|位)`, 'g')));
      if (people.length === 1) adult = people[0];
      else if (people.length > 1) errors.push('人數不明確');
    }

    // 加購 / 不加購
    const addonFlags = [];
    for (const a of rest.matchAll(/(不|不要|不用|免)?\s*加購/g)) addonFlags.push(a[1] ? false : true);
    const addonU = uniq(addonFlags);
    if (addonU.length > 1) errors.push('加購與不加購同時出現');
    const addon = addonU.length === 1 ? addonU[0] : null;

    // 素食種類（先移除「正常用餐」避免誤判）
    const mealText = rest.replace(/(?:要|恢復|正常)\s*用餐/g, '');
    const isFull = /全素|純素/.test(mealText);
    const isEgg = /蛋奶(?:素)?/.test(mealText);
    const isNormal = /正常|葷食|葷/.test(mealText);
    if ([isFull, isEgg, isNormal].filter(Boolean).length > 1) errors.push('素食種類不明確');
    const vegType = isFull ? '全素' : isEgg ? '蛋奶' : isNormal ? '正常' : (/素食|吃素/.test(mealText) ? '蛋奶' : null);

    // 用餐 / 不用餐
    const noMeal = /不用餐|不餐|不吃|不用吃/.test(rest);
    const wantMeal = /(?:要|恢復|正常)\s*用餐|要用餐|恢復用餐/.test(rest);
    if (noMeal && wantMeal) errors.push('不用餐與要用餐同時出現');

    // 時間：8:30、08:30、8點半、8點30分，或後面單獨的 4 位數字 0830
    let time = null;
    let tm = rest.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    let hour = null, minute = null, compact = false;
    if (tm) { hour = Number(tm[1]); minute = Number(tm[2]); }
    else {
      tm = rest.match(/(\d{1,2})\s*點\s*(半|\d{1,2}\s*分?)?/);
      if (tm) {
        hour = Number(tm[1]);
        minute = tm[2] === '半' ? 30 : (tm[2] ? parseInt(tm[2], 10) : 0);
      } else {
        tm = rest.match(/(?:^|[^\d])(\d{2})(\d{2})(?!\d)/);
        if (tm) { hour = Number(tm[1]); minute = Number(tm[2]); compact = true; }
      }
    }
    if (tm) {
      const hourOk = compact ? (hour >= 0 && hour <= 23) : (hour >= 1 && hour <= 12);
      if (!hourOk || minute < 0 || minute > 59 || minute % 5 !== 0) {
        errors.push(compact ? '用餐時間請用 4 位數字（例：0830）、5 分鐘為單位' : '用餐時間請用 1~12 點、5 分鐘為單位');
      } else {
        time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }
    if (noMeal && time) errors.push('不用餐與用餐時間同時出現');
    if (noMeal && addon === true) errors.push('不用餐與加購同時出現');
    if (noMeal && vegType) errors.push('不用餐與素食加購同時出現');
    if (addon === false && vegType) errors.push('不加購與素食加購同時出現');

    // 已吃 / 未吃
    const done = /已吃|已用餐|吃過|吃飽|已用/.test(text);
    const notDone = /未吃|未用餐|還沒吃|尚未用餐|未用|取消用餐/.test(text);
    if (done && notDone) errors.push('已用餐與未用餐同時出現');

    const patch = {};
    if (adult != null) patch.adult = adult;
    if (child != null) patch.child = child;
    if (infant != null) patch.infant = infant;
    // 訂單模式把「幾小」視為小孩總數：講了小孩就清嬰幼兒、講了嬰幼兒就清小孩
    if ('infant' in room) {
      if (child != null && infant == null) patch.infant = 0;
      if (infant != null && child == null) patch.child = 0;
    }
    if (addon === false) {
      patch.eggMilk = '';
      patch.vegan = '不加購';
      if (!('infant' in room) && adult == null && child == null && infant == null) {
        patch.adult = '';
        patch.child = '';
      }
    } else if (addon === true || vegType) {
      const s = String(room.eggMilk || '') + ' ' + String(room.vegan || '');
      const currentType = /全素/.test(s) ? '全素' : /蛋奶/.test(s) ? '蛋奶' : '正常';
      const type = vegType || currentType;
      patch.eggMilk = type === '全素' ? '全素加購' : type === '蛋奶' ? '蛋奶加購' : '加購';
      patch.vegan = '';
    }
    if (noMeal) patch.mealTime = '不用餐';
    else if (time) patch.mealTime = time;
    else if (wantMeal) patch.mealTime = '';

    const legacy = !('adult' in room) && !('infant' in room);
    if (legacy && ['adult', 'child', 'infant', 'eggMilk', 'vegan', 'mealTime'].some(k => k in patch)) {
      errors.push('此房為舊格式，請先重新匯入才能改人數／餐點');
    }

    let dailyStatus = null;
    if (done) dailyStatus = 'completed';
    else if (notDone) dailyStatus = 'pending';

    const changes = [];
    const addChange = (label, from, to) => {
      if (String(from == null ? '' : from) !== String(to == null ? '' : to)) {
        changes.push({ label, from: from == null || from === '' ? '—' : String(from), to: to == null || to === '' ? '—' : String(to) });
      }
    };
    if ('adult' in patch) addChange('大人', room.adult, patch.adult);
    if ('child' in patch) addChange('小孩', room.child, patch.child);
    if ('infant' in patch) addChange('嬰幼兒', room.infant, patch.infant);
    if ('eggMilk' in patch || 'vegan' in patch) {
      addChange('餐點', mealLabel(room), mealLabel(Object.assign({}, room, patch)));
    }
    if ('mealTime' in patch) addChange('用餐時間', room.mealTime || '—', patch.mealTime || '—');
    const recognized = adult != null || child != null || infant != null || addon != null || vegType != null
      || noMeal || wantMeal || time != null || done || notDone;
    if (!errors.length && !recognized) {
      errors.push('沒有看懂要改什麼（可用：幾大幾小、加購、不加購、全素、蛋奶、不用餐、時間、已吃、未吃）');
    }

    return {
      ok: errors.length === 0,
      line, roomNumber, room, patch, dailyStatus, changes, errors
    };
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
    normalizeCommandText, cnToInt, splitRoomCommands, parseRoomCommand, mealLabel,
    NOTE_FIELDS, NOTE_MAX, noteGet, noteSet, noteCount, migrateNote,
    clearNotesForDate, sanitizeNotes
  };
});