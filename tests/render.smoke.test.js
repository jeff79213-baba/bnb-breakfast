'use strict';

/* =========================================================
   render.smoke.test.js — 畫面層冒煙測試（零依賴）
   用最小 DOM stub 實際執行 app.js 的 render()，
   守住診斷報告 §2 那類「ReferenceError 但單元測試抓不到」的 bug。
   ========================================================= */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.join(__dirname, '..');

function makeEl() {
  return {
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: '',
    value: '',
    disabled: false,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0 }; },
    scrollIntoView() {},
    setAttribute() {},
    getAttribute() { return null; },
  };
}

function bootApp() {
  const els = {};
  const store = {};
  const sandbox = {
    console,
    document: {
      getElementById(id) { return els[id] || (els[id] = makeEl()); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      documentElement: makeEl(),
      createElement() { return makeEl(); },
      addEventListener() {},
      body: makeEl(),
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    navigator: {},
    location: { protocol: 'file:', hostname: '', href: 'file:///' },
    setTimeout, clearTimeout,
    confirm: () => true,
    addEventListener() {}, removeEventListener() {},
    innerHeight: 800, scrollY: 0, visualViewport: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(DIR, 'core.js'), 'utf8'), sandbox, { filename: 'core.js' });

  let appSrc = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  appSrc += `
;globalThis.__probe = {
  setState(s) { state = s; },
  render, renderGrid, filterRooms, todayKey,
  isOrderMode, isBreakfast8Mode, noteStar,
  openNoteModal, saveNoteModal, getNote, countNotesToday, clearTodayNotes,
  openVersionModal, APP_VERSION, CHANGELOG,
  openLastImport, makeImportSnapshot
};
`;
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });

  return { P: sandbox.__probe, els };
}

const TYPES = [
  { id: 'hot', label: '熱食', emoji: 'x' },
  { id: 'normal', label: '一般早餐', emoji: 'y' },
];
function mkState(rooms, notes) {
  return {
    version: 1,
    settings: { types: TYPES, prep: {}, mealSlots: [], sortMode: 'room' },
    rooms, daily: {}, notes: notes || {},
  };
}

const { P, els } = bootApp();
const grid = els['roomGrid'];
const tk = P.todayKey();

test('卡片模式：手動房 render 不丟 ReferenceError（報告 §2 原 bug）', () => {
  P.setState(mkState([
    { roomNumber: '101', breakfastType: 'normal' },
    { roomNumber: '102', breakfastType: 'hot' },
  ]));
  assert.doesNotThrow(() => P.render());
  assert.ok(grid.innerHTML.includes('101'), '應畫出卡片 101');
  assert.ok(grid.innerHTML.includes('102'), '應畫出卡片 102');
});

test('卡片模式：renderGrid 直接呼叫也正常（filterRooms 已接回）', () => {
  assert.doesNotThrow(() => P.renderGrid(tk));
  assert.ok(grid.innerHTML.includes('102'));
});

test('卡片模式：＊ 永遠可見（新增入口），有備註時才變金色', () => {
  P.setState(mkState([{ roomNumber: '101', breakfastType: 'normal' }]));
  P.render();
  assert.ok(grid.innerHTML.includes('data-noteedit'), '無備註也要有 ＊ 當入口');
  assert.ok(!grid.innerHTML.includes('#fff3bf'), '無備註時不該是金色底');

  P.setState(mkState(
    [{ roomNumber: '101', breakfastType: 'normal' }],
    { [tk]: { '101': { veg: '1人全素' } } }
  ));
  P.render();
  assert.ok(grid.innerHTML.includes('data-noteedit'), '有備註仍有 ＊');
  assert.ok(grid.innerHTML.includes('#fff3bf'), '有備註應變金色底');
});

test('8 欄模式：兩欄表格 render 正常', () => {
  P.setState(mkState([
    { roomNumber: '201', source: '官網', adult: 2, child: 1, mealTime: '', breakfastType: 'hot' },
  ]));
  assert.strictEqual(P.isBreakfast8Mode(), true);
  assert.doesNotThrow(() => P.render());
  assert.ok(grid.innerHTML.includes('大人'), '應畫出表頭');
});

test('新訂單模式：renderOrderGrid 正常', () => {
  P.setState(mkState([
    { roomNumber: '301', source: '手動訂單', adult: 2, child: 0, infant: 1, mealTime: '', breakfastType: 'hot', orderId: 'A1' },
  ]));
  assert.strictEqual(P.isOrderMode(), true);
  assert.doesNotThrow(() => P.render());
  assert.ok(grid.innerHTML.includes('301'));
});

test('新訂單模式：排序「尚未用餐」把未用餐排前面', () => {
  const s = mkState([
    { roomNumber: '301', source: '手動訂單', adult: 1, child: 0, infant: 0, mealTime: '', breakfastType: 'hot', orderId: 'A1' },
    { roomNumber: '302', source: '官網', adult: 2, child: 0, infant: 0, mealTime: '', breakfastType: 'hot', orderId: 'A2' },
  ]);
  s.settings.sortMode = 'pending';
  s.daily = { [tk]: { '301': 'completed' } };
  P.setState(s);
  assert.doesNotThrow(() => P.render());
  assert.ok(grid.innerHTML.indexOf('302') < grid.innerHTML.indexOf('301'), '未用餐 302 應排在已用餐 301 前面');
});

test('查看匯入資料：沒有紀錄時顯示提示，不當機', () => {
  const s = mkState([]);
  s.lastImport = null;
  P.setState(s);
  assert.doesNotThrow(() => P.openLastImport());
  assert.ok(els['lastImportSummary'].textContent.includes('尚無匯入紀錄'));
});

test('查看匯入資料：8 欄快照顯示欄位與原始 B~H', () => {
  const snap = P.makeImportSnapshot({
    isBreakfast8: true,
    rows: [{
      roomNumber: '201', source: '官網', status: '續住', eggMilk: '', vegan: '不加購',
      adult: '2', child: '1', mealTime: '08:00',
      raw: ['', '201', '官網', '續住', '不', '加', '購', '08:00'],
    }],
    issues: ['第 9 列：房號 999 重複'],
  });
  const s = mkState([]);
  s.lastImport = snap;
  P.setState(s);
  assert.doesNotThrow(() => P.openLastImport());
  const list = els['lastImportList'].innerHTML;
  assert.ok(els['lastImportSummary'].innerHTML.includes('早餐統計 8 欄'));
  assert.ok(list.includes('201'));
  assert.ok(list.includes('續住'));
  assert.ok(list.includes('續住｜不｜加｜購｜08:00'), '應顯示原始 B~H 欄位');
  assert.ok(els['lastImportIssues'].innerHTML.includes('第 9 列'));
});

test('混合資料（37 間新訂單 + 手動加 101）：some 判斷不讓整頁掉回卡片', () => {
  const rooms = [];
  for (let i = 0; i < 37; i++) {
    rooms.push({ roomNumber: String(200 + i), source: '官網', adult: 2, child: 1, infant: 0, mealTime: '', breakfastType: 'hot', orderId: 'O' + i });
  }
  rooms.push({ roomNumber: '101', breakfastType: 'normal' });
  P.setState(mkState(rooms));
  assert.strictEqual(P.isOrderMode(), true);
  assert.doesNotThrow(() => P.render());
  assert.ok(grid.innerHTML.includes('200'), '匯入的房號不應消失');
});

test('noteModal 來回：開窗讀空、存檔寫入 notes、＊ 隨之出現', () => {
  P.setState(mkState([{ roomNumber: '101', breakfastType: 'normal' }]));
  P.openNoteModal('101');
  assert.strictEqual(els['noteEatenInput'].value, '');
  assert.strictEqual(els['noteVegInput'].value, '');
  els['noteEatenInput'].value = '1大 07:30 已吃';
  els['noteVegInput'].value = '1人全素，其餘葷';
  P.saveNoteModal();
  assert.strictEqual(P.getNote(tk, '101', 'eaten'), '1大 07:30 已吃');
  assert.strictEqual(P.getNote(tk, '101', 'veg'), '1人全素，其餘葷');
  assert.strictEqual(P.countNotesToday(), 1);
  assert.ok(grid.innerHTML.includes('data-noteedit'));
});

test('清空今日備註：notes 歸零、＊ 由金色退回淡灰', () => {
  P.clearTodayNotes();
  assert.strictEqual(P.countNotesToday(), 0);
  assert.ok(grid.innerHTML.includes('data-noteedit'), '＊ 仍在（當入口）');
  assert.ok(!grid.innerHTML.includes('#fff3bf'), '金色底應消失');
});

test('版本紀錄：目前版本與清單都畫得出來，最新版在最上面', () => {
  assert.doesNotThrow(() => P.openVersionModal());
  assert.strictEqual(els['versionCurrent'].textContent, P.APP_VERSION, '應顯示目前版本');
  const list = els['versionList'].innerHTML;
  assert.ok(list.includes(P.APP_VERSION), '清單應含目前版本');
  assert.ok(list.includes('v22'), '清單應含歷史版本');
  assert.ok(list.indexOf(P.APP_VERSION) < list.indexOf('v22'), '最新版應排最前面');
});

test('三種畫面都有 ＊ 入口（資料層測試）', () => {
  P.setState(mkState([{ roomNumber: '201', source: '官網', adult: 2, child: 1, mealTime: '', breakfastType: 'hot' }]));
  P.render();
  assert.ok(grid.innerHTML.includes('data-noteedit'), '8 欄模式要有 ＊');
  P.setState(mkState([{ roomNumber: '301', source: '手動訂單', adult: 1, child: 0, infant: 0, mealTime: '', breakfastType: 'hot', orderId: 'A1' }]));
  P.render();
  assert.ok(grid.innerHTML.includes('data-noteedit'), '新訂單模式要有 ＊');
});
