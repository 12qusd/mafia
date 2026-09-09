import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, loadConfig } from '@nocturne/server';
// Local round acceleration is possible only in this isolated in-memory server.
const built = process.env.NOCTURNE_URL
  ? null
  : await buildApp({
      ...loadConfig(),
      noDb: true,
      production: false,
      port: 0,
      host: '127.0.0.1',
      llmBaseUrl: undefined,
      testModeEnv: false,
      clientDistDir: resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist'),
    });
if (built) await built.listen();
const base = process.env.NOCTURNE_URL || `http://127.0.0.1:${built.app.server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || chromium.executablePath(),
  headless: true,
});
const out = process.env.NOCTURNE_QA_DIR || '/tmp/nocturne-qa';
mkdirSync(out, { recursive: true });
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Quick Play', exact: true }).waitFor();
  await page.screenshot({ path: out + '/home.png', fullPage: true });
  // Two independent browser identities use the user-visible invitation.
  const hostContext = await browser.newContext({ reducedMotion: 'reduce' });
  const hostPage = await hostContext.newPage();
  await hostPage.goto(base);
  await hostPage.getByText('Host a private table', { exact: false }).click();
  await hostPage.getByPlaceholder('The Blind Tiger').fill('Invitation check');
  await hostPage.locator('.home-disclosure[open] .btn-primary').click();
  await hostPage.waitForURL('**/lobby/**');
  const invite = await hostPage.locator('.invite-code').innerText();
  const friendContext = await browser.newContext({ reducedMotion: 'reduce' });
  const friend = await friendContext.newPage();
  await friend.goto(`${base}/join/${invite}`);
  await friend.waitForURL('**/lobby/**');
  await friend.locator('.roster-item').nth(1).waitFor();
  await hostPage.locator('.page > .spread .btn-danger').click();
  await hostPage.waitForURL(base + '/');
  if (!(await hostPage.getByRole('button', { name: 'Quick Play', exact: true }).isEnabled()))
    throw new Error('Leaving a lobby lost the session');
  await friendContext.close();
  await hostContext.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + '/mobile-home.png', fullPage: true });
  if (
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    )
  )
    throw new Error('Mobile home overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Quick Play', exact: true }).click();
  await page.waitForURL('**/game', { timeout: 45000 });
  await page.locator('.role-name').waitFor();
  const role = await page.locator('.role-name').innerText();
  const seats = await page.locator('.town-resident').count();
  if (seats < 7) throw new Error('Quick Play did not fill the table');
  await page.screenshot({ path: out + '/game.png', fullPage: true });
  await page.locator('.chat-input-row input').fill('The clock tower has my attention.');
  await page.locator('.chat-input-row input').press('Enter');
  await page.getByText('The clock tower has my attention.', { exact: false }).waitFor();
  await page.reload();
  await page.locator('.role-name').waitFor({ timeout: 15000 });
  if ((await page.locator('.role-name').innerText()) !== role)
    throw new Error('Refresh lost the role');
  if ((await page.locator('.town-resident').count()) !== seats)
    throw new Error('Refresh lost the table');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + '/mobile-game.png', fullPage: true });
  for (const name of [
    'The table: players, votes and tallies',
    'Chat channels',
    'Your role, actions and wills',
  ]) {
    await page.getByRole('tab', { name, exact: true }).click();
    if (
      (await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected')) !== 'true'
    )
      throw new Error('Mobile pane failed: ' + name);
  }
  if (
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    )
  )
    throw new Error('Mobile game overflow');
  let fullRound = false;
  if (built) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const token = await page.evaluate(() => globalThis.localStorage.getItem('nocturne.token'));
    const identity = await built.ctx.identity.resolveToken(token);
    const room = built.ctx.manager.getRoom(built.ctx.manager.scopeIdOf(identity.id));
    // Exercise actual bot policy + engine transitions; no public debug endpoint.
    for (let n = 0; n < 100 && !room.isOver; n++) {
      await new Promise((r) => setTimeout(r, 2100));
      room.endPhaseNow();
      if (n === 0) {
        await page.screenshot({ path: out + '/night.png', fullPage: true });
      }
    }
    if (!room.isOver) throw new Error('Full round did not finish in 100 phases');
    await page.locator('.gameover-modal').waitFor();
    await page.screenshot({ path: out + '/game-over.png', fullPage: true });
    await page.reload();
    await page.locator('.gameover-modal').waitFor();
    await page.getByRole('button', { name: 'Quick Play again', exact: true }).click();
    await page.waitForURL('**/game', { timeout: 45000 });
    await page.locator('.role-name').waitFor();
    fullRound = true;
  }
  console.log(
    JSON.stringify({
      quickPlay: true,
      invitations: true,
      fullRoundAndPlayAgain: fullRound,
      refreshPreservesRole: true,
      seats,
      role,
      mobilePanes: true,
      errors,
    }),
  );
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  if (built) await built.shutdown(false);
}
