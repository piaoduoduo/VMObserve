// Playwright CLI run-code against work/launch.py from a fresh checkout.
async page => {
  const base = new URL(page.url()).origin;
  const cowId = 'example--20261126T123621.058829Z';
  const demandId = 'example--20261126T124107.942264Z';
  const response = await page.request.get(base + '/api/evidence?' + new URLSearchParams({
    id: cowId, case: 'baseline-16MiB-1', kind: 'jsonl'
  }));
  if (!response.ok()) throw Error('Missing COW JSONL');
  const records = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  const after = records.filter(e => e.kind === 'pagemap' && e.phase === 'child_write');
  const parents = after.find(e => e.role === 'parent').entries;
  const children = after.find(e => e.role === 'child').entries;
  const expected = parents.map(p => {
    const c = children.find(item => item.vaddr === p.vaddr);
    return [String(p.page_index), '0x' + p.pfn, '0x' + c.pfn, p.pfn === c.pfn ? '仍共享' : '已分开'];
  });

  await page.goto(base);
  const preview = page.locator('.featured-pagemap');
  await preview.getByText('Present 0 → 1', {exact: true}).waitFor();
  const rows = preview.locator('tbody tr');
  await rows.last().waitFor();
  const displayed = await rows.evaluateAll(items => items.map(r => [...r.cells].map(c => c.textContent)));
  if (displayed.length !== 8 || JSON.stringify(displayed) !== JSON.stringify(expected)) throw Error('PFN table differs from JSONL');

  await preview.getByRole('link', {name: '查看父子进程同步采样'}).click();
  await page.locator('[data-cow-pagemap="pair"][data-pagemap-state="available"]').waitFor();
  if (!page.url().includes(cowId) || !await page.locator('[data-course-step="7"][aria-current="step"]').count())
    throw Error('COW link missed the synchronized child_write step');
  await page.goBack();
  await preview.getByRole('link', {name: '查看写入前后的页表'}).click();
  const pageOne = page.locator('.pte-cell').filter({has: page.getByText('#1', {exact: true})});
  await pageOne.getByText('P = 1', {exact: true}).waitFor();
  if (!page.url().includes(demandId) || !await page.locator('[data-course-step="2"][aria-current="step"]').count())
    throw Error('3.3 link missed write_quarter');
  await page.locator('.seq-steps [data-course-step="1"]').click();
  await pageOne.getByText('P = 0', {exact: true}).waitFor();
  await page.locator('.pte-cell').filter({has: page.getByText('#0', {exact: true})}).getByText('P = 1', {exact: true}).waitFor();
  return {cowRows: displayed, demandPage: 1, present: [0, 1], allocatedPageZero: 1};
}
