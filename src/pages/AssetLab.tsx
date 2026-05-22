import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Brush,
  Check,
  CircleDashed,
  Eraser,
  Eye,
  Image as ImageIcon,
  Loader2,
  MousePointer2,
  Pipette,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  Sparkles,
  Upload,
  Wand2
} from 'lucide-react';
import { Link } from 'react-router-dom';

type AssetRecord = {
  asset_id: string;
  project_id?: string;
  asset_type?: string;
  storage_backend?: string;
  cos_bucket?: string;
  cos_region?: string;
  cos_key?: string;
  cos_public_url?: string;
  signed_url_expires_in?: number;
  name?: string;
  url?: string;
  absolute_url?: string;
  width?: number;
  height?: number;
  source_asset_id?: string;
  metadata?: Record<string, unknown>;
};

type CutoutTool = 'brush' | 'erase' | 'lasso' | 'magic';
type PreviewMode = 'checker' | 'black' | 'white' | 'color';

type RefineSettings = {
  contract_px: number;
  expand_px: number;
  feather_px: number;
  smooth_px: number;
  alpha_threshold: number;
  remove_white_fringe: boolean;
  matte_color: string;
  despill_strength: number;
};

const DEFAULT_REFINE: RefineSettings = {
  contract_px: 1,
  expand_px: 0,
  feather_px: 1,
  smooth_px: 1,
  alpha_threshold: 12,
  remove_white_fringe: true,
  matte_color: '#ffffff',
  despill_strength: 0.6
};

const PROJECT_ID = 'asset_lab_default';

function apiData(json: any) {
  return json?.data ?? json;
}

function displayUrl(asset?: AssetRecord) {
  return asset?.absolute_url || asset?.url || '';
}

function sourceUrlForA(asset?: AssetRecord) {
  const url = asset?.absolute_url || asset?.url || '';
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${window.location.origin}${url}`;
}

function isLocalUrl(url: string) {
  if (!url) return true;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === window.location.hostname.toLowerCase();
  } catch {
    return true;
  }
}

function compactId(value?: string) {
  if (!value) return 'untitled';
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function loadWorkspaceAssets(): AssetRecord[] {
  try {
    const saved = localStorage.getItem('vn_project');
    if (!saved) return [];
    const project = JSON.parse(saved);
    const assets = Array.isArray(project?.assets) ? project.assets : [];
    return assets
      .filter((asset: any) => asset?.url && (asset.type === 'char' || asset.type === 'bg'))
      .map((asset: any) => ({
        asset_id: asset.id,
        project_id: project.id || PROJECT_ID,
        asset_type: asset.type === 'char' ? 'workspace_character' : 'workspace_background',
        name: asset.name || asset.id,
        url: asset.url,
        absolute_url: asset.url?.startsWith('http') ? asset.url : `${window.location.origin}${asset.url}`,
        width: asset.width,
        height: asset.height
      }));
  } catch {
    return [];
  }
}

function extractTaskId(payload: any) {
  const data = apiData(payload);
  return data?.task_id || data?.taskId || data?.id || data?.data?.task_id || data?.data?.taskId;
}

function extractResultAsset(payload: any): AssetRecord | null {
  const data = apiData(payload);
  const nested = data?.data || data?.result || data?.asset || data;
  const accessUrl = nested?.absolute_url || nested?.url || nested?.asset_url || nested?.image_url || nested?.audio_url;
  if (!accessUrl) return null;
  const canonicalUrl = nested?.url || accessUrl;
  return {
    asset_id: nested.asset_id || nested.task_id || `remote_${Date.now()}`,
    project_id: nested.project_id || PROJECT_ID,
    asset_type: nested.asset_type || 'generated_image',
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
    metadata: nested.metadata
  };
}

function buildCheckerPattern(ctx: CanvasRenderingContext2D) {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = 32;
  patternCanvas.height = 32;
  const pctx = patternCanvas.getContext('2d');
  if (!pctx) return '#202124';
  pctx.fillStyle = '#f2f2ed';
  pctx.fillRect(0, 0, 32, 32);
  pctx.fillStyle = '#cfcfc7';
  pctx.fillRect(0, 0, 16, 16);
  pctx.fillRect(16, 16, 16, 16);
  return ctx.createPattern(patternCanvas, 'repeat') || '#202124';
}

async function decodeImage(src: string) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  return image;
}

async function uploadBlob(blob: Blob, filename: string, assetType: string, sourceAssetId?: string) {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('project_id', PROJECT_ID);
  form.append('asset_type', assetType);
  if (sourceAssetId) form.append('source_asset_id', sourceAssetId);

  const response = await fetch('/api/v1/user-assets', {
    method: 'POST',
    body: form
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(json.message || 'asset upload failed');
  }
  return apiData(json) as AssetRecord;
}

async function registerRemoteAsset(asset: AssetRecord, sourceAssetId?: string) {
  const response = await fetch('/api/v1/user-assets/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      asset_id: asset.asset_id,
      asset_type: asset.asset_type || 'generated_image',
      url: asset.url,
      absolute_url: asset.absolute_url,
      storage_backend: asset.storage_backend,
      cos_bucket: asset.cos_bucket,
      cos_region: asset.cos_region,
      cos_key: asset.cos_key,
      cos_public_url: asset.cos_public_url,
      signed_url_expires_in: asset.signed_url_expires_in,
      width: asset.width,
      height: asset.height,
      source_asset_id: sourceAssetId,
      metadata: asset.metadata
    })
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) return asset;
  return apiData(json) as AssetRecord;
}

function readCanvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('canvas export failed'));
      else resolve(blob);
    }, 'image/png');
  });
}

export function AssetLab() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [tool, setTool] = useState<CutoutTool>('erase');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('checker');
  const [brushSize, setBrushSize] = useState(34);
  const [magicTolerance, setMagicTolerance] = useState(18);
  const [magicEdgeGuard, setMagicEdgeGuard] = useState(42);
  const [refine, setRefine] = useState<RefineSettings>(DEFAULT_REFINE);
  const [status, setStatus] = useState('Ready');
  const [isBusy, setIsBusy] = useState(false);
  const [maskVersion, setMaskVersion] = useState(0);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const [latestAlpha, setLatestAlpha] = useState<AssetRecord | null>(null);
  const [latestOutput, setLatestOutput] = useState<AssetRecord | null>(null);
  const [variantPrompt, setVariantPrompt] = useState({
    character_id: 'char_mira',
    expression_prompt: 'gentle smile',
    pose_prompt: 'standing centered',
    outfit_prompt: ''
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);

  const selectedAsset = useMemo(
    () => assets.find(asset => asset.asset_id === selectedAssetId),
    [assets, selectedAssetId]
  );

  const refreshAssets = useCallback(async () => {
    const workspaceAssets = loadWorkspaceAssets();
    try {
      const response = await fetch(`/api/v1/user-assets?project_id=${encodeURIComponent(PROJECT_ID)}`);
      const json = await response.json();
      const remoteAssets = response.ok && json.code === 0 ? apiData(json).records || [] : [];
      const combined = [...remoteAssets, ...workspaceAssets];
      setAssets(combined);
      setSelectedAssetId(current => current || combined[0]?.asset_id || '');
    } catch {
      setAssets(workspaceAssets);
      setSelectedAssetId(current => current || workspaceAssets[0]?.asset_id || '');
    }
  }, []);

  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  const pushUndo = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !ctx) return;
    setUndoStack(stack => [...stack.slice(-19), ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)]);
    setRedoStack([]);
  }, []);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext('2d');
    const image = imageRef.current;
    if (!canvas || !ctx || !maskCanvas || !maskCtx || !image) return;

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    if (previewMode === 'checker') {
      ctx.fillStyle = buildCheckerPattern(ctx);
    } else if (previewMode === 'black') {
      ctx.fillStyle = '#000000';
    } else if (previewMode === 'white') {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#7d4ef2';
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    tempCtx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i + 3] = maskData.data[i];
    }
    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(temp, 0, 0);

    if (lassoPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#DEDBC8';
      ctx.lineWidth = Math.max(2, canvas.width / 360);
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      lassoPoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    }
  }, [lassoPoints, previewMode]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, maskVersion]);

  useEffect(() => {
    let cancelled = false;
    const loadSelected = async () => {
      if (!selectedAsset) return;
      setStatus('Loading source image...');
      try {
        const image = await decodeImage(displayUrl(selectedAsset));
        if (cancelled) return;
        imageRef.current = image;
        setImageSize({ width: image.naturalWidth, height: image.naturalHeight });

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = image.naturalWidth;
        maskCanvas.height = image.naturalHeight;
        const maskCtx = maskCanvas.getContext('2d');
        if (maskCtx) {
          maskCtx.fillStyle = '#ffffff';
          maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        }
        maskCanvasRef.current = maskCanvas;
        setUndoStack([]);
        setRedoStack([]);
        setLatestAlpha(null);
        setLatestOutput(null);
        setMaskVersion(version => version + 1);
        setStatus('Source ready');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Image load failed');
      }
    };
    loadSelected();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const paintMask = (x: number, y: number, value: 0 | 255) => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !ctx) return;
    ctx.save();
    ctx.fillStyle = value === 255 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    setMaskVersion(version => version + 1);
  };

  const applyMagic = (x: number, y: number) => {
    const image = imageRef.current;
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext('2d');
    if (!image || !maskCanvas || !maskCtx) return;

    const temp = document.createElement('canvas');
    temp.width = image.naturalWidth;
    temp.height = image.naturalHeight;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    tempCtx.drawImage(image, 0, 0);
    const source = tempCtx.getImageData(0, 0, temp.width, temp.height);
    const mask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const sx = Math.max(0, Math.min(temp.width - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(temp.height - 1, Math.round(y)));
    const sampleIndex = (sy * temp.width + sx) * 4;
    const sr = source.data[sampleIndex];
    const sg = source.data[sampleIndex + 1];
    const sb = source.data[sampleIndex + 2];
    const limit = magicTolerance * magicTolerance * 3;
    const edgeLimit = magicEdgeGuard * magicEdgeGuard * 3;
    const width = temp.width;
    const height = temp.height;
    const total = width * height;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    const colorDistanceToSample = (index: number) => {
      const offset = index * 4;
      const dr = source.data[offset] - sr;
      const dg = source.data[offset + 1] - sg;
      const db = source.data[offset + 2] - sb;
      return dr * dr + dg * dg + db * db;
    };

    const neighborDistance = (a: number, b: number) => {
      const ai = a * 4;
      const bi = b * 4;
      const dr = source.data[ai] - source.data[bi];
      const dg = source.data[ai + 1] - source.data[bi + 1];
      const db = source.data[ai + 2] - source.data[bi + 2];
      return dr * dr + dg * dg + db * db;
    };

    const isBoundaryPixel = (index: number) => {
      if (magicEdgeGuard <= 0) return false;
      const px = index % width;
      const py = Math.floor(index / width);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = px + ox;
          const ny = py + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (neighborDistance(index, ny * width + nx) > edgeLimit) return true;
        }
      }
      return false;
    };

    const enqueue = (index: number) => {
      if (index < 0 || index >= total || visited[index]) return;
      visited[index] = 1;
      if (colorDistanceToSample(index) > limit) return;
      const offset = index * 4;
      mask.data[offset] = 0;
      mask.data[offset + 1] = 0;
      mask.data[offset + 2] = 0;
      mask.data[offset + 3] = 255;
      if (index !== sampleIndex / 4 && isBoundaryPixel(index)) return;
      queue[tail] = index;
      tail += 1;
    };

    enqueue(sy * width + sx);
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const px = index % width;
      const py = Math.floor(index / width);
      if (px > 0) enqueue(index - 1);
      if (px < width - 1) enqueue(index + 1);
      if (py > 0) enqueue(index - width);
      if (py < height - 1) enqueue(index + width);
    }
    maskCtx.putImageData(mask, 0, 0);
    setMaskVersion(version => version + 1);
  };

  const fillLasso = (points: { x: number; y: number }[]) => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !ctx || points.length < 3) return;
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    setMaskVersion(version => version + 1);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageRef.current) return;
    const point = canvasPoint(event);
    if (tool === 'magic') {
      pushUndo();
      applyMagic(point.x, point.y);
      return;
    }

    pushUndo();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'lasso') {
      setLassoPoints([point]);
      return;
    }
    paintMask(point.x, point.y, tool === 'brush' ? 255 : 0);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = canvasPoint(event);
    if (tool === 'lasso') {
      setLassoPoints(points => [...points, point]);
      return;
    }
    paintMask(point.x, point.y, tool === 'brush' ? 255 : 0);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (tool === 'lasso') {
      setLassoPoints(points => {
        fillLasso(points);
        return [];
      });
    }
  };

  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!previous || !maskCanvas || !ctx) return;
    const current = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    ctx.putImageData(previous, 0, 0);
    setUndoStack(stack => stack.slice(0, -1));
    setRedoStack(stack => [...stack, current]);
    setMaskVersion(version => version + 1);
  };

  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!next || !maskCanvas || !ctx) return;
    const current = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    ctx.putImageData(next, 0, 0);
    setRedoStack(stack => stack.slice(0, -1));
    setUndoStack(stack => [...stack, current]);
    setMaskVersion(version => version + 1);
  };

  const createAlphaCanvas = () => {
    const image = imageRef.current;
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext('2d');
    if (!image || !maskCanvas || !maskCtx) {
      throw new Error('source image is not ready');
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas is not available');
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const rawAlpha = maskData.data[i];
      imageData.data[i + 3] = rawAlpha < refine.alpha_threshold ? 0 : rawAlpha;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  const saveAlpha = async () => {
    if (!selectedAsset) throw new Error('select a source image first');
    const canvas = createAlphaCanvas();
    const blob = await readCanvasBlob(canvas);
    const asset = await uploadBlob(blob, 'manual-alpha.png', 'manual_alpha', selectedAsset.asset_id);
    setLatestAlpha(asset);
    await refreshAssets();
    return asset;
  };

  const ensureAssetReachableForA = async (asset: AssetRecord) => {
    const currentUrl = sourceUrlForA(asset);
    if (asset.storage_backend === 'cos' || asset.cos_key || !isLocalUrl(currentUrl)) {
      return asset;
    }

    setStatus('Uploading source image for remote access...');
    const response = await fetch(displayUrl(asset));
    if (!response.ok) {
      throw new Error('source image upload preparation failed');
    }
    const blob = await response.blob();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const uploaded = await uploadBlob(blob, `${asset.asset_id || 'source'}.${extension}`, 'source_image', asset.asset_id);
    await refreshAssets();
    return uploaded;
  };

  const ensureAlphaReachableForA = async () => {
    if (latestAlpha && !isLocalUrl(sourceUrlForA(latestAlpha))) {
      return latestAlpha;
    }
    return saveAlpha();
  };

  const pollRemoteTask = async (taskId: string, sourceAssetId?: string) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(`/api/v1/asset-api/tasks/${encodeURIComponent(taskId)}`);
      const json = await response.json();
      if (!response.ok || json.code !== 0) {
        throw new Error(json.message || 'task polling failed');
      }
      const payload = apiData(json);
      const statusValue = payload.status || payload.data?.status;
      if (statusValue === 'failed') {
        throw new Error(payload.message || payload.error || 'remote task failed');
      }
      if (statusValue === 'succeeded') {
        const resultAsset = extractResultAsset(payload);
        if (resultAsset) {
          const registered = await registerRemoteAsset(resultAsset, sourceAssetId);
          setLatestOutput(registered);
          await refreshAssets();
        }
        return payload;
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000));
    }
    throw new Error('remote task timed out');
  };

  const submitCutout = async () => {
    if (!selectedAsset) return;
    setIsBusy(true);
    setStatus('Saving alpha and submitting cutout...');
    try {
      const sourceForA = await ensureAssetReachableForA(selectedAsset);
      const alpha = await ensureAlphaReachableForA();
      const payload = {
        project_id: PROJECT_ID,
        source_asset_id: sourceForA.asset_id,
        source_image_url: sourceUrlForA(sourceForA),
        cutout_mode: 'manual_refine',
        manual_alpha_url: sourceUrlForA(alpha),
        alpha_url: sourceUrlForA(alpha),
        refine
      };
      const response = await fetch('/api/v1/asset-api/cutout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await response.json();
      if (!response.ok || json.code !== 0) {
        throw new Error(json.message || 'cutout submit failed');
      }
      const taskId = extractTaskId(json);
      if (taskId) {
        setStatus(`Cutout task ${taskId} submitted`);
        await pollRemoteTask(taskId, sourceForA.asset_id);
        setStatus('Cutout finished');
      } else {
        const resultAsset = extractResultAsset(json);
        if (resultAsset) {
          const registered = await registerRemoteAsset(resultAsset, sourceForA.asset_id);
          setLatestOutput(registered);
          await refreshAssets();
        }
        setStatus('Cutout response received');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Cutout failed');
    } finally {
      setIsBusy(false);
    }
  };

  const submitVariant = async () => {
    if (!selectedAsset) return;
    setIsBusy(true);
    setStatus('Submitting edit variant...');
    try {
      const sourceForA = await ensureAssetReachableForA(selectedAsset);
      const payload = {
        project_id: PROJECT_ID,
        character_id: variantPrompt.character_id,
        source_asset_id: sourceForA.asset_id,
        reference_image_url: sourceUrlForA(sourceForA),
        expression_prompt: variantPrompt.expression_prompt,
        pose_prompt: variantPrompt.pose_prompt,
        outfit_prompt: variantPrompt.outfit_prompt,
        cutout_mode: 'preserve_alpha',
        variant_tags: [variantPrompt.expression_prompt || 'edit']
      };
      const response = await fetch('/api/v1/asset-api/character/variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await response.json();
      if (!response.ok || json.code !== 0) {
        throw new Error(json.message || 'variant submit failed');
      }
      const taskId = extractTaskId(json);
      if (taskId) {
        setStatus(`Variant task ${taskId} submitted`);
        await pollRemoteTask(taskId, sourceForA.asset_id);
        setStatus('Variant finished');
      } else {
        const resultAsset = extractResultAsset(json);
        if (resultAsset) {
          const registered = await registerRemoteAsset(resultAsset, sourceForA.asset_id);
          setLatestOutput(registered);
          await refreshAssets();
        }
        setStatus('Variant response received');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Variant failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsBusy(true);
    setStatus('Uploading source image...');
    try {
      const asset = await uploadBlob(file, file.name || 'source.png', 'source_image');
      await refreshAssets();
      setSelectedAssetId(asset.asset_id);
      setStatus('Upload complete');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  };

  const toolButton = (id: CutoutTool, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => setTool(id)}
      title={label}
      className={`h-10 rounded-lg border flex items-center justify-center transition-colors ${
        tool === id ? 'border-primary bg-primary text-black' : 'border-white/10 bg-white/5 text-white/60 hover:text-primary hover:border-primary/40'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const sourceAssets = assets.filter(asset => {
    const type = String(asset.asset_type || '');
    return !type.includes('manual_alpha') && !type.includes('audio');
  });

  return (
    <div className="min-h-screen bg-black text-[#E1E0CC] font-sans">
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-black sticky top-0 z-20">
        <div className="flex items-center gap-5 min-w-0">
          <Link to="/" className="text-xl font-bold tracking-tighter hover:opacity-80 transition-opacity">
            Ariadne<span className="text-primary">*</span>
          </Link>
          <div className="h-4 w-px bg-white/20" />
          <Link to="/workstation" className="text-white/50 hover:text-primary" title="Back to workstation">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Link to="/asset-library" className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55 hover:border-primary hover:text-primary">
            Library
          </Link>
          <div className="min-w-0">
            <h1 className="text-sm font-medium truncate">Asset Lab</h1>
            <p className="text-[10px] text-white/35 truncate">Manual cutout and edit variants</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/45">
          {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
          <span className="max-w-[360px] truncate">{status}</span>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-64px)] grid-cols-1 overflow-auto lg:h-[calc(100vh-64px)] lg:grid-cols-[280px_minmax(0,1fr)_340px] lg:overflow-hidden">
        <aside className="border-b border-white/10 bg-black/60 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40">Source Library</h2>
              <button
                type="button"
                onClick={refreshAssets}
                className="text-white/40 hover:text-primary"
                title="Refresh assets"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/5 text-white/55 transition-colors hover:border-primary/50 hover:text-primary">
              <Upload className="w-5 h-5" />
              <span className="text-xs">Upload Source</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>

            <div className="grid gap-2">
              {sourceAssets.map(asset => (
                <button
                  key={asset.asset_id}
                  type="button"
                  onClick={() => setSelectedAssetId(asset.asset_id)}
                  className={`grid grid-cols-[58px_minmax(0,1fr)] gap-3 rounded-xl border p-2 text-left transition-colors ${
                    selectedAssetId === asset.asset_id ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5 hover:border-white/25'
                  }`}
                >
                  {displayUrl(asset) ? (
                    <img src={displayUrl(asset)} alt="" className="h-14 w-14 rounded-lg bg-black object-contain" />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-white/5 flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-white/35" />
                    </div>
                  )}
                  <div className="min-w-0 self-center">
                    <div className="truncate text-xs text-white/80">{asset.name || compactId(asset.asset_id)}</div>
                    <div className="mt-1 truncate text-[10px] text-white/35">{asset.asset_type || 'image'}</div>
                    {asset.width && asset.height && (
                      <div className="mt-1 text-[10px] text-white/30">{asset.width} x {asset.height}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="relative flex min-w-0 flex-col overflow-hidden bg-[#0a0a0a]">
          <div className="flex min-h-14 shrink-0 flex-col gap-3 border-b border-white/10 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {toolButton('brush', 'Restore foreground', Brush)}
              {toolButton('erase', 'Erase background', Eraser)}
              {toolButton('lasso', 'Lasso remove', MousePointer2)}
              {toolButton('magic', 'Magic color remove', Pipette)}
              <div className="mx-2 h-5 w-px bg-white/10" />
              <button
                type="button"
                onClick={undo}
                disabled={!undoStack.length}
                title="Undo"
                className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-white/50 hover:text-primary disabled:opacity-30"
              >
                <RotateCcw className="mx-auto w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!redoStack.length}
                title="Redo"
                className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-white/50 hover:text-primary disabled:opacity-30"
              >
                <RotateCw className="mx-auto w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['checker', 'black', 'white', 'color'] as PreviewMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={`h-8 rounded-full px-3 text-[10px] capitalize transition-colors ${
                    previewMode === mode ? 'bg-primary text-black' : 'border border-white/10 text-white/50 hover:text-primary'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-1 overflow-auto p-4 sm:p-6">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1b1b1b_0%,#080808_72%)]" />
            <div className="relative z-10 flex h-full min-h-[420px] items-center justify-center lg:min-h-[520px]">
              {selectedAsset ? (
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="max-h-full max-w-full rounded-xl border border-white/10 bg-black shadow-2xl touch-none"
                  style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
                />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-8 py-10 text-center">
                  <CircleDashed className="mx-auto mb-4 w-8 h-8 text-white/35" />
                  <div className="text-sm text-white/70">Upload or choose an image to start.</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="border-t border-white/10 bg-black/60 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Tool Settings</h2>
              <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
                <label className="block">
                  <div className="mb-2 flex justify-between text-xs text-white/55">
                    <span>Brush Size</span>
                    <span>{brushSize}px</span>
                  </div>
                  <input className="w-full accent-primary" type="range" min="4" max="120" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} />
                </label>
                <label className="block">
                  <div className="mb-2 flex justify-between text-xs text-white/55">
                    <span>Magic Tolerance</span>
                    <span>{magicTolerance}</span>
                  </div>
                  <input className="w-full accent-primary" type="range" min="0" max="96" value={magicTolerance} onChange={e => setMagicTolerance(Number(e.target.value))} />
                </label>
                <label className="block">
                  <div className="mb-2 flex justify-between text-xs text-white/55">
                    <span>Edge Guard</span>
                    <span>{magicEdgeGuard}</span>
                  </div>
                  <input className="w-full accent-primary" type="range" min="0" max="120" value={magicEdgeGuard} onChange={e => setMagicEdgeGuard(Number(e.target.value))} />
                </label>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Refine Mapping</h2>
              <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
                {[
                  ['contract_px', 'Contract Edge', 0, 6, 0.5],
                  ['expand_px', 'Expand Edge', 0, 6, 0.5],
                  ['feather_px', 'Feather', 0, 8, 0.5],
                  ['smooth_px', 'Smooth', 0, 8, 0.5],
                  ['alpha_threshold', 'Alpha Threshold', 0, 80, 1],
                  ['despill_strength', 'Despill', 0, 1, 0.05]
                ].map(([key, label, min, max, step]) => (
                  <label key={String(key)} className="block">
                    <div className="mb-2 flex justify-between text-xs text-white/55">
                      <span>{label}</span>
                      <span>{Number(refine[key as keyof RefineSettings]).toFixed(Number(step) < 1 ? 2 : 0)}</span>
                    </div>
                    <input
                      className="w-full accent-primary"
                      type="range"
                      min={Number(min)}
                      max={Number(max)}
                      step={Number(step)}
                      value={Number(refine[key as keyof RefineSettings])}
                      onChange={e => setRefine(value => ({ ...value, [String(key)]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60">
                  <span>Remove White Fringe</span>
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={refine.remove_white_fringe}
                    onChange={e => setRefine(value => ({ ...value, remove_white_fringe: e.target.checked }))}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60">
                  <span>Matte Color</span>
                  <input
                    type="color"
                    value={refine.matte_color}
                    onChange={e => setRefine(value => ({ ...value, matte_color: e.target.value }))}
                    className="h-7 w-10 rounded border-0 bg-transparent"
                  />
                </label>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Cutout Submit</h2>
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <button
                  type="button"
                  onClick={async () => {
                    setIsBusy(true);
                    setStatus('Saving manual alpha...');
                    try {
                      await saveAlpha();
                      setStatus('Manual alpha saved');
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : 'Alpha save failed');
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  disabled={!selectedAsset || isBusy}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs text-white/70 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Alpha To B
                </button>
                <button
                  type="button"
                  onClick={submitCutout}
                  disabled={!selectedAsset || isBusy}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-medium text-black transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  Submit Cutout To A
                </button>
                {latestAlpha && (
                  <div className="truncate text-[10px] text-white/40">alpha: {compactId(latestAlpha.asset_id)}</div>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Edit Variant</h2>
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                {[
                  ['character_id', 'Character ID'],
                  ['expression_prompt', 'Expression'],
                  ['pose_prompt', 'Pose'],
                  ['outfit_prompt', 'Outfit']
                ].map(([key, label]) => (
                  <label key={key} className="block">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-white/35">{label}</div>
                    <input
                      value={variantPrompt[key as keyof typeof variantPrompt]}
                      onChange={e => setVariantPrompt(value => ({ ...value, [key]: e.target.value }))}
                      className="h-9 w-full rounded-lg border border-white/10 bg-black px-3 text-xs text-white/80 outline-none focus:border-primary"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={submitVariant}
                  disabled={!selectedAsset || isBusy}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-full bg-white/10 text-xs text-white/75 transition-colors hover:bg-primary hover:text-black disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Submit Variant To A
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[10px] uppercase tracking-widest text-white/40">Latest Output</h2>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                {latestOutput?.url ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                    <img src={displayUrl(latestOutput)} alt="" className="max-h-56 w-full rounded-lg bg-black object-contain" />
                    <div className="flex items-center gap-2 text-[10px] text-white/45">
                      <Eye className="w-3.5 h-3.5" />
                      <span className="truncate">{latestOutput.asset_id}</span>
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center gap-2 text-white/35">
                    <Wand2 className="w-6 h-6" />
                    <span className="text-xs">Remote result appears here.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>
      </main>
    </div>
  );
}
