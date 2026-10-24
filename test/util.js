import {desiredTasks, nextCronTime, parseCron} from '../src/util.ts';
import t from 'tap';

t.test('Util', async t => {
  await t.test('desiredTasks', async t => {
    t.same(desiredTasks({}, [], []), []);
    t.same(desiredTasks({foo: 2}, ['foo', 'bar'], ['foo', 'foo']), ['bar']);
    t.same(desiredTasks({foo: 0}, ['foo', 'bar'], []), ['bar']);
    t.same(desiredTasks({foo: 2}, ['foo', 'bar'], ['foo', 'foo', 'foo']), ['bar']);
    t.same(desiredTasks({foo: 2, bar: 1}, ['foo', 'bar', 'baz'], ['foo', 'bar', 'foo']), ['baz']);
    t.same(desiredTasks({foo: 2, bar: 1}, ['foo', 'bar'], ['foo', 'foo', 'bar']), []);
    t.same(desiredTasks({}, ['foo', 'bar'], ['foo', 'foo']), ['foo', 'bar']);
  });

  await t.test('parseCron: basic forms', async t => {
    t.same(parseCron('* * * * *')[0].values, [...Array(60).keys()]);
    t.equal(parseCron('* * * * *')[0].isStar, true);
    t.equal(parseCron('5 * * * *')[0].isStar, false);
    t.same(parseCron('5,15,25 * * * *')[0].values, [5, 15, 25]);
    t.same(parseCron('0 9-17 * * *')[1].values, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    t.same(parseCron('*/15 * * * *')[0].values, [0, 15, 30, 45]);
    t.same(parseCron('0-30/10 * * * *')[0].values, [0, 10, 20, 30]);
    t.same(parseCron('5/10 * * * *')[0].values, [5]);
    t.ok(parseCron('*/15 * * * *')[0].set.has(45));
  });

  await t.test('parseCron: nicknames', async t => {
    t.same(parseCron('@hourly'), parseCron('0 * * * *'));
    t.same(parseCron('@daily'), parseCron('0 0 * * *'));
    t.same(parseCron('@midnight'), parseCron('0 0 * * *'));
    t.same(parseCron('@weekly'), parseCron('0 0 * * 0'));
    t.same(parseCron('@monthly'), parseCron('0 0 1 * *'));
    t.same(parseCron('@yearly'), parseCron('0 0 1 1 *'));
    t.same(parseCron('@annually'), parseCron('0 0 1 1 *'));
    t.throws(() => parseCron('@bogus'), /Unknown cron nickname "@bogus"/);
  });

  await t.test('parseCron: symbolic names', async t => {
    t.same(parseCron('0 0 * JAN *')[3].values, [1]);
    t.same(parseCron('0 0 * jan-mar *')[3].values, [1, 2, 3]);
    t.same(parseCron('0 0 * * MON-FRI')[4].values, [1, 2, 3, 4, 5]);
    t.same(parseCron('0 0 * * sat,sun')[4].values, [0, 6]);
    t.throws(() => parseCron('* * * BOGUS *'), /Invalid name "BOGUS" in month field/);
    t.throws(() => parseCron('* MON * * *'), /Invalid name "MON" in hour field/);
  });

  await t.test('parseCron: 7 as Sunday', async t => {
    t.same(parseCron('0 0 * * 7')[4].values, [0]);
    t.same(parseCron('0 0 * * 5-7')[4].values, [0, 5, 6]);
    t.same(parseCron('0 0 * * 0,7')[4].values, [0]);
  });

  await t.test('parseCron: errors', async t => {
    t.throws(() => parseCron('* * * *'), /expected 5 fields/);
    t.throws(() => parseCron('* * * * * *'), /expected 5 fields/);
    t.throws(() => parseCron(''), /expected 5 fields/);
    t.throws(() => parseCron('60 * * * *'), /Value out of range in minute field/);
    t.throws(() => parseCron('* 24 * * *'), /Value out of range in hour field/);
    t.throws(() => parseCron('* * 0 * *'), /Value out of range in day-of-month field/);
    t.throws(() => parseCron('* * * 13 *'), /Value out of range in month field/);
    t.throws(() => parseCron('* * * * 8'), /Value out of range in day-of-week field/);
    t.throws(() => parseCron('?? * * * *'), /Invalid minute field/);
    t.throws(() => parseCron('*/0 * * * *'), /Invalid step "0" in minute field/);
    t.throws(() => parseCron('*/ * * * *'), /Invalid step "" in minute field/);
    t.throws(() => parseCron('5-2 * * * *'), /Value out of range in minute field/);
  });

  await t.test('nextCronTime', async t => {
    // 2026-05-12 12:00:00 UTC (Tuesday)
    const base = new Date(Date.UTC(2026, 4, 12, 12));
    const after = seconds => new Date(base.getTime() + seconds * 1000);
    const utc = (...args) => new Date(Date.UTC(...args));

    t.same(nextCronTime('* * * * *', base), after(60));
    t.same(nextCronTime('*/5 * * * *', base), after(300));
    t.same(nextCronTime('0 13 * * *', base), utc(2026, 4, 12, 13));
    t.same(nextCronTime('0 9 * * *', base), utc(2026, 4, 13, 9));
    t.same(nextCronTime('59 23 * * *', base), utc(2026, 4, 12, 23, 59));
    t.same(nextCronTime('0 0 * * *', utc(2026, 11, 31, 23, 59)), utc(2027, 0, 1));

    // Weekday filter
    t.same(nextCronTime('0 9 * * 1-5', base), utc(2026, 4, 13, 9));

    // Vixie OR semantics
    t.same(nextCronTime('0 0 1 * 0', base), utc(2026, 4, 17));

    // Yearly
    t.same(nextCronTime('0 0 1 1 *', base), utc(2027, 0, 1));

    // Boundary rounding
    t.same(nextCronTime('* * * * *', after(30)), after(60));

    // Quadrennial leap years
    t.same(nextCronTime('0 0 29 2 *', utc(2027, 0, 1)), utc(2028, 1, 29));

    // Nicknames
    t.same(nextCronTime('@hourly', base), utc(2026, 4, 12, 13));
    t.same(nextCronTime('@daily', base), utc(2026, 4, 13));
    t.same(nextCronTime('@yearly', base), utc(2027, 0, 1));

    // Symbolic names
    t.same(nextCronTime('0 9 * * MON-FRI', base), utc(2026, 4, 13, 9));
    t.same(nextCronTime('0 0 1 JAN *', base), utc(2027, 0, 1));

    // 7 as Sunday
    t.same(nextCronTime('0 0 * * 7', base), utc(2026, 4, 17));

    // Parse once
    const cron = parseCron('*/5 * * * *');
    t.same(nextCronTime(cron, base), after(300));
    t.same(nextCronTime(cron, after(300)), after(600));

    // No match
    t.throws(() => nextCronTime('0 0 31 2 *', base), /No matching time found for cron expression/);
  });
});
