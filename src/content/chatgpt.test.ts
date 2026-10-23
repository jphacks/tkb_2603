// @vitest-environment happy-dom
// ChatGPT に似た DOM を作って、送信・生成中・回答の終わり・エラーの貼り付けを取れるか確かめる。
// 本物の画面の構造とは違いうるので、当日は必ず実機の「診断」で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptObserver } from './chatgpt';

function setup() {
  document.body.innerHTML = `
    <main>
      <div id="thread"></div>
      <form data-chatgpt-composer>
        <div contenteditable="true" role="textbox" id="prompt-textarea"></div>
        <button data-testid="send-button">送信</button>
      </form>
    </main>`;
}

function addUser(text: string) {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'user');
  el.textContent = text;
  document.getElementById('thread')!.appendChild(el);
}

function addAssistant(text: string) {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'assistant');
  el.textContent = text;
  document.getElementById('thread')!.appendChild(el);
  return el;
}

function setStop(on: boolean) {
  const existing = document.querySelector('[data-testid="stop-button"]');
  if (on && !existing) {
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'stop-button');
    document.querySelector('form')!.appendChild(b);
  }
  if (!on && existing) existing.remove();
}

describe('ChatGptObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup();
  });
  afterEach(() => vi.useRealTimers());

  it('送信 → 生成中 → 停止ボタンが消えたら回答の終わり', async () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatGptObserver(cb);
    obs.start();
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = 'React でフォームを作って';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).toHaveBeenCalledWith('React でフォームを作って');

    addUser('React でフォームを作って');
    setStop(true);
    const a = addAssistant('もちろんです');
    await vi.advanceTimersByTimeAsync(600);
    expect(obs.isGenerating()).toBe(true);
    expect(cb.onResponseDone).not.toHaveBeenCalled();

    a.textContent = 'もちろんです。まずは次の 4 つに分けると見通しよく作れます。';
    setStop(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![0]).toContain('4 つに分ける');
    expect(cb.onResponseDone.mock.calls[0]![1]).toBe('React でフォームを作って');

    // 同じ回答を 2 回数えない
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);

    // 終わった後に同じ回答が伸びたら、差分だけを続きとして渡す
    a.textContent += ' 続きの説明です。';
    await vi.advanceTimersByTimeAsync(3500);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(2);
    expect(cb.onResponseDone.mock.calls[1]![0]).toBe(' 続きの説明です。');
    expect(cb.onResponseDone.mock.calls[1]![2]).toBe(true);
    obs.stop();
  });

  it('生成中に送信ボタン(停止と兼用)を押しても送信とは数えない', async () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatGptObserver(cb);
    obs.start();
    setStop(true);
    document.getElementById('prompt-textarea')!.textContent = '書きかけ';
    (document.querySelector('[data-testid="send-button"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).not.toHaveBeenCalled();
    obs.stop();
  });

  it('エラー文らしい貼り付けだけを数える(本文は渡さない)', () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatGptObserver(cb);
    obs.start();
    const composer = document.getElementById('prompt-textarea')!;
    const paste = (text: string) => {
      const ev = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      composer.dispatchEvent(ev);
    };
    paste("TypeError: Cannot read properties of undefined (reading 'map')\n    at App (App.tsx:12:5)");
    paste('普通の文章です');
    expect(cb.onErrorPaste).toHaveBeenCalledTimes(1);
    expect(cb.onErrorPaste).toHaveBeenCalledWith(2);
    obs.stop();
  });
});
