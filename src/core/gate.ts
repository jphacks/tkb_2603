// 休憩の出し方(計画 v2.2 §3)。「休憩が必要か」と「今、声をかけてよいか」を分けて判断する。
import { load } from './model';
import type { EngineState, ModelParams } from './types';

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

/**
 * 提案を出すか。
 * - 通知モード: 必要 かつ 区切り
 * - 自動タイマーモード: 必要になった時点で出す。ただし「次の区切りで」を選んだ後は区切りまで待つ(決定)
 */
export function shouldPrompt(
  state: EngineState,
  p: ModelParams,
  mode: NotifyMode,
  ctx: GateContext,
  waitingForBreakpoint: boolean,
): boolean {
  if (!needsBreak(state, p)) return false;
  if (mode === 'auto_timer' && !waitingForBreakpoint) return true;
  return isBreakpoint(state, ctx);
}

export type PromptAction = 'now' | 'next_breakpoint' | 'decline';

/** 「次の区切りで」は最短 5 分あける。「今回は不要」は断るたびに 15 → 30 → 60 分(仮置き) */
export const NEXT_BREAKPOINT_MIN = 5;
export const DECLINE_STEPS_MIN = [15, 30, 60];

export function applyPromptAction(state: EngineState, action: PromptAction): EngineState {
  const s = structuredClone(state);
  if (action === 'next_breakpoint') {
    s.prompt.notBefore = s.minute + NEXT_BREAKPOINT_MIN;
  } else if (action === 'decline') {
    const step = DECLINE_STEPS_MIN[Math.min(s.prompt.declineStreak, DECLINE_STEPS_MIN.length - 1)] ?? 60;
    s.prompt.notBefore = s.minute + step;
    s.prompt.declineStreak += 1;
  }
  return s;
}
