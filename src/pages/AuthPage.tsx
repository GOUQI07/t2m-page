import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, LogIn, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import { ParticleMorph } from '../components/animations/ParticleMorph';
import { useAuth } from '../auth/AuthContext';

type AuthPageProps = {
  mode: 'login' | 'register';
};

export function AuthPage({ mode }: AuthPageProps) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/projects/new';
  const isRegister = mode === 'register';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [from, navigate, user]);

  const title = isRegister ? 'Create your Ariadne account' : 'Welcome back';
  const actionLabel = isRegister ? 'Create account' : 'Sign in';
  const Icon = isRegister ? UserPlus : LogIn;

  const helper = useMemo(() => (
    isRegister
      ? '注册后即可创建视觉小说工程、管理素材，并进入 Workstation。'
      : '登录后继续你的工程、素材库与自动生成流水线。'
  ), [isRegister]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister && password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }
    setSubmitting(true);
    try {
      if (isRegister) {
        await register({ username, email, displayName, password });
      } else {
        await login(identifier, password);
      }
      navigate(from, { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : '请求失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="auth-page" className="relative min-h-screen overflow-hidden bg-black text-white">
      <ParticleMorph />
      <div className="noise-overlay opacity-[0.5] mix-blend-overlay pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/70 to-black" />

      <header className="relative z-10 flex h-20 items-center justify-between px-6 md:px-10">
        <Link to="/" className="text-xl font-semibold tracking-tight text-primary">Ariadne</Link>
        <div className="flex items-center gap-3 text-sm">
          <Link to={isRegister ? '/login' : '/register'} className="rounded-full border border-primary/25 px-4 py-2 text-primary/75 transition-colors hover:border-primary hover:text-primary">
            {isRegister ? 'Sign in' : 'Create account'}
          </Link>
        </div>
      </header>

      <main className="relative z-10 grid min-h-[calc(100vh-5rem)] grid-cols-1 items-end gap-10 px-6 pb-10 md:grid-cols-[1.15fr_0.85fr] md:px-10 md:pb-14">
        <section className="max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.04] px-3 py-1 text-xs text-primary/70">
              <Lock className="h-3.5 w-3.5" />
              Login required for the creator workspace
            </div>
            <h1 className="max-w-4xl text-[18vw] font-medium leading-[0.82] tracking-tight text-primary md:text-[11vw]">
              Ariadne
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-primary/60 md:text-base">
              A focused visual novel engine for scene graphs, branching runtime, save slots, timeline edits, and multimodal asset generation.
            </p>
          </motion.div>
        </section>

        <motion.form
          onSubmit={handleSubmit}
          className="w-full border border-white/10 bg-black/70 p-5 backdrop-blur-xl md:p-6"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-primary/40">{isRegister ? 'Register' : 'Login'}</div>
              <h2 className="mt-2 text-2xl font-medium text-primary">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/45">{helper}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/[0.06]">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="space-y-4">
            {isRegister ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-xs text-white/45">Username</span>
                  <input data-testid="auth-username" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} autoComplete="username" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs text-white/45">Display name</span>
                  <input data-testid="auth-display-name" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs text-white/45">Email</span>
                  <input data-testid="auth-email" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" />
                </label>
              </>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs text-white/45">Username or email</span>
                <input data-testid="auth-identifier" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={identifier} onChange={event => setIdentifier(event.target.value)} required autoComplete="username" />
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-xs text-white/45">Password</span>
              <input data-testid="auth-password" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} />
            </label>

            {isRegister && (
              <label className="block">
                <span className="mb-2 block text-xs text-white/45">Confirm password</span>
                <input data-testid="auth-confirm-password" className="h-11 w-full border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors focus:border-primary" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required minLength={8} type="password" autoComplete="new-password" />
              </label>
            )}
          </div>

          {error && (
            <div className="mt-4 border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100/80">
              {error}
            </div>
          )}

          <button
            data-testid="auth-submit"
            type="submit"
            disabled={submitting}
            className="mt-6 flex h-12 w-full items-center justify-between bg-primary pl-4 pr-1 text-sm font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>{submitting ? 'Please wait...' : actionLabel}</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black">
              <ArrowRight className="h-4 w-4 text-primary" />
            </span>
          </button>
        </motion.form>
      </main>
    </div>
  );
}
