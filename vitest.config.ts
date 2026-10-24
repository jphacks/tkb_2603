import { configDefaults, defineConfig } from 'vitest/config';

// vscode/ は別の package(自分の vitest で動かす)。ルートのテストには混ぜない
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'vscode/**'],
  },
});
