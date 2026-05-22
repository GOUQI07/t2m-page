import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Clapperboard,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Library,
  Loader2,
  Mic,
  Music,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Tags,
  Upload,
  UserRound,
  Wand2,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';

type AssetRecord = {
  asset_id: string;
  project_id?: string;
  asset_type?: string;
  source_asset_id?: string;
  character_id?: string;
  name?: string;
  description?: string;
  tags?: string[] | string;
  url?: string;
  absolute_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  sample_rate?: number;
  storage_backend?: string;
  cos_bucket?: string;
  cos_region?: string;
  cos_key?: string;
  cos_public_url?: string;
  signed_url_expires_in?: number;
  created_at?: string;
  metadata?: Record<string, any>;
};

type LibraryFilter = 'all' | 'background' | 'cg' | 'character_card';
type CharacterAssetType = 'character_sprite' | 'character_variant' | 'character_voice';

type CharacterForm = {
  name: string;
  character_id: string;
  description: string;
  tags: string;
  outfit_prompt: string;
  style_prompt: string;
  voice_desc: string;
};

const PROJECT_ID = 'asset_lab_default';
const DEFAULT_STYLE = 'clean anime visual novel sprite, crisp line art, soft cel shading, transparent PNG';
const CHARACTER_NEGATIVE = 'multiple people, extra character, duplicate, clone, character sheet, lineup, side by side, text, watermark, weapon';

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'background', label: 'Background' },
  { id: 'cg', label: 'CG' },
  { id: 'character_card', label: 'Characters' }
];

const EMPTY_FORM: CharacterForm = {
  name: '',
  character_id: '',
  description: '',
  tags: '',
  outfit_prompt: '',
  style_prompt: DEFAULT_STYLE,
  voice_desc: 'young expressive visual novel character voice'
};

function apiData(json: any) {
  return json?.data ?? json;
}

function safeId(value: string) {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id || `asset_${Date.now()}`;
}

function tagsOf(record?: AssetRecord): string[] {
  const raw = record?.tags;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,\s，]+/).map(item => item.trim()).filter(Boolean);
  const metaTags = record?.metadata?.tags;
  if (Array.isArray(metaTags)) return metaTags.map(String).filter(Boolean);
  return [];
}

function textOf(record: AssetRecord) {
  return [
    record.asset_id,
    record.asset_type,
    record.character_id,
    record.name,
    record.description,
    tagsOf(record).join(' '),
    record.metadata?.prompt,
    record.metadata?.appearance_prompt,
    record.metadata?.variant_prompt,
    record.metadata?.voice_desc
  ].filter(Boolean).join(' ').toLowerCase();
}

function displayUrl(asset?: AssetRecord) {
  if (!asset) return '';
  return asset.absolute_url || asset.url || '';
}

function remoteUrl(asset?: AssetRecord) {
  const url = asset?.absolute_url || asset?.url || '';
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${window.location.origin}${url}`;
}

function isImageAsset(asset: AssetRecord) {
  const type = String(asset.asset_type || '').toLowerCase();
  return type.includes('background') || type.includes('cg') || type.includes('sprite') || type.includes('variant') || type.includes('image');
}

function isAudioAsset(asset: AssetRecord) {
  const type = String(asset.asset_type || '').toLowerCase();
  return type.includes('voice') || type.includes('audio');
}

function compactId(value?: string) {
  if (!value) return 'untitled';
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function normalizeKind(asset: AssetRecord): LibraryFilter | CharacterAssetType | 'other' {
  const type = String(asset.asset_type || '').toLowerCase();
  if (type === 'character_card') return 'character_card';
  if (type.includes('character_sprite') || type.includes('sprite')) return 'character_sprite';
  if (type.includes('character_variant') || type.includes('variant')) return 'character_variant';
  if (type.includes('voice') || type.includes('audio')) return 'character_voice';
  if (type.includes('background')) return 'background';
  if (type.includes('cg')) return 'cg';
  return 'other';
}

function extractTaskId(payload: any) {
  const data = apiData(payload);
  return data?.task_id || data?.taskId || data?.id || data?.data?.task_id || data?.data?.taskId;
}

function extractResultAsset(payload: any, fallbackType: string): AssetRecord | null {
  const data = apiData(payload);
  const nested = data?.data || data?.result || data?.asset || data;
  const accessUrl = nested?.absolute_url || nested?.url || nested?.asset_url || nested?.image_url || nested?.audio_url;
  if (!accessUrl) return null;
  const canonicalUrl = nested?.url || accessUrl;
  return {
    asset_id: nested.asset_id || nested.task_id || `remote_${Date.now()}`,
    project_id: nested.project_id || PROJECT_ID,
    asset_type: nested.asset_type || fallbackType,
    url: canonicalUrl,
    absolute_url: accessUrl.startsWith('http') ? accessUrl : `${window.location.origin}${accessUrl}`,
    storage_backend: nested.storage_backend,
    cos_bucket: nested.cos_bucket,
    cos_region: nested.cos_region,
    cos_key: nested.cos_key,
    cos_public_url: nested.cos_public_url,
    signed_url_expires_in: nested.signed_url_expires_in,
    width: nested.width,
    height: nested.height,
    duration_seconds: nested.duration_seconds,
    sample_rate: nested.sample_rate,
    metadata: nested.metadata
  };
}

function scoreRecord(record: AssetRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const haystack = textOf(record);
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 4;
    else if ([record.name, record.asset_id, record.character_id].some(value => String(value || '').toLowerCase().includes(token))) score += 2;
  }
  return score;
}

async function fetchJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(json.message || 'request failed');
  }
  return apiData(json);
}

async function registerRecord(record: Partial<AssetRecord>) {
  return fetchJson('/api/v1/user-assets/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: PROJECT_ID, ...record })
  }) as Promise<AssetRecord>;
}

async function uploadFile(file: File, assetType: string, fields: Partial<AssetRecord>) {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('project_id', PROJECT_ID);
  form.append('asset_type', assetType);
  if (fields.source_asset_id) form.append('source_asset_id', fields.source_asset_id);
  if (fields.character_id) form.append('character_id', fields.character_id);
  if (fields.name) form.append('name', fields.name);
  if (fields.tags) form.append('tags', tagsOf(fields as AssetRecord).join(','));
  if (fields.metadata) form.append('metadata', JSON.stringify(fields.metadata));
  return fetchJson('/api/v1/user-assets', { method: 'POST', body: form }) as Promise<AssetRecord>;
}

function Pill({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full px-3 text-xs transition-colors ${
        active ? 'bg-primary text-black' : 'border border-white/10 bg-white/5 text-white/55 hover:border-primary/50 hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [status, setStatus] = useState('Ready');
  const [isBusy, setIsBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CharacterForm>(EMPTY_FORM);
  const [globalUploadType, setGlobalUploadType] = useState<'background' | 'cg'>('background');
  const [globalTags, setGlobalTags] = useState('');
  const [scenePrompt, setScenePrompt] = useState('');
  const [variantPrompt, setVariantPrompt] = useState('gentle smile, standing centered');
  const [voiceText, setVoiceText] = useState('Hello, I am ready.');

  const refreshAssets = useCallback(async () => {
    try {
      const data = await fetchJson(`/api/v1/user-assets?project_id=${encodeURIComponent(PROJECT_ID)}`);
      setAssets(Array.isArray(data.records) ? data.records : []);
      setStatus('Library synced');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Library sync failed');
    }
  }, []);

  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  const characterCards = useMemo(
    () => assets.filter(asset => normalizeKind(asset) === 'character_card'),
    [assets]
  );

  const selectedCharacter = useMemo(
    () => characterCards.find(card => card.asset_id === selectedCharacterId),
    [characterCards, selectedCharacterId]
  );

  const linkedAssets = useMemo(() => {
    if (!selectedCharacter) return [];
    const cardCharacterId = selectedCharacter.character_id || selectedCharacter.metadata?.character_id;
    return assets.filter(asset => {
      if (asset.asset_id === selectedCharacter.asset_id) return false;
      if (asset.source_asset_id === selectedCharacter.asset_id) return true;
      return cardCharacterId && (asset.character_id === cardCharacterId || asset.metadata?.character_id === cardCharacterId);
    });
  }, [assets, selectedCharacter]);

  const coverFor = useCallback((card: AssetRecord) => {
    const cardCharacterId = card.character_id || card.metadata?.character_id;
    return assets.find(asset => {
      const kind = normalizeKind(asset);
      return (kind === 'character_sprite' || kind === 'character_variant')
        && (asset.source_asset_id === card.asset_id || asset.character_id === cardCharacterId || asset.metadata?.character_id === cardCharacterId)
        && displayUrl(asset);
    });
  }, [assets]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    assets.forEach(asset => tagsOf(asset).forEach(tag => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 32);
  }, [assets]);

  const libraryItems = useMemo(() => {
    const base = assets.filter(asset => {
      const kind = normalizeKind(asset);
      if (filter === 'all') return kind === 'background' || kind === 'cg' || kind === 'character_card';
      return kind === filter;
    });
    return base
      .map(asset => ({ asset, score: scoreRecord(asset, query) }))
      .filter(item => item.score > 0)
      .filter(item => !tagFilter || tagsOf(item.asset).includes(tagFilter))
      .sort((a, b) => b.score - a.score || String(b.asset.created_at || '').localeCompare(String(a.asset.created_at || '')))
      .map(item => item.asset);
  }, [assets, filter, query, tagFilter]);

  const createCharacterCard = async () => {
    const name = form.name.trim();
    const description = form.description.trim();
    if (!name || !description) {
      setStatus('Character name and description are required');
      return;
    }
    setIsBusy(true);
    setStatus('Creating character card...');
    try {
      const characterId = form.character_id.trim() || `char_${safeId(name)}`;
      const tags = tagsOf({ tags: form.tags } as AssetRecord);
      const card = await registerRecord({
        asset_id: `char_card_${safeId(characterId)}_${Date.now()}`,
        asset_type: 'character_card',
        name,
        description,
        tags,
        character_id: characterId,
        metadata: {
          character_id: characterId,
          appearance_prompt: description,
          outfit_prompt: form.outfit_prompt,
          style_prompt: form.style_prompt,
          voice_desc: form.voice_desc,
          tags
        }
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await refreshAssets();
      setSelectedCharacterId(card.asset_id);
      setStatus('Character card created');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Character card create failed');
    } finally {
      setIsBusy(false);
    }
  };

  const uploadLibraryFile = async (file: File, assetType: string, parent?: AssetRecord, extra?: Record<string, any>) => {
    setIsBusy(true);
    setStatus('Uploading asset...');
    try {
      const characterId = parent?.character_id || parent?.metadata?.character_id || extra?.character_id;
      await uploadFile(file, assetType, {
        source_asset_id: parent?.asset_id,
        character_id: characterId,
        name: file.name,
        tags: extra?.tags || tagsOf(parent).join(','),
        metadata: {
          character_id: characterId,
          library_kind: assetType,
          uploaded_by: 'asset_library',
          ...extra
        }
      });
      await refreshAssets();
      setStatus('Asset uploaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  };

  const submitRemote = async (path: string, payload: Record<string, any>) => {
    const data = await fetchJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return data;
  };

  const pollTask = async (
    taskId: string,
    sourceAssetId: string | undefined,
    fallbackType: string,
    extra: Partial<AssetRecord>
  ) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const payload = await fetchJson(`/api/v1/asset-api/tasks/${encodeURIComponent(taskId)}`);
      const statusValue = payload.status || payload.data?.status;
      if (statusValue === 'failed') {
        throw new Error(payload.message || payload.error || 'remote task failed');
      }
      if (statusValue === 'succeeded') {
        const resultAsset = extractResultAsset(payload, fallbackType);
        if (!resultAsset) return payload;
        await registerRecord({
          ...resultAsset,
          asset_type: extra.asset_type || resultAsset.asset_type || fallbackType,
          source_asset_id: sourceAssetId,
          name: extra.name || resultAsset.name,
          tags: extra.tags,
          character_id: extra.character_id,
          metadata: {
            ...(resultAsset.metadata || {}),
            ...(extra.metadata || {})
          }
        });
        await refreshAssets();
        return payload;
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000));
    }
    throw new Error('remote task timed out');
  };

  const runRemoteAndRegister = async (
    path: string,
    payload: Record<string, any>,
    sourceAssetId: string | undefined,
    fallbackType: string,
    extra: Partial<AssetRecord>
  ) => {
    const response = await submitRemote(path, payload);
    const taskId = extractTaskId(response);
    if (taskId) {
      setStatus(`Task ${taskId} submitted`);
      return pollTask(taskId, sourceAssetId, fallbackType, extra);
    }
    const resultAsset = extractResultAsset(response, fallbackType);
    if (resultAsset) {
      await registerRecord({
        ...resultAsset,
        asset_type: extra.asset_type || resultAsset.asset_type || fallbackType,
        source_asset_id: sourceAssetId,
        name: extra.name || resultAsset.name,
        tags: extra.tags,
        character_id: extra.character_id,
        metadata: {
          ...(resultAsset.metadata || {}),
          ...(extra.metadata || {})
        }
      });
      await refreshAssets();
    }
    return response;
  };

  const generateCharacterSprite = async (card: AssetRecord) => {
    const characterId = card.character_id || card.metadata?.character_id || safeId(card.name || card.asset_id);
    const payload = {
      project_id: PROJECT_ID,
      character_id: characterId,
      character_card: {
        name: card.name,
        role: 'visual novel character',
        appearance: card.metadata?.appearance_prompt || card.description,
        outfit: card.metadata?.outfit_prompt || '',
        style: card.metadata?.style_prompt || DEFAULT_STYLE,
        identity_rules: ['single character only', 'same face shape', 'same hairstyle and colors']
      },
      appearance_prompt: card.metadata?.appearance_prompt || card.description || card.name,
      pose_prompt: 'standing centered, full body visible',
      expression_prompt: 'neutral expression',
      outfit_prompt: card.metadata?.outfit_prompt || '',
      style_prompt: card.metadata?.style_prompt || DEFAULT_STYLE,
      negative_prompt: CHARACTER_NEGATIVE,
      width: 640,
      height: 1024,
      sprite_framing: 'full_body'
    };
    return runRemoteAndRegister('/api/v1/asset-api/character', payload, card.asset_id, 'character_sprite', {
      asset_type: 'character_sprite',
      name: `${card.name || characterId} base sprite`,
      tags: tagsOf(card),
      character_id: characterId,
      metadata: { character_id: characterId, prompt: payload.appearance_prompt, generated_by: 'asset_library' }
    });
  };

  const generateCharacterVariant = async (card: AssetRecord, prompt = variantPrompt) => {
    const characterId = card.character_id || card.metadata?.character_id || safeId(card.name || card.asset_id);
    const reference = linkedAssets.find(asset => normalizeKind(asset) === 'character_sprite' && remoteUrl(asset));
    const payload = {
      project_id: PROJECT_ID,
      character_id: characterId,
      reference_image_url: reference ? remoteUrl(reference) : null,
      pose_prompt: prompt,
      expression_prompt: prompt,
      outfit_prompt: card.metadata?.outfit_prompt || '',
      style_prompt: card.metadata?.style_prompt || DEFAULT_STYLE,
      negative_prompt: CHARACTER_NEGATIVE,
      variant_tags: tagsOf({ tags: prompt } as AssetRecord).slice(0, 4),
      width: 640,
      height: 1024,
      sprite_framing: 'full_body',
      cutout_mode: 'preserve_alpha'
    };
    return runRemoteAndRegister('/api/v1/asset-api/character/variant', payload, card.asset_id, 'character_variant', {
      asset_type: 'character_variant',
      name: `${card.name || characterId} ${prompt}`,
      tags: [...tagsOf(card), ...tagsOf({ tags: prompt } as AssetRecord)],
      character_id: characterId,
      metadata: { character_id: characterId, variant_prompt: prompt, generated_by: 'asset_library' }
    });
  };

  const generateCharacterVoice = async (card: AssetRecord, line = voiceText) => {
    const characterId = card.character_id || card.metadata?.character_id || safeId(card.name || card.asset_id);
    const payload = {
      project_id: PROJECT_ID,
      character_id: characterId,
      text: line,
      voice_desc: card.metadata?.voice_desc || 'young expressive visual novel character voice',
      emotion: 'neutral',
      reference_voice_url: null,
      reference_voice_path: null,
      cfg_value: 2.0,
      inference_timesteps: 10,
      normalize: true,
      denoise: true
    };
    return runRemoteAndRegister('/api/v1/asset-api/voice', payload, card.asset_id, 'character_voice', {
      asset_type: 'character_voice',
      name: `${card.name || characterId} voice`,
      tags: tagsOf(card),
      character_id: characterId,
      metadata: { character_id: characterId, voice_text: line, voice_desc: payload.voice_desc, generated_by: 'asset_library' }
    });
  };

  const generateCharacterSet = async (card: AssetRecord) => {
    setIsBusy(true);
    setStatus('Generating character set...');
    try {
      await generateCharacterSprite(card);
      for (const prompt of ['neutral expression', 'gentle smile', 'angry expression']) {
        await generateCharacterVariant(card, prompt);
      }
      await generateCharacterVoice(card);
      setStatus('Character set generation requested');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Character set generation failed');
    } finally {
      setIsBusy(false);
    }
  };

  const generateSceneAsset = async (assetType: 'background' | 'cg', prompt: string, source?: AssetRecord) => {
    setIsBusy(true);
    setStatus(`Generating ${assetType}...`);
    try {
      const payload = {
        project_id: PROJECT_ID,
        prompt,
        background_prompt: prompt,
        style_prompt: 'visual novel production art, clean composition, high detail',
        negative_prompt: assetType === 'background' ? 'people, character, silhouette, face, body' : 'text, watermark, logo',
        width: 1280,
        height: 720,
        asset_type: assetType
      };
      await runRemoteAndRegister('/api/v1/asset-api/background', payload, source?.asset_id, assetType, {
        asset_type: assetType,
        name: source?.name || prompt.slice(0, 48) || assetType,
        tags: source ? tagsOf(source) : tagsOf({ tags: globalTags } as AssetRecord),
        metadata: { prompt, generated_by: 'asset_library', source_asset_id: source?.asset_id }
      });
      setStatus(`${assetType} generation requested`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${assetType} generation failed`);
    } finally {
      setIsBusy(false);
    }
  };

  const regenerateAsset = async (asset: AssetRecord) => {
    const kind = normalizeKind(asset);
    const parent = characterCards.find(card => card.asset_id === asset.source_asset_id || card.character_id === asset.character_id || card.metadata?.character_id === asset.metadata?.character_id);
    setIsBusy(true);
    setStatus('Regenerating asset...');
    try {
      if (kind === 'character_sprite' && parent) await generateCharacterSprite(parent);
      else if (kind === 'character_variant' && parent) await generateCharacterVariant(parent, asset.metadata?.variant_prompt || asset.name || 'gentle smile');
      else if (kind === 'character_voice' && parent) await generateCharacterVoice(parent, asset.metadata?.voice_text || voiceText);
      else if (kind === 'background' || kind === 'cg') await generateSceneAsset(kind, asset.metadata?.prompt || asset.name || asset.description || kind, asset);
      else throw new Error('This asset type cannot regenerate yet');
      setStatus('Regenerate submitted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Regenerate failed');
    } finally {
      setIsBusy(false);
    }
  };

  const renderAssetPreview = (asset: AssetRecord, className = 'h-full w-full') => {
    if (isAudioAsset(asset)) {
      return (
        <div className={`${className} flex flex-col items-center justify-center gap-2 bg-white/5`}>
          <Music className="h-7 w-7 text-white/45" />
          <span className="text-xs text-white/45">Voice</span>
        </div>
      );
    }
    if (displayUrl(asset)) {
      return <img src={displayUrl(asset)} alt="" className={`${className} ${normalizeKind(asset) === 'background' || normalizeKind(asset) === 'cg' ? 'object-cover' : 'object-contain'} bg-black`} />;
    }
    return (
      <div className={`${className} flex items-center justify-center bg-white/5`}>
        <ImageIcon className="h-7 w-7 text-white/35" />
      </div>
    );
  };

  const renderLibraryItem = (asset: AssetRecord) => {
    const kind = normalizeKind(asset);
    if (kind === 'character_card') {
      const cover = coverFor(asset);
      return (
        <button
          key={asset.asset_id}
          type="button"
          onClick={() => setSelectedCharacterId(asset.asset_id)}
          className="group grid min-h-[250px] grid-rows-[1fr_auto] overflow-hidden rounded-lg border border-white/10 bg-white/5 text-left transition-colors hover:border-primary/60"
        >
          <div className="min-h-44 bg-black/70">
            {cover ? renderAssetPreview(cover) : (
              <div className="flex h-full min-h-44 items-center justify-center">
                <UserRound className="h-12 w-12 text-white/30" />
              </div>
            )}
          </div>
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-sm font-medium text-white/85">{asset.name || asset.character_id || compactId(asset.asset_id)}</div>
              <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] text-primary">CARD</span>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-white/45">{asset.description || asset.metadata?.appearance_prompt || 'No description'}</p>
            <div className="flex flex-wrap gap-1">
              {tagsOf(asset).slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/45">{tag}</span>)}
            </div>
          </div>
        </button>
      );
    }

    return (
      <div key={asset.asset_id} className="grid min-h-[230px] grid-rows-[1fr_auto] overflow-hidden rounded-lg border border-white/10 bg-white/5">
        <div className="min-h-40 bg-black/70">{renderAssetPreview(asset)}</div>
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-white/85">{asset.name || compactId(asset.asset_id)}</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-white/35">{asset.asset_type || kind}</div>
            </div>
            <button type="button" onClick={() => regenerateAsset(asset)} className="rounded-full border border-white/10 p-2 text-white/45 hover:border-primary hover:text-primary">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {tagsOf(asset).slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/45">{tag}</span>)}
          </div>
        </div>
      </div>
    );
  };

  const renderCharacterDetail = () => {
    if (!selectedCharacter) return null;
    const sprites = linkedAssets.filter(asset => normalizeKind(asset) === 'character_sprite');
    const variants = linkedAssets.filter(asset => normalizeKind(asset) === 'character_variant');
    const voices = linkedAssets.filter(asset => normalizeKind(asset) === 'character_voice');

    const assetTile = (asset: AssetRecord) => (
      <div key={asset.asset_id} className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
        <div className="h-52 bg-black/70">{renderAssetPreview(asset)}</div>
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs text-white/80">{asset.name || compactId(asset.asset_id)}</div>
              <div className="mt-1 text-[10px] text-white/35">{asset.width && asset.height ? `${asset.width} x ${asset.height}` : asset.asset_type}</div>
            </div>
            <button type="button" onClick={() => regenerateAsset(asset)} className="rounded-full border border-white/10 p-2 text-white/45 hover:border-primary hover:text-primary">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {isAudioAsset(asset) && displayUrl(asset) && <audio src={displayUrl(asset)} controls className="w-full" />}
          {displayUrl(asset) && (
            <a href={displayUrl(asset)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-primary">
              <ExternalLink className="h-3 w-3" /> Open
            </a>
          )}
        </div>
      </div>
    );

    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col overflow-hidden">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <button type="button" onClick={() => setSelectedCharacterId('')} className="rounded-full border border-white/10 p-2 text-white/50 hover:border-primary hover:text-primary">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="truncate text-lg font-medium text-[#E1E0CC]">{selectedCharacter.name || selectedCharacter.character_id}</div>
                <div className="mt-1 truncate text-xs text-white/40">{selectedCharacter.character_id || selectedCharacter.metadata?.character_id}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => generateCharacterSet(selectedCharacter)} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-medium text-black disabled:opacity-50">
                <Sparkles className="h-3.5 w-3.5" /> Generate Set
              </button>
              <Link to="/asset-lab" className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-4 text-xs text-white/65 hover:border-primary hover:text-primary">
                <Wand2 className="h-3.5 w-3.5" /> Asset Lab
              </Link>
            </div>
          </div>
        </header>

        <div className="grid flex-1 overflow-auto lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
            <div className="space-y-6">
              <section className="space-y-3">
                <h2 className="text-[10px] uppercase tracking-widest text-white/40">Character Info</h2>
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <p className="text-sm leading-relaxed text-white/70">{selectedCharacter.description || selectedCharacter.metadata?.appearance_prompt}</p>
                  <div className="mt-4 flex flex-wrap gap-1">
                    {tagsOf(selectedCharacter).map(tag => <span key={tag} className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/50">{tag}</span>)}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-[10px] uppercase tracking-widest text-white/40">Upload</h2>
                <div className="grid gap-2">
                  {[
                    ['character_sprite', 'Base Sprite', 'image/*'],
                    ['character_variant', 'Variant', 'image/*'],
                    ['character_voice', 'Voice', 'audio/*']
                  ].map(([type, label, accept]) => (
                    <label key={type} className="flex h-10 cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white/65 hover:border-primary hover:text-primary">
                      <span>{label}</span>
                      <Upload className="h-3.5 w-3.5" />
                      <input
                        type="file"
                        accept={accept}
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = '';
                          if (file) uploadLibraryFile(file, type, selectedCharacter);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-[10px] uppercase tracking-widest text-white/40">Generate</h2>
                <button type="button" onClick={() => generateCharacterSprite(selectedCharacter)} disabled={isBusy} className="flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-50">
                  <UserRound className="h-3.5 w-3.5" /> Base Sprite
                </button>
                <textarea
                  value={variantPrompt}
                  onChange={event => setVariantPrompt(event.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-white/10 bg-black p-3 text-xs text-white/75 outline-none focus:border-primary"
                />
                <button type="button" onClick={() => generateCharacterVariant(selectedCharacter)} disabled={isBusy} className="flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-50">
                  <ImageIcon className="h-3.5 w-3.5" /> Variant
                </button>
                <textarea
                  value={voiceText}
                  onChange={event => setVoiceText(event.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-white/10 bg-black p-3 text-xs text-white/75 outline-none focus:border-primary"
                />
                <button type="button" onClick={() => generateCharacterVoice(selectedCharacter)} disabled={isBusy} className="flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-50">
                  <Mic className="h-3.5 w-3.5" /> Voice
                </button>
              </section>
            </div>
          </aside>

          <main className="space-y-8 p-5">
            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Character Sprites</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sprites.map(assetTile)}</div>
              {!sprites.length && <EmptyRow label="No base sprite yet" />}
            </section>
            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Sprite Variants</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{variants.map(assetTile)}</div>
              {!variants.length && <EmptyRow label="No variant yet" />}
            </section>
            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Character Voice</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{voices.map(assetTile)}</div>
              {!voices.length && <EmptyRow label="No voice asset yet" />}
            </section>
          </main>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-[#E1E0CC] font-sans">
      <header className="sticky top-0 z-20 h-16 border-b border-white/10 bg-black px-5">
        <div className="flex h-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <Link to="/" className="text-xl font-bold tracking-tighter hover:opacity-80">
              Ariadne<span className="text-primary">*</span>
            </Link>
            <div className="h-4 w-px bg-white/20" />
            <Link to="/workstation" className="text-white/50 hover:text-primary">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-medium">Asset Library</h1>
              <p className="truncate text-[10px] text-white/35">Backgrounds, CG and character cards</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-white/45">
            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            <span className="truncate">{status}</span>
          </div>
        </div>
      </header>

      {selectedCharacter ? renderCharacterDetail() : (
        <main className="grid min-h-[calc(100vh-64px)] lg:grid-cols-[280px_minmax(0,1fr)_340px]">
          <aside className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[10px] uppercase tracking-widest text-white/40">Library</h2>
                  <button type="button" onClick={refreshAssets} className="text-white/45 hover:text-primary">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
                  <Search className="h-4 w-4 text-white/35" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search"
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm text-white/80 outline-none placeholder:text-white/30"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map(item => <Pill key={item.id} active={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</Pill>)}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-[10px] uppercase tracking-widest text-white/40">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  <Pill active={!tagFilter} onClick={() => setTagFilter('')}>Any</Pill>
                  {allTags.map(tag => <Pill key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>{tag}</Pill>)}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-[10px] uppercase tracking-widest text-white/40">Scene Asset</h2>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <Pill active={globalUploadType === 'background'} onClick={() => setGlobalUploadType('background')}>Background</Pill>
                    <Pill active={globalUploadType === 'cg'} onClick={() => setGlobalUploadType('cg')}>CG</Pill>
                  </div>
                  <input
                    value={globalTags}
                    onChange={event => setGlobalTags(event.target.value)}
                    placeholder="tags"
                    className="mb-3 h-9 w-full rounded-lg border border-white/10 bg-black px-3 text-xs text-white/75 outline-none focus:border-primary"
                  />
                  <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-white/10 text-xs text-white/70 hover:bg-primary hover:text-black">
                    <Upload className="h-3.5 w-3.5" /> Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = '';
                        if (file) uploadLibraryFile(file, globalUploadType, undefined, { tags: globalTags, library_kind: globalUploadType });
                      }}
                    />
                  </label>
                  <textarea
                    value={scenePrompt}
                    onChange={event => setScenePrompt(event.target.value)}
                    placeholder="generation prompt"
                    rows={3}
                    className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-black p-3 text-xs text-white/75 outline-none placeholder:text-white/30 focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => generateSceneAsset(globalUploadType, scenePrompt)}
                    disabled={isBusy || !scenePrompt.trim()}
                    className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Generate
                  </button>
                </div>
              </section>
            </div>
          </aside>

          <section className="min-w-0 p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Library className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-sm font-medium">Assets</h2>
                  <p className="text-[10px] text-white/35">{libraryItems.length} visible</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-xs font-medium text-black hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> New Character Card
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {libraryItems.map(renderLibraryItem)}
            </div>
            {!libraryItems.length && <EmptyRow label="No matching assets" />}
          </section>

          <aside className="border-t border-white/10 p-5 lg:border-l lg:border-t-0">
            <div className="space-y-6">
              <section className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm text-white/80">
                  <FileText className="h-4 w-4 text-primary" /> Library Counts
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Metric label="Characters" value={characterCards.length} />
                  <Metric label="Backgrounds" value={assets.filter(asset => normalizeKind(asset) === 'background').length} />
                  <Metric label="CG" value={assets.filter(asset => normalizeKind(asset) === 'cg').length} />
                  <Metric label="Voices" value={assets.filter(asset => normalizeKind(asset) === 'character_voice').length} />
                </div>
              </section>
              <section className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm text-white/80">
                  <Tags className="h-4 w-4 text-primary" /> Active Tags
                </div>
                <div className="flex flex-wrap gap-2">
                  {allTags.slice(0, 18).map(tag => <span key={tag} className="rounded-full bg-black px-2 py-1 text-[10px] text-white/45">{tag}</span>)}
                  {!allTags.length && <span className="text-xs text-white/35">No tags yet</span>}
                </div>
              </section>
            </div>
          </aside>
        </main>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#090909] p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-medium">New Character Card</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-full p-2 text-white/45 hover:text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={form.name} onChange={name => setForm(value => ({ ...value, name, character_id: value.character_id || `char_${safeId(name)}` }))} />
              <Field label="Character ID" value={form.character_id} onChange={character_id => setForm(value => ({ ...value, character_id }))} />
              <div className="sm:col-span-2">
                <Area label="Description" value={form.description} onChange={description => setForm(value => ({ ...value, description }))} rows={4} />
              </div>
              <Field label="Tags" value={form.tags} onChange={tags => setForm(value => ({ ...value, tags }))} />
              <Field label="Outfit" value={form.outfit_prompt} onChange={outfit_prompt => setForm(value => ({ ...value, outfit_prompt }))} />
              <div className="sm:col-span-2">
                <Area label="Style" value={form.style_prompt} onChange={style_prompt => setForm(value => ({ ...value, style_prompt }))} rows={2} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Voice Desc" value={form.voice_desc} onChange={voice_desc => setForm(value => ({ ...value, voice_desc }))} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="h-9 rounded-full border border-white/10 px-4 text-xs text-white/60 hover:text-white">Cancel</button>
              <button type="button" onClick={createCharacterCard} disabled={isBusy} className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-medium text-black disabled:opacity-50">
                <Send className="h-3.5 w-3.5" /> Create
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.03] text-xs text-white/35">
      {label}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-black p-3">
      <div className="text-lg text-white/85">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-white/35">{label}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-white/35">{label}</div>
      <input value={value} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-black px-3 text-sm text-white/80 outline-none focus:border-primary" />
    </label>
  );
}

function Area({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-white/35">{label}</div>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="w-full resize-none rounded-lg border border-white/10 bg-black p-3 text-sm text-white/80 outline-none focus:border-primary" />
    </label>
  );
}
