// 対応する AI チャットのサイトごとの定義。画面の読み取りに使うセレクタと、会話 ID の取り方。
// どのサイトも画面の構造はよく変わる(調査05・08・15)。セレクタは複数を順に試し、
// どれが当たったかを診断に出す。実機で確かめたら、ここだけを直せばよい。

export type SiteId = 'chatgpt' | 'claude' | 'gemini';

export interface SelectorSet {
  assistant: readonly string[];
  user: readonly string[];
  composer: readonly string[];
  /** 生成中にだけある要素(停止ボタン・生成中の属性) */
  stop: readonly string[];
  send: readonly string[];
  /** 常駐ボタンの位置合わせに使う、入力欄の外枠。無ければ composer の form か composer 自体 */
  composerContainer: readonly string[];
}

export interface SiteDef {
  id: SiteId;
  label: string;
  hosts: readonly string[];
  selectors: SelectorSet;
  /** URL のパスから会話 ID を取る。新しい会話(まだ ID が無い)なら null */
  conversationId(pathname: string): string | null;
  /** 回答の文から、本文でない所(考えた過程のラベルなど)を落とす */
  cleanAssistantText?(text: string): string;
}

export const CHATGPT: SiteDef = {
  id: 'chatgpt',
  label: 'ChatGPT',
  hosts: ['chatgpt.com'],
  selectors: {
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
    composerContainer: [],
  },
  conversationId: (p) => p.match(/^\/(?:g\/[^/]+\/)?c\/([^/?#]+)/)?.[1] ?? null,
};

/** Claude.ai: data-testid と data-is-streaming が付いていて、言語に左右されにくい(調査15) */
export const CLAUDE: SiteDef = {
  id: 'claude',
  label: 'Claude',
  hosts: ['claude.ai'],
  selectors: {
    assistant: ['[data-testid="assistant-message"]', '.font-claude-response', '.font-claude-message'],
    user: ['[data-testid="user-message"]', '.font-user-message'],
    composer: [
      '[data-testid="chat-input"][contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      'div.ProseMirror',
    ],
    stop: [
      '[data-is-streaming="true"]',
      'button[aria-label="Stop response"]',
      'button[aria-label="Stop Response"]',
      'button[aria-label*="停止"]',
    ],
    send: ['[data-testid="chat-input-send"]', 'button[aria-label="Send message"]', 'button[aria-label="Send Message"]'],
    composerContainer: ['[data-composer-card-holder] > div', 'fieldset'],
  },
  conversationId: (p) => p.match(/^\/chat\/([^/?#]+)/)?.[1] ?? null,
  // 考えた過程の折りたたみのラベル(「Thought process」「Thought for 12s」)は読む量に入れない
  cleanAssistantText: (t) =>
    t
      .replace(/^(\s*(Thought process|Thought for \d+\s*s(?:econds)?|思考プロセス)\s*)+/i, '')
      .split('\n')
      .filter((line) => !/^\s*(Thought process|Thought for \d+\s*s(econds)?|思考プロセス)\s*$/i.test(line))
      .join('\n'),
};

/** Gemini: 生成中を表す属性が無く、停止ボタンの文言に頼る。日本語の文言は未確認(調査15) */
export const GEMINI: SiteDef = {
  id: 'gemini',
  label: 'Gemini',
  hosts: ['gemini.google.com'],
  selectors: {
    assistant: [
      'model-response .model-response-text',
      'model-response message-content',
      'model-response',
      '.model-response-text',
      '[aria-label="Gemini response"]',
    ],
    user: ['user-query', '.user-query-container', '.query-text', 'div[aria-label="User message"]'],
    composer: [
      'rich-textarea .ql-editor[contenteditable="true"]',
      '.ql-editor[role="textbox"]',
      '.ql-editor[contenteditable="true"]',
    ],
    stop: [
      'button[aria-label="Stop response"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="中止"]',
      'button[data-test-id*="stop"]',
      'mat-icon[fonticon="stop"]',
    ],
    send: ['.send-button.submit button', 'button.send-button', 'button[aria-label="Send message"]', 'button[aria-label*="送信"]'],
    composerContainer: ['input-area-v2', '.input-area-container', 'rich-textarea'],
  },
  conversationId: (p) => p.match(/^\/(?:app|gem\/[^/]+)\/([^/?#]+)/)?.[1] ?? null,
};

export const SITES: readonly SiteDef[] = [CHATGPT, CLAUDE, GEMINI];

export function detectSite(hostname: string): SiteDef {
  return SITES.find((s) => s.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) ?? CHATGPT;
}

/** content script を差し込むページ(manifest の matches と host_permissions に使う) */
export const SITE_MATCHES = SITES.flatMap((s) => s.hosts.map((h) => `https://${h}/*`));
