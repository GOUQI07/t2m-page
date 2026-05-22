import type { VNProjectState, VNSaveSlot } from '../types/vn';

export type VNProjectSummary = {
  projectId: string;
  id?: string;
  title?: string;
  schemaVersion?: number;
  entrySceneId?: string;
  sceneCount?: number;
  assetCount?: number;
  saveCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

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

export async function listBackendProjects(): Promise<VNProjectSummary[]> {
  const data = await fetchJson('/api/v1/projects', { cache: 'no-store' });
  return Array.isArray(data?.projects) ? data.projects : [];
}

export async function loadBackendProject(projectId: string): Promise<unknown> {
  const data = await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' });
  return data?.project ?? data;
}

export async function saveBackendProject(project: VNProjectState): Promise<unknown> {
  const projectId = project.projectId || project.id || 'default';
  const data = await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    json: project
  });
  return data?.project ?? data;
}

export async function migrateBackendProject(project: unknown): Promise<unknown> {
  const data = await fetchJson('/api/v1/projects/migrate', {
    method: 'POST',
    json: project
  });
  return data?.project ?? data;
}

export async function listBackendSaveSlots(projectId: string): Promise<VNSaveSlot[]> {
  const data = await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/saves`, { cache: 'no-store' });
  return Array.isArray(data?.slots) ? data.slots : [];
}

export async function saveBackendSaveSlot(projectId: string, slot: VNSaveSlot): Promise<VNSaveSlot> {
  const data = await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/saves`, {
    method: 'POST',
    json: slot
  });
  return (data?.slot ?? slot) as VNSaveSlot;
}

export async function deleteBackendSaveSlot(projectId: string, slotId: string): Promise<void> {
  await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/saves/${encodeURIComponent(slotId)}`, {
    method: 'DELETE'
  });
}
