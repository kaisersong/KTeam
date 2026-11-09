import{test}from'node:test';import assert from'node:assert/strict';import{calendarWindow}from'../src/runtime/calendar.js';
test('Sunday stays this week; Monday rolls over using user timezone rather than UTC date',()=>{
 const sunday=calendarWindow(new Date('2026-11-08T15:59:59Z'),'Asia/Shanghai');assert.equal(sunday.weekStart,'2026-11-02');assert.equal(sunday.weekEnd,'2026-11-08');assert.equal(sunday.weekday,'周日');
 const monday=calendarWindow(new Date('2026-11-08T16:00:00Z'),'Asia/Shanghai');assert.equal(monday.today,'2026-11-09');assert.equal(monday.weekStart,'2026-11-09');assert.equal(monday.weekEnd,'2026-11-15');assert.equal(monday.lastWeekStart,'2026-11-02');assert.equal(monday.lastWeekEnd,'2026-11-08');
 const year=calendarWindow(new Date('2027-01-01T12:00:00Z'),'America/New_York');assert.equal(year.weekStart,'2026-12-28');assert.equal(year.weekEnd,'2027-01-03');
});
