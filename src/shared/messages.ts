// content script と background のあいだのメッセージ。

/** LLM が会話の 1 往復から抜き出す出来事(点数は出させない。DR05) */
export interface ClassifyResult {
  decision_requests: { span: string }[];
  verification_events: { type: 'error_report' | 'failure_after_attempt' | 'correctness_check' | 'test_or_result_check' }[];
  topic_shift: { shift: boolean; current_task: string };
}

export interface ClassifyRequest {
  type: 'classify';
  userText: string;
  assistantText: string;
  previousTask: string;
}

export type ClassifyResponse =
  | { ok: true; result: ClassifyResult; model: string; ms: number; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; model: string; ms: number };

export interface OpenOptionsRequest {
  type: 'open_options';
}

export interface TestKeyRequest {
  type: 'test_key';
}

export type BackgroundRequest = ClassifyRequest | OpenOptionsRequest | TestKeyRequest;
