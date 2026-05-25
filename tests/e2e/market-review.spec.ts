import { expect, test } from '@playwright/test';
import { authedGet, authedPost, registerTestUser, uniqueId } from './helpers';

test.describe('market review workflow', () => {
  test.skip(!process.env.E2E_ADMIN_TOKEN, 'Set E2E_ADMIN_TOKEN to exercise the admin review path.');

  test('submitted playable can be approved and appears in the plaza listing API', async ({ request }) => {
    const auth = await registerTestUser(request, 'e2emarket');
    const projectId = uniqueId('market_project');
    const title = `E2E Market ${projectId}`;
    const playableUrl = process.env.E2E_PLAYABLE_URL || 'http://127.0.0.1:3000/';

    const saveProject = await authedPost(request, auth.token, '/api/v1/projects', {
      projectId,
      id: projectId,
      title,
      entrySceneId: 'start',
      nodes: [
        {
          id: 'start',
          title: 'Start',
          type: 'normal',
          status: 'done',
          actions: [{ id: 'line_1', type: 'line', speaker: 'Narrator', text: 'Market E2E.' }]
        }
      ],
      assets: [],
      variables: []
    });
    expect(saveProject.ok()).toBeTruthy();
    expect((await saveProject.json()).code).toBe(0);

    const build = await authedPost(request, auth.token, '/api/v1/market/builds', {
      projectId,
      playableUrl,
      versionLabel: 'e2e',
      buildType: 'WEB_PLAYABLE',
      metadata: { e2e: true }
    });
    const buildJson = await build.json();
    expect(buildJson.code, buildJson.message).toBe(0);

    const submission = await authedPost(request, auth.token, '/api/v1/market/submissions', {
      projectId,
      buildId: buildJson.data.buildId,
      title,
      summary: 'E2E market submission',
      description: 'Created by Playwright',
      tags: ['e2e', 'market'],
      contentRating: 'GENERAL'
    });
    const submissionJson = await submission.json();
    expect(submissionJson.code, submissionJson.message).toBe(0);

    const review = await authedPost(
      request,
      process.env.E2E_ADMIN_TOKEN!,
      `/api/v1/admin/market/submissions/${submissionJson.data.submissionId}/review`,
      { decision: 'APPROVED', reviewerNote: 'Approved by Playwright E2E.' }
    );
    const reviewJson = await review.json();
    expect(reviewJson.code, reviewJson.message).toBe(0);

    const listings = await authedGet(request, auth.token, `/api/v1/market/listings?q=${encodeURIComponent(title)}&limit=10`);
    const listingsJson = await listings.json();
    expect(listingsJson.code, listingsJson.message).toBe(0);
    expect(listingsJson.data.listings.some((listing: { title?: string }) => listing.title === title)).toBeTruthy();
  });
});
