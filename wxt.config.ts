import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ひといき',
    description: 'AI チャット(ChatGPT・Claude・Gemini)での作業の中身から負担の目安を計算して、休憩のタイミングを提案します',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*', 'https://api.anthropic.com/*'],
  },
});
