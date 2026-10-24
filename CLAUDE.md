# ひといき — 開発メモ(AI エージェント向け)

- 核: ChatGPT での作業の**中身**から負担を計算して休憩を提案する。時間は 5 要素のうちの 1 つにすぎない。時間を土台にする変更はしない
- 計画の正本はリポジトリの外にある(森平の Drive: `work/個人/jphacks準備/資料/計画.md`)。決定事項を勝手に変えない
- 計算は `src/core/` の純粋な関数で行う。ブラウザの API に依存させない。変えたら `npm test` を通す
- ChatGPT の DOM は頻繁に変わる。セレクタはサイトごとに `src/content/sites.ts`(ChatGPT・Claude・Gemini)にまとめ、複数を順に試す。読み取りの動きは `src/content/observer.ts`。当たったものは UI の「診断」に出る
- LLM には点数を出させない。出来事を JSON で抜き出すだけにする(`src/shared/classifier.ts`)
- 本文は保存しない。記録(`appendLog`)には件数・文字数・時刻・操作だけを入れる
- 言わないこと(README・画面の文言): 「脳の疲労を測定」「最適な休憩時間」「世界初」
- CSS は Shadow DOM の中で効く。`rem` ではなく px で書く
- 開発の説明は `docs/DEVELOPMENT.md`。`README.md` は JPHACKS の提出用テンプレートなので消さない(中身は提出前に埋める)
- コマンド: `npm run dev` / `npm run build` / `npm test` / `npx tsc --noEmit`
- 変更は意味のあるまとまりごとに確認して、定期的にコミットする(ユーザー指定)。
