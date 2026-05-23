import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react';
import { listReviewQueue, MarketSubmission, reviewSubmission } from '../api/market';
import { useAuth } from '../auth/AuthContext';

type PageMode = 'pending' | 'reviewed';
type ReviewedFilter = 'ALL' | 'APPROVED' | 'REJECTED';

function statusLabel(status: string) {
  if (status === 'APPROVED') return '已通过';
  if (status === 'REJECTED') return '已拒绝';
  return '待审核';
}

function statusClass(status: string) {
  if (status === 'APPROVED') return 'border-emerald-300/25 text-emerald-100';
  if (status === 'REJECTED') return 'border-red-300/25 text-red-100';
  return 'border-primary/25 text-primary/65';
}

function sortReviewed(items: MarketSubmission[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.reviewedAt || left.submittedAt || '');
    const rightTime = Date.parse(right.reviewedAt || right.submittedAt || '');
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export function AdminMarket() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<PageMode>('pending');
  const [reviewedFilter, setReviewedFilter] = useState<ReviewedFilter>('ALL');
  const [submissions, setSubmissions] = useState<MarketSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const loadPending = async () => listReviewQueue('PENDING_REVIEW');

  const loadReviewed = async (filter: ReviewedFilter) => {
    if (filter === 'APPROVED') return listReviewQueue('APPROVED');
    if (filter === 'REJECTED') return listReviewQueue('REJECTED');
    const [approved, rejected] = await Promise.all([
      listReviewQueue('APPROVED'),
      listReviewQueue('REJECTED')
    ]);
    return sortReviewed([...approved, ...rejected]);
  };

  const refresh = async (
    nextMode = mode,
    nextFilter = reviewedFilter,
    clearBeforeLoad = false
  ) => {
    setLoading(true);
    setError('');
    if (clearBeforeLoad) {
      setSubmissions([]);
    }
    try {
      const nextItems = nextMode === 'pending'
        ? await loadPending()
        : await loadReviewed(nextFilter);
      setSubmissions(nextItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审核列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (nextMode: PageMode) => {
    setMode(nextMode);
    refresh(nextMode, reviewedFilter, true);
  };

  const switchReviewedFilter = (filter: ReviewedFilter) => {
    setReviewedFilter(filter);
    refresh('reviewed', filter, true);
  };

  const decide = async (submissionId: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusyId(submissionId);
    setError('');
    try {
      await reviewSubmission(submissionId, decision, notes[submissionId] || '');
      await refresh('pending', reviewedFilter, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setBusyId('');
    }
  };

  const readonly = mode === 'reviewed';

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-5 md:px-8">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-xl font-semibold text-primary">Ariadne<span className="text-primary/60">*</span></Link>
          <Link to="/market" className="text-sm text-white/45 hover:text-primary">游戏广场</Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-white/40 md:inline">{user?.displayName || user?.username}</span>
          <button type="button" onClick={() => logout().then(() => navigate('/'))} className="h-9 rounded-md border border-white/10 px-3 text-xs text-white/55 hover:border-primary hover:text-primary">
            Logout
          </button>
        </div>
      </header>

      <main className="px-5 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary/35">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </div>
            <h1 className="mt-2 text-3xl font-medium text-primary">审核后台</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => switchMode('pending')}
              className={`h-9 rounded-md px-4 text-sm ${mode === 'pending' ? 'bg-primary text-black' : 'border border-white/10 text-white/55 hover:border-primary hover:text-primary'}`}
            >
              待审核
            </button>
            <button
              type="button"
              onClick={() => switchMode('reviewed')}
              className={`h-9 rounded-md px-4 text-sm ${mode === 'reviewed' ? 'bg-primary text-black' : 'border border-white/10 text-white/55 hover:border-primary hover:text-primary'}`}
            >
              已审核
            </button>
          </div>
        </div>

        {mode === 'reviewed' && (
          <div className="mb-5 flex flex-wrap gap-2">
            {[
              ['ALL', '全部'],
              ['APPROVED', '通过'],
              ['REJECTED', '拒绝']
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchReviewedFilter(value as ReviewedFilter)}
                className={`h-8 rounded-md px-3 text-xs ${reviewedFilter === value ? 'bg-white/12 text-primary' : 'border border-white/10 text-white/45 hover:border-primary/40 hover:text-primary'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {error && <div className="mb-4 border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>}
        {loading && submissions.length === 0 && <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary/60" /></div>}

        <div className="grid gap-3">
          {submissions.map(submission => (
            <article key={submission.submissionId} className="border border-white/10 bg-white/[0.03] p-4">
              <div className={`grid gap-4 ${readonly ? 'md:grid-cols-[1fr_360px]' : 'md:grid-cols-[1fr_320px]'}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-medium text-primary">{submission.title}</h2>
                    <span className={`rounded-md border px-2 py-1 text-xs ${statusClass(submission.status)}`}>{statusLabel(submission.status)}</span>
                  </div>
                  <div className="mt-2 text-xs text-white/35">{submission.projectId} · {submission.versionLabel} · {submission.submittedAt}</div>
                  <p className="mt-3 max-w-3xl text-sm text-white/50">{submission.summary || '暂无简介'}</p>
                  {submission.playableUrl && (
                    <a href={submission.playableUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-primary/80 hover:text-primary">
                      打开试玩 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                {readonly ? (
                  <div className="border border-white/10 bg-black/40 p-3">
                    <div className="text-xs text-white/35">审核结果</div>
                    <div className={`mt-2 text-sm ${submission.status === 'APPROVED' ? 'text-emerald-100' : 'text-red-100'}`}>{statusLabel(submission.status)}</div>
                    <div className="mt-4 text-xs text-white/35">审核意见</div>
                    <p className="mt-2 min-h-16 text-sm leading-relaxed text-white/55">{submission.reviewerNote || '无'}</p>
                    <div className="mt-4 text-xs text-white/30">审核时间：{submission.reviewedAt || '-'}</div>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <textarea
                      value={notes[submission.submissionId] || ''}
                      onChange={event => setNotes(current => ({ ...current, [submission.submissionId]: event.target.value }))}
                      className="min-h-24 resize-none border border-white/10 bg-black/60 p-3 text-sm outline-none focus:border-primary"
                      placeholder="审核意见"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button disabled={busyId === submission.submissionId} onClick={() => decide(submission.submissionId, 'APPROVED')} className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-primary text-xs text-black disabled:opacity-50">
                        <Check className="h-4 w-4" />通过
                      </button>
                      <button disabled={busyId === submission.submissionId} onClick={() => decide(submission.submissionId, 'REJECTED')} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-red-300/25 text-xs text-red-100 disabled:opacity-50">
                        <X className="h-4 w-4" />驳回
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        {!loading && submissions.length === 0 && (
          <div className="border border-white/10 py-16 text-center text-sm text-white/35">
            {mode === 'pending' ? '当前没有待审核投稿。' : '当前筛选下没有已审核记录。'}
          </div>
        )}
      </main>
    </div>
  );
}
