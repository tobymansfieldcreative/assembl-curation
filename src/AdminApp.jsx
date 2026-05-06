import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AssemblWordmark from '../src/assets/wordmark.svg?react'

// ─── Design tokens ────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --color-brand: #E8622A;
    --color-brand-light: #F0385A;
    --color-brand-gradient: linear-gradient(135deg, #E8622A 0%, #F0385A 100%);
    --bg-base: #09090d;
    --bg-surface: #15151f;
    --bg-elevated: #1E1E2A;
    --bg-overlay: #252533;
    --bg-hover: rgba(255,255,255,0.04);
    --text-primary: #ffffff;
    --text-secondary: #b2b5be;
    --text-muted: #697182;
    --border-subtle: #252533;
    --border-default: #3A3A50;
    --color-success: #10B981;
    --color-warning: #F59E0B;
    --color-error: #EF4444;
    --color-info: #6366F1;
    --font-display: 'Plus Jakarta Sans', sans-serif;
    --font-body: 'DM Sans', sans-serif;
    --radius-xs: 4px;
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    --radius-full: 100px;
    --sidebar-w: 220px;
    --transition-base: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  html, body { height: 100%; }
  body {
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  #root { height: 100%; }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }

  input, textarea, select {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color var(--transition-base);
  }
  input:focus, textarea:focus, select:focus { border-color: var(--color-brand); }
  input::placeholder, textarea::placeholder { color: var(--text-muted); }
  button { cursor: pointer; font-family: var(--font-body); }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideRight { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  .anim-fade { animation: fadeIn 200ms ease both; }
  .anim-slide-right { animation: slideRight 220ms cubic-bezier(0.4,0,0.2,1) both; }
  .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
`;

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SB_URL = 'https://mizoxinvfikwznywuknp.supabase.co';
const SB_KEY = 'sb_publishable_MNjb4nCCYJ-aDZhJCmcu7Q_yPO05yN2';

async function sb(method, sbPath, body) {
  const doRequest = async () => {
    const token = window.__adminToken || SB_KEY;
    const headers = {
      apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    };
    if (method === 'POST')  headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
    if (method === 'PATCH') headers['Prefer'] = 'return=representation';
    if (method === 'GET')   headers['Prefer'] = 'count=exact';
    const res = await fetch(`${SB_URL}/rest/v1/${sbPath}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const total = res.headers.get('content-range')?.split('/')[1];
    const errBody = res.ok ? null : await res.json().catch(() => ({}));
    return { res, total, errBody };
  };

  let { res, total, errBody } = await doRequest();
  const errMsg = `${errBody?.message || errBody?.error_description || ''}`.toLowerCase();
  const shouldTryRefresh = !res.ok && (res.status === 401 || errMsg.includes('jwt expired'));

  if (shouldTryRefresh && typeof window.__refreshAdminSession === 'function') {
    const refreshed = await window.__refreshAdminSession();
    if (refreshed) ({ res, total, errBody } = await doRequest());
  }

  if (!res.ok) throw new Error(errBody?.message || errBody?.error_description || `${method} ${sbPath} → ${res.status}`);
  const data = await res.json().catch(() => null);
  return { data, total: total ? parseInt(total) : undefined };
}

// ─── Supabase auth client (separate from raw fetch helper) ────────────────────
// We use the REST API directly for data, but need the auth endpoints for OTP
const ADMIN_EMAILS = ['toby@assembl.app', 'dave@assembl.app']; // update as needed

async function sbAuth(path, body) {
  const res = await fetch(`${SB_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || `Auth error ${res.status}`);
  return data;
}

async function refreshSession(refreshToken) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || `Auth refresh error ${res.status}`);
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function useAuth() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('admin_session') || 'null'); } catch { return null; }
  });
  const [who, setWho] = useState(() => localStorage.getItem('admin_who') || '');

  const ok = Boolean(session?.access_token);

  // Keep sb() using the session token when available
  useEffect(() => {
    if (session?.access_token) {
      window.__adminToken = session.access_token;
    } else {
      window.__adminToken = null;
    }
  }, [session?.access_token]);

  useEffect(() => {
    let inflight = null;
    window.__refreshAdminSession = async () => {
      if (inflight) return inflight;
      inflight = (async () => {
        const current = session || (() => { try { return JSON.parse(sessionStorage.getItem('admin_session') || 'null'); } catch { return null; } })();
        if (!current?.refresh_token) return false;
        try {
          const next = await refreshSession(current.refresh_token);
          if (next?.access_token) {
            sessionStorage.setItem('admin_session', JSON.stringify(next));
            setSession(next);
            return true;
          }
          return false;
        } catch {
          sessionStorage.removeItem('admin_session');
          window.__adminToken = null;
          setSession(null);
          return false;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    };
    return () => { window.__refreshAdminSession = null; };
  }, [session]);

  const sendOtp = async (email) => {
    await sbAuth('otp', { email, create_user: false });
  };

  const verifyOtp = async (email, token) => {
    const data = await sbAuth('verify', { email, token, type: 'email' });
    if (data.access_token) {
      sessionStorage.setItem('admin_session', JSON.stringify(data));
      setSession(data);
      const name = email.split('@')[0];
      if (!who) { localStorage.setItem('admin_who', name); setWho(name); }
      return true;
    }
    return false;
  };

  const logout = () => {
    sessionStorage.removeItem('admin_session');
    window.__adminToken = null;
    setSession(null);
  };

  const saveWho = (name) => { localStorage.setItem('admin_who', name); setWho(name); };

  return { ok, who, session, sendOtp, verifyOtp, logout, saveWho };
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const parseImages = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } };
const parseSlugs  = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };

function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1;
  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i-range), hi = Math.min(i+range+1, s2.length);
    for (let j = lo; j < hi; j++) { if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; matches++; break; } }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) { if (!m1[i]) continue; while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++; }
  const j = (matches/s1.length + matches/s2.length + (matches-t/2)/matches) / 3;
  const l = Math.min(4, [...s1].findIndex((c,i) => c !== s2[i]));
  return j + l * 0.1 * (1-j);
}
function nameSimilarity(a, b) {
  const clean = s => s.toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\b(the|a|an|bar|pub|london|restaurant|cafe|&|and)\b/g,'').replace(/\s+/g,' ').trim();
  return jaroSimilarity(clean(a), clean(b));
}
function haversineM(lat1, lng1, lat2, lng2) {
  const R=6371000, r=Math.PI/180, dLat=(lat2-lat1)*r, dLng=(lng2-lng1)*r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Spinner({ size=20, color='var(--color-brand)' }) {
  return <div style={{ width:size, height:size, borderRadius:'50%', border:`2px solid var(--border-default)`, borderTopColor:color, animation:'spin 0.7s linear infinite', flexShrink:0 }} />;
}

function Badge({ children, color='default', style:s }) {
  const C = { default:{bg:'var(--bg-overlay)',br:'var(--border-default)',t:'var(--text-secondary)'}, success:{bg:'rgba(16,185,129,.12)',br:'rgba(16,185,129,.3)',t:'#10B981'}, warning:{bg:'rgba(245,158,11,.12)',br:'rgba(245,158,11,.3)',t:'#F59E0B'}, error:{bg:'rgba(239,68,68,.12)',br:'rgba(239,68,68,.3)',t:'#EF4444'}, info:{bg:'rgba(99,102,241,.12)',br:'rgba(99,102,241,.3)',t:'#818CF8'}, brand:{bg:'rgba(232,98,42,.12)',br:'rgba(232,98,42,.3)',t:'#E8622A'} };
  const c = C[color]||C.default;
  return <span style={{ display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:'var(--radius-full)',background:c.bg,border:`1px solid ${c.br}`,color:c.t,fontSize:11,fontWeight:700,fontFamily:'var(--font-display)',whiteSpace:'nowrap',...s }}>{children}</span>;
}

function Btn({ children, variant='default', size='md', onClick, disabled, style:s, title }) {
  const base = { display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,border:'none',borderRadius:'var(--radius-full)',fontFamily:'var(--font-display)',fontWeight:700,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.45:1,transition:'all var(--transition-base)',whiteSpace:'nowrap', ...(size==='sm'?{padding:'5px 12px',fontSize:12}:size==='lg'?{padding:'12px 24px',fontSize:15}:{padding:'8px 16px',fontSize:13}) };
  const V = { default:{background:'var(--bg-overlay)',color:'var(--text-secondary)',border:'1px solid var(--border-default)'}, primary:{backgroundImage:'var(--color-brand-gradient)',color:'#fff'}, success:{background:'rgba(16,185,129,.15)',color:'#10B981',border:'1.5px solid rgba(16,185,129,.4)'}, warning:{background:'rgba(245,158,11,.15)',color:'#F59E0B',border:'1.5px solid rgba(245,158,11,.4)'}, danger:{background:'rgba(239,68,68,.15)',color:'#EF4444',border:'1.5px solid rgba(239,68,68,.4)'}, ghost:{background:'transparent',color:'var(--text-secondary)',border:'none'}, solid_success:{background:'#10B981',color:'#fff'}, solid_danger:{background:'#EF4444',color:'#fff'} };
  return <button onClick={disabled?undefined:onClick} title={title} style={{...base,...(V[variant]||V.default),...s}}>{children}</button>;
}

function Inp({ value, onChange, placeholder, type='text', style:s, rows, autoFocus, onKeyDown }) {
  const base = { padding:'8px 12px',width:'100%',background:'var(--bg-elevated)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)',fontSize:14,...s };
  if (rows) return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{...base,resize:'vertical',lineHeight:1.5}} />;
  return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown} style={base} />;
}

function Sel({ value, onChange, children, style:s }) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{ padding:'7px 28px 7px 10px',background:'var(--bg-elevated)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)',fontSize:13,cursor:'pointer',appearance:'none',backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23697182' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,backgroundRepeat:'no-repeat',backgroundPosition:'right 8px center',...s }}>{children}</select>;
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
      <div onClick={()=>onChange(!checked)} style={{ width:36,height:20,borderRadius:10,background:checked?'var(--color-brand)':'var(--border-default)',position:'relative',transition:'background var(--transition-base)',flexShrink:0 }}>
        <div style={{ position:'absolute',top:2,left:checked?18:2,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left var(--transition-base)' }} />
      </div>
      {label && <span style={{ fontSize:13,color:'var(--text-secondary)' }}>{label}</span>}
    </label>
  );
}

function Modal({ open, onClose, title, children, width=560 }) {
  useEffect(() => { if (!open) return; const h = e => e.key==='Escape'&&onClose(); window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h); }, [open]);
  if (!open) return null;
  return (
    <div style={{ position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24,animation:'fadeIn 150ms ease both' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'var(--bg-surface)',borderRadius:'var(--radius-xl)',border:'1px solid var(--border-default)',width:'100%',maxWidth:width,maxHeight:'90vh',overflow:'auto',animation:'slideUp 200ms cubic-bezier(0.4,0,0.2,1) both' }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px',borderBottom:'1px solid var(--border-subtle)',position:'sticky',top:0,background:'var(--bg-surface)',zIndex:1 }}>
          <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:16 }}>{title}</div>
          <button onClick={onClose} style={{ background:'var(--bg-overlay)',border:'none',color:'var(--text-muted)',width:28,height:28,borderRadius:'var(--radius-full)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}

function Toast({ message, type='success', onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return ()=>clearTimeout(t); }, []);
  const color = type==='error'?'#EF4444':type==='warning'?'#F59E0B':'#10B981';
  return (
    <div style={{ position:'fixed',bottom:24,right:24,zIndex:9999,background:'var(--bg-elevated)',border:`1px solid ${color}`,borderRadius:'var(--radius-md)',padding:'12px 18px',display:'flex',alignItems:'center',gap:10,animation:'slideUp 200ms ease both',boxShadow:'0 8px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ color,fontSize:16 }}>{type==='error'?'✕':type==='warning'?'⚠':'✓'}</div>
      <div style={{ fontSize:13,fontWeight:500,fontFamily:'var(--font-display)' }}>{message}</div>
    </div>
  );
}
function useToast() {
  const [toast,setToast] = useState(null);
  const show = useCallback((msg,type='success')=>setToast({message:msg,type,key:Date.now()}),[]);
  const el = toast ? <Toast key={toast.key} message={toast.message} type={toast.type} onDone={()=>setToast(null)}/> : null;
  return { show, el };
}

function FRow({ label, hint, children }) {
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
      <div style={{ display:'flex',alignItems:'baseline',gap:8 }}>
        <label style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',fontFamily:'var(--font-display)',textTransform:'uppercase',letterSpacing:'0.06em' }}>{label}</label>
        {hint && <span style={{ fontSize:11,color:'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Login (OTP) ──────────────────────────────────────────────────────────────
function LoginScreen({ onSendOtp, onVerifyOtp }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [stage, setStage] = useState('email'); // 'email' | 'otp'
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSend = async () => {
    if (!email) return;
    setLoading(true); setErr('');
    try {
      await onSendOtp(email);
      setStage('otp');
    } catch(e) {
      setErr(e.message || 'Failed to send code');
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!token) return;
    setLoading(true); setErr('');
    try {
      const ok = await onVerifyOtp(email, token);
      if (!ok) setErr('Invalid or expired code');
    } catch(e) {
      setErr(e.message || 'Verification failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'radial-gradient(ellipse at 50% 0%, rgba(232,98,42,0.1) 0%, transparent 65%), var(--bg-base)' }}>
      <div style={{ background:'var(--bg-surface)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-xl)',padding:'40px 36px',width:380,animation:'slideUp 300ms ease both' }}>
        <AssemblWordmark style={{ width:100, height:22, marginBottom:4 }} />
        <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:17,marginBottom:6 }}>Admin Console</div>

        {stage === 'email' ? <>
          <div style={{ color:'var(--text-muted)',fontSize:13,marginBottom:28 }}>Enter your email to receive a login code.</div>
          <Inp value={email} onChange={setEmail} type="email" placeholder="your@email.com" autoFocus
            onKeyDown={e=>e.key==='Enter'&&handleSend()} style={{ marginBottom:12 }} />
          {err && <div style={{ color:'#EF4444',fontSize:12,marginBottom:10,fontFamily:'var(--font-display)' }}>{err}</div>}
          <Btn variant="primary" size="lg" onClick={handleSend} disabled={loading||!email} style={{ width:'100%' }}>
            {loading ? <><Spinner size={14} color="#fff"/> Sending…</> : 'Send code →'}
          </Btn>
        </> : <>
          <div style={{ color:'var(--text-muted)',fontSize:13,marginBottom:6 }}>Code sent to</div>
          <div style={{ fontFamily:'var(--font-display)',fontWeight:600,fontSize:14,color:'var(--text-primary)',marginBottom:24 }}>{email}</div>
          <Inp value={token} onChange={setToken} type="text" placeholder="8-digit code" autoFocus
            onKeyDown={e=>e.key==='Enter'&&handleVerify()} style={{ marginBottom:12,letterSpacing:'0.2em',fontSize:18,textAlign:'center' }} />
          {err && <div style={{ color:'#EF4444',fontSize:12,marginBottom:10,fontFamily:'var(--font-display)' }}>{err}</div>}
          <Btn variant="primary" size="lg" onClick={handleVerify} disabled={loading||!token} style={{ width:'100%',marginBottom:10 }}>
            {loading ? <><Spinner size={14} color="#fff"/> Verifying…</> : 'Verify →'}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={()=>{setStage('email');setToken('');setErr('');}} style={{ width:'100%' }}>← Use a different email</Btn>
        </>}
      </div>
    </div>
  );
}

// ─── Shell / Nav ──────────────────────────────────────────────────────────────
const NAV = [
  { id:'venues',    icon:'🏛', label:'Venues',         desc:'Browse & edit venue records' },
  { id:'triage',    icon:'⚑', label:'Review Flagged',         desc:'Resolve flagged venues' },
  { id:'dupes',     icon:'🔁', label:'Duplicates',      desc:'Detect & merge duplicates' },
  { id:'reference', icon:'📐', label:'Reference Data',  desc:'Features, occasions, categories' },
  { id:'activity',  icon:'📋', label:'Activity',        desc:'Edit history' },
];

function AppShell({ who, active, setActive, stats, onLogout, children }) {
  return (
    <div style={{ display:'flex',height:'100vh',overflow:'hidden' }}>
      <div style={{ width:'var(--sidebar-w)',flexShrink:0,background:'var(--bg-surface)',borderRight:'1px solid var(--border-subtle)',display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding:'20px 20px 16px',borderBottom:'1px solid var(--border-subtle)', textAlign:'left' }}>
          <AssemblWordmark style={{ width:100, height:22, marginBottom:4 }} />
          <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2,fontWeight:600,letterSpacing:'0.05em' }}>ADMIN CONSOLE</div>
        </div>
        <nav style={{ flex:1,padding:'12px 10px',overflowY:'auto' }}>
          {NAV.map(item => {
            const on = active===item.id;
            return (
              <button key={item.id} onClick={()=>setActive(item.id)} style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:'var(--radius-sm)',border:'none',background:on?'rgba(232,98,42,0.12)':'transparent',color:on?'var(--color-brand)':'var(--text-secondary)',fontFamily:'var(--font-display)',fontWeight:on?700:500,fontSize:13,cursor:'pointer',marginBottom:2,transition:'all var(--transition-base)',textAlign:'left' }}>
                <span style={{ fontSize:15 }}>{item.icon}</span>
                {item.label}
                {item.id==='triage' && stats?.flagged>0 && <span style={{ marginLeft:'auto',background:'var(--color-warning)',color:'#000',borderRadius:'var(--radius-full)',fontSize:10,fontWeight:800,padding:'1px 6px' }}>{stats.flagged}</span>}
                {item.id==='dupes'  && stats?.pendingDupes>0 && <span style={{ marginLeft:'auto',background:'var(--color-warning)',color:'#000',borderRadius:'var(--radius-full)',fontSize:10,fontWeight:800,padding:'1px 6px' }}>{stats.pendingDupes}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding:'12px 16px',borderTop:'1px solid var(--border-subtle)' }}>
          <div style={{ fontSize:11,color:'var(--text-muted)' }}>Signed in as</div>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:2 }}>
            <div style={{ fontSize:13,fontWeight:600,color:'var(--text-secondary)',fontFamily:'var(--font-display)' }}>{who||'anonymous'}</div>
            <button onClick={onLogout} title="Sign out" style={{ background:'none',border:'none',color:'var(--text-muted)',fontSize:13,cursor:'pointer',padding:'2px 4px',borderRadius:4 }}>↩</button>
          </div>
        </div>
      </div>
      <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>
        <div style={{ padding:'14px 24px',borderBottom:'1px solid var(--border-subtle)',display:'flex',alignItems:'center',background:'var(--bg-surface)',flexShrink:0, textAlign:'left' }}>
          <div>
            <div style={{ fontFamily:'var(--font-display)',fontWeight:800,fontSize:17 }}>{NAV.find(n=>n.id===active)?.icon} {NAV.find(n=>n.id===active)?.label}</div>
            <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:1 }}>{NAV.find(n=>n.id===active)?.desc}</div>
          </div>
        </div>
        <div style={{ flex:1,display:'flex',overflow:'hidden' }} className="anim-fade">{children}</div>
      </div>
    </div>
  );
}

// ─── Image Carousel ───────────────────────────────────────────────────────────
function ImgCarousel({ images, height=240 }) {
  const [idx,setIdx]=useState(0), [err,setErr]=useState(false);
  const urls=parseImages(images);
  useEffect(()=>{setIdx(0);setErr(false);},[JSON.stringify(urls)]);
  if (!urls.length) return <div style={{ height,background:'var(--bg-elevated)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'var(--text-muted)',fontSize:13 }}><div style={{ fontSize:28,opacity:.4 }}>📷</div><div>No images</div></div>;
  return (
    <div style={{ position:'relative',height,background:'var(--bg-elevated)',overflow:'hidden' }}>
      {err ? <div style={{ height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:13,flexDirection:'column',gap:6 }}><div>🖼️</div><div>Failed to load</div></div>
           : <img key={urls[idx]} src={urls[idx]} onError={()=>setErr(true)} onLoad={()=>setErr(false)} style={{ width:'100%',height:'100%',objectFit:'cover',display:'block' }} />}
      {urls.length>1 && <>
        {[['‹',()=>{setIdx((idx-1+urls.length)%urls.length);setErr(false);},8],['›',()=>{setIdx((idx+1)%urls.length);setErr(false);},'calc(100% - 36px)']].map(([ch,fn,l])=>(
          <button key={ch} onClick={e=>{e.stopPropagation();fn();}} style={{ position:'absolute',top:'50%',left:l,transform:'translateY(-50%)',background:'rgba(0,0,0,0.55)',border:'none',borderRadius:'50%',width:28,height:28,cursor:'pointer',color:'#fff',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>{ch}</button>
        ))}
        <div style={{ position:'absolute',bottom:8,right:8,background:'rgba(0,0,0,0.55)',borderRadius:4,padding:'1px 6px',fontSize:11,color:'rgba(255,255,255,0.85)' }}>{idx+1}/{urls.length}</div>
      </>}
    </div>
  );
}

// ─── Image Editor ─────────────────────────────────────────────────────────────
function ImgEditor({ images, onChange }) {
  const urls=parseImages(images), [errs,setErrs]=useState({}), [addUrl,setAddUrl]=useState(''), [addSt,setAddSt]=useState(null);
  const timer=useRef(null);
  const remove = i => onChange(urls.filter((_,j)=>j!==i));
  const move = (i,dir) => { const n=[...urls]; [n[i],n[i+dir]]=[n[i+dir],n[i]]; onChange(n); };
  const handleAdd = v => {
    setAddUrl(v); setAddSt(null); clearTimeout(timer.current);
    if (v.startsWith('http')) { setAddSt('loading'); timer.current=setTimeout(()=>{ const img=new Image(); img.onload=()=>setAddSt('ok'); img.onerror=()=>setAddSt('error'); img.src=v; },500); }
  };
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
      {!urls.length ? <div style={{ padding:16,background:'var(--bg-elevated)',borderRadius:'var(--radius-sm)',border:'1px dashed var(--border-default)',color:'var(--text-muted)',fontSize:13,textAlign:'center' }}>No images</div>
      : <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))',gap:8 }}>
          {urls.map((url,i)=>(
            <div key={url+i} style={{ position:'relative',borderRadius:'var(--radius-sm)',overflow:'hidden',aspectRatio:'4/3',border:i===0?'2px solid var(--color-brand)':'1px solid var(--border-default)',background:'var(--bg-elevated)' }}>
              {errs[i] ? <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:3,color:'var(--text-muted)',fontSize:10,padding:6 }}><div>🚫</div><div style={{ wordBreak:'break-all',textAlign:'center' }}>{url.slice(0,40)}…</div></div>
                       : <img src={url} onError={()=>setErrs(e=>({...e,[i]:true}))} style={{ width:'100%',height:'100%',objectFit:'cover',display:'block',pointerEvents:'none' }} />}
              {i===0 && <div style={{ position:'absolute',top:4,left:4,background:'var(--color-brand)',color:'#fff',borderRadius:3,padding:'1px 5px',fontSize:9,fontWeight:800 }}>COVER</div>}
              <div style={{ position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(transparent,rgba(0,0,0,0.85))',padding:'10px 4px 4px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                <div style={{ display:'flex',gap:2 }}>
                  {[['←',-1,i===0],['→',1,i===urls.length-1]].map(([ch,dir,dis])=>(
                    <button key={ch} onClick={()=>!dis&&move(i,dir)} disabled={dis} style={{ width:20,height:20,borderRadius:3,border:'none',background:dis?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.22)',color:dis?'rgba(255,255,255,0.25)':'#fff',cursor:dis?'not-allowed':'pointer',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center' }}>{ch}</button>
                  ))}
                </div>
                <button onClick={()=>remove(i)} style={{ width:20,height:20,borderRadius:3,border:'none',background:'rgba(239,68,68,0.7)',color:'#fff',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
              </div>
            </div>
          ))}
        </div>}
      <div style={{ display:'flex',gap:6,alignItems:'center' }}>
        <div style={{ position:'relative',flex:1 }}>
          <Inp value={addUrl} onChange={handleAdd} placeholder="Paste image URL to add…" style={{ borderColor:addSt==='ok'?'rgba(16,185,129,0.5)':addSt==='error'?'rgba(239,68,68,0.5)':undefined,paddingRight:28 }} />
          {addSt && <span style={{ position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',fontSize:13,color:addSt==='ok'?'#10B981':addSt==='error'?'#EF4444':'var(--text-muted)' }}>{addSt==='ok'?'✓':addSt==='error'?'✕':'…'}</span>}
        </div>
        <Btn variant="primary" size="sm" disabled={!addUrl||addSt==='error'||!addUrl.startsWith('http')} onClick={()=>{onChange([...urls,addUrl.trim()]);setAddUrl('');setAddSt(null);}}>+ Add</Btn>
      </div>
    </div>
  );
}

// ─── Feature Selector ─────────────────────────────────────────────────────────
function FeatureSel({ selected, allFeatures, onChange }) {
  const [search,setSearch]=useState('');
  const filtered = useMemo(()=>{
    const f = [...allFeatures].sort((a,b)=>a.label.localeCompare(b.label));
    if (!search) return f;
    const q = search.toLowerCase();
    return f.filter(f=>f.label.toLowerCase().includes(q)||f.slug.includes(q));
  },[allFeatures,search]);
  const toggle = slug => { const s=new Set(selected); s.has(slug)?s.delete(slug):s.add(slug); onChange([...s]); };
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
      <Inp value={search} onChange={setSearch} placeholder="Filter features…" style={{ fontSize:13 }} />
      <div style={{ maxHeight:320,overflowY:'auto' }}>
        <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>
          {filtered.map(f=>{ const on=selected.includes(f.slug); return (
            <button key={f.slug} onClick={()=>toggle(f.slug)} style={{ padding:'4px 10px',borderRadius:'var(--radius-full)',fontSize:12,fontWeight:600,border:`1.5px solid ${on?'var(--color-brand)':'var(--border-default)'}`,background:on?'rgba(232,98,42,0.15)':'transparent',color:on?'var(--color-brand)':'var(--text-secondary)',cursor:'pointer',transition:'all var(--transition-base)' }}>{f.label}</button>
          ); })}
        </div>
      </div>
      {selected.length>0 && <div style={{ fontSize:12,color:'var(--text-muted)' }}>{selected.length} feature{selected.length!==1?'s':''} selected</div>}
    </div>
  );
}

// ─── Venue Edit Drawer ────────────────────────────────────────────────────────
const CAT_OPTS = ['pub','bar','cocktail_bar','wine_bar','beer_bar','gastropub','music_venue','comedy_club','hotel_bar','brewery_taproom','lounge','sports_bar','karaoke','speakeasy','dive_bar','cabaret','concert_venue','jazz_and_blues'];
const VENUE_SEL = 'id,name,category,description,address,locality,borough,lat,lng,website,verified_url,booking_url,phone,features,image_urls,is_independent,permanently_closed,curation_status,curation_notes,curation_updated_at,curation_updated_by,features_stale';

function VenueDrawer({ venue, allFeatures, who, onClose, onSaved, onDeleted, showToast }) {
  const [draft,setDraft]=useState(null), [saving,setSaving]=useState(false), [tab,setTab]=useState('info');
  useEffect(()=>{
    if (!venue) return;
    setDraft({ name:venue.name||'', category:venue.category||'', description:venue.description||'', address:venue.address||'', locality:venue.locality||'', borough:venue.borough||'', website:venue.verified_url||venue.website||'', booking_url:venue.booking_url||'', phone:venue.phone||'', lat:venue.lat||'', lng:venue.lng||'', features:parseSlugs(venue.features), image_urls:parseImages(venue.image_urls), curation_status:venue.curation_status||'', curation_notes:venue.curation_notes||'', is_independent:Boolean(venue.is_independent), permanently_closed:Boolean(venue.permanently_closed) });
    setTab('info');
  },[venue?.id]);
  if (!venue||!draft) return null;
  const set = k => v => setDraft(d=>({...d,[k]:v}));

  const save = async () => {
    setSaving(true);
    try {
      await sb('PATCH',`venues?id=eq.${venue.id}`,{ name:draft.name, category:draft.category, description:draft.description, address:draft.address, locality:draft.locality, borough:draft.borough, verified_url:draft.website, booking_url:draft.booking_url, phone:draft.phone, lat:draft.lat?parseFloat(draft.lat):null, lng:draft.lng?parseFloat(draft.lng):null, features:draft.features, image_urls:draft.image_urls, curation_status:draft.curation_status||null, curation_notes:draft.curation_notes||null, is_independent:draft.is_independent, permanently_closed:draft.permanently_closed, curation_updated_at:new Date().toISOString(), curation_updated_by:who||'admin' });
      showToast('Venue saved'); onSaved({...venue,...draft});
    } catch(e) { showToast(e.message,'error'); } finally { setSaving(false); }
  };

  const softDelete = async () => {
    if (!confirm(`Mark "${venue.name}" as deleted? It will be hidden from the app but can be restored.`)) return;
    setSaving(true);
    try {
      await sb('PATCH',`venues?id=eq.${venue.id}`,{ curation_status:'deleted',curation_updated_at:new Date().toISOString(),curation_updated_by:who||'admin' });
      showToast(`"${venue.name}" deleted (reversible)`); onDeleted(venue.id); onClose();
    } catch(e) { showToast(e.message,'error'); } finally { setSaving(false); }
  };

  const restore = async () => {
    setSaving(true);
    try {
      await sb('PATCH',`venues?id=eq.${venue.id}`,{ curation_status:null,curation_updated_at:new Date().toISOString(),curation_updated_by:who||'admin' });
      showToast(`"${venue.name}" restored`); onSaved({...venue,curation_status:null});
    } catch(e) { showToast(e.message,'error'); } finally { setSaving(false); }
  };

  const isDeleted = draft.curation_status==='deleted';
  const TABS = [{id:'info',label:'Info'},{id:'features',label:`Features (${draft.features.length})`},{id:'images',label:`Images (${draft.image_urls.length})`},{id:'admin',label:'Admin'}];

  return (
    <div style={{ width:480,flexShrink:0,borderLeft:'1px solid var(--border-subtle)',background:'var(--bg-surface)',display:'flex',flexDirection:'column',animation:'slideRight 220ms ease both',overflow:'hidden' }}>
      <div style={{ padding:'16px 20px',borderBottom:'1px solid var(--border-subtle)',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12 }}>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:16 }} className="truncate">{venue.name}</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>{venue.category} · {venue.borough||venue.locality}</div>
        </div>
        <div style={{ display:'flex',gap:6,alignItems:'center',flexShrink:0 }}>
          {isDeleted && <Badge color="error">Deleted</Badge>}
          {draft.curation_status==='flagged' && <Badge color="warning">Flagged</Badge>}
          <button onClick={onClose} style={{ background:'var(--bg-overlay)',border:'none',color:'var(--text-muted)',width:28,height:28,borderRadius:'var(--radius-full)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
        </div>
      </div>

      <div style={{ display:'flex',borderBottom:'1px solid var(--border-subtle)',padding:'0 16px',gap:4 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'10px 12px',border:'none',background:'transparent',color:tab===t.id?'var(--color-brand)':'var(--text-muted)',fontSize:13,fontWeight:tab===t.id?700:500,borderBottom:tab===t.id?'2px solid var(--color-brand)':'2px solid transparent',cursor:'pointer',fontFamily:'var(--font-display)',transition:'color var(--transition-base)' }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex:1,overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:16 }}>
        {tab==='info' && <>
          <FRow label="Name"><Inp value={draft.name} onChange={set('name')} placeholder="Venue name" /></FRow>
          <FRow label="Category">
            <Sel value={draft.category} onChange={set('category')}>
              <option value="">— select —</option>
              {CAT_OPTS.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
            </Sel>
          </FRow>
          <FRow label="Description"><Inp value={draft.description} onChange={set('description')} placeholder="Venue description…" rows={4} /></FRow>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <FRow label="Borough"><Inp value={draft.borough} onChange={set('borough')} placeholder="Borough" /></FRow>
            <FRow label="Locality"><Inp value={draft.locality} onChange={set('locality')} placeholder="Area / neighbourhood" /></FRow>
          </div>
          <FRow label="Address"><Inp value={draft.address} onChange={set('address')} placeholder="Full address" /></FRow>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <FRow label="Lat"><Inp value={String(draft.lat)} onChange={set('lat')} placeholder="51.xxxx" /></FRow>
            <FRow label="Lng"><Inp value={String(draft.lng)} onChange={set('lng')} placeholder="-0.xxxx" /></FRow>
          </div>
          <FRow label="Website"><Inp value={draft.website} onChange={set('website')} placeholder="https://…" /></FRow>
          <FRow label="Booking URL"><Inp value={draft.booking_url} onChange={set('booking_url')} placeholder="https://…" /></FRow>
          <FRow label="Phone"><Inp value={draft.phone} onChange={set('phone')} placeholder="+44…" /></FRow>
          <div style={{ display:'flex',gap:16 }}>
            <Toggle checked={draft.is_independent} onChange={set('is_independent')} label="Independent" />
            <Toggle checked={draft.permanently_closed} onChange={set('permanently_closed')} label="Permanently closed" />
          </div>
        </>}
        {tab==='features' && <FeatureSel selected={draft.features} allFeatures={allFeatures} onChange={set('features')} />}
        {tab==='images'   && <ImgEditor images={draft.image_urls} onChange={set('image_urls')} />}
        {tab==='admin' && <>
          <FRow label="Curation Status">
            <Sel value={draft.curation_status} onChange={set('curation_status')}>
              <option value="">Active (visible in app)</option>
              <option value="flagged">Flagged (hidden, needs review)</option>
              <option value="deleted">Deleted (hidden, reversible)</option>
            </Sel>
          </FRow>
          <FRow label="Curation Notes" hint="Internal only">
            <Inp value={draft.curation_notes} onChange={set('curation_notes')} placeholder="Notes for the team…" rows={3} />
          </FRow>
          <div style={{ padding:12,background:'var(--bg-elevated)',borderRadius:'var(--radius-sm)',display:'flex',flexDirection:'column',gap:6,fontSize:12,color:'var(--text-muted)' }}>
            <div><strong style={{ color:'var(--text-secondary)' }}>ID:</strong> {venue.id}</div>
            {venue.curation_updated_by && <div><strong style={{ color:'var(--text-secondary)' }}>Last edited by:</strong> {venue.curation_updated_by}</div>}
            {venue.curation_updated_at && <div><strong style={{ color:'var(--text-secondary)' }}>Last edited:</strong> {new Date(venue.curation_updated_at).toLocaleString()}</div>}
          </div>
          <div style={{ paddingTop:12,borderTop:'1px solid var(--border-subtle)' }}>
            {isDeleted ? <Btn variant="success" onClick={restore} disabled={saving} style={{ width:'100%' }}>♻ Restore venue</Btn>
                       : <Btn variant="danger" onClick={softDelete} disabled={saving} style={{ width:'100%' }}>🗑 Delete venue (reversible)</Btn>}
          </div>
        </>}
      </div>

      <div style={{ padding:'14px 20px',borderTop:'1px solid var(--border-subtle)',display:'flex',gap:8,background:'var(--bg-surface)' }}>
        <Btn variant="default" onClick={onClose} style={{ flex:1 }}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={saving} style={{ flex:2 }}>
          {saving?<><Spinner size={14} color="#fff"/> Saving…</>:'✓ Save changes'}
        </Btn>
      </div>
    </div>
  );
}

// ─── VENUES SECTION ───────────────────────────────────────────────────────────
function VenuesSection({ who, allFeatures, showToast, onStatsChange }) {
  const [venues,setVenues]=useState([]), [total,setTotal]=useState(0), [loading,setLoading]=useState(false);
  const [search,setSearch]=useState(''), [fStatus,setFStatus]=useState('active'), [fCat,setFCat]=useState(''), [fBorough,setFBorough]=useState('');
  const [page,setPage]=useState(0), [sel,setSel]=useState(null);
  const PAGE=50;

  const buildQ = useCallback(()=>{
    let q=`venues?select=${VENUE_SEL}&order=name.asc&limit=${PAGE}&offset=${page*PAGE}`;
    if (fStatus==='active')   q+='&curation_status=is.null&permanently_closed=neq.true';
    else if (fStatus==='flagged') q+='&curation_status=eq.flagged';
    else if (fStatus==='deleted') q+='&curation_status=eq.deleted';
    else if (fStatus==='stale')   q+='&features_stale=eq.true';
    else if (fStatus==='no_images') q+='&image_urls=eq.%5B%5D&curation_status=is.null';
    if (fCat)    q+=`&category=eq.${fCat}`;
    if (fBorough) q+=`&borough=eq.${encodeURIComponent(fBorough)}`;
    if (search)  q+=`&name=ilike.*${encodeURIComponent(search)}*`;
    return q;
  },[page,search,fStatus,fCat,fBorough]);

  const load = useCallback(async()=>{
    setLoading(true);
    try { const {data,total:t}=await sb('GET',buildQ()); setVenues(Array.isArray(data)?data:[]); if(t!==undefined)setTotal(t); }
    catch(e){ showToast(e.message,'error'); } finally { setLoading(false); }
  },[buildQ]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(0);},[search,fStatus,fCat,fBorough]);

  const boroughs = useMemo(()=>[...new Set(venues.map(v=>v.borough).filter(Boolean))].sort(),[venues]);

  const STATUS_TABS = [{id:'active',label:'Active'},{id:'flagged',label:'Flagged'},{id:'deleted',label:'Deleted'},{id:'stale',label:'Stale features'},{id:'no_images',label:'No images'}];

  return (
    <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
      <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div style={{ padding:'14px 20px',borderBottom:'1px solid var(--border-subtle)',display:'flex',flexDirection:'column',gap:10 }}>
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <Inp value={search} onChange={setSearch} placeholder="Search venues…" style={{ flex:1,maxWidth:300 }} />
            <Sel value={fCat} onChange={setFCat}><option value="">All categories</option>{CAT_OPTS.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</Sel>
            <Sel value={fBorough} onChange={setFBorough}><option value="">All boroughs</option>{boroughs.map(b=><option key={b} value={b}>{b}</option>)}</Sel>
            <Btn variant="ghost" size="sm" onClick={load} title="Refresh" style={{ fontSize:23 }}>↺</Btn>
          </div>
          <div style={{ display:'flex',gap:6,alignItems:'center' }}>
            {STATUS_TABS.map(f=>(
              <button key={f.id} onClick={()=>setFStatus(f.id)} style={{ padding:'5px 12px',borderRadius:'var(--radius-full)',border:'1.5px solid',borderColor:fStatus===f.id?'var(--color-brand)':'var(--border-default)',background:fStatus===f.id?'rgba(232,98,42,0.12)':'transparent',color:fStatus===f.id?'var(--color-brand)':'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'var(--font-display)',transition:'all var(--transition-base)' }}>{f.label}</button>
            ))}
            <div style={{ marginLeft:'auto',fontSize:12,color:'var(--text-muted)' }}>{loading?'…':`${total.toLocaleString()} venues`}</div>
          </div>
        </div>

        <div style={{ flex:1,overflowY:'auto' }}>
          {loading&&!venues.length ? <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:200,gap:12 }}><Spinner/><span style={{ color:'var(--text-muted)',fontSize:13 }}>Loading…</span></div>
          : !venues.length ? <div style={{ padding:40,textAlign:'center',color:'var(--text-muted)',fontSize:14 }}>No venues found</div>
          : <table style={{ width:'100%',borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg-surface)',position:'sticky',top:0,zIndex:1 }}>
                  {['Name','Category','Borough','Features','Images','Status',''].map(h=>(
                    <th key={h} style={{ padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)',borderBottom:'1px solid var(--border-subtle)',whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {venues.map((v,i)=>{
                  const active=sel?.id===v.id, imgs=parseImages(v.image_urls).length, feats=parseSlugs(v.features).length;
                  return (
                    <tr key={v.id} onClick={()=>setSel(active?null:v)} style={{ cursor:'pointer',background:active?'rgba(232,98,42,0.07)':i%2?'rgba(255,255,255,0.015)':'transparent',borderBottom:'1px solid var(--border-subtle)',transition:'background var(--transition-base)', textAlign:'left' }}
                      onMouseEnter={e=>{if(!active)e.currentTarget.style.background='var(--bg-hover)';}}
                      onMouseLeave={e=>{if(!active)e.currentTarget.style.background=i%2?'rgba(255,255,255,0.015)':'transparent';}}>
                      <td style={{ padding:'9px 14px',maxWidth:220 }}><div style={{ fontWeight:600,fontSize:13,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis' }}>{v.name}</div>{v.locality&&<div style={{ fontSize:11,color:'var(--text-muted)',marginTop:1 }}>{v.locality}</div>}</td>
                      <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-secondary)',whiteSpace:'nowrap' }}>{v.category?.replace(/_/g,' ')||'—'}</td>
                      <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-secondary)',whiteSpace:'nowrap' }}>{v.borough||'—'}</td>
                      <td style={{ padding:'9px 14px',fontSize:12,color:feats?'var(--text-secondary)':'var(--text-muted)' }}>{feats||'—'}</td>
                      <td style={{ padding:'9px 14px',fontSize:12,color:imgs?'var(--text-secondary)':'#EF4444' }}>{imgs||<span style={{ opacity:.6 }}>0</span>}</td>
                      <td style={{ padding:'9px 14px' }}>
                        {v.curation_status==='deleted'&&<Badge color="error">Deleted</Badge>}
                        {v.curation_status==='flagged'&&<Badge color="warning">Flagged</Badge>}
                        {v.features_stale&&!v.curation_status&&<Badge color="info">Stale</Badge>}
                        {v.permanently_closed&&<Badge color="default">Closed</Badge>}
                      </td>
                      <td style={{ padding:'9px 14px' }}><Btn variant="ghost" size="sm" style={{ color:'var(--color-brand)',opacity:active?1:0.5 }}>Edit →</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
        </div>

        {total>PAGE && (
          <div style={{ padding:'12px 20px',borderTop:'1px solid var(--border-subtle)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <Btn variant="default" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Prev</Btn>
            <div style={{ fontSize:12,color:'var(--text-muted)' }}>Page {page+1} of {Math.ceil(total/PAGE)} · {total.toLocaleString()} total</div>
            <Btn variant="default" size="sm" disabled={(page+1)*PAGE>=total} onClick={()=>setPage(p=>p+1)}>Next →</Btn>
          </div>
        )}
      </div>

      {sel && <VenueDrawer venue={sel} allFeatures={allFeatures} who={who} onClose={()=>setSel(null)}
        onSaved={u=>{setVenues(vs=>vs.map(v=>v.id===u.id?{...v,...u}:v)); setSel(s=>s?.id===u.id?{...s,...u}:s);}}
        onDeleted={id=>{setVenues(vs=>vs.filter(v=>v.id!==id)); setSel(null);}}
        showToast={showToast} />}
    </div>
  );
}

// ─── TRIAGE (FLAGGED RESOLUTION) SECTION ─────────────────────────────────────
function TriageSection({ who, allFeatures, showToast, onStatsChange }) {
  const [queue,setQueue]=useState([]), [idx,setIdx]=useState(0), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false), [editOpen,setEditOpen]=useState(false), [imgIdx,setImgIdx]=useState(0);

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try { const{data}=await sb('GET',`venues?select=${VENUE_SEL}&curation_status=eq.flagged&order=curation_updated_at.asc&limit=200`); setQueue(Array.isArray(data)?data:[]); }
      catch(e){ showToast(e.message,'error'); } finally { setLoading(false); }
    })();
  },[]);

  const cur = queue[idx];
  const images = cur ? parseImages(cur.image_urls) : [];
  const featureLabels = cur ? parseSlugs(cur.features).map(slug=>{ const f=allFeatures.find(f=>f.slug===slug); return f?.label||slug.replace(/_/g,' '); }) : [];

  const resolve = async (status) => {
    if (!cur||saving) return;
    setSaving(true);
    try {
      await sb('PATCH',`venues?id=eq.${cur.id}`,{ curation_status:status||null, curation_updated_at:new Date().toISOString(), curation_updated_by:who||'admin' });
      setQueue(q=>q.filter(v=>v.id!==cur.id));
      setIdx(i=>Math.min(i,queue.length-2));
      setImgIdx(0); onStatsChange();
    } catch(e){ showToast(e.message,'error'); } finally { setSaving(false); }
  };

  const skip = () => { setIdx(i=>(i+1)%queue.length); setImgIdx(0); };

  useEffect(()=>{
    const h = e => {
      if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      if (e.key==='k') resolve(null);
      if (e.key==='d') resolve('deleted');
      if (e.key==='ArrowRight'||e.key==='l') skip();
      if (e.key==='ArrowLeft'&&imgIdx>0) setImgIdx(i=>i-1);
      if (e.key==='ArrowRight'&&imgIdx<images.length-1) setImgIdx(i=>i+1);
    };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[cur,imgIdx,queue.length,images.length]);

  if (loading) return <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:12 }}><Spinner/><span style={{ color:'var(--text-muted)' }}>Loading flagged venues…</span></div>;
  if (!queue.length) return (
    <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12 }}>
      <div style={{ fontSize:48 }}>✓</div>
      <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:20 }}>Nothing flagged</div>
      <div style={{ color:'var(--text-muted)',fontSize:14 }}>Flag venues from the Venues table to review them here</div>
    </div>
  );

  return (
    <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
      <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
        {/* Image pane */}
        <div style={{ flex:'0 0 50%',position:'relative',background:'var(--bg-base)',overflow:'hidden' }}>
          {!images.length ? (
            <div style={{ height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,color:'var(--text-muted)' }}><div style={{ fontSize:48,opacity:.3 }}>📷</div><div style={{ fontSize:14 }}>No images</div></div>
          ) : <>
            <img key={images[imgIdx]} src={images[imgIdx]} alt="" style={{ width:'100%',height:'100%',objectFit:'cover',display:'block' }} />
            {images.length>1 && <>
              <div style={{ position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',display:'flex',gap:6 }}>
                {images.map((_,i)=><div key={i} onClick={()=>setImgIdx(i)} style={{ width:i===imgIdx?20:6,height:6,borderRadius:3,background:i===imgIdx?'#fff':'rgba(255,255,255,0.4)',cursor:'pointer',transition:'all 0.2s' }} />)}
              </div>
              <div style={{ position:'absolute',bottom:16,right:16,background:'rgba(0,0,0,0.55)',borderRadius:4,padding:'2px 8px',fontSize:11,color:'rgba(255,255,255,0.85)' }}>{imgIdx+1}/{images.length}</div>
              {imgIdx>0 && <button onClick={()=>setImgIdx(i=>i-1)} style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',background:'rgba(0,0,0,0.5)',border:'none',borderRadius:'50%',width:36,height:36,color:'#fff',fontSize:20,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>‹</button>}
              {imgIdx<images.length-1 && <button onClick={()=>setImgIdx(i=>i+1)} style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'rgba(0,0,0,0.5)',border:'none',borderRadius:'50%',width:36,height:36,color:'#fff',fontSize:20,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>›</button>}
            </>}
          </>}
          <div style={{ position:'absolute',top:16,left:16 }}>
            <div style={{ background:'rgba(0,0,0,0.6)',borderRadius:'var(--radius-full)',padding:'4px 12px',fontSize:12,fontWeight:700,color:'#fff',fontFamily:'var(--font-display)' }}>{idx+1} / {queue.length} in queue</div>
          </div>
        </div>

        {/* Info + actions */}
        <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--bg-surface)' }}>
          <div style={{ flex:1,overflowY:'auto',padding:'32px 32px 16px' }}>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:'var(--font-display)',fontWeight:800,fontSize:26,lineHeight:1.15,marginBottom:8 }}>{cur.name}</div>
              <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
                {cur.category && <Badge color="default">{cur.category.replace(/_/g,' ')}</Badge>}
                {cur.borough && <span style={{ fontSize:13,color:'var(--text-muted)' }}>{cur.borough}</span>}
                {cur.locality && cur.locality!==cur.borough && <span style={{ fontSize:13,color:'var(--text-muted)' }}>· {cur.locality}</span>}
                {cur.features_stale && <Badge color="warning">⚠ stale features</Badge>}
              </div>
            </div>

            {cur.description && (
              <p style={{ fontSize:14,color:'var(--text-secondary)',lineHeight:1.65,marginBottom:20,borderLeft:'2px solid var(--border-default)',paddingLeft:14 }}>{cur.description}</p>
            )}

            {featureLabels.length>0 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8,fontFamily:'var(--font-display)' }}>Features</div>
                <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>{featureLabels.map(f=><Badge key={f}>{f}</Badge>)}</div>
              </div>
            )}

            {(cur.verified_url||cur.website) && (
              <a href={cur.verified_url||cur.website} target="_blank" rel="noopener noreferrer"
                style={{ display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'var(--color-brand)',textDecoration:'none' }}>
                🌐 {(cur.verified_url||cur.website).replace(/^https?:\/\//,'')}
              </a>
            )}
          </div>

          <div style={{ padding:'20px 32px 28px',borderTop:'1px solid var(--border-subtle)',display:'flex',flexDirection:'column',gap:10 }}>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
              <button onClick={()=>resolve(null)} disabled={saving} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:6,padding:'16px 12px',borderRadius:'var(--radius-lg)',border:'1.5px solid rgba(16,185,129,0.4)',background:'rgba(16,185,129,0.1)',color:'#10B981',cursor:saving?'not-allowed':'pointer',opacity:saving?.5:1,transition:'all var(--transition-base)',fontFamily:'var(--font-display)' }}>
                <span style={{ fontSize:22 }}>✓</span>
                <span style={{ fontSize:14,fontWeight:700 }}>Restore</span>
                <span style={{ fontSize:10,opacity:.5,fontWeight:600 }}>K</span>
              </button>
              <button onClick={()=>resolve('deleted')} disabled={saving} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:6,padding:'16px 12px',borderRadius:'var(--radius-lg)',border:'1.5px solid rgba(239,68,68,0.4)',background:'rgba(239,68,68,0.1)',color:'#EF4444',cursor:saving?'not-allowed':'pointer',opacity:saving?.5:1,transition:'all var(--transition-base)',fontFamily:'var(--font-display)' }}>
                <span style={{ fontSize:22 }}>✕</span>
                <span style={{ fontSize:14,fontWeight:700 }}>Delete</span>
                <span style={{ fontSize:10,opacity:.5,fontWeight:600 }}>D</span>
              </button>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
              <Btn variant="default" onClick={skip}>Skip <span style={{ opacity:.4,fontSize:11 }}>→</span></Btn>
              <Btn variant="default" onClick={()=>setEditOpen(true)}>✎ Edit details</Btn>
            </div>
          </div>
        </div>
      </div>

      {editOpen && <VenueDrawer venue={cur} allFeatures={allFeatures} who={who} onClose={()=>setEditOpen(false)}
        onSaved={u=>{
          // If no longer flagged, remove from queue
          if (u.curation_status !== 'flagged') { setQueue(q=>q.filter(v=>v.id!==u.id)); setIdx(i=>Math.min(i,queue.length-2)); onStatsChange(); }
          else { setQueue(q=>q.map(v=>v.id===u.id?{...v,...u}:v)); }
          setEditOpen(false); showToast('Saved');
        }}
        onDeleted={id=>{setQueue(q=>q.filter(v=>v.id!==id)); setEditOpen(false); onStatsChange();}}
        showToast={showToast} />}
    </div>
  );
}

// ─── DUPLICATES SECTION ───────────────────────────────────────────────────────
function DupesSection({ who, showToast, onStatsChange }) {
  const [cands,setCands]=useState([]), [totalPending,setTotalPending]=useState(0), [computing,setComputing]=useState(false), [sel,setSel]=useState(null), [choices,setChoices]=useState({}), [merging,setMerging]=useState(false);

  const loadCands = async () => {
    try {
      const{data,total}=await sb('GET','duplicate_candidates?select=*&status=eq.pending&order=similarity_score.desc&limit=100');
      setTotalPending(total||0);
      // Also fetch venue names in bulk
      if (Array.isArray(data) && data.length) {
        const ids = [...new Set(data.flatMap(c=>[c.venue_a,c.venue_b]))];
        const {data:vdata}=await sb('GET',`venues?select=id,name,borough,category&id=in.(${ids.join(',')})`);
        const vmap = Object.fromEntries((vdata||[]).map(v=>[v.id,v]));
        setCands(data.map(c=>({...c, venueAData:vmap[c.venue_a], venueBData:vmap[c.venue_b]})));
      } else { setCands([]); }
    } catch { setCands([]); setTotalPending(0); }
  };

  useEffect(()=>{loadCands();},[]);

  const runScan = async () => {
    setComputing(true);
    showToast('Scanning for duplicates…','warning');
    try {
      // Seed with already-pending canonical pairs so repeat scans don't reinsert them.
      const { data: existingPending } = await sb('GET','duplicate_candidates?select=venue_a,venue_b&status=eq.pending&limit=100000');
      const seen = new Set(
        (Array.isArray(existingPending) ? existingPending : []).map(r => {
          const [a,b] = [r.venue_a, r.venue_b].sort();
          return `${a}|${b}`;
        })
      );

      let all=[];
      for (let off=0;;off+=1000) {
        const{data}=await sb('GET',`venues?select=id,name,lat,lng,borough,category&curation_status=is.null&permanently_closed=neq.true&lat=not.is.null&limit=1000&offset=${off}`);
        if (!data?.length) break; all=all.concat(data); if(data.length<1000)break;
      }
      const pairs=[];
      for (let i=0;i<all.length;i++) {
        for (let j=i+1;j<all.length;j++) {
          const a=all[i],b=all[j];
          if(!a.lat||!b.lat) continue;
          const dist=haversineM(a.lat,a.lng,b.lat,b.lng);
          if(dist>150) continue;
          const sim=nameSimilarity(a.name,b.name);
          if(sim<0.72) continue;
          const [venueA, venueB] = [a.id, b.id].sort();
          const key=`${venueA}|${venueB}`;
          if(seen.has(key)) continue;
          seen.add(key);
          pairs.push({venue_a:venueA,venue_b:venueB,similarity_score:sim,distance_metres:Math.round(dist),detection_method:'proximity_name',status:'pending'});
        }
      }
      if (!pairs.length) { showToast('No new candidates found','warning'); }
      else { await sb('POST','duplicate_candidates',pairs); showToast(`Found ${pairs.length} candidate${pairs.length!==1?'s':''}`); await loadCands(); onStatsChange(); }
    } catch(e){ showToast(e.message,'error'); } finally { setComputing(false); }
  };

  const openMerge = async (c) => {
    try {
      const[{data:[a]},{data:[b]}]=await Promise.all([sb('GET',`venues?select=${VENUE_SEL}&id=eq.${c.venue_a}`),sb('GET',`venues?select=${VENUE_SEL}&id=eq.${c.venue_b}`)]);
      setSel({a,b,candId:c.id});
      const ch={};
      ['name','description','category','borough','locality','address','verified_url','booking_url','phone'].forEach(k=>{ch[k]=(a[k]?.length||0)>=(b[k]?.length||0)?'a':'b';});
      ch.features='merge'; ch.image_urls='merge';
      setChoices(ch);
    } catch(e){showToast(e.message,'error');}
  };

  const dismiss = async id => {
    try { await sb('PATCH',`duplicate_candidates?id=eq.${id}`,{status:'dismissed'}); setCands(c=>c.filter(x=>x.id!==id)); if(sel?.candId===id)setSel(null); onStatsChange(); }
    catch(e){showToast(e.message,'error');}
  };

  const merge = async () => {
    if(!sel) return;
    const{a,b,candId}=sel;
    setMerging(true);
    try {
      const pick=k=>choices[k]==='b'?b[k]:a[k];
      const merged={ name:pick('name'), description:pick('description'), category:pick('category'), borough:pick('borough'), locality:pick('locality'), address:pick('address'), verified_url:pick('verified_url')||pick('website'), booking_url:pick('booking_url'), phone:pick('phone'), features:choices.features==='merge'?[...new Set([...parseSlugs(a.features),...parseSlugs(b.features)])]:parseSlugs(pick('features')), image_urls:choices.image_urls==='merge'?[...new Set([...parseImages(a.image_urls),...parseImages(b.image_urls)])]:parseImages(pick('image_urls')), curation_updated_at:new Date().toISOString(), curation_updated_by:who||'admin' };
      await sb('PATCH',`venues?id=eq.${a.id}`,merged);
      await sb('PATCH',`venues?id=eq.${b.id}`,{curation_status:'deleted',curation_notes:`Merged into ${a.id}`});
      try{await sb('PATCH',`outing_venues?venue_id=eq.${b.id}`,{venue_id:a.id});}catch{}
      await sb('PATCH',`duplicate_candidates?id=eq.${candId}`,{status:'merged'});
      showToast(`Merged "${b.name}" into "${a.name}"`);
      setCands(c=>c.filter(x=>x.id!==candId)); setSel(null); onStatsChange();
    } catch(e){showToast(e.message,'error');} finally{setMerging(false);}
  };

  const FIELDS = ['name','category','description','borough','locality','address','verified_url','booking_url','phone'];

  return (
    <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
      {/* Candidates list */}
      <div style={{ width:320,flexShrink:0,borderRight:'1px solid var(--border-subtle)',display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div style={{ padding:'16px 16px 12px',borderBottom:'1px solid var(--border-subtle)',display:'flex',flexDirection:'column',gap:10 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:14 }}>Pending candidates</div>
            <Badge color={cands.length?'warning':'default'}>{cands.length} shown / {totalPending} pending</Badge>
          </div>
          <Btn variant="primary" size="sm" onClick={runScan} disabled={computing} style={{ width:'100%' }}>
            {computing?<><Spinner size={12} color="#fff"/> Scanning…</>:'🔍 Scan for duplicates'}
          </Btn>
          <div style={{ fontSize:11,color:'var(--text-muted)',lineHeight:1.5 }}>Finds venues within 150m with similar names. Stores results in <code style={{ fontSize:10,background:'var(--bg-elevated)',padding:'1px 4px',borderRadius:3 }}>duplicate_candidates</code>.</div>
        </div>
        <div style={{ flex:1,overflowY:'auto' }}>
          {!cands.length ? <div style={{ padding:24,textAlign:'center',color:'var(--text-muted)',fontSize:13 }}>Run a scan to detect candidates</div>
          : cands.map(c=>{
            const aName=c.venueAData?.name||c.venue_a, bName=c.venueBData?.name||c.venue_b, isSel=sel?.candId===c.id;
            return (
              <div key={c.id} onClick={()=>openMerge(c)} style={{ padding:'12px 16px',cursor:'pointer',background:isSel?'rgba(232,98,42,0.07)':'transparent',borderBottom:'1px solid var(--border-subtle)',transition:'background var(--transition-base)' }}
                onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background='var(--bg-hover)';}}
                onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background='transparent';}}>
                <div style={{ fontSize:13,fontWeight:600,marginBottom:3 }}>{aName}</div>
                <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:3 }}>vs</div>
                <div style={{ fontSize:13,fontWeight:600,marginBottom:8 }}>{bName}</div>
                <div style={{ display:'flex',gap:5, justifyContent:'center' }}>
                  <Badge color={c.similarity_score>.9?'error':c.similarity_score>.8?'warning':'default'}>{Math.round(c.similarity_score*100)}% similar</Badge>
                  <Badge color="default">{Math.round(c.distance_metres)}m</Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Merge UI */}
      {!sel ? (
        <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,color:'var(--text-muted)' }}>
          <div style={{ fontSize:40,opacity:.3 }}>🔁</div><div style={{ fontSize:14 }}>Select a candidate to review</div>
        </div>
      ) : (
        <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
          <div style={{ padding:'16px 24px',borderBottom:'1px solid var(--border-subtle)',display:'flex',alignItems:'center',gap:12, textAlign:'left' }}>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:15 }}>Merge Review</div>
              <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>Click a cell to choose which value wins. Venue A is always kept.</div>
            </div>
            <Btn variant="ghost" size="sm" onClick={()=>dismiss(sel.candId)}>Not a duplicate</Btn>
            <Btn variant="primary" size="sm" onClick={merge} disabled={merging}>{merging?<><Spinner size={12} color="#fff"/> Merging…</>:'⚡ Merge'}</Btn>
          </div>
          <div style={{ flex:1,overflowY:'auto',padding:24 }}>
            <div style={{ display:'grid',gridTemplateColumns:'130px 1fr 1fr',gap:10,marginBottom:14 }}>
              <div/>
              {[{label:'Venue A (Winner)',color:'var(--text-secondary)',bg:'var(--bg-elevated)',br:'var(--border-default)',sub:'Will be kept'},{label:'Venue B',color:'var(--text-secondary)',bg:'var(--bg-elevated)',br:'var(--border-default)',sub:'Will be deleted'}].map(h=>(
                <div key={h.label} style={{ padding:'8px 12px',background:h.bg,border:`1px solid ${h.br}`,borderRadius:'var(--radius-sm)',textAlign:'center' }}>
                  <div style={{ fontSize:12,fontWeight:700,color:h.color,fontFamily:'var(--font-display)' }}>{h.label}</div>
                  <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{h.sub}</div>
                </div>
              ))}
            </div>
            {FIELDS.map(field=>{
              const av=sel.a[field]||'', bv=sel.b[field]||'', same=av===bv;
              return (
                <div key={field} style={{ display:'grid',gridTemplateColumns:'130px 1fr 1fr',gap:10,marginBottom:8,alignItems:'start' }}>
                  <div style={{ paddingTop:10,fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)' }}>{field.replace(/_/g,' ')}</div>
                  {['a','b'].map(side=>{
                    const val=side==='a'?av:bv, chosen=choices[field]===side, discarded=!same&&choices[field]!==side;
                    return <div key={side} onClick={()=>!same&&setChoices(c=>({...c,[field]:side}))} style={{
                      padding:'8px 12px',borderRadius:'var(--radius-sm)',
                      border:`1.5px solid ${chosen?'rgba(16,185,129,0.5)':discarded?'var(--border-subtle)':'var(--border-default)'}`,
                      background:chosen?'rgba(16,185,129,0.08)':'var(--bg-elevated)',
                      cursor:same?'default':'pointer',
                      fontSize:13,
                      color:chosen?'var(--text-primary)':discarded?'var(--text-muted)':val?'var(--text-primary)':'var(--text-muted)',
                      fontStyle:!val?'italic':'normal',
                      opacity:discarded?0.5:1,
                      transition:'all var(--transition-base)',lineHeight:1.4,wordBreak:'break-word',
                    }}>{val||'(empty)'}{chosen&&!same&&<span style={{ float:'right',color:'#10B981',fontSize:12 }}>✓</span>}</div>;
                  })}
                </div>
              );
            })}
            {[{key:'features',av:`${parseSlugs(sel.a.features).length} features`,bv:`${parseSlugs(sel.b.features).length} features`},{key:'image_urls',av:`${parseImages(sel.a.image_urls).length} images`,bv:`${parseImages(sel.b.image_urls).length} images`}].map(({key,av,bv})=>(
              <div key={key} style={{ display:'grid',gridTemplateColumns:'130px 1fr 1fr',gap:10,marginBottom:8,alignItems:'start' }}>
                <div style={{ paddingTop:10,fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)' }}>{key.replace(/_/g,' ')}</div>
                <div style={{ gridColumn:'2/4',padding:'8px 12px',borderRadius:'var(--radius-sm)',background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.3)',fontSize:13,color:'#818CF8',fontFamily:'var(--font-display)',fontWeight:600 }}>🔀 Always merged — {av} + {bv}</div>
              </div>
            ))}
            <div style={{ display:'grid',gridTemplateColumns:'130px 1fr 1fr',gap:10,marginTop:8 }}>
              <div/>
              {[sel.a,sel.b].map((v,i)=><div key={i} style={{ borderRadius:'var(--radius-sm)',overflow:'hidden' }}><ImgCarousel images={v.image_urls} height={120}/></div>)}
            </div>
          </div>
        </div>
      )}    </div>
  );
}

// ─── REFERENCE DATA SECTION ───────────────────────────────────────────────────
function RefSection({ showToast }) {
  const [tab,setTab]=useState('features'), [features,setFeatures]=useState([]), [featureOpts,setFeatureOpts]=useState([]), [occasions,setOccasions]=useState([]), [loading,setLoading]=useState(false), [editing,setEditing]=useState(null), [draft,setDraft]=useState({}), [saving,setSaving]=useState(false), [isNew,setIsNew]=useState(false);

  const loadF = async () => { setLoading(true); try { const{data}=await sb('GET','feature_definitions?select=*&order=label.asc'); setFeatures(Array.isArray(data)?data:[]); } catch(e){showToast(e.message,'error');} finally{setLoading(false);} };
  const loadO = async () => { setLoading(true); try { const{data}=await sb('GET','occasion_definitions?select=*&order=sort_order.asc'); setOccasions(Array.isArray(data)?data:[]); } catch(e){showToast(e.message,'error');} finally{setLoading(false);} };
  const loadFeatureOpts = async () => {
    try {
      const { data } = await sb('GET','feature_definitions?select=slug,label&order=label.asc');
      setFeatureOpts(Array.isArray(data) ? data : []);
    } catch(e) { showToast(e.message,'error'); }
  };
  useEffect(()=>{ if(tab==='features')loadF(); else loadO(); },[tab]);
  useEffect(()=>{ loadFeatureOpts(); },[]);

  const openEdit = row => { setEditing(row.slug||row.id); setDraft({...row}); setIsNew(false); };
  const openNew  = () => { setEditing('__new__'); setIsNew(true); setDraft(tab==='features'?{slug:'',label:'',icon:'',category:'general',ratable:false,must_haveable:false,question:'',occasions:[]}:{slug:'',label:'',icon:'',description:'',is_primary:true,in_onboarding:true,sort_order:0,default_must_haves:[]}); };

  const save = async () => {
    setSaving(true);
    try {
      if (tab==='features') { isNew?await sb('POST','feature_definitions',[draft]):await sb('PATCH',`feature_definitions?slug=eq.${draft.slug}`,draft); loadF(); }
      else { isNew?await sb('POST','occasion_definitions',[draft]):await sb('PATCH',`occasion_definitions?id=eq.${draft.id}`,draft); loadO(); }
      showToast('Saved'); setEditing(null);
    } catch(e){showToast(e.message,'error');} finally{setSaving(false);}
  };

  const setD = k => v => setDraft(d=>({...d,[k]:v}));
  const toggleDefaultMustHave = (slug) => {
    const cur = Array.isArray(draft.default_must_haves) ? draft.default_must_haves : [];
    if (cur.includes(slug)) {
      setD('default_must_haves')(cur.filter(s => s !== slug));
      return;
    }
    if (cur.length >= 2) {
      showToast('You can select up to 2 default must-have features','warning');
      return;
    }
    setD('default_must_haves')([...cur, slug]);
  };
  const TABS = [{id:'features',label:`Features (${features.length})`},{id:'occasions',label:`Occasions (${occasions.length})`}];

  return (
    <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
      <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div style={{ display:'flex',gap:4,padding:'0 20px',borderBottom:'1px solid var(--border-subtle)',alignItems:'center' }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);setEditing(null);}} style={{ padding:'12px 16px',border:'none',background:'transparent',color:tab===t.id?'var(--color-brand)':'var(--text-muted)',fontSize:13,fontWeight:tab===t.id?700:500,borderBottom:tab===t.id?'2px solid var(--color-brand)':'2px solid transparent',cursor:'pointer',fontFamily:'var(--font-display)' }}>{t.label}</button>
          ))}
          <div style={{ marginLeft:'auto',paddingRight:4 }}><Btn variant="primary" size="sm" onClick={openNew}>+ New {tab==='features'?'feature':'occasion'}</Btn></div>
        </div>

        <div style={{ flex:1,overflowY:'auto' }}>
          {loading ? <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:200,gap:12 }}><Spinner/><span style={{ color:'var(--text-muted)',fontSize:13 }}>Loading…</span></div>
          : tab==='features' ? (
            <table style={{ width:'100%',borderCollapse:'collapse' }}>
              <thead><tr style={{ position:'sticky',top:0,background:'var(--bg-surface)',zIndex:1 }}>
                {['Slug','Label','Icon','Category','Ratable','Must-have','Occasions',''].map(h=><th key={h} style={{ padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)',borderBottom:'1px solid var(--border-subtle)',whiteSpace:'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {features.map((f,i)=>(
                  <tr key={f.slug} onClick={()=>openEdit(f)} style={{ cursor:'pointer',background:editing===f.slug?'rgba(232,98,42,0.07)':i%2?'rgba(255,255,255,0.015)':'transparent',borderBottom:'1px solid var(--border-subtle)', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'} onMouseLeave={e=>e.currentTarget.style.background=editing===f.slug?'rgba(232,98,42,0.07)':i%2?'rgba(255,255,255,0.015)':'transparent'}>
                    <td style={{ padding:'9px 14px',fontSize:12,fontFamily:'monospace',color:'var(--text-muted)' }}>{f.slug}</td>
                    <td style={{ padding:'9px 14px',fontSize:13,fontWeight:600 }}>{f.label}</td>
                    <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-muted)' }}>{f.icon||'—'}</td>
                    <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-secondary)' }}>{(f.category||'general').replace(/_/g,' ')}</td>
                    <td style={{ padding:'9px 14px' }}>{f.ratable?<Badge color="success">Yes</Badge>:<span style={{ color:'var(--text-muted)',fontSize:12 }}>—</span>}</td>
                    <td style={{ padding:'9px 14px' }}>{(f.must_haveable||f.mustHaveable)?<Badge color="info">Yes</Badge>:<span style={{ color:'var(--text-muted)',fontSize:12 }}>—</span>}</td>
                    <td style={{ padding:'9px 14px' }}><div style={{ display:'flex',flexWrap:'wrap',gap:3 }}>{(Array.isArray(f.occasions)?f.occasions:(f.occasions||'').split(',').filter(Boolean)).map(o=><Badge key={o}>{o}</Badge>)}</div></td>
                    <td style={{ padding:'9px 14px' }}><Btn variant="ghost" size="sm" style={{ color:'var(--color-brand)' }}>Edit</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ width:'100%',borderCollapse:'collapse' }}>
              <thead><tr style={{ position:'sticky',top:0,background:'var(--bg-surface)',zIndex:1 }}>
                {['Slug','Label','Icon','Description','Primary','Onboarding','Default must-haves','Order',''].map(h=><th key={h} style={{ padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)',borderBottom:'1px solid var(--border-subtle)',whiteSpace:'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {occasions.map((o,i)=>(
                  <tr key={o.id} onClick={()=>openEdit(o)} style={{ cursor:'pointer',background:editing===o.id?'rgba(232,98,42,0.07)':i%2?'rgba(255,255,255,0.015)':'transparent',borderBottom:'1px solid var(--border-subtle)', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'} onMouseLeave={e=>e.currentTarget.style.background=editing===o.id?'rgba(232,98,42,0.07)':i%2?'rgba(255,255,255,0.015)':'transparent'}>
                    <td style={{ padding:'9px 14px',fontSize:12,fontFamily:'monospace',color:'var(--text-muted)' }}>{o.slug}</td>
                    <td style={{ padding:'9px 14px',fontSize:13,fontWeight:600 }}>{o.label}</td>
                    <td style={{ padding:'9px 14px',fontSize:16 }}>{o.icon||'—'}</td>
                    <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-secondary)',maxWidth:200,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis' }}>{o.description||'—'}</td>
                    <td style={{ padding:'9px 14px' }}>{o.is_primary?<Badge color="success">Yes</Badge>:'—'}</td>
                    <td style={{ padding:'9px 14px' }}>{o.in_onboarding?<Badge color="info">Yes</Badge>:'—'}</td>
                    <td style={{ padding:'9px 14px' }}>
                      <div style={{ display:'flex',flexWrap:'wrap',gap:3 }}>
                        {(Array.isArray(o.default_must_haves)?o.default_must_haves:(o.default_must_haves||'').split(',').filter(Boolean)).length
                          ? (Array.isArray(o.default_must_haves)?o.default_must_haves:(o.default_must_haves||'').split(',').filter(Boolean)).map(s=><Badge key={s}>{s}</Badge>)
                          : <span style={{ color:'var(--text-muted)',fontSize:12 }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding:'9px 14px',fontSize:12,color:'var(--text-muted)' }}>{o.sort_order}</td>
                    <td style={{ padding:'9px 14px' }}><Btn variant="ghost" size="sm" style={{ color:'var(--color-brand)' }}>Edit</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <div style={{ width:380,flexShrink:0,borderLeft:'1px solid var(--border-subtle)',background:'var(--bg-surface)',display:'flex',flexDirection:'column',animation:'slideRight 200ms ease both' }}>
          <div style={{ padding:'16px 20px',borderBottom:'1px solid var(--border-subtle)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:15 }}>{isNew?`New ${tab==='features'?'Feature':'Occasion'}`:'Edit'}</div>
            <button onClick={()=>setEditing(null)} style={{ background:'var(--bg-overlay)',border:'none',color:'var(--text-muted)',width:28,height:28,borderRadius:'var(--radius-full)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
          </div>
          <div style={{ flex:1,overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:14 }}>
            {tab==='features' ? <>
              <FRow label="Slug" hint="snake_case, immutable"><Inp value={draft.slug||''} onChange={setD('slug')} placeholder="e.g. craft_beer" style={{ fontFamily:'monospace',fontSize:13 }} /></FRow>
              <FRow label="Label"><Inp value={draft.label||''} onChange={setD('label')} placeholder="Display name" /></FRow>
              <FRow label="Icon" hint="Phosphor icon name"><Inp value={draft.icon||''} onChange={setD('icon')} placeholder="e.g. BeerStein" /></FRow>
              <FRow label="Category">
                <Sel value={draft.category||'general'} onChange={setD('category')}>
                  <option value="general">general</option>
                  <option value="cuisine">cuisine</option>
                  <option value="food_offering">food offering</option>
                  <option value="dietary">dietary</option>
                </Sel>
              </FRow>
              <FRow label="Question" hint="Shown when rating"><Inp value={draft.question||''} onChange={setD('question')} placeholder="Was there craft beer?" rows={2} /></FRow>
              <FRow label="Occasions" hint="Comma-separated slugs"><Inp value={Array.isArray(draft.occasions)?draft.occasions.join(','):(draft.occasions||'')} onChange={v=>setD('occasions')(v.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="drinks,sunday,bignight" /></FRow>
              <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                <Toggle checked={Boolean(draft.ratable)} onChange={setD('ratable')} label="Ratable (users can rate this)" />
                <Toggle checked={Boolean(draft.must_haveable??draft.mustHaveable)} onChange={v=>setD('must_haveable')(v)} label="Must-haveable (users can require it)" />
              </div>
            </> : <>
              <FRow label="Slug" hint="immutable"><Inp value={draft.slug||''} onChange={setD('slug')} placeholder="e.g. drinks" style={{ fontFamily:'monospace',fontSize:13 }} /></FRow>
              <FRow label="Label"><Inp value={draft.label||''} onChange={setD('label')} placeholder="Display name" /></FRow>
              <FRow label="Icon" hint="Emoji or icon name"><Inp value={draft.icon||''} onChange={setD('icon')} placeholder="🍸" /></FRow>
              <FRow label="Description"><Inp value={draft.description||''} onChange={setD('description')} placeholder="Brief description…" rows={3} /></FRow>
              <FRow label="Sort Order"><Inp value={String(draft.sort_order??0)} onChange={v=>setD('sort_order')(parseInt(v)||0)} placeholder="0" style={{ width:80 }} /></FRow>
              <FRow label="Default Must-haves" hint="Choose up to 2 feature slugs">
                <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                  <div style={{ display:'flex',flexWrap:'wrap',gap:6 }}>
                    {featureOpts.map(f=>{
                      const selected = (Array.isArray(draft.default_must_haves) ? draft.default_must_haves : []).includes(f.slug);
                      return (
                        <button
                          key={f.slug}
                          onClick={()=>toggleDefaultMustHave(f.slug)}
                          style={{ padding:'4px 10px',borderRadius:'var(--radius-full)',fontSize:12,fontWeight:600,border:`1.5px solid ${selected?'var(--color-brand)':'var(--border-default)'}`,background:selected?'rgba(232,98,42,0.15)':'transparent',color:selected?'var(--color-brand)':'var(--text-secondary)',cursor:'pointer',transition:'all var(--transition-base)' }}
                        >
                          {f.label || f.slug}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize:12,color:'var(--text-muted)' }}>
                    {(Array.isArray(draft.default_must_haves) ? draft.default_must_haves.length : 0)}/2 selected
                  </div>
                </div>
              </FRow>
              <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                <Toggle checked={Boolean(draft.is_primary)} onChange={setD('is_primary')} label="Primary occasion" />
                <Toggle checked={Boolean(draft.in_onboarding)} onChange={setD('in_onboarding')} label="Show in onboarding" />
              </div>
            </>}
          </div>
          <div style={{ padding:'14px 20px',borderTop:'1px solid var(--border-subtle)',display:'flex',gap:8 }}>
            <Btn variant="default" onClick={()=>setEditing(null)} style={{ flex:1 }}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={saving} style={{ flex:2 }}>{saving?<><Spinner size={14} color="#fff"/> Saving…</>:'✓ Save'}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ACTIVITY SECTION ─────────────────────────────────────────────────────────
function ActivitySection({ showToast }) {
  const [rows,setRows]=useState([]), [loading,setLoading]=useState(true);
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try { const{data}=await sb('GET','venues?select=id,name,category,borough,curation_status,curation_notes,curation_updated_at,curation_updated_by&curation_updated_at=not.is.null&order=curation_updated_at.desc&limit=100'); setRows(Array.isArray(data)?data:[]); }
      catch(e){showToast(e.message,'error');} finally{setLoading(false);}
    })();
  },[]);

  return (
    <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
      <div style={{ padding:'16px 24px',borderBottom:'1px solid var(--border-subtle)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
        <div style={{ fontFamily:'var(--font-display)',fontWeight:700,fontSize:15 }}>Recent Edits</div>
        <div style={{ fontSize:12,color:'var(--text-muted)' }}>Last 100 changes to venue records</div>
      </div>
      <div style={{ flex:1,overflowY:'auto' }}>
        {loading ? <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:200,gap:12 }}><Spinner/><span style={{ color:'var(--text-muted)',fontSize:13 }}>Loading…</span></div>
        : !rows.length ? <div style={{ padding:40,textAlign:'center',color:'var(--text-muted)',fontSize:14 }}>No activity recorded yet</div>
        : <table style={{ width:'100%',borderCollapse:'collapse' }}>
            <thead><tr style={{ position:'sticky',top:0,background:'var(--bg-surface)',zIndex:1 }}>
              {['Venue','Category / Borough','Status','Notes','Editor','When'].map(h=><th key={h} style={{ padding:'10px 16px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-display)',borderBottom:'1px solid var(--border-subtle)',whiteSpace:'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.id} style={{ borderBottom:'1px solid var(--border-subtle)',background:i%2?'rgba(255,255,255,0.015)':'transparent' }}>
                  <td style={{ padding:'10px 16px',fontWeight:600,fontSize:13 }}>{r.name}</td>
                  <td style={{ padding:'10px 16px',fontSize:12,color:'var(--text-secondary)' }}>{[r.category?.replace(/_/g,' '),r.borough].filter(Boolean).join(' · ')||'—'}</td>
                  <td style={{ padding:'10px 16px' }}>{r.curation_status==='deleted'?<Badge color="error">Deleted</Badge>:r.curation_status==='flagged'?<Badge color="warning">Flagged</Badge>:<Badge color="success">Active</Badge>}</td>
                  <td style={{ padding:'10px 16px',fontSize:12,color:'var(--text-secondary)',maxWidth:200 }} className="truncate">{r.curation_notes||'—'}</td>
                  <td style={{ padding:'10px 16px',fontSize:12,color:'var(--text-secondary)',whiteSpace:'nowrap' }}>{r.curation_updated_by||'—'}</td>
                  <td style={{ padding:'10px 16px',fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap' }}>{r.curation_updated_at?new Date(r.curation_updated_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </div>
    </div>
  );
}

// ─── SQL Migration note ───────────────────────────────────────────────────────
// Run this in Supabase SQL editor before first use:
//
// ALTER TABLE venues
//   ADD COLUMN IF NOT EXISTS curation_status text CHECK (curation_status IN ('flagged','deleted')),
//   ADD COLUMN IF NOT EXISTS curation_notes text,
//   ADD COLUMN IF NOT EXISTS curation_updated_at timestamptz,
//   ADD COLUMN IF NOT EXISTS curation_updated_by text;
//
// CREATE TABLE IF NOT EXISTS duplicate_candidates (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   venue_a uuid REFERENCES venues(id),
//   venue_b uuid REFERENCES venues(id),
//   similarity_score float,
//   distance_metres float,
//   detection_method text DEFAULT 'proximity_name',
//   status text DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed')),
//   created_at timestamptz DEFAULT now(),
//   UNIQUE(venue_a, venue_b)
// );
//
// Also update venueService.js to filter:
//   .is('curation_status', null)

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AdminApp() {
  const { ok, who, session, sendOtp, verifyOtp, logout, saveWho } = useAuth();
  const [section,setSection]=useState('venues'), [allFeatures,setAllFeatures]=useState([]), [stats,setStats]=useState({unreviewed:0,pendingDupes:0}), [whoModal,setWhoModal]=useState(false);
  const { show: showToast, el: toastEl } = useToast();

  useEffect(()=>{
    if (!ok) return;
    (async()=>{
      try { const{data}=await sb('GET','feature_definitions?select=slug,label,icon,ratable,must_haveable,occasions&order=label.asc'); if(Array.isArray(data))setAllFeatures(data.map(r=>({slug:r.slug,label:r.label,icon:r.icon,ratable:r.ratable,mustHaveable:r.must_haveable,occasions:Array.isArray(r.occasions)?r.occasions:(r.occasions||'').split(',').filter(Boolean)}))); } catch {}
      refreshStats();
    })();
    if (!who) setWhoModal(true);
  },[ok]);

  const refreshStats = async () => {
    try {
      const [{total:flagged},dupes]=await Promise.all([
        sb('GET','venues?select=id&curation_status=eq.flagged&limit=1'),
        sb('GET','duplicate_candidates?select=id&status=eq.pending&limit=1').catch(()=>({total:0})),
      ]);
      setStats({flagged:flagged||0,pendingDupes:dupes?.total||0});
    } catch {}
  };

  if (!ok) return <><style>{GLOBAL_CSS}</style><LoginScreen onSendOtp={sendOtp} onVerifyOtp={verifyOtp}/></>;

  const sp = { who, allFeatures, showToast, onStatsChange: refreshStats };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AppShell who={who} active={section} setActive={setSection} stats={stats} onLogout={logout}>
        {section==='venues'    && <VenuesSection    {...sp} />}
        {section==='triage'    && <TriageSection    {...sp} />}
        {section==='dupes'     && <DupesSection     who={who} showToast={showToast} onStatsChange={refreshStats} />}
        {section==='reference' && <RefSection       showToast={showToast} />}
        {section==='activity'  && <ActivitySection  showToast={showToast} />}
      </AppShell>

      <Modal open={whoModal} onClose={()=>setWhoModal(false)} title="What should we call you?">
        <div style={{ color:'var(--text-secondary)',fontSize:14,marginBottom:20 }}>Your name is stored with each edit so changes are trackable.</div>
        <Inp value={who} onChange={saveWho} placeholder="Your name" autoFocus onKeyDown={e=>e.key==='Enter'&&setWhoModal(false)} style={{ marginBottom:16 }} />
        <Btn variant="primary" onClick={()=>setWhoModal(false)} style={{ width:'100%' }}>Let's go →</Btn>
      </Modal>

      {toastEl}
    </>
  );
}