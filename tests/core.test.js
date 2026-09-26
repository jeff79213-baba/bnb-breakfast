'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const hotSrcRoom = { roomNumber: '101', source: '官網', vegan: '', eggMilk: '' };
const platformRoom = { roomNumber: '312', source: 'Booking.com', vegan: '', eggMilk: '' };
const addonRoom = { roomNumber: '308', source: 'Agoda', vegan: '', eggMilk: '加購' };
const noAddRoom = { roomNumber: '507', source: '官網', vegan: '不加購', eggMilk: '' };
const noMealRoom = { roomNumber: '102', source: '手動訂單', vegan: '', eggMilk: '', mealTime: '不用餐' };

test('isHotSource: 手動/官網/官網訂單為熟食來源，其餘不是', () => {
  assert.strictEqual(C.isHotSource('手動訂單'), true);
  assert.strictEqual(C.isHotSource('官網訂單'), true);
  assert.strictEqual(C.isHotSource('官網'), true);
  assert.strictEqual(C.isHotSource('Booking.com'), false);
  assert.strictEqual(C.isHotSource(''), false);
  assert.strictEqual(C.isHotSource(undefined), false);
});

test('isAddon: eggMilk 含加購，或 vegan === 加購', () => {
  assert.strictEqual(C.isAddon(addonRoom), true);
  assert.strictEqual(C.isAddon({ eggMilk: '蛋奶加購' }), true);
  assert.strictEqual(C.isAddon({ vegan: '加購' }), true);
  assert.strictEqual(C.isAddon({ vegan: '不加購' }), false);
  assert.strictEqual(C.isAddon(platformRoom), false);
  assert.strictEqual(C.isAddon(undefined), false);
});

test('isNoAdd: vegan === 不加購', () => {
  assert.strictEqual(C.isNoAdd(noAddRoom), true);
  assert.strictEqual(C.isNoAdd(platformRoom), false);
});

test('isHotRoom / isPlatformRoom: 真理表', () => {
  assert.strictEqual(C.isHotRoom(hotSrcRoom), true);     // 官網 → 熟食
  assert.strictEqual(C.isHotRoom(platformRoom), false);  // Booking → 平台
  assert.strictEqual(C.isHotRoom(addonRoom), true);      // Agoda+加購 → 熟食
  assert.strictEqual(C.isHotRoom(noAddRoom), false);     // 官網但不加購 → 平台
  assert.strictEqual(C.isPlatformRoom(platformRoom), true);
  assert.strictEqual(C.isPlatformRoom(hotSrcRoom), false);
});

test('平台房改加購（vegan=加購）→ 排進熟食並計入未用餐', () => {
  const edited = { ...platformRoom, vegan: '加購', eggMilk: '' };
  assert.strictEqual(C.isHotRoom(edited), true);
  assert.strictEqual(C.isPlatformRoom(edited), false);
  assert.strictEqual(C.computeHotPending([edited], () => 'pending'), 1);
  assert.strictEqual(C.computeStats([edited], () => 'pending').hot, 1);
  assert.strictEqual(C.computeStats([edited], () => 'pending').addon, 1);
});

test('isNoMeal: mealTime === 不用餐', () => {
  assert.strictEqual(C.isNoMeal(noMealRoom), true);
  assert.strictEqual(C.isNoMeal(hotSrcRoom), false);
});

test('computeHotPending: 熟食區未用餐且扣除不用餐', () => {
  const rooms = [hotSrcRoom, platformRoom, addonRoom, noAddRoom, noMealRoom];
  const statusOf = () => 'pending'; // 全部未用餐
  // 熟食 = 101, 308；207 平台、507 不加購(平台)、102 不用餐(扣除)
  assert.strictEqual(C.computeHotPending(rooms, statusOf), 2);
  const allDone = () => 'completed';
  assert.strictEqual(C.computeHotPending(rooms, allDone), 0);
});

test('computeStats: 熟食含加購、熟食+平台=總數', () => {
  const rooms = [hotSrcRoom, platformRoom, addonRoom, noAddRoom];
  const statusOf = (r) => (r.roomNumber === '101' ? 'completed' : 'pending');
  const s = C.computeStats(rooms, statusOf);
  assert.strictEqual(s.hot, 2);        // 101(官網) + 308(加購)
  assert.strictEqual(s.normal, 2);     // 312 + 507(不加購)
  assert.strictEqual(s.addon, 1);      // 308
  assert.strictEqual(s.completed, 1);
  assert.strictEqual(s.pending, 3);
  assert.strictEqual(s.total, 4);
});

test('normalizeSlots / addSlot / enabledSlots: 時段操作', () => {
  assert.deepStrictEqual(C.normalizeSlots([' 8:15 ', '', ' 9:30']), ['8:15', '9:30']);
  assert.deepStrictEqual(C.normalizeSlots(undefined), []);

  let slots = C.addSlot([], '8:15');
  slots = C.addSlot(slots, '8:15');       // 重複不加
  slots = C.addSlot(slots, ' 9:30 ');     // 去空白
  slots = C.addSlot(slots, '');           // 空不加
  assert.deepStrictEqual(slots, [{ label: '8:15', enabled: true }, { label: '9:30', enabled: true }]);

  const mixed = [{ label: '8:15', enabled: true }, { label: '9:30', enabled: false }, { label: ' 10:00 ', enabled: true }];
  assert.deepStrictEqual(C.enabledSlots(mixed), ['8:15', '10:00']);
  assert.deepStrictEqual(C.enabledSlots([]), []);
});

test('sortSlots: 依時間由小到大，無法解析的放最後', () => {
  const slots = [
    { label: '9:30', enabled: true },
    { label: '8:15', enabled: true },
    { label: '10:00', enabled: true },
    { label: '早餐後', enabled: false },
    { label: '12:05', enabled: true },
  ];
  const sorted = C.sortSlots(slots);
  assert.deepStrictEqual(sorted.map(s => s.label), ['8:15', '9:30', '10:00', '12:05', '早餐後']);
  assert.strictEqual(sorted[4].enabled, false);
  assert.strictEqual(C.sortSlots(undefined).length, 0);
});

test('assignGroupColors: 依 orderId 分組、空 orderId 退 source、穩定', () => {
  const palette = ['#e64980', '#9775fa', '#4dabf7'];
  const rooms = [
    { roomNumber: '106', orderId: 'A', source: '官網' },
    { roomNumber: '301', orderId: 'A', source: '官網' },
    { roomNumber: '508', orderId: 'A', source: '官網' },
    { roomNumber: '312', orderId: '', source: '短租' },
    { roomNumber: '507', orderId: '', source: '短租' },
    { roomNumber: '101', orderId: '', source: 'Booking.com' },
  ];
  const m = C.assignGroupColors(rooms, palette);
  assert.strictEqual(m['106'], m['301']);  // 同訂單同色
  assert.strictEqual(m['301'], m['508']);
  assert.strictEqual(m['312'], m['507']);  // 同來源同色
  assert.notStrictEqual(m['312'], m['101']);
  const m2 = C.assignGroupColors(rooms, palette);
  assert.strictEqual(m['106'], m2['106']); // 穩定
  assert.strictEqual(m['312'], m2['312']);
});

test('sortRoomsGrouped: 同姓名相鄰、組間依最小房號、組內依房號', () => {
  const rooms = [
    { roomNumber: '305', guestName: '王小明' },
    { roomNumber: '306', guestName: '陳大文' },
    { roomNumber: '308', guestName: '王小明' },
    { roomNumber: '502', guestName: '王小明' },
    { roomNumber: '201', guestName: '陳大文' },
  ];
  const out = C.sortRoomsGrouped(rooms).map(r => r.roomNumber);
  // 陳大文組最小 201 < 王小明組最小 305 → 陳大文組在前
  assert.deepStrictEqual(out, ['201', '306', '305', '308', '502']);
});

test('sortRoomsGrouped: 無姓名房排最後（依房號）', () => {
  const rooms = [
    { roomNumber: '502', guestName: '王小明' },
    { roomNumber: '305', guestName: '王小明' },
    { roomNumber: '101', guestName: '' },
    { roomNumber: '601', guestName: '   ' },
    { roomNumber: '308', guestName: '王小明' },
  ];
  const out = C.sortRoomsGrouped(rooms).map(r => r.roomNumber);
  assert.deepStrictEqual(out, ['305', '308', '502', '101', '601']);
});

test('sortRoomsGrouped: 多組 + 無姓名混合、結果穩定、空輸入', () => {
  const rooms = [
    { roomNumber: '507', guestName: '' },
    { roomNumber: '305', guestName: '王小' },
    { roomNumber: '502', guestName: '王小' },
    { roomNumber: '201', guestName: '陳大' },
    { roomNumber: '308', guestName: '王小' },
    { roomNumber: '306', guestName: '陳大' },
    { roomNumber: '101', guestName: '' },
  ];
  const expected = ['201', '306', '305', '308', '502', '101', '507'];
  assert.deepStrictEqual(C.sortRoomsGrouped(rooms).map(r => r.roomNumber), expected);
  assert.deepStrictEqual(C.sortRoomsGrouped(rooms).map(r => r.roomNumber), expected); // 穩定
  assert.deepStrictEqual(C.sortRoomsGrouped([]), []);
  assert.deepStrictEqual(C.sortRoomsGrouped(undefined), []);
});

test('computeHotPeople: 基本加總（熟食總人數 = 大人 + 小孩）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, infant: 0 },
    { roomNumber: '308', source: 'Agoda', eggMilk: '加購', adult: 1, child: 2, infant: 0 },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 3, kid: 3, people: 6 });
  assert.deepStrictEqual(out.pending, { adult: 3, kid: 3, people: 6 });
});

test('computeHotPeople: 小孩 = child + infant（訂單模式三欄）', () => {
  const rooms = [{ roomNumber: '201', source: '官網', adult: 2, child: 1, infant: 2 }];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.strictEqual(out.total.adult, 2);
  assert.strictEqual(out.total.kid, 3);
  assert.strictEqual(out.total.people, 5);
});

test('computeHotPeople: 已用餐的房間整間扣除（total 不變、pending 減）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, infant: 1 },
    { roomNumber: '308', source: 'Agoda', eggMilk: '加購', adult: 1, child: 0, infant: 0 },
  ];
  const oneDone = C.computeHotPeople(rooms, (r) => (r.roomNumber === '101' ? 'completed' : 'pending'));
  assert.deepStrictEqual(oneDone.total, { adult: 3, kid: 2, people: 5 });
  assert.deepStrictEqual(oneDone.pending, { adult: 1, kid: 0, people: 1 });
  const allDone = C.computeHotPeople(rooms, () => 'completed');
  assert.deepStrictEqual(allDone.total, { adult: 3, kid: 2, people: 5 });
  assert.deepStrictEqual(allDone.pending, { adult: 0, kid: 0, people: 0 });
});

test('computeHotPeople: 排除不用餐的房間（isNoMeal）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, mealTime: '' },
    { roomNumber: '102', source: '手動訂單', adult: 3, child: 3, mealTime: '不用餐' },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 2, kid: 1, people: 3 });
  assert.deepStrictEqual(out.pending, { adult: 2, kid: 1, people: 3 });
});

test('computeHotPeople: 排除非熟食房（平台房、不加購房）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1 },
    { roomNumber: '312', source: 'Booking.com', adult: 4, child: 4 },
    { roomNumber: '507', source: '官網', vegan: '不加購', adult: 5, child: 5 },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 2, kid: 1, people: 3 });
  assert.deepStrictEqual(out.pending, { adult: 2, kid: 1, people: 3 });
});

test('computeHotPeople: 空／undefined 輸入回傳全 0', () => {
  const expected = {
    total: { adult: 0, kid: 0, people: 0 },
    pending: { adult: 0, kid: 0, people: 0 },
  };
  assert.deepStrictEqual(C.computeHotPeople([], () => 'pending'), expected);
  assert.deepStrictEqual(C.computeHotPeople(undefined, () => 'pending'), expected);
});

test('computeHotPeople: 舊純房號模式（無人數欄位）回傳全 0', () => {
  const rooms = [{ roomNumber: '101', source: '官網', vegan: '', eggMilk: '' }];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 0, kid: 0, people: 0 });
  assert.deepStrictEqual(out.pending, { adult: 0, kid: 0, people: 0 });
});