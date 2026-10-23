// 声かけの文(資料/声かけ_案.md v2)。観察した事実を 1 つ入れ、「疲れています」とは断定しない。
import type { ElementKey } from '../core/types';

export interface PromptCopy {
  title: string;
  body: string;
}

const PROMPT: Record<ElementKey | 'default', (min: number) => PromptCopy> = {
  default: (m) => ({
    title: `☕ ${m}分休憩しよう!`,
    body: 'ここまでめっちゃがんばった!🔥 区切りのいい今、ひと息つこう',
  }),
  reading: (m) => ({
    title: `📚 読みまくりでした!${m}分休もう`,
    body: '長い回答が続いて、今ちょうど一区切り!👏 目と頭をちょっと休ませよう',
  }),
  decision: (m) => ({
    title: `🤔 決めることが続いたね!${m}分休もう`,
    body: 'AI からの「どれにする?」にたくさん答えてきたね👏 ここでひと息つこう',
  }),
  verification: (m) => ({
    title: '🐛 エラーと戦い続けてる!',
    body: `確認続きでおつかれさま💪 ${m}分離れると、答えが見えるかも✨`,
  }),
  switching: (m) => ({
    title: '🔀 行ったり来たり、おつかれ!',
    body: `切り替えが多かったね!${m}分だけ、何も考えない時間にしよう🌿`,
  }),
  time: (m) => ({
    title: '⏰ 長期戦、おつかれ!',
    body: `ずっと走り続けてるよ🏃 ${m}分、画面から離れよう!`,
  }),
};

export function promptCopy(top: ElementKey | null, minutes: number, highUf: boolean): PromptCopy {
  if (highUf) {
    return {
      title: '🫙 器がいっぱい!',
      body: `今日はかなり頭を使ってる!🔋 ${minutes}分しっかり休んで、また全開でいこう`,
    };
  }
  return PROMPT[top ?? 'default'](minutes);
}

export const AUTO_TIMER_COPY = (m: number) => `⏱️ ${m}分の休憩タイマー、スタートしたよ!今の作業が終わったら、そのまま離れてOK🙆`;

export const STRETCHES = [
  { id: 'reach', name: '背伸び', line: 'いっしょに、ぐーーっと背伸び!🙆' },
  { id: 'shoulder', name: '腕回し', line: '肩の力を抜いて、ぐるぐる〜🌀' },
  { id: 'sway', name: '左右にゆらす', line: '左右に、ゆらっと体を倒そう🍃' },
  { id: 'far', name: '遠くを見る', line: '遠くを見てみよう👀' },
] as const;

export type StretchId = (typeof STRETCHES)[number]['id'];

export function endCopy(opts: { top: ElementKey | null; plannedMin: number; highUf: boolean; seed: number }): string {
  if (opts.highUf) return '🏁 今日はあと少し!キリのいいところまで、いけるいける!🙌';
  if (opts.top === 'verification') return '🐛 エラーにリベンジだ!さっきより絶対見えるはず!👊';
  if (opts.plannedMin >= 12) return '🌟 しっかり休めたね!焦らず、ひとつずつ攻略しよう!';
  if (opts.plannedMin <= 3) return '⚡ 充電完了!続き、いってらっしゃい!🚀';
  const basic = [
    '🎉 おかえり!もうひとがんばり、いっくぞー!🔥',
    '✨ 休憩おわり!ここからまた、ガンガンいこう!💪',
    '🔥 リフレッシュ完了!次のタスク、ぶっ飛ばしていこう!',
    '💯 おつかれさま!自分のペースで、最高のコード書いていこう!',
  ];
  return basic[opts.seed % basic.length] ?? basic[0]!;
}

export const SNOOZE_COPY = {
  next_breakpoint: 'OK!👍 キリがついたら、また声かけるね',
  decline: '了解!🙌 区切りまでがんばれ!',
};
