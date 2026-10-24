// 観察した作業を伝える。疲労を測った・回復したとは断定しない。
import type { ElementKey } from '../core/types';
export type { StretchId } from '../core/types';

export interface PromptCopy { title: string; body: string }
const REASONS: Record<ElementKey | 'default', string> = {
  default: '作業が続いています。',
  reading: '読む量が多い作業が続いています。',
  decision: '選択や判断が続いています。',
  verification: '確認や指示が続いています。',
  switching: '作業の切り替えが続いています。',
  time: 'まとまった時間、作業が続いています。',
};
export function promptCopy(top: ElementKey | null, highUf: boolean): PromptCopy {
  return { title: 'ひと息、休憩しませんか', body: highUf ? '今日は作業が積み重なっています。' : REASONS[top ?? 'default'] };
}
export const STRETCHES = [
  { id: 'reach', name: '背伸び', line: '両腕を上げて、ゆっくり背伸びしましょう' },
  { id: 'shoulder', name: '肩回し', line: '肩の力を抜いて、ゆっくり肩を回しましょう' },
  { id: 'sway', name: '左右にゆらす', line: '体を左右に、ゆっくり倒しましょう' },
] as const;
export function endCopy(opts: { top: ElementKey | null; plannedMin: number; highUf: boolean }): string {
  if (opts.highUf) return '今日は作業が積み重なっています。自分のペースで続けましょう。';
  if (opts.top === 'verification') return '確認の続きは、ひとつずつ進めましょう。';
  if (opts.plannedMin >= 12) return '少し長めのひと休み。焦らず、続きを始めましょう。';
  return 'ひと休み、おつかれさまでした。自分のペースで続きをどうぞ。';
}
export const SNOOZE_COPY = {
  next_breakpoint: '作業が終わったら「区切りがついた」を押してください。',
  decline: 'あとで、またお知らせします。',
};
