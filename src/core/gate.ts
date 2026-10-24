// 休憩の出し方(計画 v2.2 §3)。「休憩が必要か」と「今、声をかけてよいか」を分けて判断する。
import { load } from './model';
import type { EngineState, ModelParams } from './types';

/** 過去のログの読み取り用。現在はユーザーが開始する通知方式のみ。 */
export type NotifyMode = 'notify' | 'auto_timer';

/** 今、声をかけてよいかの材料(画面から取る。実時間の秒) */
export interface GateContext {
  generating: boolean;
  typing: boolean;
  composerHasText: boolean;
  tabVisible: boolean;
  /** 最後の回答が終わってからの秒数(回答が無ければ null) */
  secondsSinceResponse: number | null;
  /** 区切りとみなす、回答の後の間(秒) */
  quietSeconds: number;
}

/** 休憩が必要か: 器がしきい値を超えていて、休憩中でなく、提案を止めている時間でもない */
export function needsBreak(state: EngineState, p: ModelParams): boolean {
  if (state.breakState) return false;
  if (state.prompt.waitingForUser) return false;
  if (state.minute < state.prompt.notBefore) return false;
  return load(state) >= p.threshold;
}

/** 今が区切りか: 生成中・入力中・長い回答を読んでいる最中・タブが裏、のどれでもない */
export function isBreakpoint(state: EngineState, ctx: GateContext): boolean {
  if (!ctx.tabVisible || ctx.generating || ctx.typing || ctx.composerHasText) return false;
  if (state.readBacklogMin >= 1) return false;
  if (ctx.secondsSinceResponse !== null && ctx.secondsSinceResponse < ctx.quietSeconds) return false;
  return true;
}

/** 必要かつ区切りで通知。休憩の開始は必ずユーザーの操作で行う。 */
export function shouldPrompt(state: EngineState, p: ModelParams, ctx: GateContext): boolean {
  return needsBreak(state, p) && isBreakpoint(state, ctx);
}

export type PromptAction = 'now' | 'next_breakpoint' | 'decline';

/** 区切りはユーザーが開始ボタンで知らせる。旧「今回は不要」の間隔は保存データとの互換のため残す */
export const DECLINE_STEPS_MIN = [15, 30, 60];

export function applyPromptAction(state: EngineState, action: PromptAction): EngineState {
  const s = structuredClone(state);
  if (action === 'next_breakpoint') {
    s.prompt.waitingForUser = true;
  } else if (action === 'decline') {
    s.prompt.waitingForUser = false;
    const step = DECLINE_STEPS_MIN[Math.min(s.prompt.declineStreak, DECLINE_STEPS_MIN.length - 1)] ?? 60;
    s.prompt.notBefore = s.minute + step;
    s.prompt.declineStreak += 1;
  }
  return s;
}
