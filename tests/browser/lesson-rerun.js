// Playwright CLI run-code, with the local workbench already open.
// Intercept only the execution request so this check also works without Linux.
async page => {
  const base = new URL(page.url()).origin;
  const routes = [
    ['/labs/3.3?replay=demand512', 'demand512'],
    ['/labs/3.3?replay=stack', 'stack'],
    ['/#topic=baseline', 'lesson-cow'],
    ['/#topic=thp', 'recheck'],
  ];
  const requests = [];
  const busy = '测试：已有实验正在运行';
  const intercept = async route => {
    requests.push(route.request().postDataJSON().mode);
    await route.fulfill({status: 409, json: {error: busy}});
  };
  await page.route('**/api/run', intercept);
  try {
    for (const [path, mode] of routes) {
      await page.goto(base + path);
      await page.locator('.seq-steps button').last().click();
      if (mode === 'recheck') await page.locator('#thp-recipe').selectOption('advice-sparse');
      const practice = page.locator('.lesson-practice');
      const button = practice.locator('[data-lesson-run]');
      const start = requests.length;
      await button.click();
      await practice.getByRole('status').getByText(busy, {exact: true}).waitFor({timeout: 5000});
      if (requests.length !== start + 1 || requests[start] !== mode || !await button.isEnabled()) {
        throw new Error('复做请求或重试按钮异常：' + path);
      }
    }
  } finally {
    await page.unroute('**/api/run', intercept);
  }
  return requests;
}
