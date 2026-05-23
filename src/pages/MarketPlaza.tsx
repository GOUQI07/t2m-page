import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, ExternalLink, Gamepad2, Library, Loader2, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  GameListing,
  listGameListings,
  listMySubmissions,
  listNotifications,
  MarketSubmission,
  NotificationItem,
  submitGame,
  uploadMarketPlayable
} from '../api/market';

type Tab = 'plaza' | 'submit' | 'mine' | 'notifications';

function statusTone(status: string) {
  if (status === 'APPROVED') return 'border-emerald-300/30 text-emerald-200';
  if (status === 'REJECTED') return 'border-red-300/30 text-red-200';
  if (status === 'CHANGES_REQUESTED') return 'border-amber-300/30 text-amber-100';
  return 'border-primary/25 text-primary/70';
}

function tagsFromText(value: string) {
  return value
    .split(/[,，\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function MarketPlaza() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('plaza');
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<GameListing[]>([]);
  const [submissions, setSubmissions] = useState<MarketSubmission[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isAdmin = useMemo(() => user?.roles?.some(role => ['ADMIN', 'REVIEWER'].includes(role)) ?? false, [user]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [listingResult, submissionResult, notificationResult] = await Promise.all([
        listGameListings(query),
        listMySubmissions(),
        listNotifications()
      ]);
      setListings(listingResult);
      setSubmissions(submissionResult);
      setNotifications(notificationResult.notifications);
      setUnreadCount(notificationResult.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    refresh();
  };

  const handleSubmitGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const projectId = String(form.get('projectId') || '').trim();
    const playableFile = form.get('playableFile');
    let playableUrl = String(form.get('playableUrl') || '').trim();
    try {
      if (playableFile instanceof File && playableFile.size > 0) {
        const uploaded = await uploadMarketPlayable(projectId, playableFile);
        playableUrl = uploaded.absolute_url || uploaded.url || playableUrl;
      }
      if (!playableUrl) {
        throw new Error('请上传可运行文件，或填写 Playable URL');
      }
      await submitGame({
        projectId,
        playableUrl,
        versionLabel: String(form.get('versionLabel') || '0.1.0'),
        title: String(form.get('title') || ''),
        summary: String(form.get('summary') || ''),
        description: String(form.get('description') || ''),
        coverUrl: String(form.get('coverUrl') || ''),
        tags: tagsFromText(String(form.get('tags') || '')),
        contentRating: String(form.get('contentRating') || 'GENERAL')
      });
      event.currentTarget.reset();
      setMessage('已提交审核，结果会出现在“我的投稿”和通知里。');
      setTab('mine');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-5 md:px-8">
        <div className="flex items-center gap-5">
          <Link to="/" className="text-xl font-semibold text-primary">Ariadne<span className="text-primary/60">*</span></Link>
          <nav className="hidden items-center gap-2 md:flex">
            {[
              ['plaza', '游戏广场'],
              ['submit', '上传市场'],
              ['mine', '我的投稿'],
              ['notifications', `通知${unreadCount ? ` ${unreadCount}` : ''}`]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as Tab)}
                className={`h-9 rounded-md px-3 text-sm transition-colors ${tab === id ? 'bg-primary text-black' : 'text-white/55 hover:bg-white/[0.06] hover:text-primary'}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link to="/admin/market" className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/25 px-3 text-xs text-primary/80 hover:border-primary">
              <ShieldCheck className="h-4 w-4" />
              审核后台
            </Link>
          )}
          <button type="button" onClick={() => logout().then(() => navigate('/'))} className="h-9 rounded-md border border-white/10 px-3 text-xs text-white/55 hover:border-primary hover:text-primary">
            Logout
          </button>
        </div>
      </header>

      <main className="grid gap-6 px-5 py-6 md:grid-cols-[260px_1fr] md:px-8">
        <aside className="border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm text-primary">{user?.displayName || user?.username}</div>
          <div className="mt-1 text-xs text-white/35">{user?.roles?.join(' / ') || 'USER'}</div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs md:grid-cols-1">
            <button onClick={() => setTab('plaza')} className={`flex h-10 items-center gap-2 rounded-md px-3 ${tab === 'plaza' ? 'bg-primary text-black' : 'bg-black/40 text-white/60'}`}><Gamepad2 className="h-4 w-4" />广场</button>
            <button onClick={() => setTab('submit')} className={`flex h-10 items-center gap-2 rounded-md px-3 ${tab === 'submit' ? 'bg-primary text-black' : 'bg-black/40 text-white/60'}`}><Send className="h-4 w-4" />上传</button>
            <button onClick={() => setTab('mine')} className={`flex h-10 items-center gap-2 rounded-md px-3 ${tab === 'mine' ? 'bg-primary text-black' : 'bg-black/40 text-white/60'}`}><Library className="h-4 w-4" />投稿</button>
            <button onClick={() => setTab('notifications')} className={`flex h-10 items-center gap-2 rounded-md px-3 ${tab === 'notifications' ? 'bg-primary text-black' : 'bg-black/40 text-white/60'}`}><Bell className="h-4 w-4" />通知</button>
          </div>
        </aside>

        <section className="min-h-[calc(100vh-7rem)] border border-white/10 bg-black/60 p-4 md:p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-primary/35">Market</div>
              <h1 className="mt-1 text-2xl font-medium text-primary">
                {tab === 'plaza' ? '游戏广场' : tab === 'submit' ? '上传到市场' : tab === 'mine' ? '我的投稿' : '通知中心'}
              </h1>
            </div>
            {loading && <Loader2 className="h-5 w-5 animate-spin text-primary/60" />}
          </div>

          {error && <div className="mb-4 border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>}
          {message && <div className="mb-4 border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</div>}

          {tab === 'plaza' && (
            <div>
              <form onSubmit={handleSearch} className="mb-4 flex gap-2">
                <input value={query} onChange={event => setQuery(event.target.value)} className="h-10 flex-1 border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" placeholder="搜索游戏标题或简介" />
                <button className="h-10 rounded-md bg-primary px-4 text-sm text-black">搜索</button>
              </form>
              <div className="grid gap-3 lg:grid-cols-2">
                {listings.map(listing => (
                  <article key={listing.listingId} className="border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-medium text-primary">{listing.title}</h2>
                        <p className="mt-2 line-clamp-2 text-sm text-white/45">{listing.summary || listing.description || '暂无简介'}</p>
                      </div>
                      <span className="shrink-0 rounded-md border border-primary/20 px-2 py-1 text-xs text-primary/60">{listing.contentRating || 'GENERAL'}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(listing.tags || []).map(tag => <span key={tag} className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-white/45">{tag}</span>)}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-white/35">
                      <span>{listing.playCount || 0} plays · {listing.viewCount || 0} views</span>
                      {listing.playableUrl && (
                        <a href={listing.playableUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary/80 hover:text-primary">
                          试玩 <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!loading && listings.length === 0 && <div className="py-14 text-center text-sm text-white/35">暂无已发布游戏。</div>}
            </div>
          )}

          {tab === 'submit' && (
            <form onSubmit={handleSubmitGame} className="grid max-w-3xl gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label><span className="mb-2 block text-xs text-white/45">Project ID</span><input name="projectId" required className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">Playable HTML / ZIP</span><input name="playableFile" type="file" accept=".html,.zip,application/zip,text/html" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none file:mr-3 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:text-black focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">Playable URL fallback</span><input name="playableUrl" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">标题</span><input name="title" required className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">版本</span><input name="versionLabel" defaultValue="0.1.0" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">封面 URL</span><input name="coverUrl" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
                <label><span className="mb-2 block text-xs text-white/45">分级</span><select name="contentRating" className="h-10 w-full border border-white/10 bg-black px-3 text-sm outline-none focus:border-primary"><option>GENERAL</option><option>TEEN</option><option>MATURE</option></select></label>
              </div>
              <label><span className="mb-2 block text-xs text-white/45">简介</span><input name="summary" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
              <label><span className="mb-2 block text-xs text-white/45">详情</span><textarea name="description" className="min-h-28 w-full resize-none border border-white/10 bg-white/[0.04] p-3 text-sm outline-none focus:border-primary" /></label>
              <label><span className="mb-2 block text-xs text-white/45">标签</span><input name="tags" placeholder="visual-novel, romance, demo" className="h-10 w-full border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary" /></label>
              <button className="inline-flex h-11 w-fit items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-black">
                <Send className="h-4 w-4" />
                提交审核
              </button>
            </form>
          )}

          {tab === 'mine' && (
            <div className="grid gap-3">
              {submissions.map(submission => (
                <article key={submission.submissionId} className="border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-medium text-primary">{submission.title}</h2>
                      <div className="mt-1 text-xs text-white/35">{submission.projectId} · {submission.versionLabel}</div>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs ${statusTone(submission.status)}`}>{submission.status}</span>
                  </div>
                  {submission.reviewerNote && <p className="mt-3 text-sm text-white/55">{submission.reviewerNote}</p>}
                  {submission.playableUrl && <a href={submission.playableUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-primary/80">查看构建 <ExternalLink className="h-3.5 w-3.5" /></a>}
                </article>
              ))}
              {!loading && submissions.length === 0 && <div className="py-14 text-center text-sm text-white/35">还没有投稿。</div>}
            </div>
          )}

          {tab === 'notifications' && (
            <div className="grid gap-3">
              {notifications.map(item => (
                <article key={item.notificationId} className="flex gap-3 border border-white/10 bg-white/[0.03] p-4">
                  <CheckCircle2 className={`mt-0.5 h-4 w-4 ${item.unread ? 'text-primary' : 'text-white/25'}`} />
                  <div>
                    <h2 className="text-sm font-medium text-primary">{item.title}</h2>
                    <p className="mt-1 text-sm text-white/45">{item.body}</p>
                    <div className="mt-2 text-xs text-white/25">{item.createdAt}</div>
                  </div>
                </article>
              ))}
              {!loading && notifications.length === 0 && <div className="py-14 text-center text-sm text-white/35">暂无通知。</div>}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
