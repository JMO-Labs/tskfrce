const { chromium } = require('/home/user/code/tskfrce/.claude/worktrees/agent-af5c67f81617fb82e/frontend/node_modules/@playwright/test');
const path = require('path');

const SIZES = [
  { name: '390', width: 390, height: 800 },
  { name: '1280', width: 1280, height: 1024 },
];

const MODES = ['light', 'dark'];

const builtPath = path.join(__dirname, 'updates-built.html');
const outDir = '/tmp/claude-1000/-home-user-code-tskfrce/8ac19278-b8e8-4ab6-83c1-7db16041ca28/scratchpad/shots';

(async () => {
  const browser = await chromium.launch();

  for (const size of SIZES) {
    for (const mode of MODES) {
      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
        colorScheme: mode,
      });
      await page.goto(`file://${builtPath}`);

      const filename = `updates-built-${size.name}-${mode}.png`;
      const filepath = path.join(outDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      console.log(`✓ ${filename}`);

      await page.close();
    }
  }

  await browser.close();
  console.log('Built screenshots complete');
})();
