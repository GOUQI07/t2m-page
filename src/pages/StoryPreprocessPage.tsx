import { type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, GitBranch, GripVertical, Languages, Link2, LogOut, Plus, RefreshCw, Sparkles, Trash2, Users, Wand2, X } from 'lucide-react';
import { commitVisualNovelStoryDraft, preprocessVisualNovelStory, type StoryPreprocessDraft, type StoryPreprocessIntent } from '../api/storyPreprocess';
import { useAuth } from '../auth/AuthContext';
import { getInitialLocale, LOCALE_STORAGE_KEY, translate, type Locale, type TranslationKey } from '../i18n';

type DraftScene = {
  id?: string;
  scene_id?: string;
  title?: string;
  name?: string;
  type?: string;
  summary?: string;
  actions?: any[];
};

type DraftCharacter = {
  id?: string;
  character_id?: string;
  name?: string;
  role?: string;
  voice?: string;
  character_card?: Record<string, unknown>;
  characterCard?: Record<string, unknown>;
  [key: string]: unknown;
};

type DraftSceneLink = {
  id: string;
  fromSceneId: string;
  fromActionId?: string;
  fromChoiceId?: string;
  toSceneId: string;
  label?: string;
};

type ReviewTab = 'structure' | 'characters';
type StructureView = 'lines' | 'graph';
type SceneGraphLinkKind = 'default' | 'jump' | 'choice';
type SceneGraphPositionMap = Record<string, { x: number; y: number }>;
type SceneGraphDraftLink = {
  fromSceneId: string;
  x: number;
  y: number;
};

type DraftSceneGraphLayout = {
  nodes: Array<{ id: string; x: number; y: number; depth: number }>;
  nodeById: Map<string, { id: string; x: number; y: number; depth: number }>;
  width: number;
  height: number;
};

const SCENE_GRAPH_CARD_WIDTH = 164;
const SCENE_GRAPH_CARD_HEIGHT = 92;
const SCENE_GRAPH_COLUMN_GAP = 92;
const SCENE_GRAPH_ROW_GAP = 34;
const SCENE_GRAPH_MIN_ZOOM = 0.55;
const SCENE_GRAPH_MAX_ZOOM = 1.8;
const SCENE_GRAPH_ZOOM_STEP = 0.1;

const INTENTS: Array<{ id: StoryPreprocessIntent; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { id: 'multi_scene', labelKey: 'multiScene', descriptionKey: 'multiSceneDescription' },
  { id: 'auto', labelKey: 'auto', descriptionKey: 'autoDescription' },
  { id: 'branching', labelKey: 'branching', descriptionKey: 'branchingDescription' },
  { id: 'single_scene', labelKey: 'singleScene', descriptionKey: 'singleSceneDescription' }
];

const REVIEW_TABS: Array<{ id: ReviewTab; labelKey: TranslationKey; icon: typeof FileText }> = [
  { id: 'structure', labelKey: 'sceneStructure', icon: FileText },
  { id: 'characters', labelKey: 'characterCards', icon: Users }
];


function safeProjectId(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'story-preprocess';
  return `${slug}_${Date.now().toString(36)}`;
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function draftScenes(draft?: StoryPreprocessDraft | null): DraftScene[] {
  if (!draft) return [];
  if (Array.isArray(draft.script?.scenes) && draft.script.scenes.length) return draft.script.scenes;
  if (Array.isArray(draft.script?.nodes)) return draft.script.nodes;
  return [];
}

function draftCharacters(draft?: StoryPreprocessDraft | null): DraftCharacter[] {
  if (!draft) return [];
  if (Array.isArray(draft.script?.characters)) return draft.script.characters;
  return [];
}

function sceneId(scene: DraftScene, index = 0) {
  return pickText(scene.id, scene.scene_id) || `draft_scene_${index}`;
}

function actionId(action: any, index = 0) {
  return pickText(action?.id, action?.action_id) || `draft_action_${index}`;
}

function characterId(character: DraftCharacter, index = 0) {
  return pickText(character.id, character.character_id) || `character_${index}`;
}

function choiceId(choice: any, index = 0) {
  return pickText(choice?.id, choice?.choice_id) || `choice_${index}`;
}

function actionChoices(action: any) {
  return Array.isArray(action?.choices) ? action.choices : [];
}

function createDraftScene(index: number, title: string): DraftScene {
  const id = `scene_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    title,
    type: 'normal',
    summary: '',
    actions: [
      {
        id: `action_manual_${Date.now()}`,
        type: 'line',
        speaker: 'Narrator',
        text: ''
      }
    ]
  };
}

function createDraftAction(index: number) {
  return {
    id: `action_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'line',
    speaker: 'Narrator',
    text: '',
    emotion: ''
  };
}

function createDraftCharacter(index: number, name: string): DraftCharacter {
  const id = `character_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    character_id: id,
    name,
    role: '',
    voice: '',
    character_card: {
      appearance: '',
      outfit: '',
      style: '',
      identity_rules: ''
    }
  };
}

function deriveDraftSceneLinks(scenes: DraftScene[]): DraftSceneLink[] {
  const links: DraftSceneLink[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const fromSceneId = sceneId(scene, sceneIndex);
    const defaultNext = pickText((scene as any).defaultNextSceneId, (scene as any).default_next_scene_id);
    if (defaultNext) {
      links.push({
        id: `link_default_${fromSceneId}_${defaultNext}`,
        fromSceneId,
        toSceneId: defaultNext,
        label: 'default'
      });
    }

    (Array.isArray(scene.actions) ? scene.actions : []).forEach((action, actionIndex) => {
      const fromActionId = actionId(action, actionIndex);
      const jumpTarget = pickText(action?.targetSceneId, action?.target_scene_id, action?.nextSceneId, action?.next_scene_id);
      if (jumpTarget) {
        links.push({
          id: `link_action_${fromSceneId}_${fromActionId}_${jumpTarget}`,
          fromSceneId,
          fromActionId,
          toSceneId: jumpTarget,
          label: action?.type || action?.action_type || 'jump'
        });
      }
      actionChoices(action).forEach((choice: any, choiceIndex: number) => {
        const fromChoiceId = choiceId(choice, choiceIndex);
        const choiceTarget = pickText(choice?.targetSceneId, choice?.target_scene_id, choice?.toSceneId, choice?.to_scene_id, choice?.nextSceneId, choice?.next_scene_id);
        if (choiceTarget) {
          links.push({
            id: `link_choice_${fromSceneId}_${fromActionId}_${fromChoiceId}_${choiceTarget}`,
            fromSceneId,
            fromActionId,
            fromChoiceId,
            toSceneId: choiceTarget,
            label: pickText(choice?.label, choice?.text) || 'choice'
          });
        }
      });
    });
  });
  return links;
}

function syncSceneLinks(script: any) {
  const scenes = Array.isArray(script?.scenes) && script.scenes.length
    ? script.scenes
    : Array.isArray(script?.nodes)
      ? script.nodes
      : [];
  const links = deriveDraftSceneLinks(scenes);
  return {
    ...script,
    scene_links: links,
    sceneLinks: links
  };
}

function branchCode(index: number) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < letters.length) return `Branch ${letters[index]}`;
  return `Branch ${index + 1}`;
}

function draftSceneGraphLinkKind(link: DraftSceneLink): SceneGraphLinkKind {
  if (link.fromChoiceId) return 'choice';
  if (link.id.startsWith('link_action_')) return 'jump';
  return 'default';
}

function sceneGraphLinkClass(link: DraftSceneLink) {
  const kind = draftSceneGraphLinkKind(link);
  if (kind === 'choice') return 'stroke-primary';
  if (kind === 'jump') return 'stroke-sky-300';
  return 'stroke-white/35';
}

function normalizeSceneGraphPositions(value: unknown): SceneGraphPositionMap {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<SceneGraphPositionMap>((positions, [id, position]) => {
    if (!position || typeof position !== 'object') return positions;
    const raw = position as Record<string, unknown>;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      positions[id] = { x, y };
    }
    return positions;
  }, {});
}

function buildDraftSceneGraphLayout(
  scenes: DraftScene[],
  links: DraftSceneLink[],
  manualPositions: SceneGraphPositionMap = {}
): DraftSceneGraphLayout {
  const ids = scenes.map((scene, index) => sceneId(scene, index));
  const sceneIds = new Set(ids);
  const outgoing = links.reduce((map, link) => {
    if (!sceneIds.has(link.fromSceneId) || !sceneIds.has(link.toSceneId)) return map;
    const group = map.get(link.fromSceneId) || [];
    group.push(link.toSceneId);
    map.set(link.fromSceneId, group);
    return map;
  }, new Map<string, string[]>());
  const depthById = new Map<string, number>();
  const queue = ids[0] ? [{ id: ids[0], depth: 0 }] : [];

  while (queue.length) {
    const current = queue.shift()!;
    const previousDepth = depthById.get(current.id);
    if (previousDepth !== undefined && previousDepth <= current.depth) continue;
    depthById.set(current.id, current.depth);
    (outgoing.get(current.id) || []).forEach(targetId => queue.push({ id: targetId, depth: current.depth + 1 }));
  }

  const maxReachableDepth = Math.max(0, ...Array.from(depthById.values()));
  ids.forEach((id, index) => {
    if (!depthById.has(id)) depthById.set(id, maxReachableDepth + 1 + Math.floor(index / 6));
  });

  const layouts = ids.map((id, index) => {
    const depth = depthById.get(id) || 0;
    const manualPosition = manualPositions[id];
    return {
      id,
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

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function normalizeSceneGraphZoom(value: number) {
  return Math.min(SCENE_GRAPH_MAX_ZOOM, Math.max(SCENE_GRAPH_MIN_ZOOM, Math.round(value * 100) / 100));
}

function roundSceneGraphCoordinate(value: number) {
  return Math.round(value * 10) / 10;
}

function createDraftChoice(targetSceneId?: string, index = 0) {
  const targetSlug = (targetSceneId || 'target').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 36);
  return {
    id: `choice_manual_${targetSlug}_${index + 1}`,
    label: `Choice ${index + 1}`,
    targetSceneId: targetSceneId || '',
    target_scene_id: targetSceneId || ''
  };
}

function mapDraftSceneCollections(script: any, mapper: (items: DraftScene[]) => DraftScene[]) {
  return {
    ...script,
    scenes: Array.isArray(script.scenes) ? mapper(script.scenes) : script.scenes,
    nodes: Array.isArray(script.nodes) ? mapper(script.nodes) : script.nodes
  };
}

export function StoryPreprocessPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const t = (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const toggleLocale = () => {
    setLocale(current => current === 'zh-CN' ? 'en-US' : 'zh-CN');
  };
  const sceneTypeLabel = (value: unknown) => {
    const type = pickText(value) || 'normal';
    if (type === 'branch') return t('branch');
    if (type === 'ending') return t('ending');
    if (type === 'menu') return t('menu');
    if (type === 'system') return t('system');
    return t('normal');
  };
  const intentLabel = (value: StoryPreprocessIntent | string) => {
    if (value === 'multi_scene') return t('multiScene');
    if (value === 'auto') return t('auto');
    if (value === 'branching') return t('branching');
    if (value === 'single_scene') return t('singleScene');
    return String(value || '');
  };
  const [title, setTitle] = useState(() => translate(getInitialLocale(), 'untitledVisualNovel'));
  const [sourceText, setSourceText] = useState('');
  const [intent, setIntent] = useState<StoryPreprocessIntent>('multi_scene');
  const [draft, setDraft] = useState<StoryPreprocessDraft | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [reviewTab, setReviewTab] = useState<ReviewTab>('structure');
  const [structureView, setStructureView] = useState<StructureView>('lines');
  const [draggedSceneId, setDraggedSceneId] = useState('');
  const [draggedActionId, setDraggedActionId] = useState('');
  const [selectedSceneLinkId, setSelectedSceneLinkId] = useState('');
  const [sceneGraphDraftLink, setSceneGraphDraftLink] = useState<SceneGraphDraftLink | null>(null);
  const [sceneGraphZoom, setSceneGraphZoom] = useState(1);
  const [sceneGraphPanning, setSceneGraphPanning] = useState(false);
  const [sceneGraphScrollbarsVisible, setSceneGraphScrollbarsVisible] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const sceneGraphViewportRef = useRef<HTMLDivElement | null>(null);
  const sceneGraphScrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projectId = useMemo(() => safeProjectId(title), [title]);
  const scenes = useMemo(() => draftScenes(draft), [draft]);
  const characters = useMemo(() => draftCharacters(draft), [draft]);
  const sceneLinks = useMemo(() => deriveDraftSceneLinks(scenes), [scenes]);
  const selectedScene = scenes.find((scene, index) => sceneId(scene, index) === selectedSceneId) || scenes[0];
  const selectedSceneLink = sceneLinks.find(link => link.id === selectedSceneLinkId);
  const incomingSceneIds = useMemo(() => new Set(sceneLinks.map(link => link.toSceneId)), [sceneLinks]);
  const outgoingLinksBySceneId = useMemo(() => sceneLinks.reduce((map, link) => {
    const group = map.get(link.fromSceneId) || [];
    group.push(link);
    map.set(link.fromSceneId, group);
    return map;
  }, new Map<string, DraftSceneLink[]>()), [sceneLinks]);
  const incomingLinksBySceneId = useMemo(() => sceneLinks.reduce((map, link) => {
    const group = map.get(link.toSceneId) || [];
    group.push(link);
    map.set(link.toSceneId, group);
    return map;
  }, new Map<string, DraftSceneLink[]>()), [sceneLinks]);
  const sceneGraphPositions = useMemo(
    () => normalizeSceneGraphPositions((draft?.script as any)?.metadata?.sceneMapPositions),
    [draft]
  );
  const sceneGraphLayout = useMemo(
    () => buildDraftSceneGraphLayout(scenes, sceneLinks, sceneGraphPositions),
    [scenes, sceneLinks, sceneGraphPositions]
  );
  const sourceLength = sourceText.trim().length;

  useEffect(() => () => {
    if (sceneGraphScrollbarTimerRef.current) {
      clearTimeout(sceneGraphScrollbarTimerRef.current);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const updateDraftScript = (updater: (script: any) => any) => {
    setDraft(current => current ? { ...current, script: updater(current.script || {}) } : current);
  };

  const updateScene = (targetId: string, patch: Record<string, unknown>) => {
    updateDraftScript(script => {
      const update = (items: DraftScene[]) => items.map((scene, index) => sceneId(scene, index) === targetId ? { ...scene, ...patch } : scene);
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? update(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? update(script.nodes) : script.nodes
      };
    });
  };

  const addCharacter = () => {
    if (!draft) return;
    const nextCharacter = createDraftCharacter(characters.length, `${t('characters')} ${characters.length + 1}`);
    updateDraftScript(script => ({
      ...script,
      characters: [...(Array.isArray(script.characters) ? script.characters : []), nextCharacter]
    }));
  };

  const updateCharacter = (targetId: string, patch: Record<string, unknown>) => {
    updateDraftScript(script => ({
      ...script,
      characters: (Array.isArray(script.characters) ? script.characters : []).map((character: DraftCharacter, index: number) =>
        characterId(character, index) === targetId ? { ...character, ...patch } : character
      )
    }));
  };

  const updateCharacterCard = (targetId: string, patch: Record<string, unknown>) => {
    updateDraftScript(script => ({
      ...script,
      characters: (Array.isArray(script.characters) ? script.characters : []).map((character: DraftCharacter, index: number) => {
        if (characterId(character, index) !== targetId) return character;
        const card = {
          ...(typeof character.characterCard === 'object' && character.characterCard ? character.characterCard : {}),
          ...(typeof character.character_card === 'object' && character.character_card ? character.character_card : {}),
          ...patch
        };
        return { ...character, character_card: card, characterCard: card };
      })
    }));
  };

  const deleteCharacter = (targetId: string) => {
    updateDraftScript(script => ({
      ...script,
      characters: (Array.isArray(script.characters) ? script.characters : []).filter((character: DraftCharacter, index: number) => characterId(character, index) !== targetId)
    }));
  };

  const addScene = () => {
    if (!draft) return;
    const nextScene = createDraftScene(scenes.length, t('newScene', { index: scenes.length + 1 }));
    updateDraftScript(script => {
      const existingScenes = Array.isArray(script.scenes) ? script.scenes : scenes;
      return {
        ...script,
        scenes: [...existingScenes, nextScene],
        nodes: Array.isArray(script.nodes) ? [...script.nodes, nextScene] : script.nodes
      };
    });
    setSelectedSceneId(sceneId(nextScene));
  };

  const deleteScene = (targetId: string) => {
    if (!draft || scenes.length <= 1) return;
    const nextScenes = scenes.filter((scene, index) => sceneId(scene, index) !== targetId);
    const nextSelected = sceneId(nextScenes[0], 0);
    updateDraftScript(script => {
      const removeScene = (items: DraftScene[]) => items.filter((scene, index) => sceneId(scene, index) !== targetId);
      const cleanLinks = (items: DraftScene[]) => items.map(scene => ({
        ...scene,
        defaultNextSceneId: (scene as any).defaultNextSceneId === targetId ? undefined : (scene as any).defaultNextSceneId,
        default_next_scene_id: (scene as any).default_next_scene_id === targetId ? undefined : (scene as any).default_next_scene_id,
        actions: Array.isArray(scene.actions) ? scene.actions.map(action => ({
          ...action,
          targetSceneId: action?.targetSceneId === targetId ? undefined : action?.targetSceneId,
          target_scene_id: action?.target_scene_id === targetId ? undefined : action?.target_scene_id,
          choices: Array.isArray(action?.choices)
            ? action.choices.map((choice: any) => ({
                ...choice,
                targetSceneId: choice?.targetSceneId === targetId ? undefined : choice?.targetSceneId,
                target_scene_id: choice?.target_scene_id === targetId ? undefined : choice?.target_scene_id
              }))
            : action?.choices
        })) : scene.actions
      }));
      const scenesAfterDelete = Array.isArray(script.scenes) ? cleanLinks(removeScene(script.scenes)) : script.scenes;
      const nodesAfterDelete = Array.isArray(script.nodes) ? cleanLinks(removeScene(script.nodes)) : script.nodes;
      return {
        ...script,
        scenes: scenesAfterDelete,
        nodes: nodesAfterDelete,
        entry_scene_id: script.entry_scene_id === targetId ? nextSelected : script.entry_scene_id,
        entrySceneId: script.entrySceneId === targetId ? nextSelected : script.entrySceneId,
        scene_links: Array.isArray(script.scene_links)
          ? script.scene_links.filter((link: any) => link.fromSceneId !== targetId && link.toSceneId !== targetId)
          : script.scene_links,
        sceneLinks: Array.isArray(script.sceneLinks)
          ? script.sceneLinks.filter((link: any) => link.fromSceneId !== targetId && link.toSceneId !== targetId)
          : script.sceneLinks
      };
    });
    setSelectedSceneId(nextSelected);
  };

  const reorderScenes = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIndex = scenes.findIndex((scene, index) => sceneId(scene, index) === fromId);
    const toIndex = scenes.findIndex((scene, index) => sceneId(scene, index) === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = moveItem(scenes, fromIndex, toIndex);
    updateDraftScript(script => ({
      ...script,
      scenes: reordered,
      nodes: Array.isArray(script.nodes) ? reordered : script.nodes
    }));
    setSelectedSceneId(fromId);
  };

  const handleSceneDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    setDraggedSceneId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const handleSceneDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = draggedSceneId || event.dataTransfer.getData('text/plain');
    reorderScenes(sourceId, targetId);
    setDraggedSceneId('');
  };

  const updateAction = (targetSceneId: string, targetActionId: string, patch: Record<string, unknown>) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) => {
            const id = pickText(action?.id, action?.action_id) || `draft_action_${actionIndex}`;
            return id === targetActionId ? { ...action, ...patch } : action;
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const updateSceneDefaultNext = (targetSceneId: string, nextSceneId: string) => {
    updateScene(targetSceneId, {
      defaultNextSceneId: nextSceneId || undefined,
      default_next_scene_id: nextSceneId || undefined
    });
  };

  const updateChoice = (targetSceneId: string, targetActionId: string, targetChoiceId: string, patch: Record<string, unknown>) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) => {
            if (actionId(action, actionIndex) !== targetActionId) return action;
            return {
              ...action,
              choices: actionChoices(action).map((choice: any, choiceIndex: number) =>
                choiceId(choice, choiceIndex) === targetChoiceId ? { ...choice, ...patch } : choice
              )
            };
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const addChoice = (targetSceneId: string, targetActionId: string) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) => {
            if (actionId(action, actionIndex) !== targetActionId) return action;
            const choices = actionChoices(action);
            return {
              ...action,
              type: 'choice',
              action_type: 'choice',
              choices: [
                ...choices,
                {
                  id: `choice_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  label: `Choice ${choices.length + 1}`,
                  targetSceneId: ''
                }
              ]
            };
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const deleteChoice = (targetSceneId: string, targetActionId: string, targetChoiceId: string) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) => {
            if (actionId(action, actionIndex) !== targetActionId) return action;
            return {
              ...action,
              choices: actionChoices(action).filter((choice: any, choiceIndex: number) => choiceId(choice, choiceIndex) !== targetChoiceId)
            };
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const updateActionArrayField = (targetSceneId: string, targetActionId: string, field: 'effects' | 'conditions', updater: (items: any[]) => any[]) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) =>
            actionId(action, actionIndex) === targetActionId ? { ...action, [field]: updater(Array.isArray(action?.[field]) ? action[field] : []) } : action
          )
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const updateChoiceArrayField = (targetSceneId: string, targetActionId: string, targetChoiceId: string, field: 'effects' | 'conditions', updater: (items: any[]) => any[]) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.map((action, actionIndex) => {
            if (actionId(action, actionIndex) !== targetActionId) return action;
            return {
              ...action,
              choices: actionChoices(action).map((choice: any, choiceIndex: number) =>
                choiceId(choice, choiceIndex) === targetChoiceId
                  ? { ...choice, [field]: updater(Array.isArray(choice?.[field]) ? choice[field] : []) }
                  : choice
              )
            };
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const addEffectToAction = (targetSceneId: string, targetActionId: string) => {
    updateActionArrayField(targetSceneId, targetActionId, 'effects', items => [
      ...items,
      { id: `effect_manual_${Date.now()}`, type: 'add_affinity', characterId: '', amount: 1 }
    ]);
  };

  const updateActionEffect = (targetSceneId: string, targetActionId: string, effectIndex: number, patch: Record<string, unknown>) => {
    updateActionArrayField(targetSceneId, targetActionId, 'effects', items => items.map((item, index) => index === effectIndex ? { ...item, ...patch } : item));
  };

  const deleteActionEffect = (targetSceneId: string, targetActionId: string, effectIndex: number) => {
    updateActionArrayField(targetSceneId, targetActionId, 'effects', items => items.filter((_, index) => index !== effectIndex));
  };

  const addChoiceEffect = (targetSceneId: string, targetActionId: string, targetChoiceId: string) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'effects', items => [
      ...items,
      { id: `effect_manual_${Date.now()}`, type: 'add_affinity', characterId: '', amount: 1 }
    ]);
  };

  const updateChoiceEffect = (targetSceneId: string, targetActionId: string, targetChoiceId: string, effectIndex: number, patch: Record<string, unknown>) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'effects', items => items.map((item, index) => index === effectIndex ? { ...item, ...patch } : item));
  };

  const deleteChoiceEffect = (targetSceneId: string, targetActionId: string, targetChoiceId: string, effectIndex: number) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'effects', items => items.filter((_, index) => index !== effectIndex));
  };

  const addChoiceCondition = (targetSceneId: string, targetActionId: string, targetChoiceId: string) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'conditions', items => [
      ...items,
      { id: `condition_manual_${Date.now()}`, variableKey: 'affinity.', operator: 'greater_or_equal', value: 0 }
    ]);
  };

  const updateChoiceCondition = (targetSceneId: string, targetActionId: string, targetChoiceId: string, conditionIndex: number, patch: Record<string, unknown>) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'conditions', items => items.map((item, index) => index === conditionIndex ? { ...item, ...patch } : item));
  };

  const deleteChoiceCondition = (targetSceneId: string, targetActionId: string, targetChoiceId: string, conditionIndex: number) => {
    updateChoiceArrayField(targetSceneId, targetActionId, targetChoiceId, 'conditions', items => items.filter((_, index) => index !== conditionIndex));
  };

  const addAction = (targetSceneId: string) => {
    const currentScene = scenes.find((scene, index) => sceneId(scene, index) === targetSceneId);
    const actionCount = Array.isArray(currentScene?.actions) ? currentScene.actions.length : 0;
    const nextAction = createDraftAction(actionCount);
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId) return scene;
        return {
          ...scene,
          actions: [...(Array.isArray(scene.actions) ? scene.actions : []), nextAction]
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const deleteAction = (targetSceneId: string, targetActionId: string) => {
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        return {
          ...scene,
          actions: scene.actions.filter((action, actionIndex) => {
            const id = pickText(action?.id, action?.action_id) || `draft_action_${actionIndex}`;
            return id !== targetActionId;
          })
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes,
        voice_tasks: Array.isArray(script.voice_tasks)
          ? script.voice_tasks.filter((task: any) => pickText(task?.action_id, task?.actionId) !== targetActionId)
          : script.voice_tasks
      };
    });
  };

  const reorderActions = (targetSceneId: string, fromActionId: string, toActionId: string) => {
    if (!fromActionId || !toActionId || fromActionId === toActionId) return;
    updateDraftScript(script => {
      const updateScenes = (items: DraftScene[]) => items.map((scene, sceneIndex) => {
        if (sceneId(scene, sceneIndex) !== targetSceneId || !Array.isArray(scene.actions)) return scene;
        const fromIndex = scene.actions.findIndex((action, actionIndex) => (pickText(action?.id, action?.action_id) || `draft_action_${actionIndex}`) === fromActionId);
        const toIndex = scene.actions.findIndex((action, actionIndex) => (pickText(action?.id, action?.action_id) || `draft_action_${actionIndex}`) === toActionId);
        return {
          ...scene,
          actions: moveItem(scene.actions, fromIndex, toIndex)
        };
      });
      return {
        ...script,
        scenes: Array.isArray(script.scenes) ? updateScenes(script.scenes) : script.scenes,
        nodes: Array.isArray(script.nodes) ? updateScenes(script.nodes) : script.nodes
      };
    });
  };

  const handleActionDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    setDraggedActionId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const handleActionDrop = (event: DragEvent<HTMLElement>, targetSceneId: string, targetActionId: string) => {
    event.preventDefault();
    const sourceId = draggedActionId || event.dataTransfer.getData('text/plain');
    reorderActions(targetSceneId, sourceId, targetActionId);
    setDraggedActionId('');
  };

  const showSceneGraphScrollbars = () => {
    if (sceneGraphScrollbarTimerRef.current) {
      clearTimeout(sceneGraphScrollbarTimerRef.current);
      sceneGraphScrollbarTimerRef.current = null;
    }
    setSceneGraphScrollbarsVisible(true);
  };

  const hideSceneGraphScrollbars = () => {
    if (sceneGraphScrollbarTimerRef.current || sceneGraphPanning) return;
    setSceneGraphScrollbarsVisible(false);
  };

  const revealSceneGraphScrollbars = () => {
    setSceneGraphScrollbarsVisible(true);
    if (sceneGraphScrollbarTimerRef.current) {
      clearTimeout(sceneGraphScrollbarTimerRef.current);
    }
    sceneGraphScrollbarTimerRef.current = setTimeout(() => {
      setSceneGraphScrollbarsVisible(false);
      sceneGraphScrollbarTimerRef.current = null;
    }, 900);
  };

  const handleSceneGraphScrollbarHover = (event: ReactPointerEvent<HTMLDivElement>) => {
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
      showSceneGraphScrollbars();
      return;
    }
    hideSceneGraphScrollbars();
  };

  const updateSceneGraphZoom = (
    nextZoomValue: number,
    viewport = sceneGraphViewportRef.current,
    anchor?: { clientX: number; clientY: number }
  ) => {
    setSceneGraphZoom(previousZoom => {
      const nextZoom = normalizeSceneGraphZoom(nextZoomValue);
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
    revealSceneGraphScrollbars();
  };

  const handleSceneGraphWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-scene-graph-zoom-control="true"]')) return;
    const viewport = sceneGraphViewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    updateSceneGraphZoom(
      sceneGraphZoom + (event.deltaY > 0 ? -SCENE_GRAPH_ZOOM_STEP : SCENE_GRAPH_ZOOM_STEP),
      viewport,
      { clientX: event.clientX, clientY: event.clientY }
    );
  };

  const sceneGraphPointFromClient = (viewport: HTMLElement, clientX: number, clientY: number) => {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewport.scrollLeft) / sceneGraphZoom,
      y: (clientY - rect.top + viewport.scrollTop) / sceneGraphZoom
    };
  };

  const updateSceneGraphNodePosition = (targetSceneId: string, x: number, y: number) => {
    updateDraftScript(script => {
      const sceneMapPositions = normalizeSceneGraphPositions(script.metadata?.sceneMapPositions);
      return {
        ...script,
        metadata: {
          ...(script.metadata || {}),
          sceneMapPositions: {
            ...sceneMapPositions,
            [targetSceneId]: {
              x: Math.max(8, roundSceneGraphCoordinate(x)),
              y: Math.max(8, roundSceneGraphCoordinate(y))
            }
          }
        }
      };
    });
  };

  const connectDraftSceneToTarget = (scene: DraftScene, sceneIndex: number, targetSceneId: string): DraftScene => {
    const alreadyLinked = pickText((scene as any).defaultNextSceneId, (scene as any).default_next_scene_id) === targetSceneId
      || (Array.isArray(scene.actions) ? scene.actions : []).some(action =>
        pickText(action?.targetSceneId, action?.target_scene_id, action?.nextSceneId, action?.next_scene_id) === targetSceneId
        || actionChoices(action).some((choice: any) =>
          pickText(choice?.targetSceneId, choice?.target_scene_id, choice?.toSceneId, choice?.to_scene_id, choice?.nextSceneId, choice?.next_scene_id) === targetSceneId
        )
      );
    if (alreadyLinked) return scene;

    if (!pickText((scene as any).defaultNextSceneId, (scene as any).default_next_scene_id)) {
      return { ...scene, defaultNextSceneId: targetSceneId, default_next_scene_id: targetSceneId } as DraftScene;
    }

    const actions = Array.isArray(scene.actions) ? scene.actions : [];
    const choiceActionIndex = actions.findIndex(action =>
      action?.type === 'choice' || action?.action_type === 'choice' || actionChoices(action).length > 0
    );
    if (choiceActionIndex >= 0) {
      return {
        ...scene,
        actions: actions.map((action, actionIndex) => {
          if (actionIndex !== choiceActionIndex) return action;
          const choices = actionChoices(action);
          const unboundChoiceIndex = choices.findIndex((choice: any) =>
            !pickText(choice?.targetSceneId, choice?.target_scene_id, choice?.toSceneId, choice?.to_scene_id, choice?.nextSceneId, choice?.next_scene_id)
          );
          return {
            ...action,
            type: 'choice',
            action_type: 'choice',
            choices: unboundChoiceIndex >= 0
              ? choices.map((choice: any, choiceIndex: number) => choiceIndex === unboundChoiceIndex
                ? { ...choice, targetSceneId, target_scene_id: targetSceneId }
                : choice)
              : [...choices, createDraftChoice(targetSceneId, choices.length)]
          };
        })
      };
    }

    if (!actions.length) {
      return {
        ...scene,
        actions: [{
          id: `action_manual_${Date.now()}_${sceneIndex}`,
          type: 'choice',
          action_type: 'choice',
          speaker: 'Narrator',
          text: '',
          choices: [createDraftChoice(targetSceneId)]
        }]
      };
    }

    const lastActionIndex = actions.length - 1;
    return {
      ...scene,
      actions: actions.map((action, actionIndex) => actionIndex === lastActionIndex ? {
        ...action,
        type: 'choice',
        action_type: 'choice',
        choices: [...actionChoices(action), createDraftChoice(targetSceneId, actionChoices(action).length)]
      } : action)
    };
  };

  const connectSceneByPort = (fromSceneId: string, targetSceneId: string) => {
    if (!fromSceneId || !targetSceneId || fromSceneId === targetSceneId) return;
    updateDraftScript(script => mapDraftSceneCollections(script, items => items.map((scene, index) =>
      sceneId(scene, index) === fromSceneId ? connectDraftSceneToTarget(scene, index, targetSceneId) : scene
    )));
    setSelectedSceneId(fromSceneId);
    setSelectedSceneLinkId('');
  };

  const createSceneFromPort = (fromSceneId: string, position: { x: number; y: number }) => {
    const nextScene = createDraftScene(scenes.length, t('newScene', { index: scenes.length + 1 }));
    const nextSceneId = sceneId(nextScene);
    const nextPosition = {
      x: Math.max(8, roundSceneGraphCoordinate(position.x - SCENE_GRAPH_CARD_WIDTH / 2)),
      y: Math.max(8, roundSceneGraphCoordinate(position.y - SCENE_GRAPH_CARD_HEIGHT / 2))
    };
    updateDraftScript(script => {
      const nextScript = mapDraftSceneCollections(script, items => [
        ...items.map((scene, index) => sceneId(scene, index) === fromSceneId
          ? connectDraftSceneToTarget(scene, index, nextSceneId)
          : scene),
        nextScene
      ]);
      const sceneMapPositions = normalizeSceneGraphPositions(script.metadata?.sceneMapPositions);
      return {
        ...nextScript,
        entrySceneId: script.entrySceneId || nextSceneId,
        entry_scene_id: script.entry_scene_id || nextSceneId,
        metadata: {
          ...(script.metadata || {}),
          sceneMapPositions: {
            ...sceneMapPositions,
            [nextSceneId]: nextPosition
          }
        }
      };
    });
    setSelectedSceneId(nextSceneId);
    setSelectedSceneLinkId('');
  };

  const updateSceneLinkTarget = (link: DraftSceneLink, targetSceneId: string) => {
    const nextTargetSceneId = targetSceneId || undefined;
    const kind = draftSceneGraphLinkKind(link);
    if (kind === 'default') {
      updateSceneDefaultNext(link.fromSceneId, nextTargetSceneId || '');
    } else if (kind === 'jump' && link.fromActionId) {
      updateAction(link.fromSceneId, link.fromActionId, {
        targetSceneId: nextTargetSceneId,
        target_scene_id: nextTargetSceneId,
        nextSceneId: nextTargetSceneId,
        next_scene_id: nextTargetSceneId
      });
    } else if (kind === 'choice' && link.fromActionId && link.fromChoiceId) {
      updateChoice(link.fromSceneId, link.fromActionId, link.fromChoiceId, {
        targetSceneId: nextTargetSceneId,
        target_scene_id: nextTargetSceneId,
        toSceneId: nextTargetSceneId,
        to_scene_id: nextTargetSceneId
      });
    }
    if (!nextTargetSceneId) {
      setSelectedSceneLinkId('');
    }
  };

  const unlinkSceneGraphLink = (link: DraftSceneLink) => {
    updateSceneLinkTarget(link, '');
  };

  const clearSceneOutgoingLinks = (targetSceneId: string) => {
    updateDraftScript(script => mapDraftSceneCollections(script, items => items.map((scene, index) => {
      if (sceneId(scene, index) !== targetSceneId) return scene;
      return {
        ...scene,
        defaultNextSceneId: undefined,
        default_next_scene_id: undefined,
        actions: Array.isArray(scene.actions) ? scene.actions.map(action => ({
          ...action,
          targetSceneId: undefined,
          target_scene_id: undefined,
          nextSceneId: undefined,
          next_scene_id: undefined,
          choices: actionChoices(action).map((choice: any) => ({
            ...choice,
            targetSceneId: undefined,
            target_scene_id: undefined,
            toSceneId: undefined,
            to_scene_id: undefined,
            nextSceneId: undefined,
            next_scene_id: undefined
          }))
        })) : scene.actions
      };
    })));
    setSelectedSceneLinkId('');
  };

  const clearSceneIncomingLinks = (targetSceneId: string) => {
    if (!(incomingLinksBySceneId.get(targetSceneId) || []).length) return;
    updateDraftScript(script => mapDraftSceneCollections(script, items => items.map(scene => ({
      ...scene,
      defaultNextSceneId: (scene as any).defaultNextSceneId === targetSceneId ? undefined : (scene as any).defaultNextSceneId,
      default_next_scene_id: (scene as any).default_next_scene_id === targetSceneId ? undefined : (scene as any).default_next_scene_id,
      actions: Array.isArray(scene.actions) ? scene.actions.map(action => ({
        ...action,
        targetSceneId: action?.targetSceneId === targetSceneId ? undefined : action?.targetSceneId,
        target_scene_id: action?.target_scene_id === targetSceneId ? undefined : action?.target_scene_id,
        nextSceneId: action?.nextSceneId === targetSceneId ? undefined : action?.nextSceneId,
        next_scene_id: action?.next_scene_id === targetSceneId ? undefined : action?.next_scene_id,
        choices: actionChoices(action).map((choice: any) => ({
          ...choice,
          targetSceneId: choice?.targetSceneId === targetSceneId ? undefined : choice?.targetSceneId,
          target_scene_id: choice?.target_scene_id === targetSceneId ? undefined : choice?.target_scene_id,
          toSceneId: choice?.toSceneId === targetSceneId ? undefined : choice?.toSceneId,
          to_scene_id: choice?.to_scene_id === targetSceneId ? undefined : choice?.to_scene_id,
          nextSceneId: choice?.nextSceneId === targetSceneId ? undefined : choice?.nextSceneId,
          next_scene_id: choice?.next_scene_id === targetSceneId ? undefined : choice?.next_scene_id
        }))
      })) : scene.actions
    }))));
    setSelectedSceneLinkId('');
  };

  const focusSceneGraphLink = (link: DraftSceneLink) => {
    setSelectedSceneLinkId(link.id);
    setSelectedSceneId(link.fromSceneId);
  };

  const beginSceneGraphInputPortDrag = (event: ReactPointerEvent, targetSceneId: string) => {
    if (event.button !== 0) return;
    const viewport = event.currentTarget.closest('[data-draft-scene-graph-viewport="true"]') as HTMLElement | null;
    event.preventDefault();
    event.stopPropagation();
    const incomingLinks = incomingLinksBySceneId.get(targetSceneId) || [];
    const link = selectedSceneLink?.toSceneId === targetSceneId ? selectedSceneLink : incomingLinks[incomingLinks.length - 1];
    if (!viewport || !link) {
      setSelectedSceneId(targetSceneId);
      return;
    }

    const pointerStart = sceneGraphPointFromClient(viewport, event.clientX, event.clientY);
    setSelectedSceneLinkId(link.id);
    setSceneGraphDraftLink({ fromSceneId: link.fromSceneId, ...pointerStart });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const point = sceneGraphPointFromClient(viewport, moveEvent.clientX, moveEvent.clientY);
      setSceneGraphDraftLink({ fromSceneId: link.fromSceneId, ...point });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const point = sceneGraphPointFromClient(viewport, upEvent.clientX, upEvent.clientY);
      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-draft-scene-input-port]') as HTMLElement | null;
      const nextTargetSceneId = dropTarget?.dataset.draftSceneInputPort;
      const movedDistance = Math.hypot(point.x - pointerStart.x, point.y - pointerStart.y);

      setSceneGraphDraftLink(null);
      if (nextTargetSceneId && nextTargetSceneId !== link.fromSceneId) {
        updateSceneLinkTarget(link, nextTargetSceneId);
      } else if (movedDistance > 24) {
        unlinkSceneGraphLink(link);
      } else {
        focusSceneGraphLink(link);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphPortDrag = (event: ReactPointerEvent, fromSceneId: string, layout: { x: number; y: number }) => {
    if (event.button !== 0) return;
    const viewport = event.currentTarget.closest('[data-draft-scene-graph-viewport="true"]') as HTMLElement | null;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    const startPoint = {
      x: layout.x + SCENE_GRAPH_CARD_WIDTH,
      y: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2
    };
    setSceneGraphDraftLink({ fromSceneId, ...startPoint });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const point = sceneGraphPointFromClient(viewport, moveEvent.clientX, moveEvent.clientY);
      setSceneGraphDraftLink({ fromSceneId, ...point });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const point = sceneGraphPointFromClient(viewport, upEvent.clientX, upEvent.clientY);
      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-draft-scene-input-port]') as HTMLElement | null;
      const targetSceneId = dropTarget?.dataset.draftSceneInputPort;
      const movedDistance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);

      setSceneGraphDraftLink(null);
      if (targetSceneId && targetSceneId !== fromSceneId) {
        connectSceneByPort(fromSceneId, targetSceneId);
      } else if (movedDistance > 24) {
        createSceneFromPort(fromSceneId, point);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-draft-scene-graph-interactive="true"]')) return;
    const viewport = event.currentTarget;
    event.preventDefault();
    revealSceneGraphScrollbars();
    setSceneGraphPanning(true);
    const originX = event.clientX;
    const originY = event.clientY;
    const originScrollLeft = viewport.scrollLeft;
    const originScrollTop = viewport.scrollTop;

    const onPointerMove = (moveEvent: PointerEvent) => {
      viewport.scrollLeft = originScrollLeft - (moveEvent.clientX - originX);
      viewport.scrollTop = originScrollTop - (moveEvent.clientY - originY);
      revealSceneGraphScrollbars();
    };

    const onPointerUp = () => {
      setSceneGraphPanning(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const beginSceneGraphNodeDrag = (event: ReactPointerEvent, targetSceneId: string, layout: { x: number; y: number }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    const originLeft = layout.x;
    const originTop = layout.y;

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateSceneGraphNodePosition(
        targetSceneId,
        originLeft + (moveEvent.clientX - originX) / sceneGraphZoom,
        originTop + (moveEvent.clientY - originY) / sceneGraphZoom
      );
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const analyze = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!sourceText.trim()) return;
    setError('');
    setAnalyzing(true);
    try {
      const nextDraft = await preprocessVisualNovelStory({
        projectId,
        text: sourceText.trim(),
        intent
      });
      const script = { ...(nextDraft.script || {}), title: title || nextDraft.script?.title };
      const normalizedDraft = { ...nextDraft, script, intent };
      setDraft(normalizedDraft);
      const firstScene = draftScenes(normalizedDraft)[0];
      setSelectedSceneId(firstScene ? sceneId(firstScene) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('storyPreprocessFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  const commit = async () => {
    if (!draft) return;
    setError('');
    setCommitting(true);
    try {
      const script = syncSceneLinks({
        ...(draft.script || {}),
        title: title || draft.script?.title,
        project_id: draft.projectId
      });
      const payload = await commitVisualNovelStoryDraft({
        draft: { ...draft, script },
        settings: {
          entry: 'projects/new/story',
          title,
          sourceLength,
          requestedIntent: intent,
          storage: 'database-project-metadata'
        }
      });
      const savedProject = payload?.project || payload;
      if (payload?.dispatchError && savedProject && typeof savedProject === 'object') {
        savedProject.generationStatus = 'failed';
        savedProject.error = `Asset dispatch failed: ${payload.dispatchError}`;
      }
      localStorage.setItem('vn_project', JSON.stringify(savedProject));
      navigate('/workstation');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createProjectFailed'));
    } finally {
      setCommitting(false);
    }
  };

  const renderStructureTab = () => {
    if (!selectedScene) return null;
    const currentSceneId = sceneId(selectedScene);
    const viewToggle = (
      <div className="flex items-center justify-between gap-3 border border-white/10 bg-white/[0.03] p-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStructureView('lines')}
            className={`h-8 rounded-full px-3 text-xs ${structureView === 'lines' ? 'bg-primary text-black' : 'border border-white/10 text-white/55 hover:border-primary hover:text-primary'}`}
          >
            {t('linesView')}
          </button>
          <button
            type="button"
            onClick={() => setStructureView('graph')}
            className={`flex h-8 items-center gap-2 rounded-full px-3 text-xs ${structureView === 'graph' ? 'bg-primary text-black' : 'border border-white/10 text-white/55 hover:border-primary hover:text-primary'}`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t('sceneGraph')}
          </button>
        </div>
        <div className="text-[10px] text-white/35">{sceneLinks.length} {t('links')}</div>
      </div>
    );
    if (structureView === 'graph') {
      return (
        <div className="space-y-4">
          {viewToggle}
          {renderBranchesTab()}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {viewToggle}
        <div className="border border-white/10 bg-white/[0.03] p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs text-white/40">{t('sceneTitle')}</span>
              <input
                className="h-10 w-full border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none focus:border-primary"
                value={selectedScene.title || selectedScene.name || ''}
                onChange={event => updateScene(currentSceneId, { title: event.target.value })}
              />
            </label>
            <label>
              <span className="mb-2 block text-xs text-white/40">{t('type')}</span>
              <select
                className="h-10 w-full border border-white/10 bg-black/40 px-3 text-sm text-white/80 outline-none focus:border-primary"
                value={selectedScene.type || 'normal'}
                onChange={event => updateScene(currentSceneId, { type: event.target.value })}
              >
                <option value="normal">{t('normal')}</option>
                <option value="branch">{t('branch')}</option>
                <option value="ending">{t('ending')}</option>
                <option value="menu">{t('menu')}</option>
                <option value="system">{t('system')}</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-2 block text-xs text-white/40">{t('summary')}</span>
            <textarea
              className="min-h-20 w-full resize-none border border-white/10 bg-black/40 p-3 text-sm leading-relaxed text-white/80 outline-none focus:border-primary"
              value={selectedScene.summary || ''}
              onChange={event => updateScene(currentSceneId, { summary: event.target.value })}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-white/70">{t('actions')}</div>
          <button
            type="button"
            onClick={() => addAction(currentSceneId)}
            className="flex h-8 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addAction')}
          </button>
        </div>

        <div className="space-y-2">
          {(Array.isArray(selectedScene.actions) ? selectedScene.actions : []).map((action, index) => {
            const id = actionId(action, index);
            return (
              <article key={id} className="border border-white/10 bg-white/[0.025] p-3">
                <div
                  draggable
                  onDragStart={event => handleActionDragStart(event, id)}
                  onDragEnd={() => setDraggedActionId('')}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => handleActionDrop(event, currentSceneId, id)}
                  className="mb-2 flex cursor-grab items-center justify-between gap-2 text-[10px] text-white/35 active:cursor-grabbing"
                >
                  <span className="inline-flex items-center gap-1"><GripVertical className="h-3 w-3" /> {action.type || action.action_type || 'line'} · #{index + 1}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{id}</span>
                    <button
                      type="button"
                      onClick={() => deleteAction(currentSceneId, id)}
                      className="rounded-full border border-white/10 p-1 text-white/35 hover:border-red-300/50 hover:text-red-200"
                      aria-label={t('delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-[9rem_9rem_1fr]">
                  <input
                    className="h-9 border border-white/10 bg-black/40 px-2 text-xs text-white/75 outline-none focus:border-primary"
                    value={action.speaker || action.speaker_name || action.speaker_id || ''}
                    onChange={event => updateAction(currentSceneId, id, { speaker: event.target.value })}
                    placeholder={t('speaker')}
                  />
                  <input
                    className="h-9 border border-white/10 bg-black/40 px-2 text-xs text-white/75 outline-none focus:border-primary"
                    value={action.emotion || ''}
                    onChange={event => updateAction(currentSceneId, id, { emotion: event.target.value })}
                    placeholder={t('emotion')}
                  />
                  <textarea
                    className="min-h-16 resize-none border border-white/10 bg-black/40 p-2 text-xs leading-relaxed text-white/75 outline-none focus:border-primary"
                    value={action.text || action.dialogue || action.line || ''}
                    onChange={event => updateAction(currentSceneId, id, { text: event.target.value })}
                    placeholder={t('actionText')}
                  />
                </div>
              </article>
            );
          })}
          {(!Array.isArray(selectedScene.actions) || selectedScene.actions.length === 0) && (
            <div className="flex min-h-24 items-center justify-center border border-dashed border-white/10 text-xs text-white/35">
              {t('noActionsInScene')}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCharactersTab = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-white/45">{t('characterCardsReviewHint')}</div>
        <button
          type="button"
          onClick={addCharacter}
          className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('addCharacter')}
        </button>
      </div>
      {characters.map((character, index) => {
        const id = characterId(character, index);
        const card = {
          ...(typeof character.characterCard === 'object' && character.characterCard ? character.characterCard : {}),
          ...(typeof character.character_card === 'object' && character.character_card ? character.character_card : {})
        } as Record<string, unknown>;
        return (
          <article key={id} className="border border-white/10 bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white/80">{character.name || id}</div>
                <div className="mt-1 truncate text-[10px] text-white/35">{id}</div>
              </div>
              <button
                type="button"
                onClick={() => deleteCharacter(id)}
                className="rounded-full border border-white/10 p-2 text-white/35 hover:border-red-300/50 hover:text-red-200"
                aria-label={t('delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <input className="h-9 border border-white/10 bg-black/40 px-2 text-xs text-white/75 outline-none focus:border-primary" value={character.name || ''} onChange={event => updateCharacter(id, { name: event.target.value })} placeholder={t('name')} />
              <input className="h-9 border border-white/10 bg-black/40 px-2 text-xs text-white/75 outline-none focus:border-primary" value={character.role || ''} onChange={event => updateCharacter(id, { role: event.target.value })} placeholder={t('role')} />
              <input className="h-9 border border-white/10 bg-black/40 px-2 text-xs text-white/75 outline-none focus:border-primary" value={character.voice || ''} onChange={event => updateCharacter(id, { voice: event.target.value })} placeholder={t('voice')} />
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <textarea className="min-h-20 resize-none border border-white/10 bg-black/40 p-2 text-xs leading-relaxed text-white/75 outline-none focus:border-primary" value={pickText(card.appearance)} onChange={event => updateCharacterCard(id, { appearance: event.target.value })} placeholder={t('appearance')} />
              <textarea className="min-h-20 resize-none border border-white/10 bg-black/40 p-2 text-xs leading-relaxed text-white/75 outline-none focus:border-primary" value={pickText(card.outfit)} onChange={event => updateCharacterCard(id, { outfit: event.target.value })} placeholder={t('outfit')} />
              <textarea className="min-h-20 resize-none border border-white/10 bg-black/40 p-2 text-xs leading-relaxed text-white/75 outline-none focus:border-primary" value={pickText(card.style)} onChange={event => updateCharacterCard(id, { style: event.target.value })} placeholder={t('style')} />
            </div>
            <textarea
              className="mt-2 min-h-16 w-full resize-none border border-white/10 bg-black/40 p-2 text-xs leading-relaxed text-white/75 outline-none focus:border-primary"
              value={pickText(card.identity_rules)}
              onChange={event => updateCharacterCard(id, { identity_rules: event.target.value })}
              placeholder={t('identityRules')}
            />
          </article>
        );
      })}
      {characters.length === 0 && (
        <div className="flex min-h-48 items-center justify-center border border-dashed border-white/10 text-xs text-white/35">
          {t('noCharacterCards')}
        </div>
      )}
    </div>
  );

  const renderBranchesTab = () => {
    const sceneByDraftId = new Map(scenes.map((scene, index) => [sceneId(scene, index), scene]));
    const entrySceneId = pickText((draft?.script as any)?.entrySceneId, (draft?.script as any)?.entry_scene_id) || sceneId(scenes[0] || {}, 0);
    return (
      <div className="relative min-h-[34rem]" onWheel={handleSceneGraphWheel}>
        <div
          ref={sceneGraphViewportRef}
          data-draft-scene-graph-viewport="true"
          className={`scene-map-scrollbars h-[34rem] touch-none overflow-auto rounded-lg border border-white/10 bg-black/35 ${sceneGraphScrollbarsVisible || sceneGraphPanning ? 'is-scrolling' : ''} ${sceneGraphPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={beginSceneGraphPan}
          onPointerMove={handleSceneGraphScrollbarHover}
          onPointerLeave={hideSceneGraphScrollbars}
          onScroll={revealSceneGraphScrollbars}
        >
          <div
            className="relative"
            style={{
              width: sceneGraphLayout.width * sceneGraphZoom,
              height: sceneGraphLayout.height * sceneGraphZoom
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: sceneGraphLayout.width,
                height: sceneGraphLayout.height,
                transform: `scale(${sceneGraphZoom})`
              }}
            >
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${sceneGraphLayout.width} ${sceneGraphLayout.height}`} aria-hidden="true">
              <defs>
                <marker id="preprocess-scene-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
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
                    data-draft-scene-graph-interactive="true"
                    className="cursor-pointer"
                    onClick={() => focusSceneGraphLink(link)}
                  >
                    <path
                      d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      markerEnd="url(#preprocess-scene-arrow)"
                      className={selected ? 'stroke-primary' : sceneGraphLinkClass(link)}
                      strokeWidth={selected ? 2.6 : 1.7}
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
              {sceneGraphDraftLink && (() => {
                const from = sceneGraphLayout.nodeById.get(sceneGraphDraftLink.fromSceneId);
                if (!from) return null;
                const startX = from.x + SCENE_GRAPH_CARD_WIDTH;
                const startY = from.y + SCENE_GRAPH_CARD_HEIGHT / 2;
                const endX = sceneGraphDraftLink.x;
                const endY = sceneGraphDraftLink.y;
                const midX = startX + Math.max(42, Math.abs(endX - startX) / 2);
                return (
                  <path
                    d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    markerEnd="url(#preprocess-scene-arrow)"
                    className="stroke-primary"
                    strokeWidth={2.3}
                    strokeDasharray="5 5"
                  />
                );
              })()}
            </svg>
            {sceneGraphLayout.nodes.map(layout => {
              const scene = sceneByDraftId.get(layout.id);
              if (!scene) return null;
              const links = outgoingLinksBySceneId.get(layout.id) || [];
              const active = layout.id === sceneId(selectedScene || {}, 0);
              const isolated = layout.id !== entrySceneId && !incomingSceneIds.has(layout.id);
              return (
                <div key={`draft_graph_group_${layout.id}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedSceneId(layout.id);
                      setSelectedSceneLinkId('');
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedSceneId(layout.id);
                        setSelectedSceneLinkId('');
                      }
                    }}
                    onPointerDown={event => beginSceneGraphNodeDrag(event, layout.id, layout)}
                    data-draft-scene-graph-interactive="true"
                    className={`absolute cursor-grab rounded-lg border p-2 text-left shadow-[0_18px_42px_rgba(0,0,0,0.28)] transition-colors active:cursor-grabbing ${
                      active
                        ? 'border-primary/60 bg-primary/[0.08]'
                        : isolated
                          ? 'border-yellow-300/30 bg-yellow-300/[0.05] hover:border-yellow-300/55'
                          : 'border-white/10 bg-[#111] hover:border-white/30'
                    }`}
                    style={{ left: layout.x, top: layout.y, width: SCENE_GRAPH_CARD_WIDTH, height: SCENE_GRAPH_CARD_HEIGHT }}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{scene.title || scene.name || layout.id}</span>
                      {layout.id === entrySceneId && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      {isolated && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-200" />}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40">{sceneTypeLabel(scene.type)}</span>
                      {scene.type === 'ending' && <span className="rounded-full border border-emerald-300/25 px-1.5 py-0.5 text-[9px] text-emerald-200">{t('ending')}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-white/35">
                      <span>{(Array.isArray(scene.actions) ? scene.actions : []).length} {t('actions')}</span>
                      <span>{links.length} {t('outgoing')}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-draft-scene-graph-interactive="true"
                    data-draft-scene-input-port={layout.id}
                    onPointerDown={event => beginSceneGraphInputPortDrag(event, layout.id)}
                    onContextMenu={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      clearSceneIncomingLinks(layout.id);
                    }}
                    className="absolute z-10 h-5 w-5 cursor-crosshair touch-none rounded-full border border-white/25 bg-black shadow-[0_0_0_3px_rgba(255,255,255,0.04)] transition-colors hover:border-primary hover:bg-primary/15"
                    style={{ left: layout.x - 10, top: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2 - 10 }}
                    title={t('entryPort')}
                  >
                    <span className="mx-auto block h-2 w-2 rounded-full bg-white/45" />
                  </button>
                  <button
                    type="button"
                    data-draft-scene-graph-interactive="true"
                    onPointerDown={event => beginSceneGraphPortDrag(event, layout.id, layout)}
                    onContextMenu={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      clearSceneOutgoingLinks(layout.id);
                    }}
                    className={`absolute z-10 h-5 w-5 cursor-crosshair touch-none rounded-full border shadow-[0_0_0_3px_rgba(222,219,200,0.06)] transition-colors ${links.length ? 'border-primary bg-primary/20 hover:bg-primary/30' : 'border-white/25 bg-black hover:border-primary hover:bg-primary/15'}`}
                    style={{ left: layout.x + SCENE_GRAPH_CARD_WIDTH - 10, top: layout.y + SCENE_GRAPH_CARD_HEIGHT / 2 - 10 }}
                    title={t('outputPort')}
                  >
                    <span className={`mx-auto block h-2 w-2 rounded-full ${links.length ? 'bg-primary' : 'bg-white/45'}`} />
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        </div>

        <div
          data-scene-graph-zoom-control="true"
          className="absolute right-3 top-3 z-20 flex h-8 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur"
          onPointerDown={event => event.stopPropagation()}
          onWheel={event => event.stopPropagation()}
        >
          <input
            type="range"
            min={Math.round(SCENE_GRAPH_MIN_ZOOM * 100)}
            max={Math.round(SCENE_GRAPH_MAX_ZOOM * 100)}
            step="1"
            value={Math.round(sceneGraphZoom * 100)}
            onChange={event => updateSceneGraphZoom(Number(event.target.value) / 100)}
            className="h-1 w-28 accent-primary"
            title={`${t('scale')} ${Math.round(sceneGraphZoom * 100)}%`}
          />
          <span className="w-9 text-right text-[10px] tabular-nums text-white/60">{Math.round(sceneGraphZoom * 100)}%</span>
        </div>

        <div className="hidden">
          <div className="flex items-center gap-2 text-xs font-medium text-white/70">
            <Link2 className="h-4 w-4 text-primary" />
            连接编辑
          </div>
          {scenes.map((scene, sceneIndex) => {
            const id = sceneId(scene, sceneIndex);
            const sceneActions = Array.isArray(scene.actions) ? scene.actions : [];
            return (
              <section key={id} className="border border-white/10 bg-white/[0.025] p-3">
                <div className="mb-2 truncate text-xs font-medium text-white/75">{scene.title || scene.name || id}</div>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-white/35">默认下一场景</span>
                  <select
                    className="h-8 w-full border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                    value={pickText((scene as any).defaultNextSceneId, (scene as any).default_next_scene_id)}
                    onChange={event => updateSceneDefaultNext(id, event.target.value)}
                  >
                    <option value="">None</option>
                    {scenes.filter((target, targetIndex) => sceneId(target, targetIndex) !== id).map((target, targetIndex) => {
                      const targetId = sceneId(target, targetIndex);
                      return <option key={targetId} value={targetId}>{target.title || target.name || targetId}</option>;
                    })}
                  </select>
                </label>
                <div className="mt-3 space-y-2">
                  {sceneActions.map((action, actionIndex) => {
                    const idAction = actionId(action, actionIndex);
                    return (
                      <div key={idAction} className="border border-white/10 bg-black/25 p-2">
                        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/40">
                          <span className="truncate">{action.type || action.action_type || 'line'} · {pickText(action.text, action.dialogue, action.line) || idAction}</span>
                          <button type="button" onClick={() => addChoice(id, idAction)} className="shrink-0 rounded-full border border-white/10 px-2 py-1 hover:border-primary hover:text-primary">+ choice</button>
                        </div>
                        <select
                          className="h-8 w-full border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                          value={pickText(action.targetSceneId, action.target_scene_id, action.nextSceneId, action.next_scene_id)}
                          onChange={event => updateAction(id, idAction, { targetSceneId: event.target.value || undefined, target_scene_id: event.target.value || undefined })}
                        >
                          <option value="">No action jump</option>
                          {scenes.map((target, targetIndex) => {
                            const targetId = sceneId(target, targetIndex);
                            return <option key={targetId} value={targetId}>{target.title || target.name || targetId}</option>;
                          })}
                        </select>
                        <div className="mt-2 rounded border border-white/10 bg-white/[0.02] p-2">
                          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/40">
                            <span>Text affinity</span>
                            <button type="button" onClick={() => addEffectToAction(id, idAction)} className="rounded-full border border-white/10 px-2 py-1 hover:border-primary hover:text-primary">+ effect</button>
                          </div>
                          {(Array.isArray(action.effects) ? action.effects : []).map((effect: any, effectIndex: number) => (
                            <div key={effect.id || effectIndex} className="mt-2 grid grid-cols-[1fr_5rem_auto] gap-2">
                              <select
                                className="h-8 min-w-0 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                value={effect.characterId || ''}
                                onChange={event => updateActionEffect(id, idAction, effectIndex, { type: 'add_affinity', characterId: event.target.value, variableKey: event.target.value ? `affinity.${event.target.value}` : '' })}
                              >
                                <option value="">角色</option>
                                {characters.map((character, characterIndex) => {
                                  const idCharacter = characterId(character, characterIndex);
                                  return <option key={idCharacter} value={idCharacter}>{character.name || idCharacter}</option>;
                                })}
                              </select>
                              <input
                                className="h-8 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                type="number"
                                value={Number(effect.amount || 0)}
                                onChange={event => updateActionEffect(id, idAction, effectIndex, { type: 'add_affinity', amount: Number(event.target.value) })}
                              />
                              <button type="button" onClick={() => deleteActionEffect(id, idAction, effectIndex)} className="h-8 border border-white/10 px-2 text-white/35 hover:border-red-300/50 hover:text-red-200">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                        {actionChoices(action).map((choice: any, choiceIndex: number) => {
                          const idChoice = choiceId(choice, choiceIndex);
                          return (
                            <div key={idChoice} className="mt-2 grid grid-cols-[1fr_minmax(8rem,12rem)_auto] gap-2">
                              <input
                                className="h-8 min-w-0 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                value={choice.label || choice.text || ''}
                                onChange={event => updateChoice(id, idAction, idChoice, { label: event.target.value })}
                                placeholder="choice label"
                              />
                              <select
                                className="h-8 min-w-0 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                value={pickText(choice.targetSceneId, choice.target_scene_id, choice.toSceneId, choice.to_scene_id)}
                                onChange={event => updateChoice(id, idAction, idChoice, { targetSceneId: event.target.value || undefined, target_scene_id: event.target.value || undefined })}
                              >
                                <option value="">No target</option>
                                {scenes.map((target, targetIndex) => {
                                  const targetId = sceneId(target, targetIndex);
                                  return <option key={targetId} value={targetId}>{target.title || target.name || targetId}</option>;
                                })}
                              </select>
                              <button type="button" onClick={() => deleteChoice(id, idAction, idChoice)} className="h-8 border border-white/10 px-2 text-white/35 hover:border-red-300/50 hover:text-red-200">
                                <Trash2 className="h-3 w-3" />
                              </button>
                              <div className="col-span-3 grid gap-2 md:grid-cols-2">
                                <div className="rounded border border-white/10 bg-white/[0.02] p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/40">
                                    <span>Affinity condition</span>
                                    <button type="button" onClick={() => addChoiceCondition(id, idAction, idChoice)} className="rounded-full border border-white/10 px-2 py-1 hover:border-primary hover:text-primary">+ condition</button>
                                  </div>
                                  {(Array.isArray(choice.conditions) ? choice.conditions : []).map((condition: any, conditionIndex: number) => (
                                    <div key={condition.id || conditionIndex} className="mt-2 grid grid-cols-[1fr_5rem_auto] gap-2">
                                      <select
                                        className="h-8 min-w-0 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                        value={String(condition.variableKey || '').replace('affinity.', '')}
                                        onChange={event => updateChoiceCondition(id, idAction, idChoice, conditionIndex, { variableKey: event.target.value ? `affinity.${event.target.value}` : 'affinity.' })}
                                      >
                                        <option value="">角色</option>
                                        {characters.map((character, characterIndex) => {
                                          const idCharacter = characterId(character, characterIndex);
                                          return <option key={idCharacter} value={idCharacter}>{character.name || idCharacter}</option>;
                                        })}
                                      </select>
                                      <input
                                        className="h-8 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                        type="number"
                                        value={Number(condition.value || 0)}
                                        onChange={event => updateChoiceCondition(id, idAction, idChoice, conditionIndex, { operator: 'greater_or_equal', value: Number(event.target.value) })}
                                      />
                                      <button type="button" onClick={() => deleteChoiceCondition(id, idAction, idChoice, conditionIndex)} className="h-8 border border-white/10 px-2 text-white/35 hover:border-red-300/50 hover:text-red-200">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <div className="rounded border border-white/10 bg-white/[0.02] p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/40">
                                    <span>Choice affinity</span>
                                    <button type="button" onClick={() => addChoiceEffect(id, idAction, idChoice)} className="rounded-full border border-white/10 px-2 py-1 hover:border-primary hover:text-primary">+ effect</button>
                                  </div>
                                  {(Array.isArray(choice.effects) ? choice.effects : []).map((effect: any, effectIndex: number) => (
                                    <div key={effect.id || effectIndex} className="mt-2 grid grid-cols-[1fr_5rem_auto] gap-2">
                                      <select
                                        className="h-8 min-w-0 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                        value={effect.characterId || ''}
                                        onChange={event => updateChoiceEffect(id, idAction, idChoice, effectIndex, { type: 'add_affinity', characterId: event.target.value, variableKey: event.target.value ? `affinity.${event.target.value}` : '' })}
                                      >
                                        <option value="">角色</option>
                                        {characters.map((character, characterIndex) => {
                                          const idCharacter = characterId(character, characterIndex);
                                          return <option key={idCharacter} value={idCharacter}>{character.name || idCharacter}</option>;
                                        })}
                                      </select>
                                      <input
                                        className="h-8 border border-white/10 bg-black px-2 text-xs text-white/75 outline-none focus:border-primary"
                                        type="number"
                                        value={Number(effect.amount || 0)}
                                        onChange={event => updateChoiceEffect(id, idAction, idChoice, effectIndex, { type: 'add_affinity', amount: Number(event.target.value) })}
                                      />
                                      <button type="button" onClick={() => deleteChoiceEffect(id, idAction, idChoice, effectIndex)} className="h-8 border border-white/10 px-2 text-white/35 hover:border-red-300/50 hover:text-red-200">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex h-20 items-center justify-between border-b border-white/10 px-6 md:px-10">
        <Link to="/" className="text-xl font-semibold tracking-tight text-primary">Ariadne</Link>
        <div className="flex items-center gap-3">
          <Link to="/projects/new" className="hidden rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 hover:border-primary hover:text-primary md:inline-flex">
            {t('blankProject')}
          </Link>
          <span className="hidden text-sm text-white/45 md:inline">{user?.displayName || user?.username}</span>
          <button
            type="button"
            onClick={toggleLocale}
            className="flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
            aria-label={t('languageToggle')}
          >
            <Languages className="h-3.5 w-3.5" />
            {locale === 'zh-CN' ? '中' : 'EN'}
          </button>
          <button
            type="button"
            onClick={() => logout().then(() => navigate('/'))}
            className="flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('logout')}
          </button>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-5rem)] grid-cols-1 lg:grid-cols-[22rem_1fr]">
        <form onSubmit={analyze} className="flex min-h-0 flex-col border-b border-white/10 bg-black/80 lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 p-5">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3 py-1 text-xs text-primary/70">
              <Sparkles className="h-3.5 w-3.5" />
              {t('storyPreprocess')}
            </div>
            <h1 className="text-3xl font-medium text-primary">{t('storyPreprocess')}</h1>
            <div className="mt-4 grid gap-3">
              <label>
                <span className="mb-2 block text-xs text-white/45">{t('projectName')}</span>
                <input
                  className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-primary"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                />
              </label>
              <div>
                <div className="mb-2 text-xs text-white/45">{t('parseIntent')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {INTENTS.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setIntent(item.id)}
                      className={`border p-3 text-left transition-colors ${intent === item.id ? 'border-primary bg-primary/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                    >
                      <div className="text-xs font-medium text-white/85">{t(item.labelKey)}</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-white/35">{t(item.descriptionKey)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-5">
            <label className="flex min-h-0 flex-1 flex-col">
              <span className="mb-2 flex items-center justify-between text-xs text-white/45">
                <span>{t('storyText')}</span>
                <span>{sourceLength} chars</span>
              </span>
              <textarea
                className="min-h-72 flex-1 resize-none border border-white/10 bg-white/[0.035] p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/25 focus:border-primary"
                value={sourceText}
                onChange={event => setSourceText(event.target.value)}
                placeholder={t('storyTextPlaceholder')}
              />
            </label>
            {error && (
              <div className="mt-3 border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100/80">{error}</div>
            )}
            <button
              type="submit"
              disabled={analyzing || !sourceText.trim()}
              className="mt-4 flex h-11 items-center justify-between bg-primary pl-4 pr-1 text-sm font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{analyzing ? t('analyzing') : t('startPreprocess')}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black">
                {analyzing ? <RefreshCw className="h-4 w-4 animate-spin text-primary" /> : <Wand2 className="h-4 w-4 text-primary" />}
              </span>
            </button>
          </div>
        </form>

        <section className="grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_1fr]">
          <aside className="min-h-0 border-b border-white/10 p-5 xl:border-b-0 xl:border-r">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white/80">
              <FileText className="h-4 w-4 text-primary" />
              {t('draftReview')}
            </div>
            {draft ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-center text-[10px] text-white/45">
                  <div className="border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-sm text-white/80">{draft.review.sceneCount || scenes.length || 0}</div>
                    <div>{t('scenes')}</div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-sm text-white/80">{draft.review.actionCount || 0}</div>
                    <div>{t('actions')}</div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-sm text-white/80">{draft.review.assetTaskCount || 0}</div>
                    <div>{t('images')}</div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-sm text-white/80">{draft.review.voiceTaskCount || 0}</div>
                    <div>{t('voices')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addScene}
                  className="mt-4 flex h-9 w-full items-center justify-center gap-2 border border-white/10 bg-white/[0.03] text-xs text-white/65 hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('add')} {t('scene')}
                </button>
                <div className="mt-4 max-h-[54vh] space-y-2 overflow-y-auto pr-1">
                  {scenes.map((scene, index) => {
                    const id = sceneId(scene, index);
                    const selected = id === sceneId(selectedScene || {}, 0);
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={event => handleSceneDragStart(event, id)}
                        onDragEnd={() => setDraggedSceneId('')}
                        onDragOver={event => event.preventDefault()}
                        onDrop={event => handleSceneDrop(event, id)}
                        className={`w-full border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSceneId(id)}
                          className="block w-full text-left"
                        >
                          <div className="truncate text-xs font-medium text-white/80">{scene.title || scene.name || `Scene ${index + 1}`}</div>
                          <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/40">{scene.summary || id}</div>
                          <div className="mt-2 text-[10px] text-white/30">{t('sceneActionsReorder', { count: Array.isArray(scene.actions) ? scene.actions.length : 0 })}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteScene(id)}
                          disabled={scenes.length <= 1}
                          className="mt-2 inline-flex h-7 items-center gap-1 rounded-full border border-white/10 px-2 text-[10px] text-white/35 hover:border-red-300/50 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('delete')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex min-h-72 items-center justify-center border border-dashed border-white/10 p-6 text-center text-xs text-white/35">
                {t('waitingPreprocessResult')}
              </div>
            )}
          </aside>

          <div className="min-h-0 overflow-y-auto p-5">
            {draft && selectedScene ? (
              <div className="space-y-4">
                <div className="border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/85">{draft.script?.title || title}</div>
                      <div className="mt-1 text-xs text-white/35">
                        {t('draftStats', {
                          mode: intentLabel(draft.mode || ''),
                          intent: intentLabel(draft.intent || intent),
                          scenes: scenes.length,
                          characters: characters.length,
                          links: sceneLinks.length
                        })}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 px-2 py-1 text-[10px] text-emerald-100/80">
                      <CheckCircle2 className="h-3 w-3" />
                      {t('parsed')}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {REVIEW_TABS.map(tab => {
                      const Icon = tab.icon;
                      const active = reviewTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setReviewTab(tab.id)}
                          className={`flex h-10 items-center justify-center gap-2 border text-xs transition-colors ${active ? 'border-primary bg-primary/[0.08] text-primary' : 'border-white/10 bg-black/30 text-white/55 hover:border-white/25 hover:text-white/75'}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {t(tab.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {reviewTab === 'structure' && renderStructureTab()}
                {reviewTab === 'characters' && renderCharactersTab()}

                <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-black/95 p-4">
                  <div className="text-xs text-white/35">
                    {t('preprocessMetadataHint')}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="flex h-10 items-center gap-2 rounded-full border border-white/10 px-4 text-xs text-white/55 hover:border-white/30 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t('clearDraft')}
                    </button>
                    <button
                      type="button"
                      onClick={commit}
                      disabled={committing}
                      className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                    >
                      {committing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      {t('createProjectAndGenerate')}
                    </button>
                </div>
                  </div>
              </div>
            ) : (
              <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
                <div className="max-w-sm text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.06]">
                    <Wand2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-sm font-medium text-white/80">Create from story text</div>
                  <div className="mt-2 text-xs leading-relaxed text-white/40">
                    {t('reviewPlaceholder')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
