// VS Code の出来事を core の Observation に変えて、器を動かす。
// vscode モジュールには依存しない(テストで VS Code の API をまねた形を渡せるように)。
import { type GateContext, applyPromptAction, shouldPrompt } from '../../src/core/gate';
import { load, observe, splitText, tick, topContributor, type TickResult } from '../../src/core/model';
import { DEFAULT_PARAMS, type ElementKey, type EngineState, type ModelParams, type Observation, initialState } from '../../src/core/types';

/** これ以上の文字数が 1 回の変更で入ったら「まとまった挿入」(読む量)とみなす。それ未満は入力 */
export const BULK_MIN_CHARS = 100;
/** 読む量に入れる、1 回の挿入の上限(字)。補完を続けて受け入れても、読む残りが積み上がりすぎないように */
export const BULK_CAP_CHARS = 500;
/**
 * VS Code 用のパラメータ。読む残りの上限を小さくする(core の区切りは「読む残り < 1 分」が条件で、
 * VS Code には送信のように読む残りを 0 に戻す出来事が無いため。止まれば 2 分で区切りになる)
 */
export const VSCODE_PARAMS: ModelParams = { ...DEFAULT_PARAMS, readBacklogCapMin: 2 };
/** この間隔より短いファイルの切替は数えない(行き来の間引き、実時間 ms) */
export const SWITCH_MIN_INTERVAL_MS = 5000;
/** 入力がこの時間止まっていれば区切りとみなす(実時間 ms) */
export const TYPING_QUIET_MS = 3000;
/** 入力の activity を器に渡す間隔(毎打鍵で状態を複製しないように、実時間 ms) */
const ACTIVITY_THROTTLE_MS = 10_000;

/** 器に入れる対象のドキュメント(出力パネルや設定画面などは除く) */
const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-notebook-cell']);

// VS Code の型のうち使う所だけ(テストでまねるため)
export interface UriLike {
  scheme: string;
  toString(): string;
}
export interface TextChangeLike {
  document: { uri: UriLike; isDirty: boolean };
  contentChanges: readonly { text: string }[];
  /** TextDocumentChangeReason: 1 = 元に戻す、2 = やり直し */
  reason?: number;
}

export interface GateInfo {
  /** 実行中のタスクがあるか(tsc --watch のような終わらないタスクは除く) */
  taskRunning: boolean;
  /** VS Code の窓が前にあるか */
  focused: boolean;
  /** デバッグ中か */
  debugging: boolean;
}

const REASONS: Record<ElementKey | 'default', string> = {
  default: '作業が続いています。',
  reading: 'まとまった量のコードや文章が入る作業が続いています。',
  decision: '選択や判断が続いています。',
  verification: 'コマンドやテストの失敗が続いています。',
  switching: 'ファイルの切り替えが続いています。',
  time: 'まとまった時間、作業が続いています。',
};

export function promptMessage(top: ElementKey | null): string {
  return `ひと休みしませんか。${REASONS[top ?? 'default']}`;
}

export class Tracker {
  state: EngineState;
  params: ModelParams;
  private lastTypingAt = -Infinity;
  private lastActivityPushAt = -Infinity;
  private lastSwitchAt = -Infinity;
  private activeUri: string | null = null;

  constructor(state: EngineState = initialState(), params: ModelParams = VSCODE_PARAMS) {
    this.state = state;
    this.params = params;
  }

  private push(obs: Observation): void {
    this.state = observe(this.state, obs, this.params);
  }

  /** onDidChangeTextDocument */
  onTextChange(e: TextChangeLike, nowMs: number): void {
    if (!TRACKED_SCHEMES.has(e.document.uri.scheme)) return;
    // ディスクから読み直した変更は、変更の後も保存済みのまま(isDirty = false)
    if (!e.document.isDirty) return;
    if (e.reason === 1 || e.reason === 2) return;
    // 保存などで変更済みの印だけが変わった時は、中身の変更が空で届く
    if (e.contentChanges.length === 0) return;
    const inserted = e.contentChanges.reduce((n, c) => n + c.text.length, 0);
    const t = this.state.minute;
    if (inserted >= BULK_MIN_CHARS) {
      const text = e.contentChanges
        .map((c) => c.text)
        .join('\n')
        .slice(0, BULK_CAP_CHARS);
      const { jaChars, enWords } = splitText(text);
      this.push({ kind: 'response_done', t, chars: jaChars, enWords });
      return;
    }
    // 入力(削除も含む)
    this.lastTypingAt = nowMs;
    this.activity(nowMs);
  }

  /** onDidChangeActiveTextEditor */
  onActiveEditor(uri: UriLike | undefined, nowMs: number): void {
    if (!uri || !TRACKED_SCHEMES.has(uri.scheme)) return;
    const key = uri.toString();
    const prev = this.activeUri;
    this.activeUri = key;
    // 最初の 1 つ・同じファイルは切替に数えない
    if (prev === null || prev === key) return;
    if (nowMs - this.lastSwitchAt < SWITCH_MIN_INTERVAL_MS) {
      this.activity(nowMs);
      return;
    }
    this.lastSwitchAt = nowMs;
    this.push({ kind: 'switch', t: this.state.minute, source: 'file' });
  }

  /** onDidEndTerminalShellExecution / onDidEndTaskProcess。失敗(終了コード ≠ 0)だけを確認・検証に数える */
  onCommandEnd(exitCode: number | undefined, nowMs: number): void {
    if (exitCode !== undefined && exitCode !== 0) {
      this.push({ kind: 'verification', t: this.state.minute, count: 1, source: 'exit_code' });
      return;
    }
    // 成功や終了コードが分からないものは、作業していた印だけ
    this.activity(nowMs, true);
  }

  /** コマンドの開始など、作業していた印 */
  activity(nowMs: number, force = false): void {
    if (!force && nowMs - this.lastActivityPushAt < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityPushAt = nowMs;
    this.push({ kind: 'activity', t: this.state.minute });
  }

  tick(): TickResult {
    const res = tick(this.state, this.params);
    this.state = res.state;
    return res;
  }

  load(): number {
    return load(this.state);
  }

  gateContext(nowMs: number, focused = true): GateContext {
    return {
      generating: false,
      typing: nowMs - this.lastTypingAt < TYPING_QUIET_MS,
      composerHasText: false,
      // 裏にある時は出さない(出した時点で間を空けるので、見られないまま次が遠くなる)
      tabVisible: focused,
      secondsSinceResponse: null,
      quietSeconds: 0,
    };
  }

  /**
   * 今、提案を出すか。出すときは文を返し、次の提案までの間を空ける(休憩のタイマーは作らないので、
   * 出した時点で core の「今回は不要」と同じ扱いにする)
   */
  checkPrompt(nowMs: number, info: GateInfo): string | null {
    if (info.taskRunning || info.debugging) return null;
    if (!shouldPrompt(this.state, this.params, this.gateContext(nowMs, info.focused))) return null;
    const message = promptMessage(topContributor(this.state));
    this.state = applyPromptAction(this.state, 'decline');
    return message;
  }
}
