import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, Download, ChevronLeft, ChevronRight, Settings, 
  Wand2, Image as ImageIcon, MessageSquare, Plus, AlignLeft,
  MoreVertical, RefreshCw, Volume2, Trash2, PanelLeft, PanelRight,
  Search, X, Type, Layers, Link2, UserRound, Monitor, AlertTriangle,
  CheckCircle2, Mic, Save, FolderOpen, Languages, Upload
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getInitialLocale, LOCALE_STORAGE_KEY, translate, type Locale, type TranslationKey } from '../i18n';
import {
  deleteBackendSaveSlot,
  listBackendProjects,
  listBackendSaveSlots,
  loadBackendProject,
  migrateBackendProject,
  saveBackendProject,
  saveBackendSaveSlot
} from '../api/vnPersistence';
import {
  VNProjectState,
  VNNode,
  VNAction,
  VNAsset,
  VNChoice,
  VNSceneLink,
  VNSceneType,
  VNVariableDefinition,
  VNVariableScope,
  VNVariableType,
  VNCondition,
  VNConditionOperator,
  VNEffect,
  VNEffectType,
  VNTimelineMode,
  VNRuntimeHistoryEntry,
  VNRuntimeState,
  VNSelectedChoiceHistoryEntry,
  VNSaveSlot
} from '../types/vn';

const GUIDES = [
  { id: 'ariadne', name: 'Ariadne', image: '/Ariadne.png', cardImage: '/Ariadne.png', role: 'System AI Core', bgSize: 'cover', bgPosition: 'top', avatarHeight: 'h-[80%]', avatarOffset: 'pb-24' },
  { id: 'miku', name: 'Miku', image: '/miku3.png', cardImage: '/miku3.png', role: 'Virtual Idol', bgSize: 'cover', bgPosition: 'top', avatarHeight: 'h-[80%]', avatarOffset: 'pb-24' },
  { id: 'anon', name: 'Anon', image: '/anon2.png', cardImage: '/anon-guide.png', role: 'Band Member', bgSize: '180%', bgPosition: 'center 50%', avatarHeight: 'h-[75%]', avatarOffset: 'pb-40' }
];

type InspectorTab = 'content' | 'resources' | 'layout' | 'variables' | 'branch' | 'debug';
type PickerKind = 'bg' | 'char' | 'audio';

type UserAssetRecord = {
  asset_id: string;
  asset_type?: string;
  source_task_id?: string;
  provider_asset_id?: string;
  name?: string;
  url?: string;
  absolute_url?: string;
  storage_backend?: string;
  cos_bucket?: string;
  cos_region?: string;
  cos_key?: string;
  cos_public_url?: string;
  width?: number;
  height?: number;
  character_id?: string;
  metadata?: Record<string, unknown>;
};

type PickerState = {
  open: boolean;
  kind: PickerKind;
  query: string;
};

const VN_SCHEMA_VERSION = 2;

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function createChoiceId() {
  return `choice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createSceneId() {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function createVariableKey() {
  return `var_${Date.now().toString(36)}`;
}

function createConditionId() {
  return `condition_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function createEffectId() {
  return `effect_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_ACTION_DURATION = 3;
const MIN_ACTION_DURATION = 0.25;
const MAX_ESTIMATED_ACTION_DURATION = 8;
const TIMELINE_PX_PER_SECOND = 72;
const TIMELINE_HEADER_WIDTH = 128;
const PROJECT_HISTORY_LIMIT = 100;
const SCENE_GRAPH_CARD_WIDTH = 164;
const SCENE_GRAPH_CARD_HEIGHT = 92;
const SCENE_GRAPH_COLUMN_GAP = 92;
const SCENE_GRAPH_ROW_GAP = 34;
const SCENE_MAP_MIN_ZOOM = 0.55;
const SCENE_MAP_MAX_ZOOM = 1.6;
const SCENE_MAP_ZOOM_STEP = 0.08;

type TimedAction = {
  action: VNAction;
  index: number;
  startTime: number;
  duration: number;
  endTime: number;
};

type TimelineDragMode = 'move' | 'trimStart' | 'trimEnd';

type TimelineClip = TimedAction & {
  label: string;
  className: string;
  isEmpty?: boolean;
};

type SceneGraphNodeLayout = {
  id: string;
  x: number;
  y: number;
  depth: number;
};

type SceneGraphPositionMap = Record<string, { x: number; y: number }>;

type SceneGraphLayout = {
  nodes: SceneGraphNodeLayout[];
  nodeById: Map<string, SceneGraphNodeLayout>;
  width: number;
  height: number;
};

type SceneGraphLinkKind = 'default' | 'choice' | 'jump';

type SceneMapDraftLink = {
  fromSceneId: string;
  x: number;
  y: number;
};

type ChoiceBranchRow = {
  nodeId: string;
  actionId: string;
  actionIndex: number;
  choice: VNChoice;
  choiceIndex: number;
};

function roundSeconds(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSeconds(value: number) {
  return `${roundSeconds(value).toFixed(2)}s`;
}

function normalizeOptionalSeconds(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundSeconds(number) : undefined;
}

function normalizeDurationSeconds(value: unknown, fallback: number) {
  const number = normalizeOptionalSeconds(value);
  return Math.max(MIN_ACTION_DURATION, number ?? fallback);
}

function estimateActionDuration(action?: Partial<VNAction>) {
  const text = pickText(action?.text) || (action?.choices || []).map(choice => choice.label).join(' / ');
  if (!text) return DEFAULT_ACTION_DURATION;
  return Math.min(MAX_ESTIMATED_ACTION_DURATION, Math.max(1.5, roundSeconds(text.length / 18 + 1.2)));
}

function metadataNumber(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function audioDurationFromAsset(asset?: VNAsset) {
  const seconds = metadataNumber(asset?.metadata, ['durationSeconds', 'duration_seconds', 'duration']);
  if (seconds) return roundSeconds(seconds);
  const milliseconds = metadataNumber(asset?.metadata, ['durationMs', 'duration_ms']);
  return milliseconds ? roundSeconds(milliseconds / 1000) : undefined;
}

function ensureActionTimings(actions: VNAction[]) {
  let cursor = 0;
  return actions.map(action => {
    const duration = normalizeDurationSeconds(action.duration, estimateActionDuration(action));
    const startTime = normalizeOptionalSeconds(action.startTime) ?? cursor;
    cursor = Math.max(cursor, startTime + duration);
    return {
      ...action,
      startTime,
      duration
    };
  });
}

function buildTimedActions(actions: VNAction[], assetById?: (id?: string) => VNAsset | undefined): TimedAction[] {
  let cursor = 0;
  return actions.map((action, index) => {
    const voiceDuration = audioDurationFromAsset(assetById?.(action.audioAssetId));
    const duration = normalizeDurationSeconds(action.duration ?? voiceDuration, estimateActionDuration(action));
    const startTime = normalizeOptionalSeconds(action.startTime) ?? cursor;
    const timedAction = {
      action,
      index,
      startTime,
      duration,
      endTime: roundSeconds(startTime + duration)
    };
    cursor = Math.max(cursor, timedAction.endTime);
    return timedAction;
  });
}

function findTimedActionAt(timedActions: TimedAction[], time: number) {
  if (!timedActions.length) return undefined;
  return timedActions.find(item => time >= item.startTime && time < item.endTime)
    || timedActions[timedActions.length - 1];
}

function readAudioDuration(src: string) {
  return new Promise<number | undefined>(resolve => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? roundSeconds(audio.duration) : undefined);
    };
    audio.onerror = () => resolve(undefined);
  });
}

function normalizeSceneType(value: unknown): VNSceneType {
  const type = pickText(value) as VNSceneType;
  return ['normal', 'branch', 'ending', 'menu', 'system'].includes(type) ? type : 'normal';
}

function normalizeVariableType(value: unknown): VNVariableType {
  const type = pickText(value) as VNVariableType;
  return ['boolean', 'number', 'string'].includes(type) ? type : 'boolean';
}

function normalizeVariableScope(value: unknown): VNVariableScope {
  const scope = pickText(value) as VNVariableScope;
  return ['global', 'character', 'scene'].includes(scope) ? scope : 'global';
}

function normalizeConditionOperator(value: unknown): VNConditionOperator {
  const operator = pickText(value) as VNConditionOperator;
  return ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'exists', 'not_exists'].includes(operator)
    ? operator
    : 'equals';
}

function normalizeEffectType(value: unknown): VNEffectType {
  const type = pickText(value) as VNEffectType;
  return ['set_flag', 'unset_flag', 'set_var', 'add_var', 'add_affinity', 'mark_visited'].includes(type)
    ? type
    : 'set_flag';
}

function normalizeVariableDefinition(raw: any, index: number): VNVariableDefinition {
  const key = pickText(raw?.key, raw?.variable_key, raw?.id) || `flag_${index + 1}`;
  const type = normalizeVariableType(raw?.type);
  const fallbackDefault = type === 'boolean' ? false : type === 'number' ? 0 : '';
  return {
    key,
    label: pickText(raw?.label, raw?.name, key) || key,
    type,
    defaultValue: raw?.defaultValue ?? raw?.default_value ?? fallbackDefault,
    scope: normalizeVariableScope(raw?.scope)
  };
}

function normalizeCondition(raw: any, index: number): VNCondition {
  return {
    id: pickText(raw?.id, raw?.condition_id) || `condition_${index + 1}`,
    variableKey: pickText(raw?.variableKey, raw?.variable_key, raw?.key),
    operator: normalizeConditionOperator(raw?.operator || raw?.op),
    value: raw?.value
  };
}

function normalizeEffect(raw: any, index: number): VNEffect {
  return {
    id: pickText(raw?.id, raw?.effect_id) || `effect_${index + 1}`,
    type: normalizeEffectType(raw?.type || raw?.effect_type),
    variableKey: pickText(raw?.variableKey, raw?.variable_key, raw?.key) || undefined,
    value: raw?.value,
    amount: raw?.amount === undefined || raw?.amount === '' ? undefined : Number(raw.amount),
    characterId: pickText(raw?.characterId, raw?.character_id) || undefined,
    sceneId: pickText(raw?.sceneId, raw?.scene_id) || undefined
  };
}

function defaultValueForVariable(variable: VNVariableDefinition) {
  if (variable.defaultValue !== undefined) return variable.defaultValue;
  if (variable.type === 'number') return 0;
  if (variable.type === 'string') return '';
  return false;
}

function buildActionSceneIndex(nodes: VNNode[]) {
  const index = new Map<string, string>();
  nodes.forEach(node => {
    node.actions.forEach(action => {
      index.set(action.id, node.id);
      if (action.sourceActionId) index.set(action.sourceActionId, node.id);
    });
  });
  return index;
}

function normalizeChoice(choice: any, choiceIndex: number, actionToScene?: Map<string, string>): VNChoice {
  const targetActionId = pickText(choice?.targetActionId, choice?.target_action_id, choice?.nextId, choice?.next_id) || undefined;
  const explicitTargetSceneId = pickText(choice?.targetSceneId, choice?.target_scene_id, choice?.toSceneId, choice?.to_scene_id);
  const targetSceneId = explicitTargetSceneId || (targetActionId ? actionToScene?.get(targetActionId) || '' : '');

  return {
    ...(choice && typeof choice === 'object' ? choice : {}),
    id: pickText(choice?.id, choice?.choice_id) || `choice_${choiceIndex + 1}`,
    label: pickText(choice?.label, choice?.text, choice) || `Option ${choiceIndex + 1}`,
    nextId: pickText(choice?.nextId, choice?.next_id) || undefined,
    targetActionId,
    targetSceneId: targetSceneId || undefined,
    conditions: Array.isArray(choice?.conditions) ? choice.conditions.map((condition: any, index: number) => normalizeCondition(condition, index)) : undefined,
    effects: Array.isArray(choice?.effects) ? choice.effects.map((effect: any, index: number) => normalizeEffect(effect, index)) : undefined,
    disabledText: pickText(choice?.disabledText, choice?.disabled_text) || undefined
  };
}

function normalizeAction(action: any, sceneIndex: number, actionIndex: number, actionToScene?: Map<string, string>): VNAction {
  const rawChoices = Array.isArray(action?.choice?.options)
    ? action.choice.options
    : Array.isArray(action?.choices)
      ? action.choices
      : [];
  const spriteIds = action?.sprite_asset_task_ids || action?.sprite_asset_ids || [];
  const layout = action?.layout || {};
  return {
    ...(action && typeof action === 'object' ? action : {}),
    id: pickText(action?.id, action?.action_id) || `action_${sceneIndex + 1}_${actionIndex + 1}`,
    sourceActionId: pickText(action?.sourceActionId, action?.action_id) || undefined,
    type: pickText(action?.type, action?.action_type) || 'dialogue',
    speaker: pickText(action?.speaker, action?.speaker_name, action?.speaker_id) || 'Narrator',
    text: pickText(action?.text, action?.dialogue, action?.line),
    emotion: pickText(action?.emotion) || undefined,
    choices: rawChoices.map((choice: any, index: number) => normalizeChoice(choice, index, actionToScene)),
    targetSceneId: pickText(action?.targetSceneId, action?.target_scene_id) || undefined,
    targetActionId: pickText(action?.targetActionId, action?.target_action_id) || undefined,
    bgAssetId: pickText(action?.bgAssetId, action?.background_asset_task_id, action?.background_asset_id) || undefined,
    charAssetId: pickText(action?.charAssetId, spriteIds[0]) || undefined,
    audioAssetId: pickText(action?.audioAssetId, action?.voice_task_id, action?.audio_asset_id) || undefined,
    bgImage: pickText(action?.bgImage, action?.background_url) || undefined,
    charImage: pickText(action?.charImage, action?.sprite_url) || undefined,
    audioPath: pickText(action?.audioPath, action?.audio_url) || undefined,
    startTime: normalizeOptionalSeconds(action?.startTime ?? action?.start_time ?? action?.timeline?.startTime ?? action?.timeline?.start_time),
    duration: normalizeOptionalSeconds(action?.duration ?? action?.durationSeconds ?? action?.duration_seconds ?? action?.timeline?.duration),
    layout: {
      x: Number(layout.x ?? positionToOffset(layout.position)),
      y: Number(layout.y ?? 0),
      scale: Number(layout.scale ?? 1)
    }
  };
}

function normalizePosition(position: any, fallbackIndex: number) {
  if (position && typeof position === 'object') {
    return {
      x: Number(position.x ?? fallbackIndex * 220),
      y: Number(position.y ?? 0)
    };
  }
  return { x: fallbackIndex * 220, y: 0 };
}

function normalizeProjectState(rawProject: any): VNProjectState {
  const rawNodes = Array.isArray(rawProject?.nodes)
    ? rawProject.nodes
    : Array.isArray(rawProject?.scenes)
      ? rawProject.scenes
      : [];

  const firstPassNodes: VNNode[] = rawNodes.map((rawNode: any, sceneIndex: number) => {
    const rawActions = Array.isArray(rawNode?.actions) ? rawNode.actions : [];
    return {
      ...(rawNode && typeof rawNode === 'object' ? rawNode : {}),
      id: pickText(rawNode?.id, rawNode?.scene_id, rawNode?.stage_id) || `scene_${sceneIndex + 1}`,
      title: pickText(rawNode?.title, rawNode?.name) || `Scene ${sceneIndex + 1}`,
      summary: pickText(rawNode?.summary) || undefined,
      type: normalizeSceneType(rawNode?.type),
      status: pickText(rawNode?.status) as VNNode['status'] || 'done',
      actions: ensureActionTimings(rawActions.map((action: any, actionIndex: number) => normalizeAction(action, sceneIndex, actionIndex))),
      defaultNextSceneId: pickText(rawNode?.defaultNextSceneId, rawNode?.default_next_scene_id) || undefined,
      backgroundAssetId: pickText(rawNode?.backgroundAssetId, rawNode?.background_asset_id, rawNode?.background_asset_task_id) || undefined,
      bgmAssetId: pickText(rawNode?.bgmAssetId, rawNode?.bgm_asset_id) || undefined,
      tags: Array.isArray(rawNode?.tags) ? rawNode.tags : [],
      position: normalizePosition(rawNode?.position, sceneIndex)
    };
  });

  const actionToScene = buildActionSceneIndex(firstPassNodes);
  const nodes = firstPassNodes.map((node, sceneIndex) => ({
    ...node,
    actions: ensureActionTimings(node.actions.map((action, actionIndex) => normalizeAction(action, sceneIndex, actionIndex, actionToScene)))
  }));
  const projectId = pickText(rawProject?.projectId, rawProject?.project_id, rawProject?.id) || 'default';
  const requestedEntrySceneId = pickText(rawProject?.entrySceneId, rawProject?.entry_scene_id);
  const entrySceneId = nodes.some(node => node.id === requestedEntrySceneId)
    ? requestedEntrySceneId
    : nodes[0]?.id;

  return {
    ...rawProject,
    schemaVersion: Number(rawProject?.schemaVersion || rawProject?.schema_version || VN_SCHEMA_VERSION),
    projectId,
    id: pickText(rawProject?.id, rawProject?.project_id, rawProject?.projectId) || projectId,
    title: pickText(rawProject?.title) || 'Generated Visual Novel',
    entrySceneId,
    timelineMode: (rawProject?.timelineMode === 'timeline' || rawProject?.timeline_mode === 'timeline') ? 'timeline' : 'script',
    nodes,
    sceneLinks: deriveSceneLinks(nodes),
    assets: Array.isArray(rawProject?.assets) ? rawProject.assets : [],
    variables: Array.isArray(rawProject?.variables)
      ? rawProject.variables.map((variable: any, index: number) => normalizeVariableDefinition(variable, index))
      : [],
    generationStatus: rawProject?.generationStatus || 'idle'
  };
}

function deriveSceneLinks(nodes: VNNode[]): VNSceneLink[] {
  const links: VNSceneLink[] = [];
  const sceneIds = new Set(nodes.map(node => node.id));

  nodes.forEach(node => {
    if (node.defaultNextSceneId && sceneIds.has(node.defaultNextSceneId)) {
      links.push({
        id: `default_${node.id}_${node.defaultNextSceneId}`,
        fromSceneId: node.id,
        toSceneId: node.defaultNextSceneId,
        label: 'Default next'
      });
    }

    node.actions.forEach(action => {
      if (action.type === 'jump' && action.targetSceneId && sceneIds.has(action.targetSceneId)) {
        links.push({
          id: `jump_${node.id}_${action.id}_${action.targetSceneId}`,
          fromSceneId: node.id,
          fromActionId: action.id,
          toSceneId: action.targetSceneId,
          toActionId: action.targetActionId,
          label: 'Jump'
        });
      }

      action.choices?.forEach(choice => {
        if (!choice.targetSceneId || !sceneIds.has(choice.targetSceneId)) return;
        links.push({
          id: `choice_${node.id}_${action.id}_${choice.id}_${choice.targetSceneId}`,
          fromSceneId: node.id,
          fromActionId: action.id,
          fromChoiceId: choice.id,
          toSceneId: choice.targetSceneId,
          toActionId: choice.targetActionId,
          conditions: choice.conditions,
          label: choice.label || 'Choice'
        });
      });
    });
  });

  return links;
}

function sceneGraphLinkKind(link: VNSceneLink): SceneGraphLinkKind {
  if (link.fromChoiceId) return 'choice';
  if (link.id.startsWith('jump_')) return 'jump';
  return 'default';
}

function sceneGraphLinkClass(link: VNSceneLink) {
  const kind = sceneGraphLinkKind(link);
  if (kind === 'choice') return 'stroke-primary';
  if (kind === 'jump') return 'stroke-sky-300';
  return 'stroke-white/35';
}

function normalizeSceneGraphPositions(value: unknown): SceneGraphPositionMap {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<SceneGraphPositionMap>((map, [id, position]) => {
    if (!position || typeof position !== 'object') return map;
    const raw = position as Record<string, unknown>;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      map[id] = { x, y };
    }
    return map;
  }, {});
}

function buildSceneGraphLayout(
  nodes: VNNode[],
  links: VNSceneLink[],
  entrySceneId?: string,
  manualPositions: SceneGraphPositionMap = {}
): SceneGraphLayout {
  const nodeIds = new Set(nodes.map(node => node.id));
  const outgoing = links.reduce((map, link) => {
    if (!nodeIds.has(link.fromSceneId) || !nodeIds.has(link.toSceneId)) return map;
    const group = map.get(link.fromSceneId) || [];
    group.push(link.toSceneId);
    map.set(link.fromSceneId, group);
    return map;
  }, new Map<string, string[]>());
  const depthById = new Map<string, number>();
  const entryId = entrySceneId && nodeIds.has(entrySceneId) ? entrySceneId : nodes[0]?.id;
  const queue = entryId ? [{ id: entryId, depth: 0 }] : [];

  while (queue.length) {
    const current = queue.shift()!;
    const previousDepth = depthById.get(current.id);
    if (previousDepth !== undefined && previousDepth <= current.depth) continue;
    depthById.set(current.id, current.depth);
    (outgoing.get(current.id) || []).forEach(targetId => queue.push({ id: targetId, depth: current.depth + 1 }));
  }

  const maxReachableDepth = Math.max(0, ...Array.from(depthById.values()));
  nodes.forEach((node, index) => {
    if (!depthById.has(node.id)) {
      depthById.set(node.id, maxReachableDepth + 1 + Math.floor(index / 6));
    }
  });

  const layouts = nodes.map((node, index) => {
    const depth = depthById.get(node.id) || 0;
    const manualPosition = manualPositions[node.id];
    return {
      id: node.id,
      depth,
      x: manualPosition ? Math.max(8, manualPosition.x) : 16 + depth * (SCENE_GRAPH_CARD_WIDTH + SCENE_GRAPH_COLUMN_GAP),
      y: manualPosition ? Math.max(8, manualPosition.y) : 16 + index * (SCENE_GRAPH_CARD_HEIGHT + SCENE_GRAPH_ROW_GAP)
    };
  });
  const nodeById = new Map(layouts.map(layout => [layout.id, layout]));

  return {
    nodes: layouts,
    nodeById,
    width: Math.max(360, Math.max(0, ...layouts.map(layout => layout.x)) + SCENE_GRAPH_CARD_WIDTH + 32),
    height: Math.max(220, Math.max(0, ...layouts.map(layout => layout.y)) + SCENE_GRAPH_CARD_HEIGHT + 24)
  };
}

function choiceBranchesForScene(node?: VNNode): ChoiceBranchRow[] {
  if (!node) return [];
  return node.actions.flatMap((action, actionIndex) => (action.choices || []).map((choice, choiceIndex) => ({
    nodeId: node.id,
    actionId: action.id,
    actionIndex,
    choice,
    choiceIndex
  })));
}

function saveSlotStorageKey(projectId: string) {
  return `vn_save_slots_${projectId || 'default'}`;
}

function readSaveSlots(projectId: string): VNSaveSlot[] {
  try {
    const raw = localStorage.getItem(saveSlotStorageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(saveSlotStorageKey(projectId));
    return [];
  }
}

function writeSaveSlots(projectId: string, slots: VNSaveSlot[]) {
  localStorage.setItem(saveSlotStorageKey(projectId), JSON.stringify(slots));
}

function mergeSaveSlots(...groups: VNSaveSlot[][]) {
  const byId = new Map<string, VNSaveSlot>();
  groups.flat().forEach(slot => {
    if (!slot?.slotId) return;
    const previous = byId.get(slot.slotId);
    if (!previous || (slot.updatedAt || '').localeCompare(previous.updatedAt || '') >= 0) {
      byId.set(slot.slotId, slot);
    }
  });
  return Array.from(byId.values()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function projectForPersistence(project: VNProjectState): VNProjectState {
  const { saveSlots: _saveSlots, ...rest } = project;
  const projectId = project.projectId || project.id || 'default';
  return {
    ...rest,
    schemaVersion: project.schemaVersion || VN_SCHEMA_VERSION,
    projectId,
    id: project.id || projectId,
    sceneLinks: deriveSceneLinks(project.nodes)
  };
}

function projectExportFilename(project: VNProjectState) {
  const safeTitle = (project.title || project.projectId || project.id || 'visual-novel')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'visual-novel';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${safeTitle}_${stamp}.json`;
}

function playableExportFilename(project: VNProjectState) {
  return projectExportFilename(project).replace(/\.json$/, '_playable.html');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonForHtml(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function absoluteExportUrl(value: unknown, origin: string) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }
  if (value.startsWith('/')) {
    return `${origin}${value}`;
  }
  return value;
}

function projectForPlayableExport(project: VNProjectState, origin: string) {
  return {
    ...projectForPersistence(project),
    assets: project.assets.map(asset => ({
      ...asset,
      url: absoluteExportUrl(asset.url, origin) as string | undefined,
      sourceUrl: absoluteExportUrl(asset.sourceUrl, origin) as string | undefined
    })),
    nodes: project.nodes.map(node => ({
      ...node,
      actions: node.actions.map(action => ({
        ...action,
        bgImage: absoluteExportUrl(action.bgImage, origin) as string | undefined,
        charImage: absoluteExportUrl(action.charImage, origin) as string | undefined,
        audioPath: absoluteExportUrl(action.audioPath, origin) as string | undefined
      }))
    }))
  };
}

function buildPlayableHtml(project: VNProjectState) {
  const exportProject = projectForPlayableExport(project, window.location.origin);
  const title = escapeHtml(exportProject.title || 'Visual Novel');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #050505; color: #f4f1df; overflow: hidden; }
  #app { min-height: 100vh; display: grid; grid-template-rows: 1fr auto; background: radial-gradient(circle at top, #1d1d1d 0%, #050505 58%); }
  .stage { position: relative; min-height: 0; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .75; }
  .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.58)); }
  .sprite { position: absolute; bottom: 10vh; left: 50%; max-height: 72vh; max-width: min(42vw, 520px); transform: translateX(-50%); object-fit: contain; filter: drop-shadow(0 24px 42px rgba(0,0,0,.55)); }
  .hud { position: relative; z-index: 2; min-height: 11rem; padding: 1rem clamp(1rem, 4vw, 4rem) 1.25rem; border-top: 1px solid rgba(255,255,255,.14); background: rgba(5,5,5,.78); backdrop-filter: blur(18px); }
  .meta { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: .55rem; color: rgba(244,241,223,.55); font-size: .75rem; }
  .speaker { color: #d4ff63; font-weight: 700; letter-spacing: .02em; }
  .text { min-height: 3.25rem; font-size: clamp(1rem, 2vw, 1.25rem); line-height: 1.65; }
  .choices { display: grid; gap: .5rem; margin-top: .9rem; max-width: 54rem; }
  button { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.07); color: #f4f1df; border-radius: 999px; min-height: 2.4rem; padding: .55rem 1rem; font: inherit; cursor: pointer; }
  button:hover { border-color: #d4ff63; color: #d4ff63; }
  .topbar { position: absolute; z-index: 3; left: 1rem; right: 1rem; top: 1rem; display: flex; justify-content: space-between; color: rgba(244,241,223,.55); font-size: .78rem; pointer-events: none; }
  .empty { display: grid; min-height: 100vh; place-items: center; padding: 2rem; color: rgba(244,241,223,.55); }
</style>
</head>
<body>
<div id="app"></div>
<script>
const project = ${jsonForHtml(exportProject)};
let sceneId = project.entrySceneId || project.nodes?.[0]?.id || "";
let actionIndex = 0;
const vars = {};
const visited = new Set();
const assetById = new Map((project.assets || []).map(asset => [asset.id, asset]));
const app = document.getElementById("app");

function scene() { return (project.nodes || []).find(item => item.id === sceneId) || project.nodes?.[0]; }
function action() { return scene()?.actions?.[actionIndex]; }
function assetUrl(id) { return id && assetById.get(id)?.url; }
function textOf(current) { return current?.text || (current?.choices || []).map(choice => choice.label).join(" / ") || ""; }
function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
function conditionOk(condition) {
  if (!condition?.variableKey) return false;
  const left = vars[condition.variableKey];
  const right = condition.value;
  if (condition.operator === "exists") return left !== undefined && left !== null && left !== "";
  if (condition.operator === "not_exists") return left === undefined || left === null || left === "";
  if (condition.operator === "not_equals") return left != right;
  if (condition.operator === "greater_than") return Number(left) > Number(right);
  if (condition.operator === "greater_or_equal") return Number(left) >= Number(right);
  if (condition.operator === "less_than") return Number(left) < Number(right);
  if (condition.operator === "less_or_equal") return Number(left) <= Number(right);
  return left == right;
}
function applyEffects(effects = [], fallbackSceneId) {
  effects.forEach(effect => {
    const key = effect.variableKey || (effect.type === "mark_visited" ? "visited." + (effect.sceneId || fallbackSceneId) : "");
    if (effect.type === "set_flag") vars[key] = true;
    else if (effect.type === "unset_flag") vars[key] = false;
    else if (effect.type === "set_var") vars[key] = effect.value;
    else if (effect.type === "add_var" || effect.type === "add_affinity") vars[key] = Number(vars[key] || 0) + Number(effect.amount || 0);
    else if (effect.type === "mark_visited") visited.add(effect.sceneId || fallbackSceneId);
  });
}
function jumpTo(targetSceneId, targetActionId) {
  const nextScene = (project.nodes || []).find(item => item.id === targetSceneId);
  if (!nextScene) return;
  sceneId = nextScene.id;
  actionIndex = targetActionId ? Math.max(0, nextScene.actions.findIndex(item => item.id === targetActionId)) : 0;
  render();
}
function advance() {
  const currentScene = scene();
  const current = action();
  if (!current || current.choices?.length) return;
  if (current.type === "jump" && current.targetSceneId) return jumpTo(current.targetSceneId, current.targetActionId);
  if (actionIndex < (currentScene.actions?.length || 0) - 1) actionIndex += 1;
  else if (currentScene.defaultNextSceneId) return jumpTo(currentScene.defaultNextSceneId);
  render();
}
function choose(choice) {
  if (!choice) return;
  applyEffects(choice.effects || [], choice.targetSceneId || sceneId);
  if (choice.targetSceneId) jumpTo(choice.targetSceneId, choice.targetActionId);
}
function render() {
  const currentScene = scene();
  const current = action();
  if (!currentScene || !current) {
    app.innerHTML = '<div class="empty">No playable scene found.</div>';
    return;
  }
  visited.add(currentScene.id);
  const bg = current.bgImage || assetUrl(current.bgAssetId) || assetUrl(currentScene.backgroundAssetId) || "";
  const sprite = current.charImage || assetUrl(current.charAssetId) || "";
  const choices = (current.choices || []).filter(choice => (choice.conditions || []).every(conditionOk));
  app.innerHTML = \`
    <main class="stage" onclick="if(event.target === this || event.target.className === 'scrim') advance()">
      <div class="topbar"><span>\${html(project.title || "Visual Novel")}</span><span>\${html(currentScene.title || currentScene.id)}</span></div>
      \${bg ? \`<img class="bg" src="\${html(bg)}" alt="">\` : ""}
      <div class="scrim"></div>
      \${sprite ? \`<img class="sprite" src="\${html(sprite)}" alt="">\` : ""}
    </main>
    <section class="hud" onclick="if(!event.target.closest('button')) advance()">
      <div class="meta"><span class="speaker">\${html(current.speaker || "Narrator")}</span><span>\${actionIndex + 1} / \${currentScene.actions.length}</span></div>
      <div class="text">\${html(textOf(current))}</div>
      <div class="choices">\${choices.map(choice => \`<button data-choice="\${html(choice.id)}">\${html(choice.label)}</button>\`).join("")}</div>
    </section>\`;
  app.querySelectorAll("[data-choice]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      choose(choices.find(choice => choice.id === button.dataset.choice));
    });
  });
  const audioUrl = current.audioPath || assetUrl(current.audioAssetId);
  if (audioUrl) new Audio(audioUrl).play().catch(() => {});
}
render();
</script>
</body>
</html>`;
}

type ProjectValidationIssue = {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  sceneId?: string;
  actionId?: string;
};

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.filter(Boolean).forEach(value => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return Array.from(duplicates);
}

function validateProject(project: VNProjectState): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = [];
  const sceneIds = project.nodes.map(node => node.id);
  const sceneIdSet = new Set(sceneIds);
  const assetIds = new Set(project.assets.map(asset => asset.id));
  const variableKeys = new Set((project.variables || []).map(variable => variable.key));
  const actionToScene = buildActionSceneIndex(project.nodes);
  const links = deriveSceneLinks(project.nodes);

  if (!project.entrySceneId || !sceneIdSet.has(project.entrySceneId)) {
    issues.push({ id: 'missing_entry_scene', severity: 'error', message: 'Missing entry scene.' });
  }

  duplicateValues(sceneIds).forEach(id => issues.push({ id: `duplicate_scene_${id}`, severity: 'error', message: `Duplicate scene id: ${id}`, sceneId: id }));
  duplicateValues(project.assets.map(asset => asset.id)).forEach(id => issues.push({ id: `duplicate_asset_${id}`, severity: 'warning', message: `Duplicate asset id: ${id}` }));
  duplicateValues((project.variables || []).map(variable => variable.key)).forEach(id => issues.push({ id: `duplicate_variable_${id}`, severity: 'warning', message: `Duplicate variable key: ${id}` }));

  project.nodes.forEach(node => {
    duplicateValues(node.actions.map(action => action.id)).forEach(id => issues.push({ id: `duplicate_action_${node.id}_${id}`, severity: 'error', message: `Duplicate action id: ${id}`, sceneId: node.id, actionId: id }));
    if (node.defaultNextSceneId && !sceneIdSet.has(node.defaultNextSceneId)) {
      issues.push({ id: `missing_default_${node.id}`, severity: 'error', message: `${node.title} default next scene is missing: ${node.defaultNextSceneId}`, sceneId: node.id });
    }

    node.actions.forEach(action => {
      if (action.targetSceneId && !sceneIdSet.has(action.targetSceneId)) {
        issues.push({ id: `missing_jump_scene_${node.id}_${action.id}`, severity: 'error', message: `${action.id} targets missing scene: ${action.targetSceneId}`, sceneId: node.id, actionId: action.id });
      }
      if (action.targetActionId && !actionToScene.has(action.targetActionId)) {
        issues.push({ id: `missing_jump_action_${node.id}_${action.id}`, severity: 'error', message: `${action.id} targets missing action: ${action.targetActionId}`, sceneId: node.id, actionId: action.id });
      }
      if (action.bgAssetId && !assetIds.has(action.bgAssetId)) {
        issues.push({ id: `missing_bg_asset_${node.id}_${action.id}`, severity: 'warning', message: `${action.id} references missing background asset: ${action.bgAssetId}`, sceneId: node.id, actionId: action.id });
      }
      if (action.charAssetId && !assetIds.has(action.charAssetId)) {
        issues.push({ id: `missing_char_asset_${node.id}_${action.id}`, severity: 'warning', message: `${action.id} references missing character asset: ${action.charAssetId}`, sceneId: node.id, actionId: action.id });
      }
      if (action.audioAssetId && !assetIds.has(action.audioAssetId)) {
        issues.push({ id: `missing_audio_asset_${node.id}_${action.id}`, severity: 'warning', message: `${action.id} references missing audio asset: ${action.audioAssetId}`, sceneId: node.id, actionId: action.id });
      }
      if ((action.choices || []).length > 0) {
        action.choices?.forEach(choice => {
          if (!choice.targetSceneId) {
            issues.push({ id: `choice_without_target_${node.id}_${action.id}_${choice.id}`, severity: 'warning', message: `Choice "${choice.label}" has no target scene.`, sceneId: node.id, actionId: action.id });
          } else if (!sceneIdSet.has(choice.targetSceneId)) {
            issues.push({ id: `choice_missing_scene_${node.id}_${action.id}_${choice.id}`, severity: 'error', message: `Choice "${choice.label}" targets missing scene: ${choice.targetSceneId}`, sceneId: node.id, actionId: action.id });
          }
          if (choice.targetActionId && !actionToScene.has(choice.targetActionId)) {
            issues.push({ id: `choice_missing_action_${node.id}_${action.id}_${choice.id}`, severity: 'error', message: `Choice "${choice.label}" targets missing action: ${choice.targetActionId}`, sceneId: node.id, actionId: action.id });
          }
          (choice.conditions || []).forEach(condition => {
            if (condition.variableKey && !variableKeys.has(condition.variableKey)) {
              issues.push({ id: `missing_condition_var_${node.id}_${action.id}_${choice.id}_${condition.id}`, severity: 'warning', message: `${choice.label} condition references missing variable "${condition.variableKey}"`, sceneId: node.id, actionId: action.id });
            }
          });
          (choice.effects || []).forEach(effect => {
            const key = effectVariableKey(effect, choice.targetSceneId || node.id);
            if (key && !variableKeys.has(key)) {
              issues.push({ id: `missing_effect_var_${node.id}_${action.id}_${choice.id}_${effect.id}`, severity: 'warning', message: `${choice.label} effect writes undefined variable "${key}"`, sceneId: node.id, actionId: action.id });
            }
          });
        });
      }
    });
  });

  const reachable = new Set<string>();
  const visit = (sceneId?: string) => {
    if (!sceneId || reachable.has(sceneId) || !sceneIdSet.has(sceneId)) return;
    reachable.add(sceneId);
    links.filter(link => link.fromSceneId === sceneId).forEach(link => visit(link.toSceneId));
  };
  visit(project.entrySceneId || project.nodes[0]?.id);
  project.nodes.forEach(node => {
    if (!reachable.has(node.id)) {
      issues.push({ id: `orphan_scene_${node.id}`, severity: 'warning', message: `Scene is unreachable from entry: ${node.title}`, sceneId: node.id });
    }
    const hasOutgoing = links.some(link => link.fromSceneId === node.id);
    if (node.type !== 'ending' && node.actions.length > 0 && !hasOutgoing) {
      const lastAction = node.actions[node.actions.length - 1];
      if (lastAction.type !== 'ending') {
        issues.push({ id: `dead_end_${node.id}`, severity: 'warning', message: `Scene may dead-end without an ending type or outgoing link: ${node.title}`, sceneId: node.id });
      }
    }
  });

  if (!project.nodes.some(node => node.type === 'ending' && reachable.has(node.id))) {
    issues.push({ id: 'unreachable_endings', severity: 'warning', message: 'No reachable ending scene found.' });
  }

  return issues;
}

function formatDateTime(value?: string) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function valueExists(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

function compareValues(left: unknown, right: unknown, operator: VNConditionOperator) {
  if (operator === 'exists') return valueExists(left);
  if (operator === 'not_exists') return !valueExists(left);

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const canCompareAsNumber = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
  const comparableLeft = canCompareAsNumber ? leftNumber : String(left ?? '');
  const comparableRight = canCompareAsNumber ? rightNumber : String(right ?? '');

  if (operator === 'equals') return comparableLeft === comparableRight;
  if (operator === 'not_equals') return comparableLeft !== comparableRight;
  if (operator === 'greater_than') return comparableLeft > comparableRight;
  if (operator === 'greater_or_equal') return comparableLeft >= comparableRight;
  if (operator === 'less_than') return comparableLeft < comparableRight;
  if (operator === 'less_or_equal') return comparableLeft <= comparableRight;
  return false;
}

function evaluateCondition(condition: VNCondition, variables: Record<string, unknown>) {
  if (!condition.variableKey) return false;
  return compareValues(variables[condition.variableKey], condition.value, condition.operator);
}

function conditionsMet(conditions: VNCondition[] | undefined, variables: Record<string, unknown>) {
  if (!conditions?.length) return true;
  return conditions.every(condition => evaluateCondition(condition, variables));
}

function effectVariableKey(effect: VNEffect, fallbackSceneId?: string) {
  if (effect.type === 'add_affinity') {
    return effect.variableKey || (effect.characterId ? `affinity.${effect.characterId}` : '');
  }
  if (effect.type === 'mark_visited') {
    return effect.variableKey || `visited.${effect.sceneId || fallbackSceneId || 'scene'}`;
  }
  return effect.variableKey || '';
}

function applyEffectsToVariables(
  variables: Record<string, unknown>,
  effects: VNEffect[] | undefined,
  fallbackSceneId?: string
) {
  if (!effects?.length) return variables;
  const next = { ...variables };

  effects.forEach(effect => {
    const key = effectVariableKey(effect, fallbackSceneId);
    if (!key) return;

    if (effect.type === 'set_flag') {
      next[key] = true;
      return;
    }
    if (effect.type === 'unset_flag') {
      next[key] = false;
      return;
    }
    if (effect.type === 'set_var') {
      next[key] = effect.value ?? '';
      return;
    }
    if (effect.type === 'add_var' || effect.type === 'add_affinity') {
      next[key] = Number(next[key] || 0) + Number(effect.amount ?? effect.value ?? 1);
      return;
    }
    if (effect.type === 'mark_visited') {
      next[key] = true;
    }
  });

  return next;
}

function createProjectId() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  return `web_mvp_${stamp}`;
}

function normalizeAssetKind(assetType?: string): VNAsset['type'] {
  const value = String(assetType || '').toLowerCase();
  if (value.includes('voice') || value.includes('audio')) return 'audio';
  if (value.includes('character') || value.includes('sprite') || value.includes('variant')) return 'char';
  return 'bg';
}

function normalizeRemoteAssetKind(record: UserAssetRecord): VNAsset['type'] {
  return normalizeAssetKind(record.asset_type || String(record.metadata?.asset_type || ''));
}

function displayRemoteAssetUrl(record?: UserAssetRecord) {
  if (!record) return '';
  return record.absolute_url || record.url || '';
}

function toWorkspaceAsset(record: UserAssetRecord, forcedType?: PickerKind): VNAsset {
  const type = forcedType || normalizeRemoteAssetKind(record);
  return {
    id: record.asset_id,
    sourceTaskId: record.source_task_id || record.asset_id,
    type,
    name: record.name || record.asset_id,
    status: 'ready',
    url: displayRemoteAssetUrl(record),
    characterId: record.character_id || String(record.metadata?.character_id || ''),
    assetType: record.asset_type,
    width: record.width,
    height: record.height,
    metadata: record.metadata
  };
}

function assetSearchText(asset: VNAsset | UserAssetRecord) {
  const isRemote = 'asset_id' in asset;
  return [
    isRemote ? asset.asset_id : asset.id,
    asset.name,
    isRemote ? asset.asset_type : asset.type,
    isRemote ? asset.character_id : asset.characterId,
    isRemote ? undefined : asset.assetType
  ].filter(Boolean).join(' ').toLowerCase();
}

function resourceLabel(kind: PickerKind, locale: Locale = 'en-US') {
  if (kind === 'bg') return translate(locale, 'background');
  if (kind === 'char') return translate(locale, 'characterSprite');
  return translate(locale, 'voice');
}

function positionToOffset(position?: string) {
  if (position === 'left') return -220;
  if (position === 'right') return 220;
  return 0;
}

function buildVoiceUrl(requestId: string, index: number) {
  return `/generated/audio/${requestId}_line_${String(index + 1).padStart(3, '0')}.wav`;
}

function toGeneratedImageUrl(record: any, sourceTask: any) {
  const result = record?.stableAsset || record?.assetResult || {};
  const directUrl = result.absolute_url || result.url || result.asset_url || result.image_url;
  if (typeof directUrl === 'string' && directUrl) {
    return directUrl;
  }
  const projectId = result.project_id || sourceTask?.project_id || sourceTask?.projectId;
  const assetType = result.asset_type || record?.sourceAssetKind || sourceTask?.asset_type || sourceTask?.assetType;
  const fileId = result.asset_id || result.task_id || sourceTask?.task_id || sourceTask?.taskId;
  if (!projectId || !assetType || !fileId) return '';
  const fileName = String(fileId).endsWith('.png') ? String(fileId) : `${fileId}.png`;
  return `/generated/images/${encodeURIComponent(String(projectId))}/${encodeURIComponent(String(assetType))}/${encodeURIComponent(fileName)}`;
}

function sourceTaskForRecord(script: any, record: any) {
  const tasks = Array.isArray(script?.asset_tasks) ? script.asset_tasks : [];
  const sequence = Number(record?.sequenceId || record?.sequence_id || 0);
  return sequence > 0 ? tasks[sequence - 1] : undefined;
}

function extractChoiceOptions(sourceText: string) {
  const match = sourceText.match(/(?:玩家)?需要选择\s*[:：]\s*([^。！？\n]+)/u) || sourceText.match(/选择\s*[:：]\s*([^。！？\n]+)/u);
  const choiceText = match?.[1]?.trim();
  if (!choiceText) return [];

  return choiceText
    .split(/(?:，?\s*或者\s*|，?\s*或\s*|[|/、；;])/u)
    .map(option => option.replace(/^[：:，,。\s]+|[：:，,。\s]+$/gu, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function ensureChoiceFallback(nodes: VNNode[], sourceText: string) {
  const hasRenderableChoice = nodes.some(node => node.actions.some(action => (action.choices?.length ?? 0) > 0));
  if (hasRenderableChoice) return nodes;

  const options = extractChoiceOptions(sourceText);
  if (options.length < 2 || nodes.length === 0) return nodes;

  const withFilledEmptyChoice = nodes.map(node => {
    let filled = false;
    return {
      ...node,
      actions: node.actions.map(action => {
        if (filled || action.type !== 'choice') return action;
        filled = true;
        return {
          ...action,
          text: action.text || '请选择接下来的行动。',
          choices: options.map((label, index) => ({
            id: createChoiceId(),
            label,
            targetActionId: node.actions[Math.max(0, node.actions.length - 2 - index)]?.id
          }))
        };
      })
    };
  });
  if (withFilledEmptyChoice.some(node => node.actions.some(action => (action.choices?.length ?? 0) > 0))) {
    return withFilledEmptyChoice;
  }

  const lastNodeIndex = nodes.length - 1;
  const lastNode = nodes[lastNodeIndex];
  const lastAction = lastNode.actions[lastNode.actions.length - 1];
  const lastActionStart = normalizeOptionalSeconds(lastAction?.startTime) || 0;
  const lastActionDuration = normalizeDurationSeconds(lastAction?.duration, estimateActionDuration(lastAction));
  const choiceAction: VNAction = {
    id: `choice_${Date.now()}`,
    type: 'choice',
    speaker: lastAction?.speaker || 'Narrator',
    text: '请选择接下来的行动。',
    choices: options.map((label, index) => ({
      id: createChoiceId(),
      label,
      targetActionId: lastNode.actions[Math.max(0, lastNode.actions.length - 1 - index)]?.id
    })),
    bgAssetId: lastAction?.bgAssetId,
    charAssetId: lastAction?.charAssetId,
    bgImage: lastAction?.bgImage,
    charImage: lastAction?.charImage,
    startTime: roundSeconds(lastActionStart + lastActionDuration),
    duration: DEFAULT_ACTION_DURATION,
    layout: lastAction?.layout || { x: 0, y: 0, scale: 1 }
  };

  return nodes.map((node, index) => index === lastNodeIndex ? {
    ...node,
    actions: [...node.actions, choiceAction]
  } : node);
}

function flattenScriptActions(script: any) {
  const actions: any[] = [];
  const seen = new Set<string>();
  const append = (items: any[]) => {
    items.forEach(action => {
      const id = pickText(action?.id, action?.action_id);
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      actions.push(action);
    });
  };

  append(Array.isArray(script?.actions) ? script.actions : []);
  (Array.isArray(script?.scenes) ? script.scenes : []).forEach((scene: any) => append(Array.isArray(scene?.actions) ? scene.actions : []));
  (Array.isArray(script?.nodes) ? script.nodes : []).forEach((node: any) => append(Array.isArray(node?.actions) ? node.actions : []));
  return actions;
}

function scriptToProjectState(script: any, requestId: string, projectId: string, imageTaskCount = 0, voiceTaskCount = 0, sourceText = ''): VNProjectState {
  const actions = flattenScriptActions(script);
  const voiceTasks = Array.isArray(script?.voice_tasks) && script.voice_tasks.length
    ? script.voice_tasks
    : actions
        .filter((action: any) => action.voice_task_id || action.type === 'line' || action.action_type === 'dialogue' || action.action_type === 'narration')
        .map((action: any) => ({
          task_id: action.voice_task_id || `voice_${action.id || action.action_id}`,
          action_id: action.id || action.action_id,
          role: action.speaker_name || action.speaker || action.speaker_id || 'Narrator'
        }));
  const voiceTaskByActionId = new Map<string, any>();
  voiceTasks.forEach((task: any) => {
    const actionId = task.action_id || task.actionId;
    if (actionId) voiceTaskByActionId.set(String(actionId), task);
  });
  const stages = Array.isArray(script?.stages) && script.stages.length
    ? script.stages
    : [{ stage_id: 'stage_001', name: 'Generated Scene', action_ids: actions.map((action: any) => action.action_id).filter(Boolean) }];
  const scenes = Array.isArray(script?.scenes) && script.scenes.length ? script.scenes : stages;

  const nodes: VNNode[] = scenes.map((stage: any, stageIndex: number) => {
    const stageId = stage.scene_id || stage.stage_id || stage.id;
    const actionIds = Array.isArray(stage.action_ids) ? new Set(stage.action_ids) : null;
    const nestedActions = Array.isArray(stage.actions) ? stage.actions : [];
    const stageActions = nestedActions.length ? nestedActions : actions.filter((action: any) => {
      if (actionIds) return actionIds.has(action.action_id);
      return !action.stage_id || action.stage_id === stageId;
    });

    return {
      id: stage.scene_id || stage.stage_id || stage.id || `scene_${stageIndex + 1}`,
      title: stage.name || stage.title || `Generated Scene ${stageIndex + 1}`,
      summary: stage.summary || '',
      type: normalizeSceneType(stage.type),
      status: 'done',
      defaultNextSceneId: stage.default_next_scene_id || stage.defaultNextSceneId,
      backgroundAssetId: stage.background_asset_task_id || stage.background_asset_id || stage.backgroundAssetId,
      bgmAssetId: stage.bgm_asset_id || stage.bgmAssetId,
      tags: Array.isArray(stage.tags) ? stage.tags : [],
      position: normalizePosition(stage.position, stageIndex),
      actions: stageActions.map((action: any, actionIndex: number): VNAction => {
        const spriteIds = action.sprite_asset_task_ids || action.sprite_asset_ids || [];
        const layout = action.layout || {};
        const voiceTask = voiceTaskByActionId.get(String(action.action_id || ''));
        return {
          id: action.id || action.action_id || `action_${stageIndex + 1}_${actionIndex + 1}`,
          sourceActionId: action.action_id || action.id,
          type: action.action_type || action.type || 'dialogue',
          speaker: action.speaker_name || action.speaker || action.speaker_id || 'Narrator',
          text: action.text || action.dialogue || action.line || '',
          emotion: action.emotion || '',
          choices: (action.choice?.options || action.choices || []).map((choice: any) => ({
            id: choice.id || choice.choice_id || createChoiceId(),
            label: choice.label || choice.text || '',
            nextId: choice.nextId,
            targetActionId: choice.target_action_id || choice.targetActionId,
            targetSceneId: choice.target_scene_id || choice.targetSceneId || choice.to_scene_id || choice.toSceneId,
            conditions: Array.isArray(choice.conditions) ? choice.conditions.map((condition: any, index: number) => normalizeCondition(condition, index)) : undefined,
            effects: Array.isArray(choice.effects) ? choice.effects.map((effect: any, index: number) => normalizeEffect(effect, index)) : undefined,
            disabledText: choice.disabled_text || choice.disabledText
          })),
          targetSceneId: action.target_scene_id || action.targetSceneId,
          targetActionId: action.target_action_id || action.targetActionId,
          bgAssetId: action.background_asset_task_id || action.background_asset_id || stage.background_asset_task_id || stage.background_asset_id,
          charAssetId: spriteIds[0],
          audioAssetId: action.voice_task_id || voiceTask?.task_id || voiceTask?.taskId || action.audio_asset_id || ((action.id || action.action_id) ? `voice_${action.id || action.action_id}` : undefined),
          layout: {
            x: Number(layout.x ?? positionToOffset(layout.position)),
            y: Number(layout.y ?? 0),
            scale: Number(layout.scale ?? 1)
          }
        };
      })
    };
  });

  const imageAssets: VNAsset[] = (script?.asset_tasks || []).map((task: any, index: number) => {
    const id = task.task_id || task.asset_id || `image_task_${index + 1}`;
    return {
      id,
      sourceTaskId: id,
      type: normalizeAssetKind(task.asset_type || task.assetType),
      name: id,
      status: 'pending',
      characterId: task.character_id || task.characterId,
      assetType: task.asset_type || task.assetType
    };
  });

  const voiceAssets: VNAsset[] = voiceTasks.map((task: any, index: number) => {
    const id = task.task_id || `voice_action_${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      sourceTaskId: id,
      type: 'audio',
      name: task.action_id ? `${task.action_id} · ${task.role || 'Voice'}` : (task.role ? `${task.role} ${index + 1}` : `Voice Line ${index + 1}`),
      status: 'pending',
      url: buildVoiceUrl(requestId, index)
    };
  });

  return normalizeProjectState({
    schemaVersion: Number(script?.schema_version || script?.schemaVersion || VN_SCHEMA_VERSION),
    projectId: script?.project_id || projectId,
    id: projectId,
    title: script?.title || 'Generated Visual Novel',
    entrySceneId: script?.entry_scene_id || script?.entrySceneId || nodes[0]?.id,
    sceneLinks: Array.isArray(script?.scene_links) ? script.scene_links : Array.isArray(script?.sceneLinks) ? script.sceneLinks : [],
    requestId,
    script,
    sourceText,
    nodes: ensureChoiceFallback(nodes, sourceText),
    assets: [...imageAssets, ...voiceAssets],
    variables: Array.isArray(script?.variables)
      ? script.variables.map((variable: any, index: number) => normalizeVariableDefinition(variable, index))
      : [],
    imageTaskCount,
    voiceTaskCount: voiceTaskCount || voiceAssets.length,
    generationStatus: 'generating_assets'
  });
}

function upsertAsset(assets: VNAsset[], next: VNAsset) {
  const index = assets.findIndex(asset => asset.id === next.id);
  if (index < 0) return [...assets, next];
  const copy = [...assets];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

function applyImageRecords(project: VNProjectState, records: any[]) {
  let assets = project.assets;
  let changed = false;

  records.forEach((record) => {
    const sourceTask = sourceTaskForRecord(project.script, record);
    const sourceId = sourceTask?.task_id
      || sourceTask?.taskId
      || record?.stableAsset?.source_task_id
      || record?.sourceTaskId
      || record?.assetResult?.task_id
      || record?.assetResult?.asset_id;
    if (!sourceId) return;

    const existing = assets.find(asset => asset.id === sourceId);
    if (record.type === 'IMAGE_ASSET_FAILED') {
      if (existing?.status !== 'failed' || existing.error !== record.error) {
        assets = upsertAsset(assets, {
          ...(existing || { id: sourceId, name: sourceId, type: normalizeAssetKind(sourceTask?.asset_type) }),
          status: 'failed',
          error: record.error || 'Image generation failed'
        });
        changed = true;
      }
      return;
    }

    if (record.type !== 'IMAGE_ASSET_READY') return;
    const url = toGeneratedImageUrl(record, sourceTask);
    const next: VNAsset = {
      ...(existing || { id: sourceId, name: sourceId, type: normalizeAssetKind(sourceTask?.asset_type) }),
      id: sourceId,
      sourceTaskId: sourceId,
      type: normalizeAssetKind(sourceTask?.asset_type || record?.stableAsset?.asset_type || record?.assetResult?.asset_type || record?.sourceAssetKind),
      name: sourceId,
      status: 'ready',
      url,
      characterId: sourceTask?.character_id || sourceTask?.characterId,
      assetType: sourceTask?.asset_type || sourceTask?.assetType || record?.stableAsset?.asset_type || record?.assetResult?.asset_type,
      width: record?.stableAsset?.width || record?.assetResult?.width,
      height: record?.stableAsset?.height || record?.assetResult?.height,
      metadata: {
        ...(existing?.metadata || {}),
        stableAssetId: record?.stableAsset?.asset_id,
        providerAssetId: record?.stableAsset?.provider_asset_id,
        sourceTaskId: record?.stableAsset?.source_task_id || record?.sourceTaskId
      }
    };

    if (existing?.status !== next.status || existing?.url !== next.url) {
      assets = upsertAsset(assets, next);
      changed = true;
    }
  });

  if (!changed) return project;
  const readyImages = assets.filter(asset => asset.type !== 'audio' && asset.status === 'ready').length;
  const readyVoices = assets.filter(asset => asset.type === 'audio' && asset.status === 'ready').length;
  return {
    ...project,
    assets,
    generationStatus: project.imageTaskCount && readyImages >= project.imageTaskCount && readyVoices >= (project.voiceTaskCount || 0) ? 'done' : project.generationStatus
  };
}

function ensureProjectAudioBindings(project: VNProjectState) {
  const assetIds = new Set(project.assets.map(asset => asset.id));
  const voiceTasks = Array.isArray(project.script?.voice_tasks) ? project.script.voice_tasks : [];
  if (!voiceTasks.length) return project;

  const voiceTaskByActionId = new Map<string, any>();
  voiceTasks.forEach((task: any) => {
    const actionId = task.action_id || task.actionId;
    if (actionId) voiceTaskByActionId.set(String(actionId), task);
  });

  let changed = false;
  const nodes = project.nodes.map(node => ({
    ...node,
    actions: node.actions.map(action => {
      if (action.audioAssetId && assetIds.has(action.audioAssetId)) return action;
      const voiceTask = voiceTaskByActionId.get(String(action.sourceActionId || action.id));
      const audioAssetId = voiceTask?.task_id || voiceTask?.taskId;
      if (!audioAssetId || !assetIds.has(audioAssetId)) return action;
      changed = true;
      return { ...action, audioAssetId };
    })
  }));

  return changed ? { ...project, nodes } : project;
}

export function Workstation() {
  const [selectedGuide, setSelectedGuide] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const t = (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const toggleLocale = () => {
    setLocale(current => current === 'zh-CN' ? 'en-US' : 'zh-CN');
  };
  
  const [project, setProject] = useState<VNProjectState>(() => {
    const saved = localStorage.getItem('vn_project');
    if (saved) {
      try {
        return normalizeProjectState(JSON.parse(saved));
      } catch {
        localStorage.removeItem('vn_project');
      }
    }
    return normalizeProjectState({
      id: 'default',
      title: 'Project: Neon Shadows',
      entrySceneId: '',
      schemaVersion: VN_SCHEMA_VERSION,
      timelineMode: 'script',
      nodes: [],
      assets: [],
      generationStatus: 'idle'
    });
  });
  const projectStorageId = project.projectId || project.id || 'default';
  const hadLocalProjectRef = useRef(Boolean(localStorage.getItem('vn_project')));
  const backendBootstrapCompleteRef = useRef(hadLocalProjectRef.current);
  const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [promptInput, setPromptInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [activeNodeId, setActiveNodeId] = useState<string | null>(project.entrySceneId || project.nodes[0]?.id || null);
  const [activeActionIdx, setActiveActionIdx] = useState<number>(0);
  const [selectedSceneLinkId, setSelectedSceneLinkId] = useState('');
  const [sceneMapOpen, setSceneMapOpen] = useState(false);
  const [sceneMapSize, setSceneMapSize] = useState({ width: 960, height: 680 });
  const [sceneMapPosition, setSceneMapPosition] = useState(() => ({
    x: typeof window === 'undefined' ? 96 : Math.min(260, Math.max(16, window.innerWidth - 976)),
    y: 88
  }));
  const [sceneMapPanning, setSceneMapPanning] = useState(false);
  const [sceneMapScrollbarsVisible, setSceneMapScrollbarsVisible] = useState(false);
  const [sceneMapDraftLink, setSceneMapDraftLink] = useState<SceneMapDraftLink | null>(null);
  const [sceneMapZoom, setSceneMapZoom] = useState(1);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [layoutSourceActionId, setLayoutSourceActionId] = useState('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('content');
  const [assetPicker, setAssetPicker] = useState<PickerState>({ open: false, kind: 'bg', query: '' });
  const [libraryAssets, setLibraryAssets] = useState<UserAssetRecord[]>([]);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveLoadOpen, setSaveLoadOpen] = useState(false);
  const [saveSlots, setSaveSlots] = useState<VNSaveSlot[]>(() => readSaveSlots(project.projectId || project.id || 'default'));
  const [saveSlotsProjectId, setSaveSlotsProjectId] = useState(project.projectId || project.id || 'default');
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, unknown>>({});
  const [runtimeHistory, setRuntimeHistory] = useState<VNRuntimeHistoryEntry[]>([]);
  const [visitedSceneIds, setVisitedSceneIds] = useState<string[]>(() => {
    const firstSceneId = project.entrySceneId || project.nodes[0]?.id;
    return firstSceneId ? [firstSceneId] : [];
  });
  const [selectedChoiceHistory, setSelectedChoiceHistory] = useState<VNSelectedChoiceHistoryEntry[]>([]);
  const [runtimeStartedAt, setRuntimeStartedAt] = useState(() => new Date().toISOString());
  const [playheadTime, setPlayheadTime] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineSnap, setTimelineSnap] = useState(true);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneMapInteractionGuardRef = useRef(false);
  const sceneMapWindowRef = useRef<HTMLDivElement | null>(null);
  const sceneMapViewportRef = useRef<HTMLDivElement | null>(null);
  const sceneMapScrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimelineAudioActionIdRef = useRef<string>('');
  const projectHistoryRef = useRef<{
    past: VNProjectState[];
    future: VNProjectState[];
    current?: VNProjectState;
    suppress: boolean;
    paused: boolean;
    transactionBase?: VNProjectState;
  }>({ past: [], future: [], suppress: false, paused: false });
  const projectRef = useRef(project);

  const beginProjectTransaction = () => {
    const history = projectHistoryRef.current;
    if (history.paused) return;
    history.transactionBase = history.current || projectRef.current;
    history.paused = true;
  };

  useEffect(() => () => {
    if (sceneMapScrollbarTimerRef.current) {
      clearTimeout(sceneMapScrollbarTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!sceneMapOpen) return;
    requestAnimationFrame(() => {
      sceneMapWindowRef.current?.focus({ preventScroll: true });
    });
  }, [sceneMapOpen]);

  const commitProjectTransaction = () => {
    const history = projectHistoryRef.current;
    if (!history.paused) return;
    setTimeout(() => {
      const latestHistory = projectHistoryRef.current;
      const base = latestHistory.transactionBase;
      const current = latestHistory.current || projectRef.current;
      latestHistory.paused = false;
      latestHistory.transactionBase = undefined;
      if (!base || base === current) return;
      latestHistory.past = [...latestHistory.past, base].slice(-PROJECT_HISTORY_LIMIT);
      latestHistory.future = [];
      latestHistory.current = current;
    }, 0);
  };

  const syncActiveSelectionForProject = (nextProject: VNProjectState) => {
    const nextNode = nextProject.nodes.find(node => node.id === activeNodeId)
      || nextProject.nodes.find(node => node.id === nextProject.entrySceneId)
      || nextProject.nodes[0];
    setActiveNodeId(nextNode?.id || null);
    setActiveActionIdx(index => Math.min(Math.max(0, index), Math.max(0, (nextNode?.actions.length || 1) - 1)));
  };

  useEffect(() => {
    if (hadLocalProjectRef.current) return;
    let cancelled = false;

    const loadLatestBackendProject = async () => {
      try {
        const projects = await listBackendProjects();
        const latest = projects[0];
        if (!latest?.projectId) return;

        const loadedProject = await loadBackendProject(latest.projectId);
        if (cancelled) return;

        const normalized = normalizeProjectState(loadedProject);
        setProject(normalized);
        syncActiveSelectionForProject(normalized);
        setWorkspaceNotice(t('backendProjectLoaded', { title: normalized.title }));
      } catch {
        // localStorage remains the source of truth when the backend is offline.
      } finally {
        backendBootstrapCompleteRef.current = true;
      }
    };

    loadLatestBackendProject();
    return () => {
      cancelled = true;
    };
  }, []);

  const undoProject = () => {
    const history = projectHistoryRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    const current = history.current || project;
    history.future = [current, ...history.future].slice(0, PROJECT_HISTORY_LIMIT);
    history.current = previous;
    history.suppress = true;
    setProject(previous);
    syncActiveSelectionForProject(previous);
  };

  const redoProject = () => {
    const history = projectHistoryRef.current;
    const next = history.future.shift();
    if (!next) return;
    const current = history.current || project;
    history.past = [...history.past, current].slice(-PROJECT_HISTORY_LIMIT);
    history.current = next;
    history.suppress = true;
    setProject(next);
    syncActiveSelectionForProject(next);
  };

  const exportProjectJson = () => {
    const exportProject = {
      ...projectForPersistence(project),
      saveSlots,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(exportProject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = projectExportFilename(project);
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkspaceNotice(t('projectExported'));
  };

  const exportPlayableHtml = () => {
    const blob = new Blob([buildPlayableHtml(project)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = playableExportFilename(project);
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkspaceNotice(t('playableExported'));
  };

  const importProjectJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const migrated = await migrateBackendProject(parsed).catch(() => parsed);
      const nextProject = normalizeProjectState(migrated);
      const importedSlots = Array.isArray(parsed?.saveSlots)
        ? parsed.saveSlots
        : Array.isArray((migrated as any)?.saveSlots)
          ? (migrated as any).saveSlots
          : [];
      const nextProjectId = nextProject.projectId || nextProject.id || 'default';

      localStorage.setItem('vn_project', JSON.stringify(projectForPersistence(nextProject)));
      if (importedSlots.length) {
        writeSaveSlots(nextProjectId, importedSlots);
      }

      setProject(nextProject);
      syncActiveSelectionForProject(nextProject);
      setSaveSlotsProjectId(nextProjectId);
      setSaveSlots(importedSlots);
      setRuntimeVariables({});
      setRuntimeHistory([]);
      setSelectedChoiceHistory([]);
      setVisitedSceneIds(nextProject.entrySceneId ? [nextProject.entrySceneId] : nextProject.nodes[0]?.id ? [nextProject.nodes[0].id] : []);
      setRuntimeStartedAt(new Date().toISOString());
      setActiveActionIdx(0);

      saveBackendProject(projectForPersistence(nextProject)).catch(() => {});
      importedSlots.forEach(slot => {
        saveBackendSaveSlot(nextProjectId, { ...slot, projectId: nextProjectId }).catch(() => {});
      });

      setWorkspaceNotice(t('projectImported', { title: nextProject.title }));
    } catch (error) {
      console.error(error);
      setWorkspaceNotice(t('projectImportFailed'));
    }
  };

  const handleProjectFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      importProjectJson(file);
    }
  };

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    projectRef.current = project;
    const history = projectHistoryRef.current;
    if (!history.current) {
      history.current = project;
      return;
    }
    if (history.suppress) {
      history.current = project;
      history.suppress = false;
      return;
    }
    if (history.paused) {
      history.current = project;
      return;
    }
    if (history.current === project) return;
    history.past = [...history.past, history.current].slice(-PROJECT_HISTORY_LIMIT);
    history.future = [];
    history.current = project;
  }, [project]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input') {
        const inputType = (target.getAttribute('type') || 'text').toLowerCase();
        return !['range', 'checkbox', 'radio', 'button'].includes(inputType);
      }
      return tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoProject();
        else undoProject();
      } else if (key === 'y') {
        event.preventDefault();
        redoProject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    const persistableProject = projectForPersistence(project);
    localStorage.setItem('vn_project', JSON.stringify(persistableProject));

    if (!backendBootstrapCompleteRef.current) return;
    if (projectSaveTimerRef.current) {
      clearTimeout(projectSaveTimerRef.current);
    }
    projectSaveTimerRef.current = setTimeout(() => {
      saveBackendProject(persistableProject).catch(() => {
        // The localStorage fallback intentionally stays silent during dev/offline work.
      });
    }, 800);

    return () => {
      if (projectSaveTimerRef.current) {
        clearTimeout(projectSaveTimerRef.current);
        projectSaveTimerRef.current = null;
      }
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const localSlots = readSaveSlots(projectStorageId);
    setSaveSlots(localSlots);
    setSaveSlotsProjectId(projectStorageId);

    listBackendSaveSlots(projectStorageId)
      .then(remoteSlots => {
        if (cancelled) return;
        if (remoteSlots.length) {
          setSaveSlots(current => mergeSaveSlots(remoteSlots, current, localSlots));
        }
      })
      .catch(() => {
        // Keep the local save slots available while backend persistence is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [projectStorageId]);

  useEffect(() => {
    writeSaveSlots(saveSlotsProjectId, saveSlots);
  }, [saveSlotsProjectId, saveSlots]);

  useEffect(() => {
    if (!project.nodes.length) return;
    const nextEntry = project.entrySceneId && project.nodes.some(node => node.id === project.entrySceneId)
      ? project.entrySceneId
      : project.nodes[0]?.id;
    if (nextEntry && nextEntry !== project.entrySceneId) {
      setProject(p => ({ ...p, entrySceneId: nextEntry }));
    }
  }, [project.entrySceneId, project.nodes]);

  useEffect(() => {
    setLayoutSourceActionId('');
  }, [activeNodeId, activeActionIdx]);

  useEffect(() => {
    if (!activeNodeId) return;
    setVisitedSceneIds(ids => ids.includes(activeNodeId) ? ids : [...ids, activeNodeId]);
  }, [activeNodeId]);

  useEffect(() => {
    const variables = project.variables || [];
    if (!variables.length) return;
    setRuntimeVariables(current => {
      let changed = false;
      const next = { ...current };
      variables.forEach(variable => {
        if (!Object.prototype.hasOwnProperty.call(next, variable.key)) {
          next[variable.key] = defaultValueForVariable(variable);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [project.variables]);

  useEffect(() => {
    if (!project.sourceText) return;
    const patchedNodes = ensureChoiceFallback(project.nodes, project.sourceText);
    if (patchedNodes !== project.nodes) {
      setProject(p => ({ ...p, nodes: patchedNodes }));
    }
  }, [project.sourceText, project.nodes]);

  useEffect(() => {
    const patchedProject = ensureProjectAudioBindings(project);
    if (patchedProject !== project) {
      setProject(patchedProject);
    }
  }, [project]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (timelineIntervalRef.current) clearInterval(timelineIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    const node = project.nodes.find(item => item.id === activeNodeId);
    const timedActions = buildTimedActions(node?.actions || [], id => project.assets.find(asset => asset.id === id));
    const timedAction = timedActions.find(item => item.index === activeActionIdx);
    if (!timedAction) {
      setPlayheadTime(0);
      return;
    }
    if (isPlaying && (project.timelineMode || 'script') === 'timeline') return;
    setPlayheadTime(timedAction.startTime);
  }, [activeNodeId, activeActionIdx, isPlaying, project.assets, project.nodes, project.timelineMode]);

  useEffect(() => {
    if (timelineIntervalRef.current) {
      clearInterval(timelineIntervalRef.current);
      timelineIntervalRef.current = null;
    }

    if (!isPlaying || (project.timelineMode || 'script') !== 'timeline') return;

    timelineIntervalRef.current = setInterval(() => {
      const node = project.nodes.find(item => item.id === activeNodeId);
      const timedActions = buildTimedActions(node?.actions || [], id => project.assets.find(asset => asset.id === id));
      if (!node || timedActions.length === 0) return;

      const totalDuration = Math.max(...timedActions.map(item => item.endTime), DEFAULT_ACTION_DURATION);
      const activeTimedAction = timedActions.find(item => item.index === activeActionIdx);
      if (activeTimedAction && (activeTimedAction.action.type === 'choice' || (activeTimedAction.action.choices?.length ?? 0) > 0)) {
        setIsPlaying(false);
        return;
      }

      setPlayheadTime(current => {
        const next = roundSeconds(Math.min(totalDuration, current + 0.1));
        const nextTimedAction = findTimedActionAt(timedActions, next);
        if (nextTimedAction && nextTimedAction.index !== activeActionIdx) {
          setActiveActionIdx(nextTimedAction.index);
          if (nextTimedAction.action.type === 'choice' || (nextTimedAction.action.choices?.length ?? 0) > 0) {
            setIsPlaying(false);
            return nextTimedAction.startTime;
          }
        }
        if (next >= totalDuration) {
          setIsPlaying(false);
          audioRef.current?.pause();
          audioRef.current = null;
        }
        return next;
      });
    }, 100);

    return () => {
      if (timelineIntervalRef.current) {
        clearInterval(timelineIntervalRef.current);
        timelineIntervalRef.current = null;
      }
    };
  }, [activeActionIdx, activeNodeId, isPlaying, project.assets, project.nodes, project.timelineMode]);

  useEffect(() => {
    if (!isPlaying || (project.timelineMode || 'script') !== 'timeline') {
      lastTimelineAudioActionIdRef.current = '';
      return;
    }
    const node = project.nodes.find(item => item.id === activeNodeId);
    const action = node?.actions[activeActionIdx];
    if (!action || lastTimelineAudioActionIdRef.current === action.id) return;
    lastTimelineAudioActionIdRef.current = action.id;
    audioRef.current?.pause();
    audioRef.current = null;
    const src = action.audioPath || project.assets.find(asset => asset.id === action.audioAssetId)?.url;
    if (!src) return;
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.play().catch(error => console.warn('audio playback failed', error));
  }, [activeActionIdx, activeNodeId, isPlaying, project.assets, project.nodes, project.timelineMode]);

  useEffect(() => {
    let cancelled = false;

    const loadLibraryAssets = async () => {
      try {
        const res = await fetch('/api/v1/user-assets?project_id=asset_lab_default', { cache: 'no-store' });
        const json = await res.json();
        const records = json?.data?.records || json?.records || [];
        if (!cancelled && Array.isArray(records)) {
          setLibraryAssets(records);
        }
      } catch (error) {
        console.warn('asset library sync failed', error);
      }
    };

    loadLibraryAssets();
    const timer = setInterval(loadLibraryAssets, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!project.requestId) return;
    let timer: any;
    const poll = async () => {
       try {
           const res = await fetch(`/api/v1/image-tasks/${project.requestId}/results`);
           if (!res.ok) return;
           const json = await res.json();
           const records = json?.data?.records || json?.records || json?.results || [];
           if (Array.isArray(records)) {
              setProject(p => applyImageRecords(p, records));
           }
       } catch (e) {
           console.warn('image result polling failed', e);
       }
    };
    poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [project.requestId]);

  useEffect(() => {
    if (!project.requestId) return;

    const checkAudioAsset = async (asset: VNAsset) => {
      if (!asset.url) return;
      try {
        const res = await fetch(asset.url, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) {
           const durationSeconds = await readAudioDuration(asset.url);
           setProject(p => {
              const assets = p.assets.map(item => item.id === asset.id ? {
                ...item,
                status: 'ready' as const,
                metadata: durationSeconds ? { ...(item.metadata || {}), durationSeconds } : item.metadata
              } : item);
              const readyImages = assets.filter(item => item.type !== 'audio' && item.status === 'ready').length;
              const readyVoices = assets.filter(item => item.type === 'audio' && item.status === 'ready').length;
              return {
                ...p,
                assets,
                generationStatus: p.imageTaskCount && readyImages >= p.imageTaskCount && readyVoices >= (p.voiceTaskCount || 0) ? 'done' : p.generationStatus
              };
           });
        }
      } catch (e) {
        console.warn('audio probing failed', e);
      }
    };

    const probeAll = () => {
      project.assets
        .filter(asset => asset.type === 'audio' && asset.status !== 'ready')
        .forEach(checkAudioAsset);
    };

    probeAll();
    const t = setInterval(probeAll, 5000);
    return () => clearInterval(t);
  }, [project.requestId, project.assets]);

  const handleGenerate = async () => {
      const sourceText = promptInput.trim();
      if (!sourceText) return;
      setIsGenerating(true);
      try {
          const projectId = createProjectId();
          const res = await fetch('/api/v1/transmute/visual-novel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: projectId, text: sourceText })
          });
          const json = await res.json();
          if (!res.ok || json.code !== 0) {
            throw new Error(json.message || 'visual novel generation failed');
          }

          const payload = json.data || {};
          const requestId = payload.requestId || `task_${Date.now()}`;
          const script = payload.script || {};
          const imageTaskCount = Number(payload.imageTaskCount || 0);
          const voiceTaskCount = Number(payload.voiceTaskCount || 0);
          const nextProject = payload.project
            ? normalizeProjectState({
              ...payload.project,
              requestId,
              script,
              sourceText,
              imageTaskCount,
              voiceTaskCount,
              generationStatus: imageTaskCount || voiceTaskCount ? 'generating_assets' : 'script_ready'
            })
            : scriptToProjectState(
              script,
              requestId,
              payload.projectId || script.project_id || projectId,
              imageTaskCount,
              voiceTaskCount,
              sourceText
            );

          setProject(nextProject);
          setActiveNodeId(nextProject.entrySceneId || nextProject.nodes[0]?.id || null);
          setActiveActionIdx(0);
          setPromptInput('');
      } catch (err) {
          console.error(err);
          const demoguid = `demo_${Date.now()}`;
          setProject(p => ({
            ...p,
            requestId: demoguid,
            generationStatus: 'failed',
            error: err instanceof Error ? err.message : 'Generate failed',
            entrySceneId: p.entrySceneId || demoguid,
            nodes: [...p.nodes, { 
              id: demoguid, 
              title: 'Demo Scene', 
              type: 'normal',
              status: 'done', 
              actions: [{ id: 'a1', type: 'dialogue', speaker: 'Sys', text: 'Generated line fallback from prompt: ' + sourceText, startTime: 0, duration: DEFAULT_ACTION_DURATION, layout: { x: 0, y: 0, scale: 1 } }] 
            }]
          }));
          setActiveNodeId(demoguid);
          setActiveActionIdx(0);
          setPromptInput('');
      } finally {
          setIsGenerating(false);
      }
  };

  if (!selectedGuide) {
    return (
      <div className="h-screen w-full bg-black flex flex-col items-center justify-center font-sans text-white select-none">
        <button
          type="button"
          onClick={toggleLocale}
          className="absolute right-6 top-6 flex h-8 items-center gap-2 rounded-full border border-white/20 px-3 text-xs font-medium text-white/70 hover:bg-white/5 hover:text-white"
          aria-label={t('languageToggle')}
        >
          <Languages className="h-3.5 w-3.5" />
          {locale === 'zh-CN' ? '中' : 'EN'}
        </button>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-3xl font-medium tracking-tight mb-3 text-[#E1E0CC]">{t('selectGuide')}</h1>
          <p className="text-white/40 text-sm">{t('chooseGuide')}</p>
        </motion.div>
        
        <div className="flex items-center gap-6 max-w-4xl w-full px-6 overflow-x-auto justify-center">
          {GUIDES.map((g, i) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => setSelectedGuide(g.id)}
              className="w-64 h-80 shrink-0 border border-white/10 rounded-2xl bg-black hover:border-white/30 cursor-pointer overflow-hidden relative group transition-all"
            >
              <div 
                className="absolute inset-0 bg-black opacity-50 grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
                style={{ 
                  backgroundImage: `url(${g.cardImage})`,
                  backgroundSize: g.bgSize || 'cover',
                  backgroundPosition: g.bgPosition || 'top',
                  backgroundRepeat: 'no-repeat'
                }}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-6 pt-20">
                <h3 className="font-medium text-lg text-[#E1E0CC]">{g.name}</h3>
                <p className="text-xs text-white/50">{g.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  const guideAsset = GUIDES.find(g => g.id === selectedGuide);
  const sceneLinks = deriveSceneLinks(project.nodes);
  const incomingSceneIds = new Set(sceneLinks.map(link => link.toSceneId));
  const outgoingLinksBySceneId = sceneLinks.reduce((map, link) => {
    const links = map.get(link.fromSceneId) || [];
    links.push(link);
    map.set(link.fromSceneId, links);
    return map;
  }, new Map<string, VNSceneLink[]>());
  const incomingLinksBySceneId = sceneLinks.reduce((map, link) => {
    const links = map.get(link.toSceneId) || [];
    links.push(link);
    map.set(link.toSceneId, links);
    return map;
  }, new Map<string, VNSceneLink[]>());
  const sceneGraphPositions = normalizeSceneGraphPositions(project.metadata?.sceneMapPositions);
  const sceneGraphLayout = buildSceneGraphLayout(project.nodes, sceneLinks, project.entrySceneId, sceneGraphPositions);
  const selectedSceneLink = sceneLinks.find(link => link.id === selectedSceneLinkId);
  const sceneById = (id?: string) => id ? project.nodes.find(node => node.id === id) : undefined;
  const activeNode = project.nodes.find(n => n.id === activeNodeId);
  const currentAction = activeNode?.actions[activeActionIdx];
  const activeChoiceBranches = choiceBranchesForScene(activeNode);
  const assetById = (id?: string) => id ? project.assets.find(asset => asset.id === id) : undefined;
  const layoutSourceActions = activeNode?.actions.filter((action, index) => index !== activeActionIdx && action.layout) || [];
  const defaultLayoutSourceAction = activeNode?.actions[activeActionIdx - 1]
    || activeNode?.actions.find((_, index) => index !== activeActionIdx);
  const selectedLayoutSourceId = layoutSourceActionId || defaultLayoutSourceAction?.id || '';
  const selectedLayoutSourceAction = activeNode?.actions.find(action => action.id === selectedLayoutSourceId);
  const timelineMode = project.timelineMode || 'script';
  const timedActions = buildTimedActions(activeNode?.actions || [], assetById);
  const timelineTotalDuration = timedActions.length
    ? Math.max(...timedActions.map(item => item.endTime), DEFAULT_ACTION_DURATION)
    : DEFAULT_ACTION_DURATION;
  const timelinePixelsPerSecond = TIMELINE_PX_PER_SECOND * timelineZoom;
  const timelineCanvasWidth = Math.max(920, Math.ceil(timelineTotalDuration * timelinePixelsPerSecond) + 160);
  const timelineMajorStep = timelineZoom >= 1.6 ? 1 : timelineZoom >= 0.85 ? 2 : 5;
  const timelineRulerTicks = Array.from(
    { length: Math.max(2, Math.ceil(timelineTotalDuration / timelineMajorStep) + 2) },
    (_, index) => roundSeconds(index * timelineMajorStep)
  ).filter(time => time <= timelineTotalDuration + timelineMajorStep);
  const activeTimedAction = timedActions.find(item => item.index === activeActionIdx);

  const setTimelineModeValue = (mode: VNTimelineMode) => {
    setProject(p => ({ ...p, timelineMode: mode }));
  };

  const snapTimelineSeconds = (value: number, ignoreActionIndex?: number) => {
    const clamped = Math.max(0, value);
    if (!timelineSnap) return roundSeconds(clamped);

    const gridSnapped = Math.round(clamped * 4) / 4;
    const snapThreshold = Math.max(0.08, 12 / timelinePixelsPerSecond);
    const boundaryPoints = timedActions
      .filter(item => item.index !== ignoreActionIndex)
      .flatMap(item => [item.startTime, item.endTime]);
    const closestBoundary = boundaryPoints.reduce<{ point: number; distance: number } | undefined>((closest, point) => {
      const distance = Math.abs(point - clamped);
      if (!closest || distance < closest.distance) return { point, distance };
      return closest;
    }, undefined);

    if (closestBoundary && closestBoundary.distance <= snapThreshold) {
      return roundSeconds(closestBoundary.point);
    }
    return roundSeconds(gridSnapped);
  };

  const seekTimeline = (time: number) => {
    const clamped = Math.max(0, Math.min(timelineTotalDuration, roundSeconds(time)));
    setPlayheadTime(clamped);
    const timedAction = findTimedActionAt(timedActions, clamped);
    if (timedAction && timedAction.index !== activeActionIdx) {
      setActiveActionIdx(timedAction.index);
    }
  };

  const beginPlayheadDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsPlaying(false);
    stopAudio();

    const originX = event.clientX;
    const originTime = playheadTime;

    const onPointerMove = (moveEvent: PointerEvent) => {
      seekTimeline(originTime + (moveEvent.clientX - originX) / timelinePixelsPerSecond);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const updateActionTiming = (actionIndex: number, updates: Pick<VNAction, 'startTime' | 'duration'>) => {
    if (!activeNodeId) return;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => {
        if (node.id !== activeNodeId) return node;
        return {
          ...node,
          actions: node.actions.map((action, index) => index === actionIndex ? {
            ...action,
            startTime: updates.startTime,
            duration: updates.duration
          } : action)
        };
      })
    }));
  };

  const beginTimelineClipDrag = (event: React.PointerEvent, clip: TimelineClip, mode: TimelineDragMode) => {
    event.preventDefault();
    event.stopPropagation();
    if (clip.isEmpty) return;

    beginProjectTransaction();
    const originX = event.clientX;
    const originalStart = clip.startTime;
    const originalDuration = clip.duration;
    const originalEnd = clip.endTime;
    setActiveActionIdx(clip.index);
    setPlayheadTime(clip.startTime);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaSeconds = (moveEvent.clientX - originX) / timelinePixelsPerSecond;
      let startTime = originalStart;
      let duration = originalDuration;

      if (mode === 'move') {
        startTime = snapTimelineSeconds(originalStart + deltaSeconds, clip.index);
      } else if (mode === 'trimStart') {
        startTime = Math.min(
          originalEnd - MIN_ACTION_DURATION,
          snapTimelineSeconds(originalStart + deltaSeconds, clip.index)
        );
        duration = Math.max(MIN_ACTION_DURATION, roundSeconds(originalEnd - startTime));
      } else {
        const nextEnd = Math.max(originalStart + MIN_ACTION_DURATION, snapTimelineSeconds(originalEnd + deltaSeconds, clip.index));
        duration = Math.max(MIN_ACTION_DURATION, roundSeconds(nextEnd - originalStart));
      }

      updateActionTiming(clip.index, { startTime, duration });
      setPlayheadTime(startTime);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      commitProjectTransaction();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const updateNode = (nodeId: string, updates: Partial<VNNode>) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => node.id === nodeId ? { ...node, ...updates } : node)
    }));
  };

  const setEntryScene = (nodeId: string) => {
    setProject(p => ({ ...p, entrySceneId: nodeId }));
  };

  const selectSceneFromMap = (nodeId: string) => {
    setSelectedSceneLinkId('');
    setActiveNodeId(nodeId);
    setActiveActionIdx(0);
  };

  const clampSceneMapFrame = (x: number, y: number, width = sceneMapSize.width, height = sceneMapSize.height) => {
    if (typeof window === 'undefined') return { x, y };
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - Math.min(width, window.innerWidth - margin * 2) - margin);
    const maxY = Math.max(margin, window.innerHeight - Math.min(height, window.innerHeight - margin * 2) - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY)
    };
  };

  const normalizeSceneMapZoom = (value: number) => (
    Math.min(SCENE_MAP_MAX_ZOOM, Math.max(SCENE_MAP_MIN_ZOOM, Math.round(value * 100) / 100))
  );

  const showSceneMapScrollbars = () => {
    if (sceneMapScrollbarTimerRef.current) {
      clearTimeout(sceneMapScrollbarTimerRef.current);
      sceneMapScrollbarTimerRef.current = null;
    }
    setSceneMapScrollbarsVisible(true);
  };

  const hideSceneMapScrollbars = () => {
    if (sceneMapScrollbarTimerRef.current || sceneMapPanning) return;
    setSceneMapScrollbarsVisible(false);
  };

  const revealSceneMapScrollbars = () => {
    setSceneMapScrollbarsVisible(true);
    if (sceneMapScrollbarTimerRef.current) {
      clearTimeout(sceneMapScrollbarTimerRef.current);
    }
    sceneMapScrollbarTimerRef.current = setTimeout(() => {
      setSceneMapScrollbarsVisible(false);
      sceneMapScrollbarTimerRef.current = null;
    }, 900);
  };

  const handleSceneMapScrollbarHover = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const rect = viewport.getBoundingClientRect();
    const railSize = 18;
    const hasVerticalScrollbar = viewport.scrollHeight > viewport.clientHeight + 1;
    const hasHorizontalScrollbar = viewport.scrollWidth > viewport.clientWidth + 1;
    const overVerticalRail = hasVerticalScrollbar
      && event.clientX >= rect.right - railSize
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    const overHorizontalRail = hasHorizontalScrollbar
      && event.clientY >= rect.bottom - railSize
      && event.clientY <= rect.bottom
      && event.clientX >= rect.left
      && event.clientX <= rect.right;

    if (overVerticalRail || overHorizontalRail) {
      showSceneMapScrollbars();
      return;
    }
    hideSceneMapScrollbars();
  };

  const updateSceneMapZoom = (
    nextZoomValue: number,
    viewport = sceneMapViewportRef.current,
    anchor?: { clientX: number; clientY: number }
  ) => {
    setSceneMapZoom(previousZoom => {
      const nextZoom = normalizeSceneMapZoom(nextZoomValue);
      if (nextZoom === previousZoom) return previousZoom;

      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const anchorX = anchor ? anchor.clientX - rect.left : viewport.clientWidth / 2;
        const anchorY = anchor ? anchor.clientY - rect.top : viewport.clientHeight / 2;
        const graphX = (viewport.scrollLeft + anchorX) / previousZoom;
        const graphY = (viewport.scrollTop + anchorY) / previousZoom;
        requestAnimationFrame(() => {
          viewport.scrollLeft = graphX * nextZoom - anchorX;
          viewport.scrollTop = graphY * nextZoom - anchorY;
        });
      }

      return nextZoom;
    });
    revealSceneMapScrollbars();
  };

  const handleSceneMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-scene-map-zoom-control="true"]')) return;
    const viewport = sceneMapViewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    updateSceneMapZoom(
      sceneMapZoom + (event.deltaY > 0 ? -SCENE_MAP_ZOOM_STEP : SCENE_MAP_ZOOM_STEP),
      viewport,
      { clientX: event.clientX, clientY: event.clientY }
    );
  };

  const openSceneMapWindow = () => {
    setSceneMapPosition(position => clampSceneMapFrame(position.x, position.y));
    setSceneMapOpen(true);
    setRightSidebarOpen(true);
    setInspectorTab('branch');
  };

  const beginSceneMapWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-scene-map-window-control="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    sceneMapInteractionGuardRef.current = true;
    const originX = event.clientX;
    const originY = event.clientY;
    const originPosition = sceneMapPosition;

    const onPointerMove = (moveEvent: PointerEvent) => {
      setSceneMapPosition(clampSceneMapFrame(
        originPosition.x + moveEvent.clientX - originX,
        originPosition.y + moveEvent.clientY - originY
      ));
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneMapResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    sceneMapInteractionGuardRef.current = true;
    const originX = event.clientX;
    const originY = event.clientY;
    const originSize = sceneMapSize;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextSize = {
        width: Math.min(Math.max(520, originSize.width + moveEvent.clientX - originX), Math.max(520, window.innerWidth - 16)),
        height: Math.min(Math.max(360, originSize.height + moveEvent.clientY - originY), Math.max(360, window.innerHeight - 16))
      };
      setSceneMapSize(nextSize);
      setSceneMapPosition(position => clampSceneMapFrame(position.x, position.y, nextSize.width, nextSize.height));
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const updateSceneGraphNodePosition = (nodeId: string, x: number, y: number) => {
    setProject(p => {
      const sceneMapPositions = normalizeSceneGraphPositions(p.metadata?.sceneMapPositions);
      return {
        ...p,
        metadata: {
          ...(p.metadata || {}),
          sceneMapPositions: {
            ...sceneMapPositions,
            [nodeId]: {
              x: Math.max(8, roundSeconds(x)),
              y: Math.max(8, roundSeconds(y))
            }
          }
        }
      };
    });
  };

  const sceneGraphPointFromClient = (viewport: HTMLElement, clientX: number, clientY: number) => {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewport.scrollLeft) / sceneMapZoom,
      y: (clientY - rect.top + viewport.scrollTop) / sceneMapZoom
    };
  };

  const connectSceneNodeToTarget = (node: VNNode, targetSceneId: string): VNNode => {
    const alreadyLinked = node.defaultNextSceneId === targetSceneId
      || node.actions.some(action => action.targetSceneId === targetSceneId || action.choices?.some(choice => choice.targetSceneId === targetSceneId));
    if (alreadyLinked) return node;
    if (!node.defaultNextSceneId) {
      return { ...node, defaultNextSceneId: targetSceneId };
    }

    const choiceActionIndex = node.actions.findIndex(action => action.type === 'choice' || (action.choices?.length || 0) > 0);
    const nextChoiceLabel = (choices: VNChoice[] | undefined) => `Option ${(choices?.length || 0) + 1}`;
    if (choiceActionIndex >= 0) {
      return {
        ...node,
        actions: node.actions.map((action, index) => {
          if (index !== choiceActionIndex) return action;
          const choices = action.choices || [];
          const unboundIndex = choices.findIndex(choice => !choice.targetSceneId);
          return {
            ...action,
            type: 'choice',
            choices: unboundIndex >= 0
              ? choices.map((choice, choiceIndex) => choiceIndex === unboundIndex ? { ...choice, targetSceneId } : choice)
              : [...choices, { id: createChoiceId(), label: nextChoiceLabel(choices), targetSceneId }]
          };
        })
      };
    }

    if (!node.actions.length) {
      return {
        ...node,
        actions: [{
          id: `action_${Date.now()}`,
          type: 'choice',
          speaker: guideAsset?.name || 'Narrator',
          text: '',
          choices: [{ id: createChoiceId(), label: 'Option 1', targetSceneId }],
          startTime: 0,
          duration: DEFAULT_ACTION_DURATION,
          layout: { x: 0, y: 0, scale: 1 }
        }]
      };
    }

    const lastActionIndex = node.actions.length - 1;
    return {
      ...node,
      actions: node.actions.map((action, index) => index === lastActionIndex ? {
        ...action,
        type: 'choice',
        choices: [...(action.choices || []), { id: createChoiceId(), label: nextChoiceLabel(action.choices), targetSceneId }]
      } : action)
    };
  };

  const connectSceneByPort = (fromSceneId: string, targetSceneId: string) => {
    if (!fromSceneId || !targetSceneId || fromSceneId === targetSceneId) return;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => node.id === fromSceneId ? connectSceneNodeToTarget(node, targetSceneId) : node)
    }));
    setActiveNodeId(fromSceneId);
    setSelectedSceneLinkId('');
  };

  const createSceneFromPort = (fromSceneId: string, position: { x: number; y: number }) => {
    const now = Date.now();
    const sceneId = createSceneId();
    const node: VNNode = {
      id: sceneId,
      title: `Scene ${project.nodes.length + 1}`,
      type: 'normal',
      status: 'done',
      tags: [],
      position: normalizePosition(undefined, project.nodes.length),
      actions: [{
        id: `action_${now}`,
        type: 'dialogue',
        speaker: guideAsset?.name || 'Narrator',
        text: '',
        startTime: 0,
        duration: DEFAULT_ACTION_DURATION,
        layout: { x: 0, y: 0, scale: 1 }
      }]
    };
    const nodePosition = {
      x: Math.max(8, position.x - SCENE_GRAPH_CARD_WIDTH / 2),
      y: Math.max(8, position.y - SCENE_GRAPH_CARD_HEIGHT / 2)
    };

    setProject(p => {
      const sceneMapPositions = normalizeSceneGraphPositions(p.metadata?.sceneMapPositions);
      return {
        ...p,
        entrySceneId: p.entrySceneId || node.id,
        nodes: [
          ...p.nodes.map(scene => scene.id === fromSceneId ? connectSceneNodeToTarget(scene, node.id) : scene),
          node
        ],
        metadata: {
          ...(p.metadata || {}),
          sceneMapPositions: {
            ...sceneMapPositions,
            [node.id]: nodePosition
          }
        }
      };
    });
    setActiveNodeId(node.id);
    setActiveActionIdx(0);
    setSelectedSceneLinkId('');
  };

  const unlinkSceneGraphLink = (link: VNSceneLink) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => {
        if (node.id !== link.fromSceneId) return node;
        if (sceneGraphLinkKind(link) === 'default') {
          return { ...node, defaultNextSceneId: undefined };
        }
        return {
          ...node,
          actions: node.actions.map(action => {
            if (action.id !== link.fromActionId) return action;
            if (sceneGraphLinkKind(link) === 'jump') {
              return { ...action, targetSceneId: undefined, targetActionId: undefined };
            }
            return {
              ...action,
              choices: action.choices?.map(choice => choice.id === link.fromChoiceId ? {
                ...choice,
                targetSceneId: undefined,
                targetActionId: undefined
              } : choice)
            };
          })
        };
      })
    }));
    setSelectedSceneLinkId('');
  };

  const clearSceneOutgoingLinks = (nodeId: string) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => node.id === nodeId ? {
        ...node,
        defaultNextSceneId: undefined,
        actions: node.actions.map(action => ({
          ...action,
          targetSceneId: undefined,
          targetActionId: undefined,
          choices: action.choices?.map(choice => ({
            ...choice,
            targetSceneId: undefined,
            targetActionId: undefined
          }))
        }))
      } : node)
    }));
    setSelectedSceneLinkId('');
  };

  const clearSceneIncomingLinks = (nodeId: string) => {
    if (!(incomingLinksBySceneId.get(nodeId) || []).length) return;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => ({
        ...node,
        defaultNextSceneId: node.defaultNextSceneId === nodeId ? undefined : node.defaultNextSceneId,
        actions: node.actions.map(action => ({
          ...action,
          targetSceneId: action.targetSceneId === nodeId ? undefined : action.targetSceneId,
          targetActionId: action.targetSceneId === nodeId ? undefined : action.targetActionId,
          choices: action.choices?.map(choice => choice.targetSceneId === nodeId ? {
            ...choice,
            targetSceneId: undefined,
            targetActionId: undefined
          } : choice)
        }))
      }))
    }));
    setSelectedSceneLinkId('');
  };

  const beginSceneGraphInputPortDrag = (event: React.PointerEvent, nodeId: string) => {
    if (event.button !== 0) return;
    const viewport = event.currentTarget.closest('[data-scene-graph-viewport="true"]') as HTMLElement | null;
    event.preventDefault();
    event.stopPropagation();
    const incomingLinks = incomingLinksBySceneId.get(nodeId) || [];
    const link = selectedSceneLink?.toSceneId === nodeId ? selectedSceneLink : incomingLinks[incomingLinks.length - 1];
    if (!viewport || !link) {
      selectSceneFromMap(nodeId);
      return;
    }
    const sourceLayout = sceneGraphLayout.nodeById.get(link.fromSceneId);
    if (!sourceLayout) {
      focusSceneGraphLink(link);
      return;
    }

    sceneMapInteractionGuardRef.current = true;
    const pointerStart = sceneGraphPointFromClient(viewport, event.clientX, event.clientY);
    setSelectedSceneLinkId(link.id);
    setSceneMapDraftLink({ fromSceneId: link.fromSceneId, ...pointerStart });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const point = sceneGraphPointFromClient(viewport, moveEvent.clientX, moveEvent.clientY);
      setSceneMapDraftLink({ fromSceneId: link.fromSceneId, ...point });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const point = sceneGraphPointFromClient(viewport, upEvent.clientX, upEvent.clientY);
      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-scene-input-port]') as HTMLElement | null;
      const targetSceneId = dropTarget?.dataset.sceneInputPort;
      const movedDistance = Math.hypot(point.x - pointerStart.x, point.y - pointerStart.y);

      setSceneMapDraftLink(null);
      if (targetSceneId && targetSceneId !== link.fromSceneId) {
        updateSceneLinkTarget(link, targetSceneId);
      } else if (movedDistance > 24) {
        unlinkSceneGraphLink(link);
      } else {
        focusSceneGraphLink(link);
      }
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphPortDrag = (event: React.PointerEvent, nodeId: string, layout: SceneGraphNodeLayout) => {
    if (event.button !== 0) return;
    const viewport = event.currentTarget.closest('[data-scene-graph-viewport="true"]') as HTMLElement | null;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    sceneMapInteractionGuardRef.current = true;
    const startPoint = {
      x: layout.x + SCENE_GRAPH_CARD_WIDTH,
      y: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2
    };
    setSceneMapDraftLink({ fromSceneId: nodeId, ...startPoint });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const point = sceneGraphPointFromClient(viewport, moveEvent.clientX, moveEvent.clientY);
      setSceneMapDraftLink({ fromSceneId: nodeId, ...point });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const point = sceneGraphPointFromClient(viewport, upEvent.clientX, upEvent.clientY);
      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-scene-input-port]') as HTMLElement | null;
      const targetSceneId = dropTarget?.dataset.sceneInputPort;
      const movedDistance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);

      setSceneMapDraftLink(null);
      if (targetSceneId && targetSceneId !== nodeId) {
        connectSceneByPort(nodeId, targetSceneId);
      } else if (movedDistance > 24) {
        createSceneFromPort(nodeId, point);
      }
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-scene-graph-interactive="true"]')) return;
    const viewport = event.currentTarget;
    event.preventDefault();
    sceneMapInteractionGuardRef.current = true;
    revealSceneMapScrollbars();
    setSceneMapPanning(true);
    const originX = event.clientX;
    const originY = event.clientY;
    const originScrollLeft = viewport.scrollLeft;
    const originScrollTop = viewport.scrollTop;

    const onPointerMove = (moveEvent: PointerEvent) => {
      viewport.scrollLeft = originScrollLeft - (moveEvent.clientX - originX);
      viewport.scrollTop = originScrollTop - (moveEvent.clientY - originY);
      revealSceneMapScrollbars();
    };

    const onPointerUp = () => {
      setSceneMapPanning(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphNodeDrag = (event: React.PointerEvent, nodeId: string, layout: SceneGraphNodeLayout) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    beginProjectTransaction();
    sceneMapInteractionGuardRef.current = true;
    const originX = event.clientX;
    const originY = event.clientY;
    const originLeft = layout.x;
    const originTop = layout.y;

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateSceneGraphNodePosition(
        nodeId,
        originLeft + (moveEvent.clientX - originX) / sceneMapZoom,
        originTop + (moveEvent.clientY - originY) / sceneMapZoom
      );
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      commitProjectTransaction();
      window.setTimeout(() => {
        sceneMapInteractionGuardRef.current = false;
      }, 120);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const focusSceneGraphLink = (link: VNSceneLink) => {
    setSelectedSceneLinkId(link.id);
    setActiveNodeId(link.fromSceneId);
    const sourceScene = sceneById(link.fromSceneId);
    const actionIndex = link.fromActionId
      ? sourceScene?.actions.findIndex(action => action.id === link.fromActionId) ?? -1
      : -1;
    setActiveActionIdx(Math.max(0, actionIndex));
    setRightSidebarOpen(true);
    setInspectorTab('branch');
  };

  const updateSceneLinkTarget = (link: VNSceneLink, targetSceneId: string) => {
    const nextTargetSceneId = targetSceneId || undefined;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => {
        if (node.id !== link.fromSceneId) return node;
        if (sceneGraphLinkKind(link) === 'default') {
          return { ...node, defaultNextSceneId: nextTargetSceneId };
        }
        return {
          ...node,
          actions: node.actions.map(action => {
            if (action.id !== link.fromActionId) return action;
            if (sceneGraphLinkKind(link) === 'jump') {
              return {
                ...action,
                targetSceneId: nextTargetSceneId,
                targetActionId: nextTargetSceneId === action.targetSceneId ? action.targetActionId : undefined
              };
            }
            return {
              ...action,
              choices: (action.choices || []).map(choice => choice.id === link.fromChoiceId ? {
                ...choice,
                targetSceneId: nextTargetSceneId,
                targetActionId: nextTargetSceneId === choice.targetSceneId ? choice.targetActionId : undefined
              } : choice)
            };
          })
        };
      })
    }));
    if (!nextTargetSceneId) {
      setSelectedSceneLinkId('');
    }
  };

  const updateChoiceBranchTarget = (branch: ChoiceBranchRow, targetSceneId: string) => {
    const nextTargetSceneId = targetSceneId || undefined;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => node.id === branch.nodeId ? {
        ...node,
        actions: node.actions.map(action => action.id === branch.actionId ? {
          ...action,
          choices: (action.choices || []).map(choice => choice.id === branch.choice.id ? {
            ...choice,
            targetSceneId: nextTargetSceneId,
            targetActionId: nextTargetSceneId === choice.targetSceneId ? choice.targetActionId : undefined
          } : choice)
        } : action)
      } : node)
    }));
  };

  const updateAction = (updates: Partial<VNAction>) => {
      if (!activeNodeId || !currentAction) return;
      setProject(p => ({
          ...p,
          nodes: p.nodes.map(n => {
             if (n.id !== activeNodeId) return n;
             return {
                 ...n,
                 actions: n.actions.map((a, i) => i === activeActionIdx ? { ...a, ...updates } : a)
             };
          })
      }));
  };

  const createEmptyScene = (options: {
    fromSceneId?: string;
    defaultNext?: boolean;
    choiceTarget?: { actionId: string; choiceId?: string; choiceIndex: number };
  } = {}) => {
    const now = Date.now();
    const sceneId = createSceneId();
    const node: VNNode = {
      id: sceneId,
      title: `Scene ${project.nodes.length + 1}`,
      type: 'normal',
      status: 'done',
      tags: [],
      position: normalizePosition(undefined, project.nodes.length),
      actions: [{
        id: `action_${now}`,
        type: 'dialogue',
        speaker: guideAsset?.name || 'Narrator',
        text: '',
        startTime: 0,
        duration: DEFAULT_ACTION_DURATION,
        layout: { x: 0, y: 0, scale: 1 }
      }]
    };
    setProject(p => ({
      ...p,
      entrySceneId: p.entrySceneId || node.id,
      nodes: [...p.nodes.map(scene => {
        if (options.fromSceneId && scene.id === options.fromSceneId && options.defaultNext) {
          return { ...scene, defaultNextSceneId: node.id };
        }
        if (options.fromSceneId && scene.id === options.fromSceneId && options.choiceTarget) {
          return {
            ...scene,
            actions: scene.actions.map(action => {
              if (action.id !== options.choiceTarget?.actionId) return action;
              return {
                ...action,
                choices: (action.choices || []).map((choice, index) => {
                  const matches = options.choiceTarget?.choiceId
                    ? choice.id === options.choiceTarget.choiceId
                    : index === options.choiceTarget?.choiceIndex;
                  return matches ? { ...choice, targetSceneId: node.id } : choice;
                })
              };
            })
          };
        }
        return scene;
      }), node]
    }));
    setActiveNodeId(node.id);
    setActiveActionIdx(0);
    setInspectorTab('content');
  };

  const deleteScene = (nodeId: string) => {
    const affectedLinks = sceneLinks.filter(link => link.fromSceneId === nodeId || link.toSceneId === nodeId);
    const sceneTitle = sceneById(nodeId)?.title || nodeId;
    if (affectedLinks.length > 0) {
      const confirmed = window.confirm(`Delete "${sceneTitle}"? This will remove or clear ${affectedLinks.length} scene link(s).`);
      if (!confirmed) return;
    }

    const remainingNodes = project.nodes.filter(node => node.id !== nodeId);
    const nextActiveNodeId = activeNodeId === nodeId
      ? (project.entrySceneId && project.entrySceneId !== nodeId ? project.entrySceneId : remainingNodes[0]?.id || null)
      : activeNodeId;

    setProject(p => {
      const nodes = p.nodes
        .filter(node => node.id !== nodeId)
        .map(node => ({
          ...node,
          defaultNextSceneId: node.defaultNextSceneId === nodeId ? undefined : node.defaultNextSceneId,
          actions: node.actions.map(action => ({
            ...action,
            targetSceneId: action.targetSceneId === nodeId ? undefined : action.targetSceneId,
            choices: action.choices?.map(choice => choice.targetSceneId === nodeId ? {
              ...choice,
              targetSceneId: undefined,
              targetActionId: undefined
            } : choice)
          }))
        }));
      const entrySceneId = p.entrySceneId === nodeId ? nodes[0]?.id : p.entrySceneId;
      return { ...p, entrySceneId, nodes };
    });
    setActiveNodeId(nextActiveNodeId);
    setActiveActionIdx(0);
  };

  const bindAsset = (asset: VNAsset) => {
    if (asset.type === 'bg') updateAction({ bgAssetId: asset.id, bgImage: asset.url });
    else if (asset.type === 'char') updateAction({ charAssetId: asset.id, charImage: asset.url });
    else if (asset.type === 'audio') {
      const duration = audioDurationFromAsset(asset);
      updateAction({
        audioAssetId: asset.id,
        audioPath: asset.url,
        ...(duration ? { duration } : {})
      });
    }
  };

  const alignLayoutFromAction = (sourceAction?: VNAction) => {
    if (!sourceAction?.layout || !currentAction) return;
    updateAction({
      layout: {
        x: sourceAction.layout.x,
        y: sourceAction.layout.y,
        scale: sourceAction.layout.scale
      }
    });
  };

  const applyCurrentLayoutToFollowingActions = () => {
    if (!activeNodeId || !currentAction?.layout) return;
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(node => {
        if (node.id !== activeNodeId) return node;
        return {
          ...node,
          actions: node.actions.map((action, index) => index > activeActionIdx ? {
            ...action,
            layout: { ...currentAction.layout! }
          } : action)
        };
      })
    }));
  };

  const activeBgAsset = assetById(currentAction?.bgAssetId);
  const activeCharAsset = assetById(currentAction?.charAssetId);
  const activeBg = currentAction?.bgImage || activeBgAsset?.url;
  const activeChar = currentAction?.charImage || activeCharAsset?.url || guideAsset?.image;
  const hasSceneBackground = Boolean(activeBg);
  const audioAssets = project.assets.filter(asset => asset.type === 'audio');
  const readyImageCount = project.assets.filter(asset => asset.type !== 'audio' && asset.status === 'ready').length;
  const readyVoiceCount = project.assets.filter(asset => asset.type === 'audio' && asset.status === 'ready').length;
  const currentRuntimeScene = sceneById(activeNodeId);
  const variableDefinitions = project.variables || [];
  const projectValidationIssues = validateProject(project);
  const validationErrorCount = projectValidationIssues.filter(issue => issue.severity === 'error').length;
  const validationWarningCount = projectValidationIssues.length - validationErrorCount;

  const buildRuntimeState = (updatedAt = new Date().toISOString()): VNRuntimeState => ({
    currentSceneId: activeNodeId || project.entrySceneId || project.nodes[0]?.id || '',
    currentActionIndex: Math.max(0, activeActionIdx),
    variables: runtimeVariables,
    history: runtimeHistory,
    visitedSceneIds,
    selectedChoiceHistory,
    startedAt: runtimeStartedAt,
    updatedAt
  });

  const makeHistoryEntry = (reason: string): VNRuntimeHistoryEntry | undefined => {
    if (!activeNode || !currentAction) return undefined;
    return {
      id: `history_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sceneId: activeNode.id,
      sceneTitle: activeNode.title,
      actionId: currentAction.id,
      actionIndex: activeActionIdx,
      speaker: currentAction.speaker,
      text: actionText(currentAction),
      reason,
      timestamp: new Date().toISOString()
    };
  };

  const pushRuntimeHistory = (reason: string) => {
    const entry = makeHistoryEntry(reason);
    if (!entry) return;
    setRuntimeHistory(history => [...history, entry].slice(-120));
  };

  const saveRuntimeSlot = (slotId?: string) => {
    const now = new Date().toISOString();
    const runtimeState = buildRuntimeState(now);
    if (!runtimeState.currentSceneId) {
      setWorkspaceNotice(t('noSceneBeforeSave'));
      return;
    }

    setSaveSlots(slots => {
      const existing = slotId ? slots.find(slot => slot.slotId === slotId) : undefined;
      const nextSlot: VNSaveSlot = {
        slotId: existing?.slotId || `slot_${Date.now()}`,
        projectId: projectStorageId,
        projectTitle: project.title,
        name: existing?.name || `${currentRuntimeScene?.title || t('scene')} #${runtimeState.currentActionIndex + 1}`,
        runtimeState,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      const nextSlots = existing
        ? slots.map(slot => slot.slotId === existing.slotId ? nextSlot : slot)
        : [nextSlot, ...slots];
      saveBackendSaveSlot(projectStorageId, nextSlot)
        .then(savedSlot => {
          setSaveSlots(current => mergeSaveSlots([savedSlot], current));
        })
        .catch(() => {
          // The local slot was already written; backend sync can recover later.
        });
      return nextSlots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
    setWorkspaceNotice(slotId ? t('saveOverwritten') : t('progressSaved'));
  };

  const loadRuntimeSlot = (slot: VNSaveSlot) => {
    if (slot.projectId !== projectStorageId) {
      setWorkspaceNotice(t('saveOtherProject'));
      return;
    }
    const scene = sceneById(slot.runtimeState.currentSceneId);
    if (!scene) {
      setWorkspaceNotice(t('saveTargetSceneNotFound', { sceneId: slot.runtimeState.currentSceneId }));
      return;
    }
    const actionIndex = Math.min(
      Math.max(0, slot.runtimeState.currentActionIndex),
      Math.max(0, scene.actions.length - 1)
    );
    stopAudio();
    setActiveNodeId(scene.id);
    setActiveActionIdx(actionIndex);
    setRuntimeVariables(slot.runtimeState.variables || {});
    setRuntimeHistory(slot.runtimeState.history || []);
    setVisitedSceneIds(slot.runtimeState.visitedSceneIds?.length ? slot.runtimeState.visitedSceneIds : [scene.id]);
    setSelectedChoiceHistory(slot.runtimeState.selectedChoiceHistory || []);
    setRuntimeStartedAt(slot.runtimeState.startedAt || new Date().toISOString());
    setIsPlaying(true);
    setSaveLoadOpen(false);
    setPlayheadTime(buildTimedActions(scene.actions, assetById).find(item => item.index === actionIndex)?.startTime || 0);
    if (timelineMode === 'script') playActionAudio(scene.actions[actionIndex]);
    setWorkspaceNotice(t('loadedSave', { name: slot.name }));
  };

  const deleteRuntimeSlot = (slotId: string) => {
    setSaveSlots(slots => slots.filter(slot => slot.slotId !== slotId));
    deleteBackendSaveSlot(projectStorageId, slotId).catch(() => {
      // Deletion is reflected locally even if the backend is temporarily offline.
    });
    setWorkspaceNotice(t('saveDeleted'));
  };

  const updateVariableDefinition = (index: number, updates: Partial<VNVariableDefinition>) => {
    setProject(p => ({
      ...p,
      variables: (p.variables || []).map((variable, variableIndex) => variableIndex === index ? {
        ...variable,
        ...updates
      } : variable)
    }));
  };

  const addVariableDefinition = () => {
    const key = createVariableKey();
    const variable: VNVariableDefinition = {
      key,
      label: t('newFlag'),
      type: 'boolean',
      defaultValue: false,
      scope: 'global'
    };
    setProject(p => ({
      ...p,
      variables: [...(p.variables || []), variable]
    }));
    setRuntimeVariables(values => ({ ...values, [key]: false }));
  };

  const deleteVariableDefinition = (index: number) => {
    const variable = variableDefinitions[index];
    setProject(p => ({
      ...p,
      variables: (p.variables || []).filter((_, variableIndex) => variableIndex !== index)
    }));
    if (variable) {
      setRuntimeVariables(values => {
        const next = { ...values };
        delete next[variable.key];
        return next;
      });
    }
  };

  const updateRuntimeVariable = (key: string, value: unknown) => {
    setRuntimeVariables(values => ({ ...values, [key]: value }));
  };

  const audioForAction = (action?: VNAction) => {
    if (!action) return undefined;
    return action.audioPath || assetById(action.audioAssetId)?.url;
  };

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
  };

  const playActionAudio = (action?: VNAction) => {
    stopAudio();
    const src = audioForAction(action);
    if (!src) return;
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.play().catch(error => console.warn('audio playback failed', error));
  };

  const findActionLocation = (actionId?: string) => {
    if (!actionId) return undefined;
    for (const node of project.nodes) {
      const actionIndex = node.actions.findIndex(action => action.id === actionId || action.sourceActionId === actionId);
      if (actionIndex >= 0) return { node, actionIndex };
    }
    return undefined;
  };

  const goToScene = (sceneId?: string, actionId?: string) => {
    const node = sceneById(sceneId);
    if (!node) {
      setWorkspaceNotice(sceneId ? t('targetSceneNotFound', { sceneId }) : t('noTargetSceneConfigured'));
      return false;
    }
    const actionIndex = actionId
      ? Math.max(0, node.actions.findIndex(action => action.id === actionId || action.sourceActionId === actionId))
      : 0;
    const nextIndex = actionIndex >= 0 ? actionIndex : 0;
    pushRuntimeHistory('scene_jump');
    setActiveNodeId(node.id);
    setActiveActionIdx(nextIndex);
    const nextTimedAction = buildTimedActions(node.actions, assetById).find(item => item.index === nextIndex);
    setPlayheadTime(nextTimedAction?.startTime || 0);
    if (timelineMode === 'script') {
      playActionAudio(node.actions[nextIndex]);
    }
    return true;
  };

  const togglePlaytest = () => {
    if (isPlaying) {
      setIsPlaying(false);
      stopAudio();
      return;
    }
    if (!currentAction || !activeNode) {
      const entryNode = sceneById(project.entrySceneId) || project.nodes[0];
      if (!entryNode) return;
      const now = new Date().toISOString();
      setRuntimeStartedAt(now);
      setRuntimeHistory([]);
      setSelectedChoiceHistory([]);
      setVisitedSceneIds([entryNode.id]);
      setActiveNodeId(entryNode.id);
      setActiveActionIdx(0);
      setPlayheadTime(buildTimedActions(entryNode.actions, assetById)[0]?.startTime || 0);
      setIsPlaying(true);
      if (timelineMode === 'script') playActionAudio(entryNode.actions[0]);
      return;
    }
    const now = new Date().toISOString();
    setRuntimeStartedAt(now);
    setRuntimeHistory([]);
    setSelectedChoiceHistory([]);
    setVisitedSceneIds([activeNode.id]);
    setIsPlaying(true);
    setPlayheadTime(activeTimedAction?.startTime || 0);
    if (timelineMode === 'script') playActionAudio(currentAction);
  };

  const advancePlaytest = () => {
    if (!isPlaying || !activeNode || !currentAction) return;
    if ((currentAction.choices?.length ?? 0) > 0) return;
    if (currentAction.type === 'jump' && currentAction.targetSceneId) {
      goToScene(currentAction.targetSceneId, currentAction.targetActionId);
      return;
    }
    if (activeActionIdx >= activeNode.actions.length - 1) {
      if (activeNode.defaultNextSceneId) {
        goToScene(activeNode.defaultNextSceneId);
        return;
      }
      setIsPlaying(false);
      stopAudio();
      return;
    }
    const nextIndex = activeActionIdx + 1;
    const nextAction = activeNode.actions[nextIndex];
    pushRuntimeHistory('next_action');
    setActiveActionIdx(nextIndex);
    setPlayheadTime(timedActions.find(item => item.index === nextIndex)?.startTime || 0);
    if (timelineMode === 'script') playActionAudio(nextAction);
  };

  const selectChoice = (choice: VNChoice) => {
    if (!isPlaying) return;
    if (!conditionsMet(choice.conditions, runtimeVariables)) {
      setWorkspaceNotice(choice.disabledText || t('choiceLocked', { label: choice.label }));
      return;
    }
    if (activeNode && currentAction) {
      setSelectedChoiceHistory(history => [...history, {
        id: `selected_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sceneId: activeNode.id,
        actionId: currentAction.id,
        choiceId: choice.id,
        label: choice.label,
        targetSceneId: choice.targetSceneId,
        targetActionId: choice.targetActionId,
        selectedAt: new Date().toISOString()
      }].slice(-120));
    }
    setRuntimeVariables(values => applyEffectsToVariables(values, choice.effects, choice.targetSceneId || activeNode?.id));
    const markedSceneIds = (choice.effects || [])
      .filter(effect => effect.type === 'mark_visited')
      .map(effect => effect.sceneId || choice.targetSceneId || activeNode?.id)
      .filter(Boolean) as string[];
    if (markedSceneIds.length) {
      setVisitedSceneIds(ids => Array.from(new Set([...ids, ...markedSceneIds])));
    }
    if (choice.targetSceneId) {
      goToScene(choice.targetSceneId, choice.targetActionId);
      return;
    }
    const actionTarget = findActionLocation(choice.targetActionId || choice.nextId);
    if (actionTarget) {
      goToScene(actionTarget.node.id, actionTarget.node.actions[actionTarget.actionIndex]?.id);
      return;
    }
    setWorkspaceNotice(t('choiceNoTarget', { label: choice.label }));
  };

  const actionText = (action?: VNAction) => {
    if (!action) return '';
    if (action.text) return action.text;
    if (action.choices?.length) return action.choices.map(choice => choice.label).join(' / ');
    return '';
  };

  const audioLabelForAction = (action?: VNAction) => {
    const asset = assetById(action?.audioAssetId);
    if (!asset) return t('noAudio');
    return `${asset.name}${asset.status === 'ready' ? '' : ' · pending'}`;
  };

  const bindAudioById = (assetId: string) => {
    const asset = assetById(assetId);
    const duration = audioDurationFromAsset(asset);
    updateAction({
      audioAssetId: asset?.id || undefined,
      audioPath: asset?.url || undefined,
      ...(duration ? { duration } : {})
    });
  };

  const syncCurrentDurationFromVoice = async () => {
    if (!currentAction) return;
    const asset = assetById(currentAction.audioAssetId);
    const src = audioForAction(currentAction);
    if (!src) {
      setWorkspaceNotice(t('noAudio'));
      return;
    }
    const duration = audioDurationFromAsset(asset) || await readAudioDuration(src);
    if (!duration) {
      setWorkspaceNotice(t('voiceDurationUnavailable'));
      return;
    }
    updateAction({ duration });
    if (asset) {
      setProject(p => ({
        ...p,
        assets: p.assets.map(item => item.id === asset.id ? {
          ...item,
          metadata: { ...(item.metadata || {}), durationSeconds: duration }
        } : item)
      }));
    }
    setWorkspaceNotice(t('voiceDurationSynced', { seconds: duration.toFixed(2) }));
  };

  const updateChoicesFromText = (value: string) => {
    const choices = value
      .split('\n')
      .map(label => label.trim())
      .filter(Boolean)
      .map((label, index) => ({
        ...(currentAction?.choices?.[index] || { id: createChoiceId() }),
        label
      }));
    updateAction({ choices });
  };

  const currentChoicesText = currentAction?.choices?.map(choice => choice.label).join('\n') || '';

  const updateChoiceOption = (choiceIndex: number, updates: Partial<VNChoice>) => {
    if (!currentAction) return;
    updateAction({
      choices: (currentAction.choices || []).map((choice, index) => index === choiceIndex ? {
        ...choice,
        ...updates
      } : choice)
    });
  };

  const updateChoiceCondition = (choiceIndex: number, conditionIndex: number, updates: Partial<VNCondition>) => {
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      conditions: (choice.conditions || []).map((condition, index) => index === conditionIndex ? {
        ...condition,
        ...updates
      } : condition)
    });
  };

  const addChoiceCondition = (choiceIndex: number) => {
    const firstVariable = variableDefinitions[0];
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      conditions: [
        ...(choice.conditions || []),
        {
          id: createConditionId(),
          variableKey: firstVariable?.key || '',
          operator: 'equals',
          value: firstVariable?.type === 'boolean' ? true : defaultValueForVariable(firstVariable || { key: '', label: '', type: 'string', scope: 'global' })
        }
      ]
    });
  };

  const removeChoiceCondition = (choiceIndex: number, conditionIndex: number) => {
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      conditions: (choice.conditions || []).filter((_, index) => index !== conditionIndex)
    });
  };

  const updateChoiceEffect = (choiceIndex: number, effectIndex: number, updates: Partial<VNEffect>) => {
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      effects: (choice.effects || []).map((effect, index) => index === effectIndex ? {
        ...effect,
        ...updates
      } : effect)
    });
  };

  const addChoiceEffect = (choiceIndex: number) => {
    const firstVariable = variableDefinitions[0];
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      effects: [
        ...(choice.effects || []),
        {
          id: createEffectId(),
          type: firstVariable?.type === 'number' ? 'add_var' : 'set_flag',
          variableKey: firstVariable?.key || '',
          value: firstVariable?.type === 'number' ? undefined : true,
          amount: firstVariable?.type === 'number' ? 1 : undefined
        }
      ]
    });
  };

  const removeChoiceEffect = (choiceIndex: number, effectIndex: number) => {
    const choice = currentAction?.choices?.[choiceIndex];
    if (!choice) return;
    updateChoiceOption(choiceIndex, {
      effects: (choice.effects || []).filter((_, index) => index !== effectIndex)
    });
  };

  const addChoiceOption = () => {
    const nextChoices = currentAction?.choices || [];
    updateAction({
      type: 'choice',
      choices: [
        ...nextChoices,
        { id: createChoiceId(), label: `Option ${nextChoices.length + 1}` }
      ]
    });
  };

  const removeChoiceOption = (choiceIndex: number) => {
    if (!currentAction) return;
    updateAction({
      choices: (currentAction.choices || []).filter((_, index) => index !== choiceIndex)
    });
  };

  const createSceneForChoice = (choiceIndex: number) => {
    if (!activeNode || !currentAction) return;
    const choice = currentAction.choices?.[choiceIndex];
    createEmptyScene({
      fromSceneId: activeNode.id,
      choiceTarget: {
        actionId: currentAction.id,
        choiceId: choice?.id,
        choiceIndex
      }
    });
  };

  const createSceneForChoiceBranch = (branch: ChoiceBranchRow) => {
    setActiveNodeId(branch.nodeId);
    setActiveActionIdx(branch.actionIndex);
    createEmptyScene({
      fromSceneId: branch.nodeId,
      choiceTarget: {
        actionId: branch.actionId,
        choiceId: branch.choice.id,
        choiceIndex: branch.choiceIndex
      }
    });
  };

  const addBranchChoiceToScene = (nodeId: string) => {
    const node = sceneById(nodeId);
    if (!node) return;
    const choiceActionIndex = node.actions.findIndex(action => (action.choices?.length || 0) > 0);
    const targetIndex = choiceActionIndex >= 0 ? choiceActionIndex : Math.max(0, node.actions.length - 1);
    const fallbackAction: VNAction = {
      id: `action_${Date.now()}`,
      type: 'choice',
      speaker: guideAsset?.name || 'Narrator',
      text: '',
      choices: [{ id: createChoiceId(), label: 'Option 1' }],
      startTime: 0,
      duration: DEFAULT_ACTION_DURATION,
      layout: { x: 0, y: 0, scale: 1 }
    };

    setProject(p => ({
      ...p,
      nodes: p.nodes.map(scene => {
        if (scene.id !== nodeId) return scene;
        if (!scene.actions.length) {
          return { ...scene, actions: [fallbackAction] };
        }
        return {
          ...scene,
          actions: scene.actions.map((action, index) => index === targetIndex ? {
            ...action,
            type: 'choice',
            choices: action.choices?.length ? action.choices : [{ id: createChoiceId(), label: 'Option 1' }]
          } : action)
        };
      })
    }));
    setActiveNodeId(nodeId);
    setActiveActionIdx(targetIndex);
    setInspectorTab('content');
  };

  const isChoiceAction = (action?: VNAction) => action?.type === 'choice';

  const actionTypeFromSpeaker = (action: VNAction) => {
    const speaker = (action.speaker || '').trim().toLowerCase();
    return speaker === 'narrator' || speaker === '\u65c1\u767d' ? 'narration' : 'dialogue';
  };

  const setChoiceMode = (checked: boolean) => {
    if (!currentAction) return;
    updateAction({
      type: checked ? 'choice' : actionTypeFromSpeaker(currentAction),
      choices: checked ? (currentAction.choices?.length ? currentAction.choices : [{ id: createChoiceId(), label: 'Option 1' }]) : []
    });
  };

  const openAssetPicker = (kind: PickerKind) => {
    setAssetPicker({ open: true, kind, query: '' });
  };

  const closeAssetPicker = () => {
    setAssetPicker(picker => ({ ...picker, open: false }));
  };

  const bindWorkspaceAsset = (asset: VNAsset) => {
    setProject(p => ({
      ...p,
      assets: upsertAsset(p.assets, asset)
    }));
    bindAsset(asset);
    setWorkspaceNotice(t('assetAssigned', { resource: resourceLabel(asset.type, locale) }));
    closeAssetPicker();
  };

  const bindRemoteAsset = (record: UserAssetRecord, kind: PickerKind) => {
    bindWorkspaceAsset(toWorkspaceAsset(record, kind));
  };

  const clearResource = (kind: PickerKind) => {
    if (kind === 'bg') updateAction({ bgAssetId: undefined, bgImage: undefined });
    if (kind === 'char') updateAction({ charAssetId: undefined, charImage: undefined });
    if (kind === 'audio') updateAction({ audioAssetId: undefined, audioPath: undefined });
    setWorkspaceNotice(t('resourceCleared', { resource: resourceLabel(kind, locale) }));
  };

  const updateCurrentLayout = (updates: Partial<{ x: number; y: number; scale: number }>) => {
    const layout = currentAction?.layout || { x: 0, y: 0, scale: 1 };
    updateAction({ layout: { ...layout, ...updates } });
  };

  const resourceForKind = (kind: PickerKind) => {
    if (kind === 'bg') return activeBgAsset;
    if (kind === 'char') return activeCharAsset;
    return assetById(currentAction?.audioAssetId);
  };

  const resourceStatus = (asset?: VNAsset) => {
    if (!asset) return { label: t('missing'), className: 'border-white/10 text-white/35 bg-white/5' };
    if (asset.status === 'ready') return { label: t('ready'), className: 'border-emerald-400/30 text-emerald-200 bg-emerald-400/10' };
    if (asset.status === 'failed') return { label: t('failed'), className: 'border-red-400/30 text-red-200 bg-red-400/10' };
    return { label: t('pending'), className: 'border-yellow-300/30 text-yellow-100 bg-yellow-300/10' };
  };

  const requestGenerateResource = async (kind: PickerKind, regenerate = false) => {
    if (!currentAction) return;
    const lineText = actionText(currentAction);
    const resourcePrompt = lineText || activeNode?.title || project.title || 'visual novel resource';
    const projectId = project.id || 'workspace_default';
    const sourceAsset = resourceForKind(kind);

    const endpoint = kind === 'bg'
      ? '/api/v1/asset-api/background'
      : kind === 'char'
        ? '/api/v1/asset-api/character/variant'
        : '/api/v1/asset-api/voice';

    const body = kind === 'bg'
      ? {
          project_id: projectId,
          source_action_id: currentAction.id,
          stage_id: activeNode?.id,
          scene_title: activeNode?.title,
          background_prompt: resourcePrompt,
          regenerate,
          source_asset_id: sourceAsset?.id
        }
      : kind === 'char'
        ? {
            project_id: projectId,
            character_id: currentAction.speaker || guideAsset?.id || 'character',
            source_asset_id: sourceAsset?.id,
            reference_image_url: sourceAsset?.url || currentAction.charImage,
            expression_prompt: resourcePrompt,
            pose_prompt: 'visual novel standing sprite, centered',
            cutout_mode: 'preserve_alpha',
            variant_tags: [currentAction.speaker].filter(Boolean),
            regenerate
          }
        : {
            project_id: projectId,
            action_id: currentAction.id,
            character_id: currentAction.speaker || guideAsset?.id || 'narrator',
            text: lineText,
            voice_prompt: resourcePrompt,
            source_asset_id: sourceAsset?.id,
            regenerate
          };

    setWorkspaceNotice(t('generatingResource', {
      action: regenerate ? t('regenerate') : t('generate'),
      resource: resourceLabel(kind, locale)
    }));

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.code === -1 || json.status === 'failed') {
        throw new Error(json.message || json.error || t('resourceGenerationFailed', { resource: resourceLabel(kind, locale) }));
      }

      const payload = json.data || json;
      const resultUrl = payload.absolute_url || payload.url || payload.audio_url;
      const resultId = payload.asset_id || payload.task_id || `${kind}_${Date.now()}`;
      const nextAsset: VNAsset = {
        id: resultId,
        sourceTaskId: payload.task_id || resultId,
        type: kind,
        name: payload.name || `${resourceLabel(kind, locale)} ${resultId}`,
        status: resultUrl ? 'ready' : 'pending',
        url: resultUrl,
        characterId: payload.character_id || currentAction.speaker,
        assetType: payload.asset_type,
        width: payload.width,
        height: payload.height,
        metadata: payload.metadata
      };

      bindWorkspaceAsset(nextAsset);
      setWorkspaceNotice(payload.task_id
        ? t('resourceTaskSubmitted', { resource: resourceLabel(kind, locale), taskId: payload.task_id })
        : t('resourceUpdated', { resource: resourceLabel(kind, locale) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('resourceGenerationFailed', { resource: resourceLabel(kind, locale) });
      setWorkspaceNotice(message);
    }
  };

  const pickerQuery = assetPicker.query.trim().toLowerCase();
  const pickerWorkspaceAssets = project.assets
    .filter(asset => asset.type === assetPicker.kind)
    .filter(asset => !pickerQuery || assetSearchText(asset).includes(pickerQuery));
  const projectAssetIds = new Set(project.assets.map(asset => asset.id));
  const pickerRemoteAssets = libraryAssets
    .filter(record => normalizeRemoteAssetKind(record) === assetPicker.kind)
    .filter(record => !projectAssetIds.has(record.asset_id))
    .filter(record => !pickerQuery || assetSearchText(record).includes(pickerQuery));

  const renderAssetPreview = (asset?: VNAsset) => {
    if (!asset) {
      return (
        <div className="flex h-full items-center justify-center rounded border border-dashed border-white/10 bg-white/[0.03] text-white/25">
          <ImageIcon className="h-5 w-5" />
        </div>
      );
    }
    if (asset.type === 'audio') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded bg-white/[0.04] text-white/45">
          <Volume2 className="h-5 w-5" />
          <span className="max-w-full truncate px-3 text-[10px]">{asset.name}</span>
        </div>
      );
    }
    if (asset.url) {
      return (
        <img
          src={asset.url}
          alt={asset.name}
          className={`h-full w-full ${asset.type === 'char' ? 'object-contain p-2' : 'object-cover'}`}
        />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded bg-white/[0.04] text-white/35">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <span className="text-[10px]">Pending</span>
      </div>
    );
  };

  const renderResourceCard = (kind: PickerKind) => {
    const asset = resourceForKind(kind);
    const status = resourceStatus(asset);
    const Icon = kind === 'bg' ? Monitor : kind === 'char' ? UserRound : Mic;

    return (
      <section key={kind} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-white/80">{resourceLabel(kind, locale)}</div>
              <div className="truncate text-[10px] text-white/35">{asset?.name || t('noAssetBound')}</div>
            </div>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span>
        </div>
        <div className="h-24 overflow-hidden rounded border border-white/10 bg-black/50">
          {renderAssetPreview(asset)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openAssetPicker(kind)}
            disabled={!currentAction}
            className="h-8 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('replace')}
          </button>
          <button
            type="button"
            onClick={() => requestGenerateResource(kind)}
            disabled={!currentAction}
            className="h-8 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('generate')}
          </button>
          <button
            type="button"
            onClick={() => requestGenerateResource(kind, true)}
            disabled={!currentAction || !asset}
            className="h-8 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('regenerate')}
          </button>
          <button
            type="button"
            onClick={() => clearResource(kind)}
            disabled={!currentAction || !asset}
            className="h-8 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('clear')}
          </button>
        </div>
      </section>
    );
  };

  const renderSceneMapGraph = () => (
    <div className="relative h-full">
      <div
        ref={sceneMapViewportRef}
        data-scene-graph-viewport="true"
        className={`scene-map-scrollbars h-full touch-none overflow-auto rounded-lg border border-white/10 bg-black/35 ${sceneMapScrollbarsVisible || sceneMapPanning ? 'is-scrolling' : ''} ${sceneMapPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={beginSceneGraphPan}
        onPointerMove={handleSceneMapScrollbarHover}
        onPointerLeave={hideSceneMapScrollbars}
        onScroll={revealSceneMapScrollbars}
      >
        <div
          className="relative"
          style={{
            width: sceneGraphLayout.width * sceneMapZoom,
            height: sceneGraphLayout.height * sceneMapZoom
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: sceneGraphLayout.width,
              height: sceneGraphLayout.height,
              transform: `scale(${sceneMapZoom})`
            }}
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${sceneGraphLayout.width} ${sceneGraphLayout.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker id="scene-map-arrow-floating" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" className="text-primary" />
                </marker>
              </defs>
              {sceneLinks.map(link => {
                const from = sceneGraphLayout.nodeById.get(link.fromSceneId);
                const to = sceneGraphLayout.nodeById.get(link.toSceneId);
                if (!from || !to) return null;
                const startX = from.x + SCENE_GRAPH_CARD_WIDTH;
                const startY = from.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                const endX = to.x;
                const endY = to.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                const midX = startX + Math.max(42, (endX - startX) / 2);
                const selected = selectedSceneLinkId === link.id;
                return (
                  <g
                    key={link.id}
                    data-scene-graph-interactive="true"
                    className="cursor-pointer"
                    onClick={() => focusSceneGraphLink(link)}
                  >
                    <path
                      d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      markerEnd="url(#scene-map-arrow-floating)"
                      className={selected ? 'stroke-primary' : sceneGraphLinkClass(link)}
                      strokeWidth={selected ? 2.6 : 1.7}
                      strokeDasharray={link.conditions?.length ? '4 4' : undefined}
                    />
                    <text
                      x={(startX + endX) / 2}
                      y={(startY + endY) / 2 - 6}
                      textAnchor="middle"
                      className={`${selected ? 'fill-primary' : 'fill-white/45'} text-[10px]`}
                    >
                      {(link.label || 'Link').slice(0, 18)}
                    </text>
                  </g>
                );
              })}
              {sceneMapDraftLink && (() => {
                const from = sceneGraphLayout.nodeById.get(sceneMapDraftLink.fromSceneId);
                if (!from) return null;
                const startX = from.x + SCENE_GRAPH_CARD_WIDTH;
                const startY = from.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                const endX = sceneMapDraftLink.x;
                const endY = sceneMapDraftLink.y;
                const midX = startX + Math.max(42, Math.abs(endX - startX) / 2);
                return (
                <path
                  d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  markerEnd="url(#scene-map-arrow-floating)"
                  className="stroke-primary"
                  strokeWidth={2.3}
                  strokeDasharray="5 5"
                />
                );
              })()}
            </svg>

            {sceneGraphLayout.nodes.map(layout => {
          const node = sceneById(layout.id);
          if (!node) return null;
          const links = outgoingLinksBySceneId.get(node.id) || [];
          const isolated = project.entrySceneId !== node.id && !incomingSceneIds.has(node.id);
          return (
            <React.Fragment key={`floating_graph_group_${node.id}`}>
            <div
              key={`floating_graph_node_${node.id}`}
              role="button"
              tabIndex={0}
              onClick={() => selectSceneFromMap(node.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectSceneFromMap(node.id);
                }
              }}
              onPointerDown={event => beginSceneGraphNodeDrag(event, node.id, layout)}
              data-scene-graph-interactive="true"
              className={`absolute cursor-grab rounded-lg border p-2 text-left shadow-[0_18px_42px_rgba(0,0,0,0.28)] transition-colors active:cursor-grabbing ${
                activeNodeId === node.id
                  ? 'border-primary/60 bg-primary/[0.08]'
                  : isolated
                    ? 'border-yellow-300/30 bg-yellow-300/[0.05] hover:border-yellow-300/55'
                    : 'border-white/10 bg-[#111] hover:border-white/30'
              }`}
              style={{
                left: layout.x,
                top: layout.y,
                width: SCENE_GRAPH_CARD_WIDTH,
                height: SCENE_GRAPH_CARD_HEIGHT
              }}
            >
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{node.title}</span>
                {project.entrySceneId === node.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                {isolated && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-200" />}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40">{node.type || 'normal'}</span>
                {node.type === 'ending' && <span className="rounded-full border border-emerald-300/25 px-1.5 py-0.5 text-[9px] text-emerald-200">{t('ending')}</span>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-white/35">
                <span>{node.actions.length} {t('action')}</span>
                <span>{links.length} {t('outgoing')}</span>
              </div>
            </div>
            <button
              type="button"
              data-scene-graph-interactive="true"
              data-scene-input-port={node.id}
              onPointerDown={event => beginSceneGraphInputPortDrag(event, node.id)}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                clearSceneIncomingLinks(node.id);
              }}
              className="absolute z-10 h-5 w-5 cursor-crosshair touch-none rounded-full border border-white/25 bg-black shadow-[0_0_0_3px_rgba(255,255,255,0.04)] transition-colors hover:border-primary hover:bg-primary/15"
              style={{
                left: layout.x - 10,
                top: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2 - 10
              }}
              title={t('inputPortHint')}
            >
              <span className="mx-auto block h-2 w-2 rounded-full bg-white/45" />
            </button>
            <button
              type="button"
              data-scene-graph-interactive="true"
              onPointerDown={event => beginSceneGraphPortDrag(event, node.id, layout)}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                clearSceneOutgoingLinks(node.id);
              }}
              className={`absolute z-10 h-5 w-5 cursor-crosshair touch-none rounded-full border shadow-[0_0_0_3px_rgba(222,219,200,0.06)] transition-colors ${
                links.length ? 'border-primary bg-primary/20 hover:bg-primary/30' : 'border-white/25 bg-black hover:border-primary hover:bg-primary/15'
              }`}
              style={{
                left: layout.x + SCENE_GRAPH_CARD_WIDTH - 10,
                top: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2 - 10
              }}
              title={t('outputPortHint')}
            >
              <span className={`mx-auto block h-2 w-2 rounded-full ${links.length ? 'bg-primary' : 'bg-white/45'}`} />
            </button>
            </React.Fragment>
          );
        })}
          </div>
        </div>
      </div>

      <div
        data-scene-map-zoom-control="true"
        className="absolute right-3 top-3 z-20 flex h-8 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur"
        onPointerDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        <input
          type="range"
          min={Math.round(SCENE_MAP_MIN_ZOOM * 100)}
          max={Math.round(SCENE_MAP_MAX_ZOOM * 100)}
          step="1"
          value={Math.round(sceneMapZoom * 100)}
          onChange={event => updateSceneMapZoom(Number(event.target.value) / 100)}
          className="h-1 w-28 accent-primary"
          title={`${t('scale')} ${Math.round(sceneMapZoom * 100)}%`}
        />
        <span className="w-9 text-right text-[10px] tabular-nums text-white/60">{Math.round(sceneMapZoom * 100)}%</span>
      </div>
    </div>
  );

  const renderSceneMapInspector = (className = 'h-full') => (
    <div className={`${className} overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-4`}>
      {selectedSceneLink ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-white/40">{t('selectedLink')}</div>
              <div className="mt-1 truncate text-xs text-white/75">
                {sceneById(selectedSceneLink.fromSceneId)?.title || selectedSceneLink.fromSceneId}
                <span className="px-1 text-white/25">{'->'}</span>
                {sceneById(selectedSceneLink.toSceneId)?.title || selectedSceneLink.toSceneId}
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] text-primary">
              {sceneGraphLinkKind(selectedSceneLink)}
            </span>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-white/35">{t('target')}</span>
            <select
              className="h-8 w-full rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
              value={selectedSceneLink.toSceneId}
              onChange={event => updateSceneLinkTarget(selectedSceneLink, event.target.value)}
            >
              <option value="">{t('noTargetScene')}</option>
              {project.nodes
                .filter(node => node.id !== selectedSceneLink.fromSceneId)
                .map(node => (
                  <option key={node.id} value={node.id}>{node.title}</option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => focusSceneGraphLink(selectedSceneLink)}
            className="h-8 w-full rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary"
          >
            {t('editSource')}
          </button>
          <button
            type="button"
            onClick={() => unlinkSceneGraphLink(selectedSceneLink)}
            className="h-8 w-full rounded-full border border-red-300/20 text-xs text-red-100/65 hover:border-red-300/55 hover:text-red-100"
          >
            {t('unlink')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40">{t('branchEditor')}</div>
              <div className="mt-1 text-xs text-white/70">{activeNode?.title || t('noSceneSelected')}</div>
            </div>
            {activeNode && (
              <button
                type="button"
                onClick={() => addBranchChoiceToScene(activeNode.id)}
                className="h-7 rounded-full border border-white/10 px-2 text-[10px] text-white/55 hover:border-primary hover:text-primary"
              >
                {t('addBranch')}
              </button>
            )}
          </div>
          {activeNode && (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-white/35">{t('defaultNext')}</span>
                <select
                  className="h-8 w-full rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
                  value={activeNode.defaultNextSceneId || ''}
                  onChange={event => updateNode(activeNode.id, { defaultNextSceneId: event.target.value || undefined })}
                >
                  <option value="">{t('noDefaultNextScene')}</option>
                  {project.nodes
                    .filter(node => node.id !== activeNode.id)
                    .map(node => (
                      <option key={node.id} value={node.id}>{node.title}</option>
                    ))}
                </select>
              </label>
              <div className="space-y-2">
                {activeChoiceBranches.map(branch => (
                  <div key={`${branch.actionId}_${branch.choice.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-white/45">
                      <span className="min-w-0 flex-1 truncate">{branch.choice.label}</span>
                      {branch.choice.conditions?.length ? (
                        <span className="rounded-full border border-primary/25 px-1.5 py-0.5 text-primary">{branch.choice.conditions.length} {t('conditions')}</span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <select
                        className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
                        value={branch.choice.targetSceneId || ''}
                        onChange={event => updateChoiceBranchTarget(branch, event.target.value)}
                      >
                        <option value="">{t('noTargetScene')}</option>
                        {project.nodes.map(node => (
                          <option key={node.id} value={node.id}>{node.title}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => createSceneForChoiceBranch(branch)}
                        className="h-8 rounded border border-white/10 px-2 text-[10px] text-white/55 hover:border-primary hover:text-primary"
                      >
                        {t('new')}
                      </button>
                    </div>
                  </div>
                ))}
                {activeChoiceBranches.length === 0 && (
                  <div className="rounded border border-dashed border-white/10 p-3 text-[10px] text-white/30">
                    {t('noBranchChoices')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen w-full bg-black text-[#E1E0CC] flex flex-col font-sans overflow-hidden select-none">
      <header className="h-16 shrink-0 border-b border-white/10 flex items-center justify-between gap-3 px-4 xl:px-6 z-20 bg-black">
        <div className="flex min-w-0 items-center gap-3 xl:gap-6">
          <Link to="/" className="shrink-0 text-xl font-bold tracking-tighter hover:opacity-80 transition-opacity">
            Ariadne<span className="text-primary">*</span>
          </Link>
          <div className="h-4 w-px shrink-0 bg-white/20" />
          <button 
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className={`shrink-0 text-white/50 hover:text-white transition-colors ${leftSidebarOpen ? 'text-primary' : ''}`}
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <h1 className="min-w-0 truncate text-sm font-medium">{project.title}</h1>
        </div>
        
        <div className="flex shrink-0 items-center gap-2 xl:gap-4">
          <button
            type="button"
            onClick={toggleLocale}
            className="h-8 px-3 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
            aria-label={t('languageToggle')}
          >
            <Languages className="w-3 h-3" />
            <span>{locale === 'zh-CN' ? '中' : 'EN'}</span>
          </button>
          <button 
            onClick={togglePlaytest}
            className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <Play className={`w-3 h-3 ${isPlaying ? 'text-primary animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{isPlaying ? t('exitPlaytest') : t('playtest')}</span>
          </button>
          <button
            type="button"
            onClick={openSceneMapWindow}
            className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <Link2 className="w-3 h-3" />
            <span className="hidden sm:inline">{t('sceneMap')}</span>
          </button>
          <button
            type="button"
            onClick={() => setSaveLoadOpen(true)}
            className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <Save className="w-3 h-3" />
            <span className="hidden sm:inline">{t('saveLoad')}</span>
          </button>
          <Link to="/asset-lab" className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2">
            <ImageIcon className="w-3 h-3" />
            <span className="hidden md:inline">{t('assetLab')}</span>
          </Link>
          <Link to="/asset-library" className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2">
            <ImageIcon className="w-3 h-3" />
            <span className="hidden md:inline">{t('library')}</span>
          </Link>
          <input
            ref={projectFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleProjectFileChange}
          />
          <button
            type="button"
            onClick={() => projectFileInputRef.current?.click()}
            className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <Upload className="w-3 h-3" />
            <span className="hidden sm:inline">{t('import')}</span>
          </button>
          <button
            type="button"
            onClick={exportProjectJson}
            className="h-8 px-3 xl:px-4 rounded-full border border-white/20 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">{t('exportJson')}</span>
          </button>
          <button
            type="button"
            onClick={exportPlayableHtml}
            className="h-8 px-3 xl:px-4 rounded-full bg-primary text-black text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Monitor className="w-3 h-3" />
            <span className="hidden sm:inline">{t('exportPlayable')}</span>
          </button>
          <div className="h-4 w-px shrink-0 bg-white/20" />
          <button 
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className={`shrink-0 text-white/50 hover:text-white transition-colors ${rightSidebarOpen ? 'text-primary' : ''}`}
          >
            <PanelRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside className={`shrink-0 border-r border-white/10 flex flex-col bg-black/50 transition-all duration-300 ${leftSidebarOpen ? 'w-[min(16rem,32vw)] min-w-[13rem]' : 'w-0 min-w-0 overflow-hidden border-none'}`}>
          <div className="h-full w-full min-w-0 flex flex-col">
            <div className="p-4 border-b border-white/10 flex flex-col gap-3">
              <h2 className="text-xs font-medium text-white/70 uppercase tracking-wider">{t('storyGeneration')}</h2>
              <textarea 
                rows={2} 
                className="w-full bg-white/5 border border-white/10 rounded overflow-y-auto text-xs p-2 text-white/90 placeholder-white/30 resize-none focus:outline-none focus:border-white/30"
                placeholder={t('storyPromptPlaceholder')}
                value={promptInput}
                onChange={e => setPromptInput(e.target.value)}
              />
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || !promptInput}
                className="w-full h-8 rounded bg-white/10 hover:bg-white/20 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {t('generateScene')}
              </button>
              <div className="text-[10px] text-white/35 leading-relaxed">
                <div>{t('status')}: <span className="text-white/60">{project.generationStatus || 'idle'}</span></div>
                {project.requestId && <div className="truncate">{t('request')}: {project.requestId}</div>}
                <div>{t('images')}: {readyImageCount}/{project.imageTaskCount || 0} · {t('voices')}: {readyVoiceCount}/{project.voiceTaskCount || 0}</div>
                {project.error && <div className="text-red-300/70 truncate">{project.error}</div>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[10px] font-medium uppercase tracking-widest text-white/40">{t('scenes')}</h2>
                <button
                  type="button"
                  onClick={() => createEmptyScene()}
                  className="flex h-7 items-center gap-1 rounded-full border border-white/10 px-2 text-[10px] text-white/60 hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3 w-3" />
                  {t('new')}
                </button>
              </div>
              {project.nodes.map(node => (
                <div 
                  key={node.id}
                  className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${activeNodeId === node.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  onClick={() => { setActiveNodeId(node.id); setActiveActionIdx(0); }}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${node.status === 'generating' ? 'bg-primary animate-pulse' : 'bg-white/50'}`} />
                  <span className={`text-sm truncate ${activeNodeId === node.id ? 'text-white' : 'text-white/60'}`}>
                    {node.title}
                  </span>
                  {project.entrySceneId === node.id && (
                    <span className="rounded-full border border-primary/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary">
                      {t('entry')}
                    </span>
                  )}
                  {node.type === 'ending' && (
                    <span className="rounded-full border border-emerald-400/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-emerald-200">
                      {t('ending')}
                    </span>
                  )}
                  <button 
                    className="ml-auto shrink-0 text-white/20 hover:text-red-400 p-1"
                    onClick={(e) => {
                       e.stopPropagation();
                       deleteScene(node.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {project.nodes.length === 0 && (
                <div className="text-xs text-white/30 italic text-center mt-4">Generate to populate story</div>
              )}
              {project.nodes.length > 0 && (
                <>
                <section className="mt-5 border-t border-white/10 pt-4">
                  <button
                    type="button"
                    onClick={() => setSceneMapOpen(true)}
                    className="group w-full rounded-lg border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-primary/50 hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{t('openSceneMap')}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                        {sceneLinks.length} links
                      </span>
                    </div>
                    <div className="mt-2 text-[10px] leading-relaxed text-white/35">
                      {activeNode?.title || t('noSceneSelected')} · {activeChoiceBranches.length} {t('choices')}
                    </div>
                  </button>
                </section>
                <section className="hidden">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[10px] font-medium uppercase tracking-widest text-white/40">{t('sceneMap')}</h2>
                    <span className="text-[10px] text-white/30">{sceneLinks.length} links</span>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/35">
                    <div className="max-h-80 overflow-auto">
                      <div
                        className="relative"
                        style={{ width: sceneGraphLayout.width, height: sceneGraphLayout.height }}
                      >
                        <svg
                          className="absolute inset-0 h-full w-full"
                          viewBox={`0 0 ${sceneGraphLayout.width} ${sceneGraphLayout.height}`}
                          aria-hidden="true"
                        >
                          <defs>
                            <marker id="scene-map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                              <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" className="text-primary" />
                            </marker>
                          </defs>
                          {sceneLinks.map(link => {
                            const from = sceneGraphLayout.nodeById.get(link.fromSceneId);
                            const to = sceneGraphLayout.nodeById.get(link.toSceneId);
                            if (!from || !to) return null;
                            const startX = from.x + SCENE_GRAPH_CARD_WIDTH;
                            const startY = from.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                            const endX = to.x;
                            const endY = to.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                            const midX = startX + Math.max(42, (endX - startX) / 2);
                            const selected = selectedSceneLinkId === link.id;
                            return (
                              <g
                                key={link.id}
                                className="cursor-pointer"
                                onClick={() => focusSceneGraphLink(link)}
                              >
                                <path
                                  d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                                  fill="none"
                                  markerEnd="url(#scene-map-arrow)"
                                  className={selected ? 'stroke-primary' : sceneGraphLinkClass(link)}
                                  strokeWidth={selected ? 2.6 : 1.7}
                                  strokeDasharray={link.conditions?.length ? '4 4' : undefined}
                                />
                                <text
                                  x={(startX + endX) / 2}
                                  y={(startY + endY) / 2 - 6}
                                  textAnchor="middle"
                                  className={`${selected ? 'fill-primary' : 'fill-white/45'} text-[10px]`}
                                >
                                  {(link.label || 'Link').slice(0, 18)}
                                </text>
                              </g>
                            );
                          })}
                        </svg>

                        {sceneGraphLayout.nodes.map(layout => {
                          const node = sceneById(layout.id);
                          if (!node) return null;
                          const links = outgoingLinksBySceneId.get(node.id) || [];
                          const isolated = project.entrySceneId !== node.id && !incomingSceneIds.has(node.id);
                          return (
                            <button
                              key={`graph_node_${node.id}`}
                              type="button"
                              onClick={() => selectSceneFromMap(node.id)}
                              className={`absolute rounded-lg border p-2 text-left transition-colors ${
                                activeNodeId === node.id
                                  ? 'border-primary/60 bg-primary/[0.08]'
                                  : isolated
                                    ? 'border-yellow-300/30 bg-yellow-300/[0.05] hover:border-yellow-300/55'
                                    : 'border-white/10 bg-[#111] hover:border-white/30'
                              }`}
                              style={{
                                left: layout.x,
                                top: layout.y,
                                width: SCENE_GRAPH_CARD_WIDTH,
                                height: SCENE_GRAPH_CARD_HEIGHT
                              }}
                            >
                              <div className="flex items-start gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{node.title}</span>
                                {project.entrySceneId === node.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                                {isolated && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-200" />}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40">{node.type || 'normal'}</span>
                                {node.type === 'ending' && <span className="rounded-full border border-emerald-300/25 px-1.5 py-0.5 text-[9px] text-emerald-200">{t('ending')}</span>}
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-white/35">
                                <span>{node.actions.length} {t('action')}</span>
                                <span>{links.length} {t('outgoing')}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    {selectedSceneLink ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-white/40">{t('selectedLink')}</div>
                            <div className="mt-1 truncate text-xs text-white/75">
                              {sceneById(selectedSceneLink.fromSceneId)?.title || selectedSceneLink.fromSceneId}
                              <span className="px-1 text-white/25">{'->'}</span>
                              {sceneById(selectedSceneLink.toSceneId)?.title || selectedSceneLink.toSceneId}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] text-primary">
                            {sceneGraphLinkKind(selectedSceneLink)}
                          </span>
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[10px] uppercase tracking-widest text-white/35">{t('target')}</span>
                          <select
                            className="h-8 w-full rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
                            value={selectedSceneLink.toSceneId}
                            onChange={event => updateSceneLinkTarget(selectedSceneLink, event.target.value)}
                          >
                            <option value="">{t('noTargetScene')}</option>
                            {project.nodes
                              .filter(node => node.id !== selectedSceneLink.fromSceneId)
                              .map(node => (
                                <option key={node.id} value={node.id}>{node.title}</option>
                              ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => focusSceneGraphLink(selectedSceneLink)}
                          className="h-8 w-full rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary"
                        >
                          {t('editSource')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-white/40">{t('branchEditor')}</div>
                            <div className="mt-1 text-xs text-white/70">{activeNode?.title || t('noSceneSelected')}</div>
                          </div>
                          {activeNode && (
                            <button
                              type="button"
                              onClick={() => addBranchChoiceToScene(activeNode.id)}
                              className="h-7 rounded-full border border-white/10 px-2 text-[10px] text-white/55 hover:border-primary hover:text-primary"
                            >
                              {t('addBranch')}
                            </button>
                          )}
                        </div>
                        {activeNode && (
                          <>
                            <label className="block space-y-1">
                              <span className="text-[10px] uppercase tracking-widest text-white/35">{t('defaultNext')}</span>
                              <select
                                className="h-8 w-full rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
                                value={activeNode.defaultNextSceneId || ''}
                                onChange={event => updateNode(activeNode.id, { defaultNextSceneId: event.target.value || undefined })}
                              >
                                <option value="">{t('noDefaultNextScene')}</option>
                                {project.nodes
                                  .filter(node => node.id !== activeNode.id)
                                  .map(node => (
                                    <option key={node.id} value={node.id}>{node.title}</option>
                                  ))}
                              </select>
                            </label>
                            <div className="space-y-2">
                              {activeChoiceBranches.map(branch => (
                                <div key={`${branch.actionId}_${branch.choice.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                  <div className="mb-1 flex items-center gap-2 text-[10px] text-white/45">
                                    <span className="min-w-0 flex-1 truncate">{branch.choice.label}</span>
                                    {branch.choice.conditions?.length ? (
                                      <span className="rounded-full border border-primary/25 px-1.5 py-0.5 text-primary">{branch.choice.conditions.length} {t('conditions')}</span>
                                    ) : null}
                                  </div>
                                  <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <select
                                      className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/75 outline-none focus:border-primary"
                                      value={branch.choice.targetSceneId || ''}
                                      onChange={event => updateChoiceBranchTarget(branch, event.target.value)}
                                    >
                                      <option value="">{t('noTargetScene')}</option>
                                      {project.nodes.map(node => (
                                        <option key={node.id} value={node.id}>{node.title}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => createSceneForChoiceBranch(branch)}
                                      className="h-8 rounded border border-white/10 px-2 text-[10px] text-white/55 hover:border-primary hover:text-primary"
                                    >
                                      {t('new')}
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {activeChoiceBranches.length === 0 && (
                                <div className="rounded border border-dashed border-white/10 p-3 text-[10px] text-white/30">
                                  {t('noBranchChoices')}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </section>
                </>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 relative flex flex-col bg-[#0a0a0a]">
          <div
            className={`flex-1 relative overflow-hidden flex items-center justify-center ${isPlaying ? 'cursor-pointer' : ''}`}
            onClick={advancePlaytest}
          >
            <div 
              className="absolute inset-0 bg-[#202124] bg-cover bg-center opacity-100"
              style={{ backgroundImage: activeBg ? `url(${activeBg})` : undefined }}
            />
            {!hasSceneBackground && (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#34363a_0%,#17181b_70%)]" />
            )}
            <div className={`absolute inset-0 ${hasSceneBackground ? 'bg-black/10' : 'bg-black/20'}`} />
            {currentAction && (
              <div className="absolute inset-0 overflow-hidden">
                <motion.img 
                  drag
                  dragMomentum={false}
                  onDragEnd={(e, info) => {
                     const layout = currentAction.layout || { x: 0, y: 0, scale: 1 };
                     updateAction({ layout: { ...layout, x: layout.x + info.offset.x, y: layout.y + info.offset.y } });
                     commitProjectTransaction();
                  }}
                  animate={{ 
                     x: currentAction.layout?.x || 0,
                     y: currentAction.layout?.y || 0,
                     scale: currentAction.layout?.scale || 1
                  }}
                  src={activeChar}
                  alt="Character sprite"
                  onDragStart={beginProjectTransaction}
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 origin-bottom max-h-[90%] object-contain cursor-move pointer-events-auto"
                  style={{ filter: 'drop-shadow(0 0 40px rgba(225,224,204,0.15))' }}
                />
              </div>
            )}
            {currentAction && (
              <div className="absolute bottom-12 left-1/2 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl z-10">
                <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
                   <span className="text-primary font-medium text-sm">{currentAction.speaker || t('narrator')}</span>
                   {isPlaying && (
                    <span className="text-[10px] text-white/40">
                      {(currentAction.choices?.length ?? 0) > 0 ? t('choosePath') : t('clickToContinue')}
                    </span>
                   )}
                </div>
                <p className="text-lg leading-relaxed text-white/90">
                  {actionText(currentAction)}
                </p>
                {(currentAction.choices?.length ?? 0) > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {currentAction.choices?.map((choice, index) => {
                      const conditionOk = conditionsMet(choice.conditions, runtimeVariables);
                      const hasTarget = Boolean(choice.targetSceneId || choice.targetActionId || choice.nextId);
                      return (
                        <button
                          key={`${choice.label}_${index}`}
                          disabled={isPlaying && (!hasTarget || !conditionOk)}
                          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-left text-sm text-white/85 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectChoice(choice);
                          }}
                        >
                          <span className="block">{conditionOk ? choice.label : (choice.disabledText || choice.label)}</span>
                          <span className="block text-[10px] text-white/35">
                            {!conditionOk ? t('conditionLocked') : sceneById(choice.targetSceneId)?.title || (choice.targetActionId ? t('actionTarget') : t('noTarget'))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`shrink-0 border-t border-white/10 bg-black/80 backdrop-blur-xl transition-all duration-300 ${timelineVisible ? (timelineMode === 'timeline' ? 'h-[28rem]' : 'h-60') : 'h-12'}`}>
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/5 cursor-pointer" onClick={() => setTimelineVisible(!timelineVisible)}>
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-white/70">
                <AlignLeft className="w-4 h-4 shrink-0" />
                <span className="shrink-0">{t('scriptTimeline')}</span>
                <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/35 sm:inline">
                  {timelineMode === 'timeline' ? t('timelineMode') : t('scriptMode')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="hidden items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5 sm:flex" onClick={event => event.stopPropagation()}>
                  {(['script', 'timeline'] as VNTimelineMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTimelineModeValue(mode)}
                      className={`h-7 rounded-full px-3 text-[10px] transition-colors ${timelineMode === mode ? 'bg-primary text-black' : 'text-white/45 hover:text-white'}`}
                    >
                      {mode === 'script' ? t('scriptMode') : t('timelineMode')}
                    </button>
                  ))}
                </div>
                {timelineVisible && timelineMode === 'timeline' && (
                  <div className="hidden items-center gap-2 lg:flex" onClick={event => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setTimelineSnap(value => !value)}
                      className={`h-7 rounded-full border px-3 text-[10px] transition-colors ${timelineSnap ? 'border-primary/50 bg-primary/10 text-primary' : 'border-white/10 text-white/45 hover:text-white'}`}
                    >
                      {timelineSnap ? t('snapOn') : t('snapOff')}
                    </button>
                    <span className="text-[10px] text-white/35">{t('zoom')}</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.1}
                      value={timelineZoom}
                      onChange={event => setTimelineZoom(Number(event.target.value))}
                      className="w-24 accent-primary"
                      aria-label={t('zoom')}
                    />
                  </div>
                )}
                {timelineVisible && (
                  <div className="hidden text-[10px] text-white/35 md:block">
                    {t('playhead')}: {formatSeconds(playheadTime)} / {formatSeconds(timelineTotalDuration)}
                  </div>
                )}
                <ChevronLeft className={`w-4 h-4 transform transition-transform ${timelineVisible ? '-rotate-90' : 'rotate-90'}`} />
              </div>
            </div>
            
            {timelineVisible && timelineMode === 'script' && (
              <div className="p-4 flex gap-4 h-[calc(100%-3rem)] min-w-0 overflow-x-auto relative">
                {timedActions.map(({ action: act, index: i, startTime, duration }) => (
                  <div 
                    key={act.id}
                    onClick={() => {
                      setActiveActionIdx(i);
                      setPlayheadTime(startTime);
                      if (isPlaying && timelineMode === 'script') playActionAudio(act);
                    }}
                    className={`w-80 shrink-0 rounded-xl p-4 border border-white/10 flex flex-col gap-3 relative group cursor-pointer transition-colors ${activeActionIdx === i ? 'bg-white/10 border-white/30 border-l-2 border-l-primary' : 'bg-white/5 hover:bg-white/10'}`}
                 >
                     <div
                       className="min-h-[3.1rem] max-h-[3.1rem] overflow-hidden pr-1 text-sm font-semibold leading-snug text-white/90 break-words whitespace-normal"
                       title={actionText(act) || act.id}
                     >
                       {actionText(act) || act.id}
                     </div>
                     <div className="flex flex-wrap gap-1">
                       {[
                         { label: 'BG', ready: Boolean(act.bgAssetId || act.bgImage) },
                         { label: t('characterSprite'), ready: Boolean(act.charAssetId || act.charImage) },
                         { label: t('voice'), ready: Boolean(audioForAction(act)) }
                       ].map(item => (
                         <span
                           key={item.label}
                           className={`rounded-full border px-2 py-0.5 text-[10px] ${item.ready ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100/80' : 'border-white/10 bg-white/[0.03] text-white/30'}`}
                         >
                           {item.label}
                         </span>
                       ))}
                     </div>
                     <div className="flex items-center justify-between mt-2">
                       <span className="text-[10px] text-white/40 truncate">{act.speaker || 'Sys'}</span>
                       {activeActionIdx === i && <div className="w-2 h-2 rounded-full bg-primary/80 animate-pulse" />}
                     </div>
                     <div className="flex items-center justify-between gap-2 text-[10px] text-white/35">
                       <span>{formatSeconds(startTime)}</span>
                       <span>{formatSeconds(duration)}</span>
                     </div>
                     <div className="text-[10px] leading-snug text-white/35 break-words">{audioLabelForAction(act)}</div>
                  </div>
                ))}
              </div>
            )}

            {timelineVisible && timelineMode === 'timeline' && (
              <div className="flex h-[calc(100%-3rem)] min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <div
                    className="relative grid gap-y-2"
                    style={{
                      width: TIMELINE_HEADER_WIDTH + timelineCanvasWidth,
                      gridTemplateColumns: `${TIMELINE_HEADER_WIDTH}px ${timelineCanvasWidth}px`
                    }}
                  >
                    <div
                      className="absolute bottom-0 top-8 z-40 w-3 -translate-x-1/2 cursor-ew-resize"
                      style={{ left: TIMELINE_HEADER_WIDTH + Math.min(playheadTime, timelineTotalDuration) * timelinePixelsPerSecond }}
                      onPointerDown={beginPlayheadDrag}
                      role="slider"
                      aria-label={t('playhead')}
                      aria-valuemin={0}
                      aria-valuemax={timelineTotalDuration}
                      aria-valuenow={Math.min(playheadTime, timelineTotalDuration)}
                    >
                      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary" />
                      <div className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_3px_rgba(255,255,255,0.12)]" />
                    </div>
                    <div className="h-8 border-b border-white/5" />
                    <div
                      className="relative h-8 border-b border-white/5"
                      onPointerDown={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        seekTimeline((event.clientX - rect.left) / timelinePixelsPerSecond);
                      }}
                    >
                      {timelineRulerTicks.map(time => (
                        <div
                          key={time}
                          className="absolute bottom-0 top-0 border-l border-white/10"
                          style={{ left: time * timelinePixelsPerSecond }}
                        >
                          <span className="absolute left-1 top-1 text-[10px] text-white/35">{formatSeconds(time)}</span>
                        </div>
                      ))}
                    </div>
                    {[
                      {
                        id: 'script',
                        label: t('scriptTrack'),
                        clips: timedActions.map(item => ({
                          ...item,
                          label: actionText(item.action) || item.action.id,
                          className: 'border-primary/35 bg-primary/15 text-primary'
                        }))
                      },
                      {
                        id: 'background',
                        label: t('backgroundTrack'),
                        clips: timedActions
                          .filter(item => item.action.bgAssetId || item.action.bgImage)
                          .map(item => ({
                            ...item,
                            label: t('background'),
                            className: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                          }))
                      },
                      {
                        id: 'character',
                        label: t('characterTrack'),
                        clips: timedActions
                          .filter(item => item.action.charAssetId || item.action.charImage)
                          .map(item => ({
                            ...item,
                            label: item.action.speaker || t('characterSprite'),
                            className: 'border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100'
                          }))
                      },
                      {
                        id: 'voice',
                        label: t('voiceTrack'),
                        clips: timedActions
                          .filter(item => Boolean(audioForAction(item.action)))
                          .map(item => ({
                            ...item,
                            label: audioLabelForAction(item.action),
                            className: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                          }))
                      },
                      {
                        id: 'choice',
                        label: t('choiceTrack'),
                        clips: timedActions
                          .filter(item => item.action.type === 'choice' || (item.action.choices?.length ?? 0) > 0)
                          .map(item => ({
                            ...item,
                            label: `${t('choices')} · ${(item.action.choices || []).length}`,
                            className: 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                          }))
                      }
                    ].map(track => (
                      <React.Fragment key={track.id}>
                        <div className="flex h-14 items-center justify-end border-r border-white/10 pr-3 text-right">
                          <span className="truncate text-[10px] uppercase tracking-widest text-white/35">
                          {track.label}
                          </span>
                        </div>
                        <div
                          className="relative h-14 rounded border border-white/10 bg-white/[0.025]"
                          onPointerDown={event => {
                            if (event.target !== event.currentTarget) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            seekTimeline((event.clientX - rect.left) / timelinePixelsPerSecond);
                          }}
                        >
                          {timelineRulerTicks.map(time => (
                            <div
                              key={`${track.id}_${time}`}
                              className="pointer-events-none absolute bottom-0 top-0 border-l border-white/[0.045]"
                              style={{ left: time * timelinePixelsPerSecond }}
                            />
                          ))}
                          {track.clips.length === 0 && (
                            <div className="flex h-full items-center px-3 text-[10px] text-white/20">{t('noTimelineClips')}</div>
                          )}
                          {(track.clips as TimelineClip[]).map(clip => (
                            <div
                              key={`${track.id}_${clip.action.id}`}
                              role="button"
                              tabIndex={0}
                              onPointerDown={event => beginTimelineClipDrag(event, clip, 'move')}
                              onDoubleClick={() => seekTimeline(clip.startTime)}
                              className={`group absolute top-1 h-12 cursor-grab overflow-hidden rounded border px-2 py-1 text-left text-[10px] shadow-lg transition-opacity hover:opacity-95 active:cursor-grabbing ${clip.className} ${activeActionIdx === clip.index ? 'ring-1 ring-primary' : ''}`}
                              style={{
                                left: clip.startTime * timelinePixelsPerSecond,
                                width: Math.max(56, clip.duration * timelinePixelsPerSecond)
                              }}
                            >
                              <div
                                className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize bg-white/20 opacity-0 transition-opacity group-hover:opacity-100"
                                onPointerDown={event => beginTimelineClipDrag(event, clip, 'trimStart')}
                              />
                              <div
                                className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize bg-white/20 opacity-0 transition-opacity group-hover:opacity-100"
                                onPointerDown={event => beginTimelineClipDrag(event, clip, 'trimEnd')}
                              />
                              <span className="block truncate">{clip.label}</span>
                              <span className="block truncate opacity-55">{formatSeconds(clip.startTime)} - {formatSeconds(clip.endTime)}</span>
                            </div>
                          ))}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        <aside className={`shrink-0 border-l border-white/10 bg-black/60 flex flex-col transition-all duration-300 ${rightSidebarOpen ? 'w-[clamp(16rem,24vw,22rem)] min-w-[16rem]' : 'w-0 min-w-0 overflow-hidden border-none'}`}>
          <div className="h-full w-full min-w-0 flex flex-col">
            <div className="shrink-0 border-b border-white/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Settings className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white/80">{t('inspector')}</div>
                    <div className="truncate text-[10px] text-white/35">{currentAction?.id || t('noActionSelected')}</div>
                  </div>
                </div>
                {currentAction && (
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
                    #{activeActionIdx + 1}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-6 gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
                {[
                  { id: 'content' as InspectorTab, label: t('content'), icon: Type },
                  { id: 'resources' as InspectorTab, label: t('assets'), icon: Layers },
                  { id: 'layout' as InspectorTab, label: t('layout'), icon: Link2 },
                  { id: 'variables' as InspectorTab, label: t('variables'), icon: Settings },
                  { id: 'branch' as InspectorTab, label: t('branchEditor'), icon: Link2 },
                  { id: 'debug' as InspectorTab, label: t('debug'), icon: CheckCircle2 }
                ].map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setInspectorTab(tab.id)}
                      className={`flex h-8 items-center justify-center gap-1 rounded-md text-[10px] transition-colors ${inspectorTab === tab.id ? 'bg-primary text-black' : 'text-white/50 hover:text-white'}`}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="hidden xl:inline">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 xl:p-5">
              {workspaceNotice && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs text-white/60">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 break-words">{workspaceNotice}</span>
                  <button type="button" onClick={() => setWorkspaceNotice('')} className="ml-auto shrink-0 text-white/35 hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {inspectorTab === 'branch' ? (
                renderSceneMapInspector('min-h-[24rem]')
              ) : !currentAction ? (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-white/35">
                  Select or create an action to edit its script, assets, and layout.
                </div>
              ) : (
                <div className="space-y-5">
                  {inspectorTab === 'content' && (
                    <>
                      <section className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-white/40">{t('scene')}</label>
                        <input
                          className="h-9 w-full rounded border border-white/10 bg-white/[0.04] px-3 text-xs text-white/80 outline-none focus:border-primary"
                          value={activeNode?.title || ''}
                          onChange={event => {
                            const title = event.target.value;
                            if (activeNodeId) updateNode(activeNodeId, { title });
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            className="h-9 rounded border border-white/10 bg-black px-3 text-xs text-white/75 outline-none focus:border-primary"
                            value={activeNode?.type || 'normal'}
                            onChange={event => activeNodeId && updateNode(activeNodeId, { type: normalizeSceneType(event.target.value) })}
                          >
                            <option value="normal">{t('normal')}</option>
                            <option value="branch">{t('branch')}</option>
                            <option value="ending">{t('ending')}</option>
                            <option value="menu">{t('menu')}</option>
                            <option value="system">{t('system')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => activeNodeId && setEntryScene(activeNodeId)}
                            disabled={!activeNodeId || project.entrySceneId === activeNodeId}
                            className="h-9 rounded border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary disabled:cursor-default disabled:border-primary/25 disabled:text-primary"
                          >
                            {project.entrySceneId === activeNodeId ? t('entryScene') : t('setEntry')}
                          </button>
                        </div>
                        <select
                          className="h-9 w-full rounded border border-white/10 bg-black px-3 text-xs text-white/75 outline-none focus:border-primary"
                          value={activeNode?.defaultNextSceneId || ''}
                          onChange={event => activeNodeId && updateNode(activeNodeId, { defaultNextSceneId: event.target.value || undefined })}
                        >
                          <option value="">{t('noDefaultNextScene')}</option>
                          {project.nodes
                            .filter(node => node.id !== activeNodeId)
                            .map(node => (
                              <option key={node.id} value={node.id}>{node.title}</option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => activeNode && createEmptyScene({ fromSceneId: activeNode.id, defaultNext: true })}
                          disabled={!activeNode}
                          className="h-8 w-full rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('createNextScene')}
                        </button>
                      </section>

                      <section className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-white/40">{t('choice')}</label>
                        <label className="flex h-9 items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-3 text-xs text-white/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={isChoiceAction(currentAction)}
                            onChange={event => setChoiceMode(event.target.checked)}
                          />
                          <span>{t('choice')}</span>
                        </label>
                      </section>

                      <section className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-white/40">{t('speaker')}</label>
                        <input
                          className="h-9 w-full rounded border border-white/10 bg-white/[0.04] px-3 text-xs text-white/80 outline-none focus:border-primary"
                          value={currentAction.speaker || ''}
                          onChange={event => updateAction({ speaker: event.target.value })}
                          placeholder={t('narrator')}
                        />
                      </section>

                      <section className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-white/40">{t('line')}</label>
                        <textarea
                          className="min-h-32 w-full resize-none rounded border border-white/10 bg-white/[0.04] p-3 text-sm leading-relaxed text-white/85 outline-none focus:border-primary"
                          value={currentAction.text || ''}
                          onChange={event => updateAction({ text: event.target.value })}
                          placeholder={t('writeCurrentLine')}
                        />
                      </section>

                      <section className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] uppercase tracking-widest text-white/40">{t('timeline')}</label>
                          <span className="text-[10px] text-white/35">
                            {t('endTime')}: {formatSeconds((currentAction.startTime ?? activeTimedAction?.startTime ?? 0) + normalizeDurationSeconds(currentAction.duration, estimateActionDuration(currentAction)))}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-white/35">{t('startTime')}</label>
                            <input
                              type="number"
                              min={0}
                              step={0.25}
                              className="h-9 w-full rounded border border-white/10 bg-black px-3 text-xs text-white/80 outline-none focus:border-primary"
                              value={currentAction.startTime ?? activeTimedAction?.startTime ?? 0}
                              onChange={event => updateAction({ startTime: normalizeOptionalSeconds(event.target.value) || 0 })}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-white/35">{t('duration')}</label>
                            <input
                              type="number"
                              min={MIN_ACTION_DURATION}
                              step={0.25}
                              className="h-9 w-full rounded border border-white/10 bg-black px-3 text-xs text-white/80 outline-none focus:border-primary"
                              value={currentAction.duration ?? activeTimedAction?.duration ?? DEFAULT_ACTION_DURATION}
                              onChange={event => updateAction({ duration: normalizeDurationSeconds(event.target.value, DEFAULT_ACTION_DURATION) })}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => seekTimeline(activeTimedAction?.startTime ?? currentAction.startTime ?? 0)}
                            className="h-8 rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary"
                          >
                            {t('seekPlayhead')}
                          </button>
                          <button
                            type="button"
                            onClick={syncCurrentDurationFromVoice}
                            disabled={!audioForAction(currentAction)}
                            className="h-8 rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('syncVoiceDuration')}
                          </button>
                        </div>
                      </section>

                      {isChoiceAction(currentAction) && (
                        <section className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-widest text-white/40">{t('choiceOptions')}</label>
                            <button
                              type="button"
                              onClick={addChoiceOption}
                              className="flex h-7 items-center gap-1 rounded-full border border-white/10 px-2 text-[10px] text-white/60 hover:border-primary hover:text-primary"
                            >
                              <Plus className="h-3 w-3" />
                              {t('add')}
                            </button>
                          </div>
                          <div className="space-y-3">
                            {(currentAction.choices || []).map((choice, index) => (
                              <div key={choice.id || index} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                <div className="mb-2 flex items-center gap-2">
                                  <input
                                    className="min-w-0 flex-1 rounded border border-white/10 bg-black px-3 py-2 text-xs text-white/80 outline-none focus:border-primary"
                                    value={choice.label}
                                    onChange={event => updateChoiceOption(index, { label: event.target.value })}
                                    placeholder={`${t('option')} ${index + 1}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeChoiceOption(index)}
                                    className="h-8 w-8 shrink-0 rounded-full border border-white/10 text-white/35 hover:border-red-400/60 hover:text-red-300"
                                    aria-label="Remove choice"
                                  >
                                    <Trash2 className="mx-auto h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                  <select
                                    className="h-9 min-w-0 rounded border border-white/10 bg-black px-3 text-xs text-white/75 outline-none focus:border-primary"
                                    value={choice.targetSceneId || ''}
                                    onChange={event => updateChoiceOption(index, {
                                      targetSceneId: event.target.value || undefined,
                                      targetActionId: undefined
                                    })}
                                  >
                                    <option value="">{t('noTargetScene')}</option>
                                    {project.nodes.map(node => (
                                      <option key={node.id} value={node.id}>{node.title}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => createSceneForChoice(index)}
                                    className="h-9 rounded border border-white/10 px-2 text-[10px] text-white/60 hover:border-primary hover:text-primary"
                                  >
                                    {t('new')}
                                  </button>
                                </div>
                                <div className="mt-3 border-t border-white/10 pt-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-[10px] uppercase tracking-widest text-white/35">{t('conditions')}</span>
                                    <button
                                      type="button"
                                      onClick={() => addChoiceCondition(index)}
                                      disabled={variableDefinitions.length === 0}
                                      className="h-6 rounded-full border border-white/10 px-2 text-[10px] text-white/50 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      {t('add')}
                                    </button>
                                  </div>
                                  <div className="space-y-2">
                                    {(choice.conditions || []).map((condition, conditionIndex) => {
                                      const variable = variableDefinitions.find(item => item.key === condition.variableKey);
                                      const needsValue = condition.operator !== 'exists' && condition.operator !== 'not_exists';
                                      return (
                                        <div key={condition.id || conditionIndex} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                          <select
                                            className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                            value={condition.variableKey}
                                            onChange={event => {
                                              const nextVariable = variableDefinitions.find(item => item.key === event.target.value);
                                              updateChoiceCondition(index, conditionIndex, {
                                                variableKey: event.target.value,
                                                value: nextVariable?.type === 'boolean' ? true : defaultValueForVariable(nextVariable || { key: '', label: '', type: 'string', scope: 'global' })
                                              });
                                            }}
                                          >
                                            <option value="">Variable</option>
                                            {variableDefinitions.map(item => (
                                              <option key={item.key} value={item.key}>{item.label || item.key}</option>
                                            ))}
                                          </select>
                                          <select
                                            className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                            value={condition.operator}
                                            onChange={event => updateChoiceCondition(index, conditionIndex, { operator: normalizeConditionOperator(event.target.value) })}
                                          >
                                            <option value="equals">equals</option>
                                            <option value="not_equals">not equals</option>
                                            <option value="greater_than">&gt;</option>
                                            <option value="greater_or_equal">&gt;=</option>
                                            <option value="less_than">&lt;</option>
                                            <option value="less_or_equal">&lt;=</option>
                                            <option value="exists">exists</option>
                                            <option value="not_exists">not exists</option>
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => removeChoiceCondition(index, conditionIndex)}
                                            className="h-8 w-8 rounded-full border border-white/10 text-white/35 hover:border-red-400/60 hover:text-red-300"
                                            aria-label="Remove condition"
                                          >
                                            <X className="mx-auto h-3 w-3" />
                                          </button>
                                          {needsValue && (
                                            <input
                                              className="col-span-3 h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                              value={String(condition.value ?? '')}
                                              onChange={event => updateChoiceCondition(index, conditionIndex, {
                                                value: variable?.type === 'number'
                                                  ? Number(event.target.value || 0)
                                                  : variable?.type === 'boolean'
                                                    ? event.target.value === 'true'
                                                    : event.target.value
                                              })}
                                              placeholder={t('compareValuePlaceholder')}
                                            />
                                          )}
                                        </div>
                                      );
                                    })}
                                    {(choice.conditions || []).length === 0 && (
                                      <div className="text-[10px] text-white/25">{t('alwaysAvailable')}</div>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-3 border-t border-white/10 pt-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-[10px] uppercase tracking-widest text-white/35">{t('effects')}</span>
                                    <button
                                      type="button"
                                      onClick={() => addChoiceEffect(index)}
                                      disabled={variableDefinitions.length === 0}
                                      className="h-6 rounded-full border border-white/10 px-2 text-[10px] text-white/50 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      {t('add')}
                                    </button>
                                  </div>
                                  <div className="space-y-2">
                                    {(choice.effects || []).map((effect, effectIndex) => {
                                      const variable = variableDefinitions.find(item => item.key === effect.variableKey);
                                      return (
                                        <div key={effect.id || effectIndex} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                          <select
                                            className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                            value={effect.type}
                                            onChange={event => updateChoiceEffect(index, effectIndex, { type: normalizeEffectType(event.target.value) })}
                                          >
                                            <option value="set_flag">set flag</option>
                                            <option value="unset_flag">unset flag</option>
                                            <option value="set_var">set var</option>
                                            <option value="add_var">add var</option>
                                            <option value="add_affinity">add affinity</option>
                                            <option value="mark_visited">mark visited</option>
                                          </select>
                                          <select
                                            className="h-8 min-w-0 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                            value={effect.variableKey || ''}
                                            onChange={event => updateChoiceEffect(index, effectIndex, { variableKey: event.target.value || undefined })}
                                          >
                                            <option value="">Variable</option>
                                            {variableDefinitions.map(item => (
                                              <option key={item.key} value={item.key}>{item.label || item.key}</option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => removeChoiceEffect(index, effectIndex)}
                                            className="h-8 w-8 rounded-full border border-white/10 text-white/35 hover:border-red-400/60 hover:text-red-300"
                                            aria-label="Remove effect"
                                          >
                                            <X className="mx-auto h-3 w-3" />
                                          </button>
                                          {(effect.type === 'set_var') && (
                                            <input
                                              className="col-span-3 h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                              value={String(effect.value ?? '')}
                                              onChange={event => updateChoiceEffect(index, effectIndex, {
                                                value: variable?.type === 'number'
                                                  ? Number(event.target.value || 0)
                                                  : variable?.type === 'boolean'
                                                    ? event.target.value === 'true'
                                                    : event.target.value
                                              })}
                                              placeholder={t('setValuePlaceholder')}
                                            />
                                          )}
                                          {(effect.type === 'add_var' || effect.type === 'add_affinity') && (
                                            <input
                                              type="number"
                                              className="col-span-3 h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                              value={Number(effect.amount ?? 1)}
                                              onChange={event => updateChoiceEffect(index, effectIndex, { amount: Number(event.target.value || 0) })}
                                            />
                                          )}
                                          {effect.type === 'mark_visited' && (
                                            <select
                                              className="col-span-3 h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                              value={effect.sceneId || ''}
                                              onChange={event => updateChoiceEffect(index, effectIndex, { sceneId: event.target.value || undefined })}
                                            >
                                              <option value="">Target scene</option>
                                              {project.nodes.map(node => (
                                                <option key={node.id} value={node.id}>{node.title}</option>
                                              ))}
                                            </select>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {(choice.effects || []).length === 0 && (
                                      <div className="text-[10px] text-white/25">{t('noVariableChanges')}</div>
                                    )}
                                  </div>
                                </div>
                                <input
                                  className="mt-3 h-8 w-full rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                  value={choice.disabledText || ''}
                                  onChange={event => updateChoiceOption(index, { disabledText: event.target.value || undefined })}
                                  placeholder={t('disabledTextPlaceholder')}
                                />
                                {!choice.targetSceneId && (
                                  <div className="mt-2 flex items-center gap-1 text-[10px] text-yellow-100/60">
                                    <AlertTriangle className="h-3 w-3" />
                                    {t('unconfiguredChoiceTarget')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {inspectorTab === 'resources' && (
                    <>
                      {(['bg', 'char', 'audio'] as PickerKind[]).map(renderResourceCard)}
                      <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
                        <button
                          type="button"
                          onClick={() => playActionAudio(currentAction)}
                          disabled={!audioForAction(currentAction)}
                          className="h-8 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('playVoice')}
                        </button>
                        <button
                          type="button"
                          onClick={() => bindAudioById('')}
                          disabled={!currentAction.audioAssetId}
                          className="h-8 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('clearVoice')}
                        </button>
                      </div>
                    </>
                  )}

                  {inspectorTab === 'layout' && (
                    <>
                      <section className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-white/60">
                          <span>{t('scale')}</span>
                          <span>{currentAction.layout?.scale?.toFixed(2) || '1.00'}</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.05"
                          value={currentAction.layout?.scale || 1}
                          onPointerDown={beginProjectTransaction}
                          onPointerUp={commitProjectTransaction}
                          onKeyDown={event => {
                            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') beginProjectTransaction();
                          }}
                          onKeyUp={commitProjectTransaction}
                          onChange={event => updateCurrentLayout({ scale: parseFloat(event.target.value) })}
                          className="w-full accent-primary"
                        />
                      </section>

                      <section className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-white/40">X</label>
                          <input
                            type="number"
                            className="h-9 w-full rounded border border-white/10 bg-white/[0.04] px-3 text-xs text-white/80 outline-none focus:border-primary"
                            value={Math.round(currentAction.layout?.x || 0)}
                            onChange={event => updateCurrentLayout({ x: Number(event.target.value || 0) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-white/40">Y</label>
                          <input
                            type="number"
                            className="h-9 w-full rounded border border-white/10 bg-white/[0.04] px-3 text-xs text-white/80 outline-none focus:border-primary"
                            value={Math.round(currentAction.layout?.y || 0)}
                            onChange={event => updateCurrentLayout({ y: Number(event.target.value || 0) })}
                          />
                        </div>
                      </section>

                      <section className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-white/40">{t('quickPosition')}</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: t('left'), x: -220 },
                            { label: t('center'), x: 0 },
                            { label: t('right'), x: 220 }
                          ].map(item => (
                            <button
                              key={item.label}
                              type="button"
                              onClick={() => updateCurrentLayout({ x: item.x })}
                              className="h-8 rounded-full border border-white/10 text-xs text-white/60 hover:border-primary hover:text-primary"
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => updateAction({ layout: { x: 0, y: 0, scale: 1 } })}
                          className="h-8 w-full rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white"
                        >
                          {t('resetTransform')}
                        </button>
                      </section>

                      <section className="border-t border-white/10 pt-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-white/60">
                          <span>{t('alignFromAction')}</span>
                          <span className="text-white/35">x/y/scale</span>
                        </div>
                        <select
                          className="w-full rounded border border-white/10 bg-black px-3 py-2 text-xs text-white/80 focus:outline-none focus:border-primary"
                          value={selectedLayoutSourceId}
                          onChange={event => setLayoutSourceActionId(event.target.value)}
                          disabled={layoutSourceActions.length === 0}
                        >
                          {layoutSourceActions.length === 0 ? (
                            <option value="">{t('noOtherAction')}</option>
                          ) : (
                            layoutSourceActions.map(action => {
                              const actionIndex = activeNode?.actions.findIndex(item => item.id === action.id) ?? -1;
                              return (
                                <option key={action.id} value={action.id}>
                                  {`#${actionIndex + 1} ${action.speaker || t('narrator')} - ${actionText(action).slice(0, 28) || action.id}`}
                                </option>
                              );
                            })
                          )}
                        </select>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => alignLayoutFromAction(selectedLayoutSourceAction)}
                            disabled={!selectedLayoutSourceAction?.layout}
                            className="h-8 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('match')}
                          </button>
                          <button
                            type="button"
                            onClick={applyCurrentLayoutToFollowingActions}
                            disabled={!currentAction.layout || !activeNode || activeActionIdx >= activeNode.actions.length - 1}
                            className="h-8 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('applyForward')}
                          </button>
                        </div>
                      </section>
                    </>
                  )}

                  {inspectorTab === 'variables' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-medium text-white/80">{t('variables')}</div>
                          <div className="text-[10px] text-white/35">{t('variablesHint')}</div>
                        </div>
                        <button
                          type="button"
                          onClick={addVariableDefinition}
                          className="flex h-8 items-center gap-1 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
                        >
                          <Plus className="h-3 w-3" />
                          {t('add')}
                        </button>
                      </div>

                      {variableDefinitions.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-white/35">
                          {t('addVariableHint')}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {variableDefinitions.map((variable, index) => (
                            <section key={`${variable.key}_${index}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <input
                                  className="min-w-0 flex-1 rounded border border-white/10 bg-black px-2 py-2 text-xs text-white/80 outline-none focus:border-primary"
                                  value={variable.label}
                                  onChange={event => updateVariableDefinition(index, { label: event.target.value })}
                                  placeholder={t('label')}
                                />
                                <button
                                  type="button"
                                  onClick={() => deleteVariableDefinition(index)}
                                  className="h-8 w-8 shrink-0 rounded-full border border-white/10 text-white/35 hover:border-red-400/60 hover:text-red-300"
                                  aria-label={t('deleteVariable')}
                                >
                                  <Trash2 className="mx-auto h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  className="h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                  value={variable.key}
                                  onChange={event => updateVariableDefinition(index, { key: event.target.value.trim() })}
                                  placeholder={t('variableKeyPlaceholder')}
                                />
                                <select
                                  className="h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                  value={variable.type}
                                  onChange={event => {
                                    const type = normalizeVariableType(event.target.value);
                                    const defaultValue = type === 'boolean' ? false : type === 'number' ? 0 : '';
                                    updateVariableDefinition(index, { type, defaultValue });
                                    updateRuntimeVariable(variable.key, defaultValue);
                                  }}
                                >
                                  <option value="boolean">boolean</option>
                                  <option value="number">number</option>
                                  <option value="string">string</option>
                                </select>
                                <select
                                  className="h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                  value={variable.scope}
                                  onChange={event => updateVariableDefinition(index, { scope: normalizeVariableScope(event.target.value) })}
                                >
                                  <option value="global">global</option>
                                  <option value="character">character</option>
                                  <option value="scene">scene</option>
                                </select>
                                <input
                                  className="h-8 rounded border border-white/10 bg-black px-2 text-[10px] text-white/70 outline-none focus:border-primary"
                                  value={String(variable.defaultValue ?? '')}
                                  onChange={event => updateVariableDefinition(index, {
                                    defaultValue: variable.type === 'number'
                                      ? Number(event.target.value || 0)
                                      : variable.type === 'boolean'
                                        ? event.target.value === 'true'
                                        : event.target.value
                                  })}
                                  placeholder={t('defaultValue')}
                                />
                              </div>
                              <div className="mt-3 rounded border border-white/10 bg-black/30 p-2">
                                <div className="mb-1 text-[10px] uppercase tracking-widest text-white/30">{t('runtimeValue')}</div>
                                <input
                                  className="h-8 w-full rounded border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                  value={String(runtimeVariables[variable.key] ?? '')}
                                  onChange={event => updateRuntimeVariable(variable.key, variable.type === 'number'
                                    ? Number(event.target.value || 0)
                                    : variable.type === 'boolean'
                                      ? event.target.value === 'true'
                                      : event.target.value)}
                                />
                              </div>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {inspectorTab === 'debug' && (
                    <div className="space-y-4">
                      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{t('runtime')}</div>
                        <div className="space-y-1 text-xs text-white/60">
                          <div className="flex justify-between gap-3"><span>{t('scene')}</span><span className="truncate text-white/80">{activeNode?.title || t('noSceneSelected')}</span></div>
                          <div className="flex justify-between gap-3"><span>{t('action')}</span><span className="truncate text-white/80">#{activeActionIdx + 1} {currentAction?.id}</span></div>
                          <div className="flex justify-between gap-3"><span>{t('started')}</span><span className="text-white/80">{formatDateTime(runtimeStartedAt)}</span></div>
                          <div className="flex justify-between gap-3"><span>{t('playing')}</span><span className="text-white/80">{isPlaying ? t('yes') : t('no')}</span></div>
                        </div>
                      </section>

                      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest text-white/40">{t('variables')}</span>
                          <span className="text-[10px] text-white/30">{Object.keys(runtimeVariables).length}</span>
                        </div>
                        <div className="max-h-40 space-y-1 overflow-y-auto">
                          {Object.entries(runtimeVariables).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px]">
                              <span className="min-w-0 truncate text-white/55">{key}</span>
                              <span className="shrink-0 text-white/80">{String(value)}</span>
                            </div>
                          ))}
                          {Object.keys(runtimeVariables).length === 0 && <div className="text-xs text-white/30">{t('noRuntimeVariables')}</div>}
                        </div>
                      </section>

                      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest text-white/40">{t('visitedScenes')}</span>
                          <span className="text-[10px] text-white/30">{visitedSceneIds.length}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {visitedSceneIds.map(sceneId => (
                            <span key={sceneId} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">
                              {sceneById(sceneId)?.title || sceneId}
                            </span>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest text-white/40">{t('validation')}</span>
                          <span className={`text-[10px] ${validationErrorCount ? 'text-red-200' : validationWarningCount ? 'text-yellow-200' : 'text-emerald-200'}`}>
                            {projectValidationIssues.length
                              ? [validationErrorCount ? t('errors', { count: validationErrorCount }) : '', validationWarningCount ? t('warnings', { count: validationWarningCount }) : ''].filter(Boolean).join(' / ')
                              : t('clean')}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {projectValidationIssues.map(issue => (
                            <button
                              key={issue.id}
                              type="button"
                              onClick={() => {
                                if (issue.sceneId) {
                                  setActiveNodeId(issue.sceneId);
                                  const node = sceneById(issue.sceneId);
                                  const index = issue.actionId ? node?.actions.findIndex(action => action.id === issue.actionId) ?? -1 : -1;
                                  setActiveActionIdx(Math.max(0, index));
                                }
                                setInspectorTab('content');
                              }}
                              className={`w-full rounded border p-2 text-left text-[10px] hover:border-opacity-70 ${
                                issue.severity === 'error'
                                  ? 'border-red-300/25 bg-red-300/[0.04] text-red-100/75'
                                  : 'border-yellow-300/20 bg-yellow-300/[0.04] text-yellow-100/70'
                              }`}
                            >
                              <span className="mr-2 uppercase text-white/35">{issue.severity}</span>
                              {issue.message}
                            </button>
                          ))}
                          {projectValidationIssues.length === 0 && (
                            <div className="text-xs text-white/30">{t('noValidationIssues')}</div>
                          )}
                        </div>
                      </section>

                      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{t('history')}</div>
                        <div className="max-h-44 space-y-2 overflow-y-auto">
                          {runtimeHistory.slice(-8).reverse().map(entry => (
                            <div key={entry.id} className="rounded border border-white/10 bg-black/30 p-2 text-[10px] text-white/55">
                              <div className="flex justify-between gap-2">
                                <span className="truncate text-white/75">{entry.sceneTitle || entry.sceneId}</span>
                                <span className="text-white/30">{entry.reason}</span>
                              </div>
                              <div className="mt-1 line-clamp-2">{entry.text}</div>
                            </div>
                          ))}
                          {runtimeHistory.length === 0 && <div className="text-xs text-white/30">{t('noRuntimeHistory')}</div>}
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="hidden overflow-y-auto overflow-x-hidden p-4 xl:p-5 space-y-8">
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-3">{t('currentLine')}</h3>
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <textarea 
                  className="w-full bg-transparent text-sm resize-none focus:outline-none" 
                  rows={3}
                  value={currentAction?.text || ''}
                  onChange={e => updateAction({ text: e.target.value })}
                />
              </div>
            </section>

            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-3">{t('audioBinding')}</h3>
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-white/35">{t('currentAction')}</div>
                  <div className="truncate text-xs text-white/75">{currentAction?.id || t('noAction')}</div>
                  <div className="mt-1 truncate text-xs text-primary">{audioLabelForAction(currentAction)}</div>
                </div>
                <select
                  className="w-full rounded border border-white/10 bg-black px-3 py-2 text-xs text-white/80 focus:outline-none focus:border-primary"
                  value={currentAction?.audioAssetId || ''}
                  onChange={event => bindAudioById(event.target.value)}
                  disabled={!currentAction}
                >
                  <option value="">{t('noAudio')}</option>
                  {audioAssets.map(asset => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} [{asset.status || 'pending'}]
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => playActionAudio(currentAction)}
                    disabled={!audioForAction(currentAction)}
                    className="h-8 flex-1 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('playAudio')}
                  </button>
                  <button
                    type="button"
                    onClick={() => bindAudioById('')}
                    disabled={!currentAction?.audioAssetId}
                    className="h-8 flex-1 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('clear')}
                  </button>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-3">{t('spriteLayoutAdjust')}</h3>
              <div className="flex flex-col gap-2 relative z-20">
                <div className="flex items-center justify-between text-xs text-white/60">
                   <span>{t('scale')}</span>
                   <span>{currentAction?.layout?.scale?.toFixed(2) || '1.00'}</span>
                </div>
                <input 
                  type="range" min="0.5" max="2" step="0.05" 
                  value={currentAction?.layout?.scale || 1}
                  onChange={e => {
                     const layout = currentAction?.layout || { x: 0, y: 0, scale: 1 };
                     updateAction({ layout: { ...layout, scale: parseFloat(e.target.value) } });
                  }}
                  className="w-full accent-primary pointer-events-auto"
                />
                <button 
                  onClick={() => updateAction({ layout: { x: 0, y: 0, scale: 1 } })}
                  className="mt-2 text-xs text-white/40 hover:text-white transition-colors self-end"
                >
                  {t('resetTransform')}
                </button>
                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-white/60">
                    <span>{t('alignFromAction')}</span>
                    <span className="text-white/35">x/y/scale</span>
                  </div>
                  <select
                    className="w-full rounded border border-white/10 bg-black px-3 py-2 text-xs text-white/80 focus:outline-none focus:border-primary"
                    value={selectedLayoutSourceId}
                    onChange={event => setLayoutSourceActionId(event.target.value)}
                    disabled={!currentAction || layoutSourceActions.length === 0}
                  >
                    {layoutSourceActions.length === 0 ? (
                      <option value="">{t('noOtherAction')}</option>
                    ) : (
                      layoutSourceActions.map(action => {
                        const actionIndex = activeNode?.actions.findIndex(item => item.id === action.id) ?? -1;
                        return (
                          <option key={action.id} value={action.id}>
                            {`#${actionIndex + 1} ${action.speaker || t('narrator')} · ${actionText(action).slice(0, 28) || action.id}`}
                          </option>
                        );
                      })
                    )}
                  </select>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => alignLayoutFromAction(selectedLayoutSourceAction)}
                      disabled={!selectedLayoutSourceAction?.layout || !currentAction}
                      className="h-8 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('matchSelected')}
                    </button>
                    <button
                      type="button"
                      onClick={applyCurrentLayoutToFollowingActions}
                      disabled={!currentAction?.layout || !activeNode || activeActionIdx >= activeNode.actions.length - 1}
                      className="h-8 rounded-full border border-white/10 text-xs text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('applyForward')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section>
               <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-3">{t('assetLibrary')}</h3>
               <div className="grid grid-cols-2 gap-2">
                 {project.assets.map(asset => (
                   <div 
                     key={asset.id}
                     onClick={() => bindAsset(asset)}
                     className="relative aspect-video rounded border border-white/10 bg-white/5 overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors"
                   >
                     {(asset.type === 'bg' || asset.type === 'char') && asset.url ? (
                       <img src={asset.url} alt="asset" className={`w-full h-full ${asset.type === 'char' ? 'object-contain' : 'object-cover'} opacity-60 group-hover:opacity-100`} />
                     ) : asset.type === 'audio' ? (
                       <div className="w-full h-full flex flex-col items-center justify-center gap-1 opacity-60 group-hover:opacity-100">
                         <Volume2 className="w-5 h-5 text-white/60" />
                         <span className="text-[10px] text-white/60">Audio</span>
                       </div>
                     ) : (
                       <div className="w-full h-full flex flex-col items-center justify-center gap-1 opacity-60 group-hover:opacity-100">
                         <RefreshCw className="w-5 h-5 text-white/40 animate-spin" />
                         <span className="text-[10px] text-white/50">Pending</span>
                       </div>
                     )}
                     <div className={`absolute right-1 top-1 w-2 h-2 rounded-full ${asset.status === 'ready' ? 'bg-emerald-400' : asset.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
                     <div className="absolute bottom-0 inset-x-0 bg-black/80 px-2 py-1 truncate text-[10px] text-white/80">
                       {asset.name}
                     </div>
                   </div>
                 ))}
               </div>
               {project.assets.length === 0 && (
                 <div className="text-xs text-white/30 italic text-center p-4 border border-white/5 rounded">
                   Generated assets will appear here.
                 </div>
               )}
            </section>
          </div>
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {sceneMapOpen && (
          <motion.div
            ref={sceneMapWindowRef}
            tabIndex={-1}
            className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#080808]/95 shadow-[0_28px_90px_rgba(0,0,0,0.65)] outline-none"
            style={{
              left: sceneMapPosition.x,
              top: sceneMapPosition.y,
              width: sceneMapSize.width,
              height: sceneMapSize.height,
              maxWidth: 'calc(100vw - 1rem)',
              maxHeight: 'calc(100vh - 1rem)'
            }}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}
            onPointerDown={() => sceneMapWindowRef.current?.focus({ preventScroll: true })}
            onWheel={handleSceneMapWheel}
            onClick={event => event.stopPropagation()}
          >
            <div
              className="flex h-14 shrink-0 cursor-grab items-center justify-between gap-4 border-b border-white/10 px-4 active:cursor-grabbing"
              onPointerDown={beginSceneMapWindowDrag}
            >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.08]">
                    <Link2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white/85">{t('sceneMap')}</div>
                    <div className="mt-0.5 truncate text-[10px] text-white/35">
                      {project.nodes.length} {t('scenes')} · {sceneLinks.length} links · {activeNode?.title || t('noSceneSelected')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-scene-map-window-control="true"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => setSceneMapOpen(false)}
                  className="rounded-full p-1.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close scene map"
                >
                  <X className="h-4 w-4" />
                </button>
            </div>

            <div className="min-h-0 flex-1 p-3">
              {renderSceneMapGraph()}
            </div>

              <button
                type="button"
                data-scene-map-window-control="true"
                onPointerDown={beginSceneMapResize}
                className="absolute bottom-2 right-2 h-5 w-5 cursor-nwse-resize rounded-sm border-b border-r border-white/35 opacity-55 transition-opacity hover:opacity-100"
                aria-label={t('resizePanel')}
              />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {saveLoadOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSaveLoadOpen(false)}
          >
            <motion.div
              className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#090909] shadow-2xl"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={event => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-white/85">
                    <Save className="h-4 w-4 text-primary" />
                    {t('saveLoad')}
                  </div>
                  <div className="mt-1 truncate text-xs text-white/35">{project.title} · {projectStorageId}</div>
                </div>
                <button type="button" onClick={() => setSaveLoadOpen(false)} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_1fr]">
                <aside className="border-b border-white/10 p-4 md:border-b-0 md:border-r">
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">{t('currentRuntime')}</div>
                    <div className="mt-3 space-y-3 text-xs">
                      <div>
                        <div className="text-white/35">{t('scene')}</div>
                        <div className="truncate text-white/80">{currentRuntimeScene?.title || t('noSceneSelected')}</div>
                      </div>
                      <div>
                        <div className="text-white/35">{t('action')}</div>
                        <div className="truncate text-white/80">#{activeActionIdx + 1} {currentAction?.speaker || t('narrator')}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border border-white/10 bg-black/30 p-2">
                          <div className="text-[10px] text-white/35">{t('visited')}</div>
                          <div className="mt-1 text-sm text-white/80">{visitedSceneIds.length}</div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/30 p-2">
                          <div className="text-[10px] text-white/35">{t('history')}</div>
                          <div className="mt-1 text-sm text-white/80">{runtimeHistory.length}</div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveRuntimeSlot()}
                      className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-medium text-black hover:bg-primary/90"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {t('saveCurrentProgress')}
                    </button>
                  </div>
                </aside>

                <div className="min-h-0 overflow-y-auto p-4">
                  {saveSlots.length === 0 ? (
                    <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-white/10 p-10 text-center text-xs text-white/35">
                      {t('noSaveSlots')}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {saveSlots.map(slot => {
                        const slotScene = sceneById(slot.runtimeState.currentSceneId);
                        const slotAction = slotScene?.actions[slot.runtimeState.currentActionIndex];
                        return (
                          <article key={slot.slotId} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white/85">{slot.name}</div>
                                <div className="mt-1 truncate text-xs text-white/40">
                                  {slotScene?.title || slot.runtimeState.currentSceneId} · #{slot.runtimeState.currentActionIndex + 1}
                                </div>
                              </div>
                              <div className="shrink-0 text-right text-[10px] text-white/35">
                                <div>{t('updated')} {formatDateTime(slot.updatedAt)}</div>
                                <div>{t('created')} {formatDateTime(slot.createdAt)}</div>
                              </div>
                            </div>
                            <div className="mt-3 line-clamp-2 text-xs leading-relaxed text-white/55">
                              {slotAction ? actionText(slotAction) : 'Saved action is missing from the current project schema.'}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
                              <span className="rounded-full border border-white/10 px-2 py-1">{t('visited')} {slot.runtimeState.visitedSceneIds?.length || 0}</span>
                              <span className="rounded-full border border-white/10 px-2 py-1">{t('history')} {slot.runtimeState.history?.length || 0}</span>
                              <span className="rounded-full border border-white/10 px-2 py-1">{t('choices')} {slot.runtimeState.selectedChoiceHistory?.length || 0}</span>
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => loadRuntimeSlot(slot)}
                                className="flex h-8 items-center justify-center gap-1 rounded-full border border-white/10 text-xs text-white/70 hover:border-primary hover:text-primary"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                {t('load')}
                              </button>
                              <button
                                type="button"
                                onClick={() => saveRuntimeSlot(slot.slotId)}
                                className="h-8 rounded-full border border-white/10 text-xs text-white/55 hover:border-white/30 hover:text-white"
                              >
                                {t('overwrite')}
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteRuntimeSlot(slot.slotId)}
                                className="h-8 rounded-full border border-white/10 text-xs text-white/45 hover:border-red-400/60 hover:text-red-300"
                              >
                                {t('delete')}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {assetPicker.open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeAssetPicker}
          >
            <motion.div
              className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#090909] shadow-2xl"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={event => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 p-4">
                <div>
                  <div className="text-sm font-medium text-white/85">{t('replaceResource', { resource: resourceLabel(assetPicker.kind, locale) })}</div>
                  <div className="text-xs text-white/35">{t('workspaceAssetsSavedRecords')}</div>
                </div>
                <button type="button" onClick={closeAssetPicker} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-white/10 p-4">
                <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
                  <Search className="h-4 w-4 text-white/35" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-white/80 outline-none placeholder:text-white/25"
                    value={assetPicker.query}
                    onChange={event => setAssetPicker(picker => ({ ...picker, query: event.target.value }))}
                    placeholder={t('searchAssets')}
                    autoFocus
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {pickerWorkspaceAssets.length === 0 && pickerRemoteAssets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-xs text-white/35">
                    {t('noMatchingAssets')}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {pickerWorkspaceAssets.length > 0 && (
                      <section>
                        <div className="mb-3 text-[10px] uppercase tracking-widest text-white/40">{t('currentWorkspace')}</div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                          {pickerWorkspaceAssets.map(asset => (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => bindWorkspaceAsset(asset)}
                              className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] text-left hover:border-primary/60"
                            >
                              <div className="h-28 border-b border-white/10 bg-black/40">
                                {renderAssetPreview(asset)}
                              </div>
                              <div className="p-3">
                                <div className="truncate text-xs text-white/75">{asset.name}</div>
                                <div className="mt-1 flex items-center gap-2 text-[10px] text-white/35">
                                  <span className={`h-1.5 w-1.5 rounded-full ${asset.status === 'ready' ? 'bg-emerald-400' : asset.status === 'failed' ? 'bg-red-400' : 'bg-yellow-300'}`} />
                                  {asset.status || 'pending'}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    {pickerRemoteAssets.length > 0 && (
                      <section>
                        <div className="mb-3 text-[10px] uppercase tracking-widest text-white/40">{t('savedLibrary')}</div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                          {pickerRemoteAssets.map(record => {
                            const url = displayRemoteAssetUrl(record);
                            return (
                              <button
                                key={record.asset_id}
                                type="button"
                                onClick={() => bindRemoteAsset(record, assetPicker.kind)}
                                className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] text-left hover:border-primary/60"
                              >
                                <div className="h-28 border-b border-white/10 bg-black/40">
                                  {assetPicker.kind === 'audio' ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
                                      <Volume2 className="h-5 w-5" />
                                      <span className="text-[10px]">Audio</span>
                                    </div>
                                  ) : url ? (
                                    <img
                                      src={url}
                                      alt={record.name || record.asset_id}
                                      className={`h-full w-full ${assetPicker.kind === 'char' ? 'object-contain p-2' : 'object-cover'}`}
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-white/25">
                                      <ImageIcon className="h-5 w-5" />
                                    </div>
                                  )}
                                </div>
                                <div className="p-3">
                                  <div className="truncate text-xs text-white/75">{record.name || record.asset_id}</div>
                                  <div className="mt-1 truncate text-[10px] text-white/35">{record.asset_type || 'saved asset'}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
