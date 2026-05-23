export type VNNodeStatus = 'done' | 'generating' | 'pending';
export type VNSceneType = 'normal' | 'branch' | 'ending' | 'menu' | 'system';
export type VNVariableType = 'boolean' | 'number' | 'string';
export type VNVariableScope = 'global' | 'character' | 'scene';
export type VNConditionOperator = 'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal' | 'exists' | 'not_exists';
export type VNEffectType = 'set_flag' | 'unset_flag' | 'set_var' | 'add_var' | 'add_affinity' | 'mark_visited';
export type VNTimelineMode = 'script' | 'timeline';
export type VNActionType = 'line' | 'choice' | 'jump' | 'set_var' | 'show_character' | 'hide_character' | 'change_background' | 'play_bgm' | 'stop_bgm' | 'play_sfx' | 'show_cg' | 'transition' | 'ending';
export type VNTimelineTrack = 'script' | 'background' | 'character' | 'voice' | 'bgm' | 'sfx' | 'fx';

export interface VNVariableDefinition {
  key: string;
  label: string;
  type: VNVariableType;
  defaultValue?: unknown;
  scope: VNVariableScope;
}

export interface VNCondition {
  id?: string;
  variableKey: string;
  operator: VNConditionOperator;
  value?: unknown;
}

export interface VNEffect {
  id?: string;
  type: VNEffectType;
  variableKey?: string;
  value?: unknown;
  amount?: number;
  characterId?: string;
  sceneId?: string;
}

export interface VNChoice {
  id: string;
  label: string;
  nextId?: string;
  targetActionId?: string;
  targetSceneId?: string;
  conditions?: VNCondition[];
  effects?: VNEffect[];
  disabledText?: string;
}

export interface VNSceneLink {
  id: string;
  fromSceneId: string;
  fromActionId?: string;
  fromChoiceId?: string;
  toSceneId: string;
  toActionId?: string;
  conditions?: VNCondition[];
  label?: string;
}

export interface VNRuntimeHistoryEntry {
  id: string;
  sceneId: string;
  sceneTitle?: string;
  actionId?: string;
  actionIndex: number;
  speaker?: string;
  text?: string;
  reason?: string;
  timestamp: string;
}

export interface VNSelectedChoiceHistoryEntry {
  id: string;
  sceneId: string;
  actionId: string;
  choiceId: string;
  label: string;
  targetSceneId?: string;
  targetActionId?: string;
  selectedAt: string;
}

export interface VNRuntimeState {
  currentSceneId: string;
  currentActionIndex: number;
  variables: Record<string, unknown>;
  history: VNRuntimeHistoryEntry[];
  visitedSceneIds: string[];
  selectedChoiceHistory: VNSelectedChoiceHistoryEntry[];
  startedAt: string;
  updatedAt: string;
}

export interface VNSaveSlot {
  slotId: string;
  projectId: string;
  schemaVersion?: number;
  projectTitle?: string;
  name: string;
  thumbnail?: string;
  runtimeState: VNRuntimeState;
  createdAt: string;
  updatedAt: string;
}

export interface VNAction {
  id: string;
  sourceActionId?: string;
  type: VNActionType;
  speaker?: string;
  text?: string;
  emotion?: string;
  choices?: VNChoice[];
  targetSceneId?: string;
  targetActionId?: string;
  bgAssetId?: string;
  charAssetId?: string;
  audioAssetId?: string;
  bgImage?: string;
  charImage?: string;
  audioPath?: string;
  start?: number;
  startTime?: number;
  duration?: number;
  track?: VNTimelineTrack;
  lane?: number;
  locked?: boolean;
  layout?: { x: number; y: number; scale: number };
}

export interface VNNode {
  id: string;
  title: string;
  summary?: string;
  type?: VNSceneType;
  status: VNNodeStatus;
  actions: VNAction[];
  defaultNextSceneId?: string;
  backgroundAssetId?: string;
  bgmAssetId?: string;
  tags?: string[];
  position?: { x: number; y: number };
  children?: VNNode[];
}

export interface VNAsset {
  id: string;
  sourceTaskId?: string;
  url?: string;
  sourceUrl?: string;
  type: 'bg' | 'char' | 'audio';
  name: string;
  status?: 'pending' | 'ready' | 'failed';
  error?: string;
  characterId?: string;
  assetType?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface VNProjectState {
  schemaVersion?: number;
  projectId?: string;
  id: string;
  title: string;
  entrySceneId?: string;
  scenes?: VNNode[];
  nodes: VNNode[];
  timelineMode?: VNTimelineMode;
  sceneLinks?: VNSceneLink[];
  assets: VNAsset[];
  characters?: unknown[];
  variables?: VNVariableDefinition[];
  saveSlots?: VNSaveSlot[];
  metadata?: Record<string, unknown>;
  requestId?: string;
  script?: any;
  sourceText?: string;
  imageTaskCount?: number;
  voiceTaskCount?: number;
  generationStatus?: 'idle' | 'submitting' | 'script_ready' | 'generating_assets' | 'done' | 'failed';
  error?: string;
}
