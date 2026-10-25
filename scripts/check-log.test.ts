import { expect, it } from 'vitest';
import type { StoredLogEntry } from '../src/shared/settings';
import { checkReport, entriesAfter, parseLocalTime, siteFlow } from './check-log';

const m = 60_000;
const o = (min: number, kind: string, site: string, detail?: Record<string, number | boolean>): StoredLogEntry =>
  ({ type: 'observation', kind, detail, at: min * m, minute: min, site });
const c = (min: number, ok: boolean, site: string): StoredLogEntry =>
  ({ type: 'classify', ok, model: 'claude-haiku-5-5', ms: 1000, at: min * m, minute: min, site });

it('サイトごとに、送信・続きを除いた回答・生成の始まり・分類を数える', () => {
  const log = [
    o(1, 'prompt_sent', 'chatgpt'),
    o(2, 'prompt_sent', 'chatgpt'),
    o(3, 'prompt_sent', 'claude'),
    o(3, 'generation_start', 'claude'),
    o(4, 'response_done', 'claude', { continuation: false }),
    c(4, true, 'claude'),
    o(5, 'response_done', 'claude', { continuation: true }),
  ];
  expect(siteFlow(log)).toEqual({
    chatgpt: { sent: 2, responses: 0, continuations: 0, generationStarts: 0, classifyOk: 0, classifyFailed: 0 },
    claude: { sent: 1, responses: 1, continuations: 1, generationStarts: 1, classifyOk: 1, classifyFailed: 0 },
  });
});

it('取り消した後の分類と、止めた後の記録を数える', () => {
  const log = [c(1, true, 'chatgpt'), o(5, 'response_done', 'chatgpt', { continuation: false }), c(6, true, 'chatgpt')];
  expect(entriesAfter(log, 3 * m, 'classify')).toHaveLength(1);
  expect(entriesAfter(log, 3 * m)).toHaveLength(2);
  const text = checkReport(log, 3 * m, 10 * m);
  expect(text).toContain('classify 1 件');
  expect(text).toContain('計測を止めた後');
  expect(text).toContain('0 件(計測を戻すまでの間に 0 件なら OK)');
});

it('時刻は手元の時刻として読み、読めなければ null', () => {
  expect(parseLocalTime('2026-10-25 11:05')).toBe(new Date(2026, 9, 25, 11, 5).getTime());
  expect(parseLocalTime('')).toBeNull();
  expect(parseLocalTime('あとで')).toBeNull();
});
