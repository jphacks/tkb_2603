import { classifyExchange } from '../src/shared/classifier';
import type { BackgroundRequest, ClassifyResponse } from '../src/shared/messages';
import { loadSettings } from '../src/shared/settings';

async function runClassify(userText: string, assistantText: string, previousTask: string, force = false): Promise<ClassifyResponse> {
  const settings = await loadSettings();
  const started = performance.now();
  // 計測を止めている時・LLM を切っている時は、本文を送らない(二重に守る)
  if (!force && (!settings.enabled || !settings.llmEnabled)) {
    return { ok: false, error: 'disabled', model: settings.model, ms: 0 };
  }
  if (!settings.apiKey) return { ok: false, error: 'no_api_key', model: settings.model, ms: 0 };
  try {
    const out = await classifyExchange({ apiKey: settings.apiKey, model: settings.model, userText, assistantText, previousTask });
    return {
      ok: true,
      result: out.result,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      model: settings.model,
      ms: Math.round(performance.now() - started),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      model: settings.model,
      ms: Math.round(performance.now() - started),
    };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
    if (msg.type === 'open_options') {
      browser.runtime.openOptionsPage();
      return false;
    }
    if (msg.type === 'classify') {
      runClassify(msg.userText, msg.assistantText, msg.previousTask).then(sendResponse);
      return true; // 非同期で返す
    }
    if (msg.type === 'test_key') {
      // 設定画面の「キーを試す」: 作った例文で 1 回だけ呼ぶ(会話の本文は使わない)
      runClassify(
        'これで合ってる?動かないんだけど\nTypeError: Cannot read properties of undefined',
        'useEffect の依存配列が原因です。A: 配列を空にする B: useCallback で包む のどちらにしますか?',
        'React のフォームを作る',
        true,
      ).then(sendResponse);
      return true;
    }
    return false;
  });
});
