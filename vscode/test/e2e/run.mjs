// 実機の確かめ: インストール済みの VS Code を「拡張機能の開発ホスト」として開き、suite.cjs を動かす。
// ふだんの VS Code の設定・拡張に触れないよう、使い捨てのユーザーデータと拡張のフォルダを使う。
// 使い方: npm run e2e(VS Code の場所は VSCODE_PATH で変えられる)
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = fileURLToPath(new URL('.', import.meta.url));
// ソケットのパスが長すぎると VS Code が起動しないので、短い場所(.vscode-test、git には入れない)に作る
const base = resolve(here, '../../.vscode-test');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, 'e2e-'));
const workspace = join(root, 'workspace');
mkdirSync(workspace);

try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: resolve(here, '../..'),
    extensionTestsPath: resolve(here, 'suite.cjs'),
    launchArgs: [workspace, `--user-data-dir=${join(root, 'user')}`, `--extensions-dir=${join(root, 'ext')}`, '--disable-workspace-trust'],
  });
} finally {
  // 使い捨てのプロファイルは毎回消す
  rmSync(root, { recursive: true, force: true });
}
