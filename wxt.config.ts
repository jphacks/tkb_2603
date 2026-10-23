import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ひといき',
    description: 'ChatGPT での作業の中身から負担の目安を計算して、区切りで休憩を提案します',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://api.anthropic.com/*'],
  },
});
