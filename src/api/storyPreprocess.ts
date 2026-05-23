export type StoryPreprocessIntent = 'auto' | 'single_scene' | 'multi_scene' | 'branching';

export type StoryPreprocessReview = {
  sceneCount?: number;
  characterCount?: number;
  actionCount?: number;
  assetTaskCount?: number;
  voiceTaskCount?: number;
  hasChoices?: boolean;
  summary?: string;
};

export type StoryPreprocessDraft = {
  preprocessId: string;
  projectId: string;
  sourceText: string;
  intent?: StoryPreprocessIntent;
  mode: 'single_scene' | 'multi_scene';
  review: StoryPreprocessReview;
  script: any;
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

export async function preprocessVisualNovelStory(params: {
  projectId: string;
  text: string;
  intent?: StoryPreprocessIntent;
}): Promise<StoryPreprocessDraft> {
  const data = await fetchJson('/api/v1/transmute/visual-novel/preprocess', {
    method: 'POST',
    json: {
      project_id: params.projectId,
      text: params.text,
      intent: params.intent || 'auto'
    }
  });
  return data as StoryPreprocessDraft;
}

export async function commitVisualNovelStoryDraft(params: {
  draft: StoryPreprocessDraft;
  settings?: Record<string, unknown>;
}): Promise<any> {
  const { draft, settings } = params;
  return fetchJson('/api/v1/transmute/visual-novel/commit', {
    method: 'POST',
    json: {
      preprocessId: draft.preprocessId,
      project_id: draft.projectId,
      sourceText: draft.sourceText,
      intent: draft.intent || 'auto',
      mode: draft.mode,
      review: draft.review,
      settings,
      script: draft.script
    }
  });
}
