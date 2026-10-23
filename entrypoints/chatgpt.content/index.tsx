import ReactDOM from 'react-dom/client';
import { Runner } from '../../src/content/runner';
import { App } from '../../src/ui/App';
import '../../src/ui/style.css';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const runner = new Runner();
    await runner.start();
    const ui = await createShadowRootUi(ctx, {
      name: 'hitoiki-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      // ChatGPT のショートカットに入力が奪われないようにする
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<App runner={runner} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
