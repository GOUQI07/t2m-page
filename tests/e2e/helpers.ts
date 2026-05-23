import { expect, type APIRequestContext, type Page } from '@playwright/test';

export type TestAuth = {
  token: string;
  user: {
    id: string;
    username: string;
    email?: string;
    displayName?: string;
    roles?: string[];
  };
  username: string;
  password: string;
};

export function uniqueId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function registerTestUser(request: APIRequestContext, prefix = 'e2e'): Promise<TestAuth> {
  const username = uniqueId(prefix).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32);
  const password = `Pw_${Date.now()}_Ariadne`;
  const response = await request.post('/api/v1/auth/register', {
    data: {
      username,
      email: `${username}@example.local`,
      displayName: username,
      password
    }
  });
  expect(response.ok()).toBeTruthy();
  const json = await response.json();
  expect(json.code, json.message).toBe(0);
  expect(json.data.token).toBeTruthy();
  return {
    token: json.data.token,
    user: json.data.user,
    username,
    password
  };
}

export async function seedAuthSession(page: Page, auth: TestAuth) {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('vn_auth_token', token);
    localStorage.setItem('vn_auth_user', JSON.stringify(user));
  }, { token: auth.token, user: auth.user });
}

export async function gotoApp(page: Page, path: string) {
  const rootChild = page.locator('#root > *').first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    try {
      await rootChild.waitFor({ state: 'attached', timeout: 15_000 });
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(750);
    }
  }
}

export async function authedGet(request: APIRequestContext, token: string, path: string) {
  return request.get(path, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function authedPost(request: APIRequestContext, token: string, path: string, data: unknown) {
  return request.post(path, {
    headers: { Authorization: `Bearer ${token}` },
    data
  });
}
