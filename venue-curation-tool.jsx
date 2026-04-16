import { useState, useEffect, useCallback, useRef } from "react";

// ─── Design tokens matching Assembl ───────────────────────────────────────────
const tokens = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@400;500&display=swap');

  :root {
    --bg-base: #0D0D12;
    --bg-surface: #16161E;
    --bg-elevated: #1E1E28;
    --bg-overlay: rgba(255,255,255,0.06);
    --border-subtle: rgba(255,255,255,0.07);
    --border-default: rgba(255,255,255,0.12);
    --text-primary: #F2F2F5;
    --text-secondary: #9999AA;
    --text-muted: #666677;
    --color-brand: #E8622A;
    --color-brand-gradient: linear-gradient(135deg, #E8622A, #F0385A);
    --color-success: #22C55E;
    --color-warning: #F59E0B;
    --color-danger: #EF4444;
    --font-display: 'Plus Jakarta Sans', sans-serif;
    --font-body: 'DM Sans', sans-serif;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;
    --radius-full: 999px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-body);
    min-height: 100vh;
  }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }
`;

// ─── Supabase config ───────────────────────────────────────────────────────────
// Replace these with your actual Supabase project URL and anon key
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const DATA_URL = `${SUPABASE_URL}/storage/v1/object/public/pipeline/venues_enriched.json`;

const DECISIONS_TABLE = 'curation_decisions';

async function supabaseRequest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} failed: ${res.status}`);
  return res.json().catch(() => null);
}

// ─── Category label map ────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  pub: 'Pub', bar: 'Bar', cocktail_bar: 'Cocktail Bar',
  wine_bar: 'Wine Bar', beer_bar: 'Beer Bar', gastropub: 'Gastropub',
  music_venue: 'Music Venue', comedy_club: 'Comedy Club', hotel_bar: 'Hotel Bar',
  brewery_taproom: 'Brewery Taproom', bottle_shop: 'Bottle Shop',
  lounge: 'Lounge', sports_bar: 'Sports Bar',
};

// ─── Feature label map (subset for display) ───────────────────────────────────
const FEATURE_LABELS = {
  craft_beer: 'Craft Beer', real_ale: 'Real Ale', cocktails: 'Cocktails',
  good_wine_list: 'Good Wine', natural_wine: 'Natural Wine',
  outdoor_seating: 'Outdoor', rooftop: 'Rooftop', garden_courtyard: 'Garden',
  live_music: 'Live Music', dj_night: 'DJ Night', pub_quiz: 'Pub Quiz',
  dog_friendly: 'Dog Friendly', food_available: 'Food', sunday_roast: 'Sunday Roast',
  sports_screens: 'Sports', late_license: 'Late License', large_groups: 'Large Groups',
  private_dining: 'Private Dining', bookable_tables: 'Bookable', happy_hour: 'Happy Hour',
  independent: 'Independent', brewery_taproom: 'Taproom', historic_building: 'Historic',
  lgbtq_friendly: 'LGBTQ+', accessible: 'Accessible', fireplace: 'Fireplace',
};

// ─── Decision badge ────────────────────────────────────────────────────────────
function DecisionBadge({ decision }) {
  const config = {
    keep:   { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',  color: '#22C55E', label: '✓ Keep' },
    remove: { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  color: '#EF4444', label: '✗ Remove' },
    flag:   { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', color: '#F59E0B', label: '? Flagged' },
  }[decision];
  if (!config) return null;
  return (
    <div style={{
      padding: '3px 10px', borderRadius: 'var(--radius-full)',
      background: config.bg, border: `1px solid ${config.border}`,
      color: config.color, fontSize: 12, fontWeight: 700,
      fontFamily: 'var(--font-display)',
    }}>
      {config.label}
    </div>
  );
}

// ─── Image carousel ────────────────────────────────────────────────────────────
function ImageCarousel({ images, name }) {
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState(false);

  const urls = Array.isArray(images)
    ? images
    : (typeof images === 'string' ? JSON.parse(images) : []);

  if (!urls.length) {
    return (
      <div style={{
        height: 200, background: 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 13, flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 28 }}>📷</div>
        <div>No images</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: 200, background: 'var(--bg-elevated)' }}>
      {error ? (
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13,
          flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 28 }}>🖼️</div>
          <div>Image failed to load</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 280, textAlign: 'center', wordBreak: 'break-all' }}>
            {urls[idx]}
          </div>
        </div>
      ) : (
        <img
          key={urls[idx]}
          src={urls[idx]}
          alt={name}
          onError={() => setError(true)}
          onLoad={() => setError(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}

      {urls.length > 1 && (
        <>
          <button onClick={() => { setIdx((idx - 1 + urls.length) % urls.length); setError(false); }} style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>‹</button>
          <button onClick={() => { setIdx((idx + 1) % urls.length); setError(false); }} style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>›</button>
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 4,
          }}>
            {urls.map((_, i) => (
              <div key={i} onClick={() => { setIdx(i); setError(false); }} style={{
                width: i === idx ? 16 : 6, height: 6, borderRadius: 3,
                background: i === idx ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', transition: 'all 0.2s',
              }} />
            ))}
          </div>
        </>
      )}

      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        background: 'rgba(0,0,0,0.6)', borderRadius: 'var(--radius-sm)',
        padding: '2px 7px', fontSize: 11, color: 'rgba(255,255,255,0.8)',
      }}>
        {idx + 1} / {urls.length}
      </div>
    </div>
  );
}

// ─── Venue card ────────────────────────────────────────────────────────────────
function VenueCard({ venue, decision, notes, onDecide, onNotes, isExpanded, onToggle }) {
  const features = Object.entries(FEATURE_LABELS)
    .filter(([slug]) => venue[slug] === true)
    .map(([, label]) => label);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${
        decision === 'keep' ? 'rgba(34,197,94,0.3)' :
        decision === 'remove' ? 'rgba(239,68,68,0.3)' :
        decision === 'flag' ? 'rgba(245,158,11,0.3)' :
        'var(--border-subtle)'
      }`,
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Image */}
      <div style={{ cursor: 'pointer' }} onClick={onToggle}>
        <ImageCarousel images={venue.image_urls} name={venue.name} />
      </div>

      {/* Card body */}
      <div style={{ padding: 16 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>
            {venue.name}
          </div>
          {decision && <DecisionBadge decision={decision} />}
        </div>

        {/* Meta */}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {[CATEGORY_LABELS[venue.category] || venue.category, venue.locality || venue.area].filter(Boolean).join(' · ')}
        </div>

        {/* Description */}
        {venue.description && (
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
            marginBottom: 10, fontStyle: 'italic',
          }}>
            "{venue.description}"
          </div>
        )}

        {/* Features */}
        {features.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
            {features.slice(0, isExpanded ? undefined : 6).map(f => (
              <div key={f} style={{
                padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)',
                fontSize: 11, color: 'var(--text-secondary)',
              }}>{f}</div>
            ))}
            {!isExpanded && features.length > 6 && (
              <div style={{
                padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)',
                fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
              }} onClick={onToggle}>+{features.length - 6} more</div>
            )}
          </div>
        )}

        {/* Expanded details */}
        {isExpanded && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            {venue.address && <div>📍 {venue.address}</div>}
            {venue.website && (
              <div>🌐 <a href={venue.website} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                {venue.website}
              </a></div>
            )}
            {venue.phone && <div>📞 {venue.phone}</div>}
            {venue.enriched_hours && (() => {
              try {
                const h = JSON.parse(venue.enriched_hours);
                return <div>🕐 {Object.entries(h).map(([d, t]) => `${d}: ${t}`).join(' · ')}</div>;
              } catch { return null; }
            })()}
            {venue.lat && venue.lng && (
              <div>
                📌 {parseFloat(venue.lat).toFixed(4)}, {parseFloat(venue.lng).toFixed(4)}
                {' · '}
                <a href={`https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                  View on maps
                </a>
              </div>
            )}
            {venue.booking_url && (
              <div>🎟 <a href={venue.booking_url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                Book a table
              </a></div>
            )}
          </div>
        )}

        {/* Notes (shown when flagged or expanded) */}
        {(decision === 'flag' || isExpanded) && (
          <textarea
            placeholder="Add notes (optional)..."
            value={notes || ''}
            onChange={e => onNotes(e.target.value)}
            rows={2}
            style={{
              width: '100%', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
              fontSize: 12, padding: '8px 10px', resize: 'vertical',
              marginBottom: 12, outline: 'none',
            }}
          />
        )}

        {/* Decision buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'keep',   label: '✓ Keep',   bg: decision === 'keep'   ? '#22C55E' : 'transparent', border: decision === 'keep' ? '#22C55E' : 'rgba(34,197,94,0.4)',   color: decision === 'keep'   ? '#fff' : '#22C55E' },
            { id: 'remove', label: '✗ Remove', bg: decision === 'remove' ? '#EF4444' : 'transparent', border: decision === 'remove' ? '#EF4444' : 'rgba(239,68,68,0.4)',  color: decision === 'remove' ? '#fff' : '#EF4444' },
            { id: 'flag',   label: '? Flag',   bg: decision === 'flag'   ? '#F59E0B' : 'transparent', border: decision === 'flag' ? '#F59E0B' : 'rgba(245,158,11,0.4)', color: decision === 'flag'   ? '#fff' : '#F59E0B' },
          ].map(btn => (
            <button key={btn.id} onClick={() => onDecide(btn.id === decision ? null : btn.id)} style={{
              flex: 1, padding: '8px 4px', borderRadius: 'var(--radius-full)',
              border: `1.5px solid ${btn.border}`, background: btn.bg,
              color: btn.color, fontFamily: 'var(--font-display)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Password gate ────────────────────────────────────────────────────────────
// Set this to a shared password you tell your partners
const APP_PASSWORD = 'assembl2024';

function usePasswordGate() {
  const [unlocked, setUnlocked] = useState(() => {
    return sessionStorage.getItem('curation_unlocked') === 'true';
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const attempt = () => {
    if (input === APP_PASSWORD) {
      sessionStorage.setItem('curation_unlocked', 'true');
      setUnlocked(true);
    } else {
      setError(true);
      setInput('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return { unlocked, input, setInput, attempt, error };
}

// ─── Main app ──────────────────────────────────────────────────────────────────
export default function CurationApp() {
  const { unlocked, input, setInput, attempt, error } = usePasswordGate();
  const [venues, setVenues] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [notes, setNotes] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [showReviewerPrompt, setShowReviewerPrompt] = useState(false);
  const saveTimer = useRef(null);

  // Load venues from Supabase Storage
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        // Load venue data
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(`Failed to fetch venues: ${res.status}`);
        const data = await res.json();
        setVenues(Array.isArray(data) ? data : data.venues || []);

        // Load existing decisions
        try {
          const existing = await supabaseRequest('GET', `${DECISIONS_TABLE}?select=venue_id,decision,notes`);
          if (Array.isArray(existing)) {
            const d = {}, n = {};
            existing.forEach(r => {
              d[r.venue_id] = r.decision;
              if (r.notes) n[r.venue_id] = r.notes;
            });
            setDecisions(d);
            setNotes(n);
          }
        } catch {
          // Decisions table may not exist yet — that's fine
        }

        // Check for stored reviewer name
        const stored = localStorage.getItem('assembl_reviewer');
        if (stored) setReviewer(stored);
        else setShowReviewerPrompt(true);

      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Auto-save decisions to Supabase with debounce
  const saveDecision = useCallback(async (venueId, decision, noteText) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        await supabaseRequest('POST', DECISIONS_TABLE, [{
          venue_id: venueId,
          decision,
          notes: noteText || null,
          reviewer: reviewer || 'anonymous',
          updated_at: new Date().toISOString(),
        }]);
      } catch (e) {
        console.error('Save failed:', e);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [reviewer]);

  const handleDecide = (venueId, decision) => {
    const next = { ...decisions };
    if (decision === null) delete next[venueId];
    else next[venueId] = decision;
    setDecisions(next);
    if (decision) saveDecision(venueId, decision, notes[venueId]);
  };

  const handleNotes = (venueId, text) => {
    const next = { ...notes, [venueId]: text };
    setNotes(next);
    if (decisions[venueId]) saveDecision(venueId, decisions[venueId], text);
  };

  const handleToggleExpand = (venueId) => {
    setExpanded(e => ({ ...e, [venueId]: !e[venueId] }));
  };

  // Filtered + searched venues
  const filtered = venues.filter(v => {
    const dec = decisions[v.id];
    const matchFilter =
      filter === 'all' ? true :
      filter === 'unreviewed' ? !dec :
      dec === filter;
    const matchSearch = !search ||
      v.name?.toLowerCase().includes(search.toLowerCase()) ||
      v.locality?.toLowerCase().includes(search.toLowerCase()) ||
      v.area?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  // Stats
  const total = venues.length;
  const kept = Object.values(decisions).filter(d => d === 'keep').length;
  const removed = Object.values(decisions).filter(d => d === 'remove').length;
  const flagged = Object.values(decisions).filter(d => d === 'flag').length;
  const reviewed = kept + removed + flagged;
  const progress = total > 0 ? (reviewed / total) * 100 : 0;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const styles = `
    ${tokens}
    .filter-btn { 
      padding: 6px 14px; border-radius: var(--radius-full);
      border: 1.5px solid var(--border-default); background: transparent;
      color: var(--text-secondary); font-family: var(--font-display);
      font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
    }
    .filter-btn:hover { border-color: var(--border-default); color: var(--text-primary); }
    .filter-btn.active { 
      background: var(--color-brand); border-color: var(--color-brand); 
      color: #fff;
    }
    .search-input {
      background: var(--bg-elevated); border: 1px solid var(--border-default);
      border-radius: var(--radius-full); color: var(--text-primary);
      font-family: var(--font-body); font-size: 13px;
      padding: 8px 16px; outline: none; width: 240px;
    }
    .search-input:focus { border-color: var(--color-brand); }
    .search-input::placeholder { color: var(--text-muted); }
  `;

  if (!unlocked) return (
    <>
      <style>{styles}</style>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(232,98,42,0.08) 0%, transparent 70%), var(--bg-base)',
      }}>
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-default)', padding: '40px 36px',
          width: 360, textAlign: 'center',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24,
            backgroundImage: 'var(--color-brand-gradient)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 8,
          }}>assembl</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
            marginBottom: 6,
          }}>Venue Curation</div>
          <div style={{
            color: 'var(--text-muted)', fontSize: 13, marginBottom: 28,
          }}>Enter the password to continue</div>
          <input
            autoFocus
            type="password"
            placeholder="Password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && attempt()}
            style={{
              width: '100%', background: error ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)',
              border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)', fontSize: 14,
              padding: '11px 14px', outline: 'none', marginBottom: 12,
              textAlign: 'center', transition: 'border-color 0.2s, background 0.2s',
            }}
          />
          {error && (
            <div style={{
              color: '#EF4444', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-display)',
            }}>
              Incorrect password
            </div>
          )}
          <button onClick={attempt} style={{
            width: '100%', padding: '12px', borderRadius: 'var(--radius-full)',
            border: 'none', backgroundImage: 'var(--color-brand-gradient)',
            color: '#fff', fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            Enter →
          </button>
        </div>
      </div>
    </>
  );

  if (loading) return (
    <>
      <style>{styles}</style>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 16,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid var(--border-default)',
          borderTopColor: 'var(--color-brand)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          Loading venues...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );

  if (error) return (
    <>
      <style>{styles}</style>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 32,
      }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
          Failed to load venues
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
          {error}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
          Make sure the Supabase URL, anon key, and storage bucket path are configured at the top of the file.
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{styles}</style>

      {/* Reviewer prompt modal */}
      {showReviewerPrompt && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-default)', padding: 32,
            width: 340, textAlign: 'center',
          }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20,
              marginBottom: 8,
            }}>Who are you?</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Your name will be saved with each decision so Toby knows who reviewed what.
            </div>
            <input
              autoFocus
              placeholder="Your name"
              value={reviewer}
              onChange={e => setReviewer(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && reviewer.trim()) {
                  localStorage.setItem('assembl_reviewer', reviewer.trim());
                  setShowReviewerPrompt(false);
                }
              }}
              style={{
                width: '100%', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
                fontSize: 14, padding: '10px 14px', outline: 'none',
                marginBottom: 16, textAlign: 'center',
              }}
            />
            <button
              onClick={() => {
                if (reviewer.trim()) {
                  localStorage.setItem('assembl_reviewer', reviewer.trim());
                  setShowReviewerPrompt(false);
                }
              }}
              style={{
                width: '100%', padding: '12px', borderRadius: 'var(--radius-full)',
                border: 'none', backgroundImage: 'var(--color-brand-gradient)',
                color: '#fff', fontFamily: 'var(--font-display)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Let's go →
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(13,13,18,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 24px',
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 24,
          padding: '16px 0',
          flexWrap: 'wrap',
        }}>
          {/* Wordmark */}
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18,
            backgroundImage: 'var(--color-brand-gradient)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            flexShrink: 0,
          }}>
            assembl
          </div>
          <div style={{
            color: 'var(--text-muted)', fontSize: 13,
            borderLeft: '1px solid var(--border-subtle)', paddingLeft: 16, flexShrink: 0,
          }}>
            Venue Curation
          </div>

          {/* Progress */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 5,
            }}>
              <span>{reviewed.toLocaleString()} of {total.toLocaleString()} reviewed</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div style={{
              height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                width: `${progress}%`, height: '100%',
                backgroundImage: 'var(--color-brand-gradient)',
                borderRadius: 2, transition: 'width 0.4s',
              }} />
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, flexShrink: 0 }}>
            {[
              { label: 'Keep', count: kept, color: '#22C55E' },
              { label: 'Remove', count: removed, color: '#EF4444' },
              { label: 'Flagged', count: flagged, color: '#F59E0B' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: s.color }}>
                  {s.count}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Saving indicator */}
          {saving && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
              Saving...
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 0', overflowX: 'auto',
        }}>
          {[
            { id: 'all',        label: `All (${total})` },
            { id: 'unreviewed', label: `Unreviewed (${total - reviewed})` },
            { id: 'keep',       label: `Keep (${kept})` },
            { id: 'remove',     label: `Remove (${removed})` },
            { id: 'flag',       label: `Flagged (${flagged})` },
          ].map(f => (
            <button
              key={f.id}
              className={`filter-btn${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <input
              className="search-input"
              placeholder="Search venues..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Venue grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '80px 0',
            color: 'var(--text-muted)', fontFamily: 'var(--font-display)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No venues found</div>
            <div style={{ fontSize: 14 }}>Try adjusting your filter or search</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20,
          }}>
            {filtered.map(venue => (
              <VenueCard
                key={venue.id}
                venue={venue}
                decision={decisions[venue.id]}
                notes={notes[venue.id]}
                isExpanded={!!expanded[venue.id]}
                onDecide={dec => handleDecide(venue.id, dec)}
                onNotes={text => handleNotes(venue.id, text)}
                onToggle={() => handleToggleExpand(venue.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
