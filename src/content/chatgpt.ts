// ChatGPT Web の画面から手がかりを取る。本文は保存しない(分類のために LLM へ送るときだけ使う)。
// 画面の構造は 2026 年 9〜10 月に何度も変わっている(調査05・08)。セレクタは複数を順に試し、
// どれが当たったかを診断に出す。当日は必ず実機で確かめる。
import { lineCount, looksLikeError } from '../core/detect';

const SELECTORS = {
  assistant: [
    '[data-message-author-role="assistant"]',
    '[data-markdown-text-style="assistant-message"]',
    '[data-content-search-unit-key$=":assistant"]',
    '[class*="prose"]',
    '.markdown',
  ],
  user: [
    '[data-message-author-role="user"]',
    '[data-user-message-bubble="true"]',
    '[data-content-search-unit-key$=":user"]',
  ],
  composer: [
    '#prompt-textarea',
    'form[data-chatgpt-composer] [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea',
  ],
  stop: [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[data-is-streaming="true"]',
    '.result-streaming',
    '[data-streaming-response-status="streaming"]',
  ],
  send: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]'],
} as const;

type SelectorGroup = keyof typeof SELECTORS;

export interface Diagnostics {
  matched: Partial<Record<SelectorGroup, string | null>>;
  assistantCount: number;
  userCount: number;
  generating: boolean;
  lastResponseChars: number;
  /** 最後の回答の先頭(実機の確認用。保存しない) */
  lastResponseHead: string;
  completionMethod: 'stop_button' | 'quiet_dom' | null;
}

export interface ChatGptCallbacks {
  onPromptSent(text: string): void;
  /** continuation: 終わったと思った回答が、その後も伸びた分 */
  onResponseDone(text: string, userText: string, continuation: boolean): void;
  onErrorPaste(lines: number): void;
  onConversationSwitch(): void;
  onActivity(): void;
}

function firstMatch(group: SelectorGroup, root: ParentNode = document): { el: Element | null; sel: string | null } {
  for (const sel of SELECTORS[group]) {
    const el = root.querySelector(sel);
    if (el) return { el, sel };
  }
  return { el: null, sel: null };
}

/** 入力欄全体の上端を、常駐ボタンの配置に使う。本文には触れない。 */
export function findComposerContainer(): HTMLElement | null {
  const composer = firstMatch('composer').el as HTMLElement | null;
  return composer?.closest('form') ?? composer;
}

function allMatch(group: SelectorGroup): Element[] {
  for (const sel of SELECTORS[group]) {
    const els = Array.from(document.querySelectorAll(sel));
    if (els.length) return els;
  }
  return [];
}

function textOf(el: Element | null | undefined): string {
  return (el as HTMLElement | null)?.innerText ?? el?.textContent ?? '';
}

/** DOM の変化がこの秒数止まったら、生成が終わったとみなす(停止ボタンが見つからない時の代わり) */
const QUIET_MS = 2500;

export class ChatGptObserver {
  diagnostics: Diagnostics = {
    matched: {},
    assistantCount: 0,
    userCount: 0,
    generating: false,
    lastResponseChars: 0,
    lastResponseHead: '',
    completionMethod: null,
  };
  lastTypingAt = 0;
  lastResponseDoneAt: number | null = null;

  private lastPath = location.pathname;
  private lastUserText = '';
  private pendingUserText = '';
  private wasGenerating = false;
  private lastMutationAt = 0;
  private lastAssistantLen = 0;
  private lastAssistantEl: Element | null = null;
  private lastUserCount = -1;
  private awaitingResponse = false;
  private timers: number[] = [];
  private observer: MutationObserver | null = null;

  constructor(private cb: ChatGptCallbacks) {}

  start(): void {
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('paste', this.onPaste, true);
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('scroll', this.onScroll, true);
    this.observer = new MutationObserver(() => {
      this.lastMutationAt = Date.now();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.timers.push(window.setInterval(this.poll, 500));
  }

  stop(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('paste', this.onPaste, true);
    document.removeEventListener('click', this.onClick, true);
    window.removeEventListener('scroll', this.onScroll, true);
    this.observer?.disconnect();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  composer(): HTMLElement | null {
    return firstMatch('composer').el as HTMLElement | null;
  }

  composerText(): string {
    const c = this.composer();
    if (!c) return '';
    return c instanceof HTMLTextAreaElement ? c.value : c.innerText.trim();
  }

  isGenerating(): boolean {
    return firstMatch('stop').el !== null;
  }

  /** 入力中: 直近 3 秒に入力があった */
  isTyping(): boolean {
    return Date.now() - this.lastTypingAt < 3000;
  }

  private inComposer(target: EventTarget | null): boolean {
    const c = this.composer();
    return !!c && target instanceof Node && (c === target || c.contains(target));
  }

  private markSent(): void {
    const text = this.pendingUserText || this.composerText();
    if (!text) return;
    this.lastUserText = text;
    this.pendingUserText = '';
    this.awaitingResponse = true;
    this.cb.onPromptSent(text);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.inComposer(e.target)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      this.pendingUserText = this.composerText();
      // 送信は ChatGPT 側の処理の後に入力欄が空になる。少し待って確かめる
      window.setTimeout(() => {
        if (this.composerText() === '' && this.pendingUserText) this.markSent();
      }, 300);
    }
  };

  private onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    // 新しい画面では送信と停止が同じボタンのことがある。生成中に押したのは停止
    if (this.isGenerating()) return;
    if (SELECTORS.send.some((sel) => target.closest(sel))) {
      this.pendingUserText = this.composerText();
      window.setTimeout(() => this.markSent(), 300);
    }
  };

  private onInput = (e: Event) => {
    if (this.inComposer(e.target)) {
      this.lastTypingAt = Date.now();
      this.cb.onActivity();
    }
  };

  private lastScrollReport = 0;
  private onScroll = () => {
    if (Date.now() - this.lastScrollReport > 10_000) {
      this.lastScrollReport = Date.now();
      this.cb.onActivity();
    }
  };

  private onPaste = (e: ClipboardEvent) => {
    if (!this.inComposer(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    // 本文は残さず、エラーらしいかと行数だけを見る
    if (looksLikeError(text)) this.cb.onErrorPaste(lineCount(text));
    this.cb.onActivity();
  };

  private poll = () => {
    // 会話の切替(URL の /c/<id> が変わった)
    if (location.pathname !== this.lastPath) {
      const wasChat = this.lastPath.startsWith('/c/');
      this.lastPath = location.pathname;
      this.lastAssistantLen = 0;
      this.lastAssistantEl = null;
      this.lastUserCount = -1;
      this.awaitingResponse = false;
      if (wasChat) this.cb.onConversationSwitch();
    }

    const assistants = allMatch('assistant');
    const users = allMatch('user');
    const generating = this.isGenerating();
    this.diagnostics.assistantCount = assistants.length;
    this.diagnostics.userCount = users.length;
    this.diagnostics.generating = generating;
    for (const g of Object.keys(SELECTORS) as SelectorGroup[]) {
      this.diagnostics.matched[g] = firstMatch(g).sel;
    }

    const last = assistants[assistants.length - 1];
    const lastText = textOf(last);

    // 送信を取り逃しても、生成中にユーザーの吹き出しが増えたら送信とみなす(文の比較はしない。整形で一致しないため)
    if (this.lastUserCount < 0) this.lastUserCount = users.length;
    if (users.length > this.lastUserCount) {
      if (!this.awaitingResponse && generating) {
        const userText = textOf(users[users.length - 1]);
        this.lastUserText = userText;
        this.awaitingResponse = true;
        this.cb.onPromptSent(userText);
      }
      this.lastUserCount = users.length;
    }

    // 生成の終わり: 停止ボタンが消えた、または停止ボタンが無い画面で DOM の変化が止まった
    let done = false;
    if (this.wasGenerating && !generating) {
      done = true;
      this.diagnostics.completionMethod = 'stop_button';
    } else if (
      this.awaitingResponse &&
      !generating &&
      lastText.length > 0 &&
      lastText.length !== this.lastAssistantLen &&
      Date.now() - this.lastMutationAt > QUIET_MS
    ) {
      done = true;
      this.diagnostics.completionMethod = 'quiet_dom';
    }
    this.wasGenerating = generating;

    if (done && lastText.length > 0) {
      const continuation = last === this.lastAssistantEl && lastText.length > this.lastAssistantLen && this.lastAssistantLen > 0;
      const text = continuation ? lastText.slice(this.lastAssistantLen) : lastText;
      this.awaitingResponse = false;
      this.lastAssistantEl = last ?? null;
      this.lastAssistantLen = lastText.length;
      this.lastResponseDoneAt = Date.now();
      this.diagnostics.lastResponseChars = lastText.length;
      this.diagnostics.lastResponseHead = lastText.slice(0, 24);
      this.cb.onResponseDone(text, this.lastUserText, continuation);
    } else if (
      // 静かになって終わりとみなした後も、同じ回答が伸びたら差分を足す(考える系のモデルは途中で長く止まる)
      !generating &&
      last === this.lastAssistantEl &&
      lastText.length > this.lastAssistantLen &&
      Date.now() - this.lastMutationAt > QUIET_MS
    ) {
      const delta = lastText.slice(this.lastAssistantLen);
      this.lastAssistantLen = lastText.length;
      this.lastResponseDoneAt = Date.now();
      this.diagnostics.lastResponseChars = lastText.length;
      this.cb.onResponseDone(delta, this.lastUserText, true);
    }
  };
}
