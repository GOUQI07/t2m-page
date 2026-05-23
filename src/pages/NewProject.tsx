import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, FolderPlus, LogOut, Sparkles } from 'lucide-react';
import { createBackendProject } from '../api/vnPersistence';
import { useAuth } from '../auth/AuthContext';
import type { VNNode, VNProjectState } from '../types/vn';

const VN_SCHEMA_VERSION = 2;

type TemplateId = 'blank' | 'branch';

function safeProjectId(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'visual-novel';
  return `${slug}_${Date.now().toString(36)}`;
}

function lineAction(id: string, speaker: string, text = '') {
  return {
    id,
    type: 'line' as const,
    speaker,
    text,
    start: 0,
    startTime: 0,
    duration: 3,
    track: 'script' as const,
    lane: 0,
    locked: false,
    layout: { x: 0, y: 0, scale: 1 }
  };
}

function buildScenes(template: TemplateId, entryTitle: string, summary: string): VNNode[] {
  if (template === 'branch') {
    return [
      {
        id: 'scene_start',
        title: entryTitle || 'Start',
        summary,
        type: 'branch',
        status: 'done',
        tags: ['start'],
        position: { x: 0, y: 0 },
        actions: [
          lineAction('action_start_1', 'Narrator', ''),
          {
            ...lineAction('choice_start_1', 'Narrator', '请选择接下来的行动。'),
            type: 'choice' as const,
            duration: 2,
            choices: [
              { id: 'choice_stay', label: '留下', targetSceneId: 'scene_stay', effects: [{ id: 'effect_affinity', type: 'add_affinity', variableKey: 'affinity.heroine', amount: 1 }] },
              { id: 'choice_leave', label: '离开', targetSceneId: 'scene_leave', effects: [{ id: 'effect_left', type: 'set_flag', variableKey: 'flag.left_room', value: true }] }
            ]
          }
        ]
      },
      {
        id: 'scene_stay',
        title: 'Stay',
        summary: 'The player stays and deepens the scene.',
        type: 'normal',
        status: 'done',
        tags: [],
        position: { x: 260, y: -80 },
        actions: [lineAction('action_stay_1', 'Narrator', '')],
        defaultNextSceneId: 'scene_ending'
      },
      {
        id: 'scene_leave',
        title: 'Leave',
        summary: 'The player leaves and changes the route.',
        type: 'normal',
        status: 'done',
        tags: [],
        position: { x: 260, y: 120 },
        actions: [lineAction('action_leave_1', 'Narrator', '')],
        defaultNextSceneId: 'scene_ending'
      },
      {
        id: 'scene_ending',
        title: 'Ending',
        summary: 'A temporary ending scene.',
        type: 'ending',
        status: 'done',
        tags: ['ending'],
        position: { x: 540, y: 20 },
        actions: [{ ...lineAction('action_ending_1', 'Narrator', ''), type: 'ending' as const }]
      }
    ];
  }

  return [
    {
      id: 'scene_start',
      title: entryTitle || 'Start',
      summary,
      type: 'normal',
      status: 'done',
      tags: ['start'],
      position: { x: 0, y: 0 },
      actions: [lineAction('action_start_1', 'Narrator', '')]
    }
  ];
}

export function NewProject() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('Untitled Visual Novel');
  const [entryTitle, setEntryTitle] = useState('Start');
  const [summary, setSummary] = useState('');
  const [template, setTemplate] = useState<TemplateId>('branch');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const projectId = useMemo(() => safeProjectId(title), [title]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const nodes = buildScenes(template, entryTitle, summary);
      const now = new Date().toISOString();
      const project: VNProjectState = {
        schemaVersion: VN_SCHEMA_VERSION,
        projectId,
        id: projectId,
        title,
        entrySceneId: 'scene_start',
        timelineMode: 'script',
        nodes,
        scenes: nodes,
        assets: [],
        characters: [],
        variables: template === 'branch'
          ? [
              { key: 'flag.left_room', label: 'Left Room', type: 'boolean', defaultValue: false, scope: 'global' },
              { key: 'affinity.heroine', label: 'Heroine Affinity', type: 'number', defaultValue: 0, scope: 'character' }
            ]
          : [],
        metadata: {
          createdBy: user?.id,
          createdFrom: 'new-project',
          createdAt: now
        },
        generationStatus: 'idle'
      };

      const saved = await createBackendProject(project);
      const nextProject = saved && typeof saved === 'object' ? saved : project;
      localStorage.setItem('vn_project', JSON.stringify(nextProject));
      navigate('/workstation');
    } catch (error) {
      setError(error instanceof Error ? error.message : '创建工程失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="new-project-page" className="min-h-screen bg-black text-white">
      <header className="flex h-20 items-center justify-between border-b border-white/10 px-6 md:px-10">
        <Link to="/" className="text-xl font-semibold tracking-tight text-primary">Ariadne</Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-white/45 md:inline">{user?.displayName || user?.username}</span>
          <button
            type="button"
            onClick={() => logout().then(() => navigate('/'))}
            className="flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-white/60 hover:border-primary hover:text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-5rem)] grid-cols-1 gap-8 px-6 py-8 md:grid-cols-[0.9fr_1.1fr] md:px-10 md:py-12">
        <section className="flex flex-col justify-between border border-white/10 bg-white/[0.03] p-6">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3 py-1 text-xs text-primary/70">
              <Sparkles className="h-3.5 w-3.5" />
              Project bootstrap
            </div>
            <h1 className="text-5xl font-medium leading-none text-primary md:text-7xl">
              New project
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/45">
              创建一个带入口场景、运行时 schema、时间线字段和可选分支模板的工程。进入 Workstation 后可以继续编辑场景图、变量和素材绑定。
            </p>
          </div>
          <div className="mt-10 grid gap-2 text-xs text-white/35">
            <div>Project ID</div>
            <div className="break-all border border-white/10 bg-black/50 p-3 font-mono text-primary/75">{projectId}</div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="border border-white/10 bg-black/70 p-5 md:p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-primary/40">Setup</div>
              <h2 className="mt-2 text-2xl font-medium text-primary">工程信息</h2>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/[0.06]">
              <FolderPlus className="h-5 w-5 text-primary" />
            </div>
          </div>

          <Link
            to="/projects/new/story"
            className="mb-5 flex items-center justify-between border border-primary/25 bg-primary/[0.06] p-4 text-left transition-colors hover:border-primary/70 hover:bg-primary/[0.1]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <FileText className="h-4 w-4" />
                从剧情文本开始
              </div>
              <div className="mt-2 text-xs leading-relaxed text-white/45">
                多场景/章节级预处理，审阅后创建项目并生成资源。
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
          </Link>

          <div className="grid gap-4">
            <label>
              <span className="mb-2 block text-xs text-white/45">工程名称</span>
              <input data-testid="new-project-title" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-primary" value={title} onChange={event => setTitle(event.target.value)} required />
            </label>
            <label>
              <span className="mb-2 block text-xs text-white/45">入口场景名称</span>
              <input data-testid="new-project-entry-title" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-primary" value={entryTitle} onChange={event => setEntryTitle(event.target.value)} required />
            </label>
            <label>
              <span className="mb-2 block text-xs text-white/45">概要</span>
              <textarea data-testid="new-project-summary" className="min-h-28 w-full resize-none border border-white/10 bg-white/[0.04] p-3 text-sm leading-relaxed text-white outline-none focus:border-primary" value={summary} onChange={event => setSummary(event.target.value)} placeholder="这个工程要讲什么故事？" />
            </label>
          </div>

          <div className="mt-5">
            <div className="mb-3 text-xs text-white/45">模板</div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { id: 'branch' as const, title: '分支模板', desc: 'Start / Stay / Leave / Ending，含 flag 和好感度变量。' },
                { id: 'blank' as const, title: '空白模板', desc: '只有入口场景和第一句台词，适合从零搭建。' }
              ].map(item => (
                <button
                  key={item.id}
                  data-testid={`new-project-template-${item.id}`}
                  type="button"
                  onClick={() => setTemplate(item.id)}
                  className={`border p-4 text-left transition-colors ${template === item.id ? 'border-primary bg-primary/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                >
                  <div className="text-sm font-medium text-primary">{item.title}</div>
                  <div className="mt-2 text-xs leading-relaxed text-white/40">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-4 border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100/80">{error}</div>
          )}

          <button
            data-testid="new-project-submit"
            type="submit"
            disabled={submitting}
            className="mt-6 flex h-12 w-full items-center justify-between bg-primary pl-4 pr-1 text-sm font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>{submitting ? 'Creating...' : 'Create project'}</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black">
              <ArrowRight className="h-4 w-4 text-primary" />
            </span>
          </button>
        </form>
      </main>
    </div>
  );
}
