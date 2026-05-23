type FetchOptions = RequestInit & {
  json?: unknown;
};

function apiData(json: any) {
  return json?.data ?? json;
}

async function fetchJson(path: string, options: FetchOptions = {}) {
  const headers = new Headers(options.headers);
  const init: RequestInit = {
    ...options,
    headers
  };

  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.json);
  }
  delete (init as FetchOptions).json;

  const response = await fetch(path, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (typeof json?.code === 'number' && json.code !== 0)) {
    throw new Error(json?.message || `Request failed: ${response.status}`);
  }
  return apiData(json);
}

export type GameListing = {
  listingId: string;
  title: string;
  summary?: string;
  description?: string;
  coverUrl?: string;
  tags?: string[];
  contentRating?: string;
  playableUrl?: string;
  versionLabel?: string;
  viewCount?: number;
  playCount?: number;
  publishedAt?: string;
};

export type MarketSubmission = {
  submissionId: string;
  projectId: string;
  buildId: string;
  ownerUserId: string;
  status: string;
  title: string;
  summary?: string;
  reviewerNote?: string;
  submittedAt?: string;
  reviewedAt?: string;
  playableUrl?: string;
  versionLabel?: string;
};

export type NotificationItem = {
  notificationId: string;
  type: string;
  title: string;
  body?: string;
  linkUrl?: string;
  unread?: boolean;
  createdAt?: string;
};

export type UploadedAssetRecord = {
  asset_id: string;
  project_id?: string;
  asset_type?: string;
  name?: string;
  url?: string;
  absolute_url?: string;
  storage_backend?: string;
  cos_key?: string;
};

export async function listGameListings(query = ''): Promise<GameListing[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  params.set('limit', '40');
  const data = await fetchJson(`/api/v1/market/listings?${params.toString()}`, { cache: 'no-store' });
  return Array.isArray(data?.listings) ? data.listings : [];
}

export async function getGameListing(listingId: string): Promise<GameListing | null> {
  const data = await fetchJson(`/api/v1/market/listings/${encodeURIComponent(listingId)}`, { cache: 'no-store' });
  return data?.listing ?? null;
}

export async function createMarketBuild(payload: {
  projectId: string;
  playableUrl: string;
  versionLabel?: string;
  coverUrl?: string;
}) {
  return fetchJson('/api/v1/market/builds', {
    method: 'POST',
    json: payload
  });
}

export async function uploadMarketPlayable(projectId: string, file: File): Promise<UploadedAssetRecord> {
  const form = new FormData();
  form.append('file', file);
  form.append('project_id', projectId);
  form.append('asset_type', 'playable_build');
  form.append('name', file.name || 'playable-build');

  const response = await fetch('/api/v1/user-assets', {
    method: 'POST',
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (typeof json?.code === 'number' && json.code !== 0)) {
    throw new Error(json?.message || `Upload failed: ${response.status}`);
  }
  return apiData(json) as UploadedAssetRecord;
}

export async function submitGame(payload: {
  projectId: string;
  buildId?: string;
  playableUrl?: string;
  versionLabel?: string;
  title: string;
  summary?: string;
  description?: string;
  coverUrl?: string;
  tags?: string[];
  contentRating?: string;
}): Promise<MarketSubmission> {
  return fetchJson('/api/v1/market/submissions', {
    method: 'POST',
    json: payload
  });
}

export async function listMySubmissions(): Promise<MarketSubmission[]> {
  const data = await fetchJson('/api/v1/market/my/submissions', { cache: 'no-store' });
  return Array.isArray(data?.submissions) ? data.submissions : [];
}

export async function listReviewQueue(status = 'PENDING_REVIEW'): Promise<MarketSubmission[]> {
  const data = await fetchJson(`/api/v1/admin/market/submissions?status=${encodeURIComponent(status)}`, { cache: 'no-store' });
  return Array.isArray(data?.submissions) ? data.submissions : [];
}

export async function reviewSubmission(submissionId: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'IN_REVIEW', reviewerNote = '') {
  return fetchJson(`/api/v1/admin/market/submissions/${encodeURIComponent(submissionId)}/review`, {
    method: 'POST',
    json: { decision, reviewerNote }
  });
}

export async function listNotifications(): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const data = await fetchJson('/api/v1/notifications?limit=20', { cache: 'no-store' });
  return {
    notifications: Array.isArray(data?.notifications) ? data.notifications : [],
    unreadCount: Number(data?.unreadCount || 0)
  };
}

export async function markNotificationRead(notificationId: string) {
  return fetchJson(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
}
