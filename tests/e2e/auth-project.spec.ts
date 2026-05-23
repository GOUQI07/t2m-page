import { expect, test } from '@playwright/test';
import { authedGet, gotoApp, registerTestUser, seedAuthSession, uniqueId } from './helpers';

test.describe('auth and project creation', () => {
  test('protected workstation redirects anonymous users to login', async ({ page }) => {
    await gotoApp(page, '/workstation');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('auth-page')).toBeVisible();
  });

  test('register and login forms create a usable browser session', async ({ page }) => {
    const username = uniqueId('uiform').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32);
    const password = `Pw_${Date.now()}_Ariadne`;

    await gotoApp(page, '/register');
    await page.getByTestId('auth-username').fill(username);
    await page.getByTestId('auth-display-name').fill(`UI ${username}`);
    await page.getByTestId('auth-email').fill(`${username}@example.local`);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-confirm-password').fill(password);
    await Promise.all([
      page.waitForURL(/\/projects\/new$/),
      page.getByTestId('auth-submit').click()
    ]);
    await expect(page.getByTestId('new-project-page')).toBeVisible();
    await expect(page.evaluate(() => localStorage.getItem('vn_auth_token'))).resolves.toBeTruthy();

    await page.evaluate(() => {
      localStorage.removeItem('vn_auth_token');
      localStorage.removeItem('vn_auth_user');
    });
    await gotoApp(page, '/login');
    await page.getByTestId('auth-identifier').fill(username);
    await page.getByTestId('auth-password').fill(password);
    await Promise.all([
      page.waitForURL(/\/projects\/new$/),
      page.getByTestId('auth-submit').click()
    ]);
    await expect(page.getByTestId('new-project-page')).toBeVisible();
  });

  test('registered user creates a branch project and persists it to the backend', async ({ page, request }) => {
    const auth = await registerTestUser(request, 'e2eproj');
    await seedAuthSession(page, auth);

    const title = `E2E Branch ${uniqueId('project')}`;
    await gotoApp(page, '/projects/new');
    await expect(page.getByTestId('new-project-page')).toBeVisible();

    await page.getByTestId('new-project-title').fill(title);
    await page.getByTestId('new-project-entry-title').fill('Opening');
    await page.getByTestId('new-project-summary').fill('Automated branch project with save-ready runtime data.');
    await page.getByTestId('new-project-template-branch').click();

    await Promise.all([
      page.waitForURL(/\/workstation$/),
      page.getByTestId('new-project-submit').click()
    ]);

    await page.getByTestId('guide-card-ariadne').click();
    await expect(page.getByTestId('workstation-project-title')).toContainText(title);

    const localProject = await page.evaluate(() => JSON.parse(localStorage.getItem('vn_project') || '{}'));
    expect(localProject.title).toBe(title);
    expect(localProject.entrySceneId).toBe('scene_start');
    expect(localProject.nodes.length).toBeGreaterThanOrEqual(4);
    expect(localProject.variables.map((item: { key: string }) => item.key)).toEqual(
      expect.arrayContaining(['flag.left_room', 'affinity.heroine'])
    );

    const listResponse = await authedGet(request, auth.token, '/api/v1/projects');
    expect(listResponse.ok()).toBeTruthy();
    const listJson = await listResponse.json();
    expect(listJson.code, listJson.message).toBe(0);
    expect(listJson.data.projects.some((project: { title?: string }) => project.title === title)).toBeTruthy();
  });
});
