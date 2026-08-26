'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, Boxes, Eye, EyeOff, LockKeyhole, Mail, Network, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import styles from './login.module.css';

const features = [
  { icon: BarChart3, label: 'Real-time insights' },
  { icon: Network, label: 'Unified operations' },
  { icon: ShieldCheck, label: 'Secure by design' },
  { icon: Boxes, label: 'Scalable for growth' },
];

function AnimatedEarth() {
  return (
    <div className={styles.earthScene} aria-hidden="true">
      <div className={styles.earthTexture} />
    </div>
  );
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/');
    }
  }, [loading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <main className={styles.page}>
      <div className={styles.stars} aria-hidden="true" /><div className={styles.geometricGrid} aria-hidden="true" />
      <section className={styles.hero} aria-label="About PhazeOne">
        <div className={styles.brand}><Image src="/phaze-logo-dark.svg" alt="Phaze Dynamics" width={920} height={270} priority /></div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Welcome to</p><h1>Phaze<span>One</span></h1><p className={styles.subtitle}>Enterprise Resource Platform</p><div className={styles.accentRule} />
          <p className={styles.promise}>One platform. All operations.<br /><strong>Built for performance. Designed for scale.</strong></p>
          <div className={styles.features}>{features.map(({icon:Icon,label}) => <div key={label} className={styles.feature}><Icon aria-hidden="true" /><span>{label}</span></div>)}</div>
        </div>
        <AnimatedEarth /><p className={styles.copyright}>© 2026 <span>Phaze Dynamics.</span> All rights reserved.</p>
      </section>
      <section className={styles.signInSide}>
        <form className={styles.card} onSubmit={handleSubmit}>
          <div className={styles.cardGlow} aria-hidden="true" /><h2>Hello again</h2><p>Sign in to your <span>PhazeOne</span> account</p>
          <label htmlFor="email">Email</label><div className={styles.inputWrap}><Mail aria-hidden="true" /><input id="email" type="email" autoComplete="email" placeholder="Enter your email" value={email} onChange={(event)=>setEmail(event.target.value)} required autoFocus /></div>
          <label htmlFor="password">Password</label><div className={styles.inputWrap}><LockKeyhole aria-hidden="true" /><input id="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event)=>setPassword(event.target.value)} required /><button type="button" className={styles.reveal} onClick={()=>setShowPassword((current)=>!current)} aria-label={showPassword?'Hide password':'Show password'}>{showPassword?<EyeOff />:<Eye />}</button></div>
          <div className={styles.formOptions}><label className={styles.remember}><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)} /><span>Remember me</span></label><a href="mailto:info@phaze-dynamics.com?subject=PhazeOne password reset">Forgot password?</a></div>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <button className={styles.submit} type="submit" disabled={submitting}><span>{submitting?'Signing in…':'Sign in'}</span>{!submitting&&<ArrowRight aria-hidden="true" />}</button>
          <p className={styles.adminHelp}>New to PhazeOne? <a href="mailto:info@phaze-dynamics.com?subject=PhazeOne access request">Contact your administrator</a></p>
        </form>
      </section>
    </main>
  );
}
