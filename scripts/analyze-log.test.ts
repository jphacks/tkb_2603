import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compareTimer, median, parseLog, report, summarize, timerTicks } from './analyze-log';

const load = (name: string) => parseLog(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

it('提案・休憩・分類・送信の数を集計する', () => {
  const s = summarize(load('sample-log.json'));
  expect(s.promptsShown).toBe(3);
  expect(s.promptActions).toEqual({ next_breakpoint: 1, now: 1, decline: 1 });
  expect(s.waitedSecMedian).toBe(30);
  expect([s.breakStarts, s.breakCompleted, s.breakEndedEarly]).toEqual([2, 1, 1]);
  expect(s.feedback).toEqual({ good: 1, unneeded: 1 });
  expect([s.classifyOk, s.classifyCount]).toEqual([2, 3]);
  expect(s.classifyAvgMs).toBeCloseTo(34000 / 3);
  expect([s.promptsSent, s.responsesDone]).toEqual([3, 3]);
});

it('30 分ごとの時刻に、生成中・入力中・読んでいる最中だったかを数える', () => {
  const c = compareTimer(load('sample-log.json'));
  // 30 分: 生成中(29〜31 分)。60 分: 入力中(59〜61 分)と読んでいる最中(58 分 + 1959 字 ÷ 653 = 61 分まで)
  expect(c).toMatchObject({ ticks: 2, generating: 1, typing: 1, reading: 1, anyBusy: 2 });
});

it('入力・生成の記録が無い古いログでも動く', () => {
  const log = load('sample-log-old.json');
  expect(compareTimer(log)).toMatchObject({ ticks: 2, generating: 0, typing: 0, reading: 1, hasTyping: false });
  expect(report(log)).toContain('(記録なし)');
});

it('記録が長く途切れたら回を分けて、間の時間には鳴らさない', () => {
  const m = 60_000;
  const at = (min: number) => ({ type: 'day_reset' as const, at: min * m, minute: 0 });
  expect(timerTicks([at(0), at(40), at(300), at(365)]).map((t) => t / m)).toEqual([30, 330, 360]);
});

it('中央値', () => {
  expect(median([])).toBeNull();
  expect(median([5, 1, 3])).toBe(3);
  expect(median([4, 1, 3, 2])).toBe(2.5);
});
