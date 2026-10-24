// 会話の 1 往復から出来事を抜き出す(background で動かす)。LLM には点数を出させない(DR05)。
import Anthropic from '@anthropic-ai/sdk';
import type { ClassifyResult } from './messages';

const SYSTEM = `You classify one developer–AI exchange from an AI chat service (ChatGPT, Claude, or Gemini). Use ONLY the definitions below.
Do not infer events that are not explicitly supported by the text.

DECISION_REQUEST: each independent point where the ASSISTANT asks the user to choose, approve, or decide
(e.g. "Which do you prefer, React or Vue?", "Shall I proceed with this approach?"). Do not count requests for factual information.

VERIFICATION_EVENT: each independent event in the USER message where the user reports an error/failure,
says something does not work after trying it, asks whether something is correct, or asks to verify a test/result.
Types: error_report (pasted error/stack trace), failure_after_attempt ("I tried it but it doesn't work"),
correctness_check ("Is this right?"), test_or_result_check ("Does this test result mean success?").
Do not count a first-time request or "tell me more".

TOPIC_SHIFT: true only if the USER message starts an independent new goal, unrelated to PREVIOUS_TASK.
Refinements, debugging, clarification, and implementation subtasks of the previous goal are NOT topic shifts.
If PREVIOUS_TASK is empty, shift is false.
Also return current_task: a short (max 15 words) description of the current goal, in the user's language.

Return only the schema-constrained JSON.`;

const SCHEMA = {
  type: 'object',
  properties: {
    decision_requests: {
      type: 'array',
      items: {
        type: 'object',
        properties: { span: { type: 'string' } },
        required: ['span'],
        additionalProperties: false,
      },
    },
    verification_events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['error_report', 'failure_after_attempt', 'correctness_check', 'test_or_result_check'],
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
    topic_shift: {
      type: 'object',
      properties: { shift: { type: 'boolean' }, current_task: { type: 'string' } },
      required: ['shift', 'current_task'],
      additionalProperties: false,
    },
  },
  required: ['decision_requests', 'verification_events', 'topic_shift'],
  additionalProperties: false,
} as const;

/** 1 往復が長すぎるときは先頭と末尾を残す(判断の要求は回答の末尾に出やすい) */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}\n…(中略 ${text.length - max} 文字)…\n${text.slice(-(max - head))}`;
}

/** サーバー側のフォールバックを使える(Opus 5.5 / Sonnet 5.5)。Haiku 5.5 には無い */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export async function classifyExchange(opts: {
  apiKey: string;
  model: string;
  userText: string;
  assistantText: string;
  previousTask: string;
}): Promise<{ result: ClassifyResult; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // 拡張(自分たちだけで使う)から直接呼ぶ。配るときはサーバー経由に変える
    dangerouslyAllowBrowser: true,
    // service worker は fetch が 30 秒を超えると止まるので短めにする
    timeout: 12_000,
    maxRetries: 1,
  });

  const content = [
    `PREVIOUS_TASK: ${opts.previousTask || '(none)'}`,
    `USER:\n${clip(opts.userText, 4000)}`,
    `ASSISTANT:\n${clip(opts.assistantText, 8000)}`,
  ].join('\n\n');

  const base = {
    model: opts.model,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
  };

  const response = FALLBACK_MODELS.has(opts.model)
    ? await client.beta.messages.create({
        ...base,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    : await client.messages.create(base);

  if (response.stop_reason === 'refusal') throw new Error('refusal');
  if (response.stop_reason === 'max_tokens') throw new Error('truncated');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no text block');
  return {
    result: JSON.parse(text.text) as ClassifyResult,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
