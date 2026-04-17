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
const SUPABASE_URL = 'https://mizoxinvfikwznywuknp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MNjb4nCCYJ-aDZhJCmcu7Q_yPO05yN2';
const VENUES_TABLE = 'venues';
const DECISIONS_TABLE = 'curation_decisions';

// Columns to fetch — enough for curation without pulling the full schema
const VENUE_SELECT = 'id,name,category,address,locality,lat,lng,website,verified_url,url_source,scraped_url,description,image_urls,booking_url,phone,features_stale,craft_beer,real_ale,cocktails,good_wine_list,natural_wine,outdoor_seating,rooftop,garden_courtyard,live_music,dj_night,pub_quiz,dog_friendly,food_available,sunday_roast,sports_screens,late_license,large_groups,private_dining,bookable_tables,happy_hour,independent,brewery_taproom,historic_building,lgbtq_friendly,accessible,fireplace';

async function supabaseRequest(method, path, body) {
  const prefer =
    method === 'POST'  ? 'resolution=merge-duplicates' :
    method === 'PATCH' ? 'return=minimal' : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { 'Prefer': prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} failed: ${res.status}`);
  return res.json().catch(() => null);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

// ─── Category / feature labels ────────────────────────────────────────────────
const CATEGORY_LABELS = {
  pub: 'Pub', bar: 'Bar', cocktail_bar: 'Cocktail Bar',
  wine_bar: 'Wine Bar', beer_bar: 'Beer Bar', gastropub: 'Gastropub',
  music_venue: 'Music Venue', comedy_club: 'Comedy Club', hotel_bar: 'Hotel Bar',
  brewery_taproom: 'Brewery Taproom', bottle_shop: 'Bottle Shop',
  lounge: 'Lounge', sports_bar: 'Sports Bar',
};

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

// ─── Password gate ────────────────────────────────────────────────────────────
const APP_PASSWORD = 'assembl2026';

function usePasswordGate() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('curation_unlocked') === 'true');
  const [input, setInput] = useState('');
  const [wrongPassword, setWrongPassword] = useState(false);
  const attempt = () => {
    if (input === APP_PASSWORD) { sessionStorage.setItem('curation_unlocked', 'true'); setUnlocked(true); }
    else { setWrongPassword(true); setInput(''); setTimeout(() => setWrongPassword(false), 2000); }
  };
  return { unlocked, input, setInput, attempt, wrongPassword };
}

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
    }}>{config.label}</div>
  );
}

// ─── Image carousel (view mode) ───────────────────────────────────────────────
function ImageCarousel({ images }) {
  const [idx, setIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  const urls = parseImages(images);

  // Reset idx if images change
  useEffect(() => { setIdx(0); setImgError(false); }, [JSON.stringify(urls)]);

  if (!urls.length) return (
    <div style={{
      height: 200, background: 'var(--bg-elevated)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 13, flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 28 }}>📷</div>
      <div>No images</div>
    </div>
  );

  return (
    <div style={{ position: 'relative', height: 200, background: 'var(--bg-elevated)' }}>
      {imgError ? (
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
          onError={() => setImgError(true)}
          onLoad={() => setImgError(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {urls.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setIdx((idx - 1 + urls.length) % urls.length); setImgError(false); }} style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>‹</button>
          <button onClick={e => { e.stopPropagation(); setIdx((idx + 1) % urls.length); setImgError(false); }} style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>›</button>
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
            {urls.map((_, i) => (
              <div key={i} onClick={e => { e.stopPropagation(); setIdx(i); setImgError(false); }} style={{
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
      }}>{idx + 1} / {urls.length}</div>
    </div>
  );
}

// ─── Image curation grid (edit mode) ─────────────────────────────────────────
function ImageCurationGrid({ images, onChange }) {
  const urls = parseImages(images);
  const [loadErrors, setLoadErrors] = useState({});
  const dragIdx = useRef(null);

  const removeImage = (i) => {
    const next = urls.filter((_, idx) => idx !== i);
    onChange(next);
    setLoadErrors(e => { const n = {...e}; delete n[i]; return n; });
  };

  const moveLeft = (i) => {
    if (i === 0) return;
    const next = [...urls];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };

  const moveRight = (i) => {
    if (i === urls.length - 1) return;
    const next = [...urls];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  const onDragStart = (i) => { dragIdx.current = i; };
  const onDrop = (i) => {
    if (dragIdx.current === null || dragIdx.current === i) return;
    const next = [...urls];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(i, 0, moved);
    onChange(next);
    dragIdx.current = null;
  };

  if (!urls.length) return (
    <div style={{
      padding: '20px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
      textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
      border: '1px dashed var(--border-default)',
    }}>
      No images — will be scraped on next pipeline run
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Images · {urls.length} · drag to reorder
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {urls.map((url, i) => (
          <div
            key={url + i}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => onDrop(i)}
            style={{
              position: 'relative', borderRadius: 'var(--radius-md)',
              overflow: 'hidden', aspectRatio: '4/3',
              border: i === 0 ? '2px solid var(--color-brand)' : '1px solid var(--border-default)',
              cursor: 'grab', background: 'var(--bg-elevated)',
            }}
          >
            {loadErrors[i] ? (
              <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexDirection: 'column', gap: 4,
                color: 'var(--text-muted)', fontSize: 11, padding: 8, textAlign: 'center',
              }}>
                <div>🚫</div>
                <div style={{ wordBreak: 'break-all', fontSize: 9, lineHeight: 1.3 }}>{url.slice(0, 60)}...</div>
              </div>
            ) : (
              <img
                src={url}
                onError={() => setLoadErrors(e => ({ ...e, [i]: true }))}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
              />
            )}

            {/* Position badge */}
            <div style={{
              position: 'absolute', top: 5, left: 5,
              background: i === 0 ? 'var(--color-brand)' : 'rgba(0,0,0,0.7)',
              borderRadius: 'var(--radius-sm)', padding: '1px 6px',
              fontSize: 10, fontWeight: 700, color: '#fff',
              fontFamily: 'var(--font-display)',
            }}>{i === 0 ? '★' : i + 1}</div>

            {/* Controls overlay */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 5px 5px',
            }}>
              <div style={{ display: 'flex', gap: 3 }}>
                <button
                  onClick={e => { e.stopPropagation(); moveLeft(i); }}
                  disabled={i === 0}
                  title="Move left"
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: 'none',
                    background: i === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
                    color: i === 0 ? 'rgba(255,255,255,0.3)' : '#fff',
                    cursor: i === 0 ? 'not-allowed' : 'pointer', fontSize: 11,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>←</button>
                <button
                  onClick={e => { e.stopPropagation(); moveRight(i); }}
                  disabled={i === urls.length - 1}
                  title="Move right"
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: 'none',
                    background: i === urls.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
                    color: i === urls.length - 1 ? 'rgba(255,255,255,0.3)' : '#fff',
                    cursor: i === urls.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>→</button>
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeImage(i); }}
                title="Remove image"
                style={{
                  width: 22, height: 22, borderRadius: 4, border: 'none',
                  background: 'rgba(239,68,68,0.7)', color: '#fff',
                  cursor: 'pointer', fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {urls.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          ★ First image is the cover photo shown in the app
        </div>
      )}

      {/* Add image by URL */}
      <AddImageRow onAdd={url => onChange([...urls, url])} />
    </div>
  );
}

// ─── Add image by URL ─────────────────────────────────────────────────────────
function AddImageRow({ onAdd }) {
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(null);  // null | 'loading' | 'ok' | 'error'
  const previewTimer = useRef(null);

  const handleChange = (v) => {
    setValue(v);
    setPreview(null);
    clearTimeout(previewTimer.current);
    if (v.startsWith('http')) {
      setPreview('loading');
      previewTimer.current = setTimeout(() => {
        const img = new Image();
        img.onload  = () => setPreview('ok');
        img.onerror = () => setPreview('error');
        img.src = v;
      }, 600);
    }
  };

  const handleAdd = () => {
    const url = value.trim();
    if (!url.startsWith('http') || preview === 'error') return;
    onAdd(url);
    setValue('');
    setPreview(null);
  };

  const statusColor = preview === 'ok' ? '#22C55E' : preview === 'error' ? '#EF4444' : 'var(--text-muted)';
  const statusIcon  = preview === 'ok' ? '✓' : preview === 'error' ? '✕' : preview === 'loading' ? '…' : '';

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          placeholder="Paste image URL to add..."
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={{
            width: '100%', background: 'var(--bg-elevated)',
            border: `1px solid ${
              preview === 'ok' ? 'rgba(34,197,94,0.5)' :
              preview === 'error' ? 'rgba(239,68,68,0.5)' :
              'var(--border-default)'
            }`,
            borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12,
            padding: '7px 28px 7px 10px', outline: 'none',
            transition: 'border-color 0.2s',
          }}
        />
        {statusIcon && (
          <div style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: statusColor, fontWeight: 700,
          }}>{statusIcon}</div>
        )}
      </div>
      <button
        onClick={handleAdd}
        disabled={!value || preview === 'error' || !value.startsWith('http')}
        style={{
          padding: '7px 14px', borderRadius: 'var(--radius-sm)',
          border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'var(--font-display)',
          background: (!value || preview === 'error' || !value.startsWith('http'))
            ? 'var(--bg-overlay)' : 'var(--color-brand)',
          color: (!value || preview === 'error' || !value.startsWith('http'))
            ? 'var(--text-muted)' : '#fff',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >+ Add</button>
    </div>
  );
}

// ─── Venue card ────────────────────────────────────────────────────────────────
function VenueCard({ venue, decision, notes, curatedImages, onDecide, onNotes, onImageChange, isExpanded, onToggle }) {
  const features = Object.entries(FEATURE_LABELS)
    .filter(([slug]) => venue[slug] === true)
    .map(([, label]) => label);

  // Use curated images if available, otherwise fall back to venue images
  const displayImages = curatedImages !== undefined ? curatedImages : venue.image_urls;
  const imageCount = parseImages(displayImages).length;
  const originalCount = parseImages(venue.image_urls).length;
  const imagesModified = curatedImages !== undefined && JSON.stringify(curatedImages) !== JSON.stringify(parseImages(venue.image_urls));

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

      {/* Image area — carousel in collapsed, curation grid in expanded */}
      {isExpanded ? (
        <div style={{ padding: '12px 12px 0' }}>
          <ImageCurationGrid images={displayImages} onChange={onImageChange} />
        </div>
      ) : (
        <div style={{ cursor: 'pointer' }} onClick={onToggle}>
          <ImageCarousel images={displayImages} />
        </div>
      )}

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, lineHeight: 1.3 }} onClick={onToggle}>
            {venue.name}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {venue.features_stale && (
              <div title="Features may be stale — domain changed in stage7" style={{
                padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                color: '#F59E0B', fontSize: 11, fontWeight: 600,
                fontFamily: 'var(--font-display)',
              }}>⚠ stale</div>
            )}
            {imagesModified && (
              <div title="Images have been curated" style={{
                padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                color: '#818CF8', fontSize: 11, fontWeight: 600,
                fontFamily: 'var(--font-display)',
              }}>✎ imgs</div>
            )}
            {decision && <DecisionBadge decision={decision} />}
          </div>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {[CATEGORY_LABELS[venue.category] || venue.category, venue.locality || venue.area].filter(Boolean).join(' · ')}
          {imageCount > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              · {imageCount} photo{imageCount !== 1 ? 's' : ''}{imagesModified && originalCount !== imageCount ? ` (was ${originalCount})` : ''}
            </span>
          )}
        </div>

        {venue.description && (
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
            marginBottom: 10, fontStyle: 'italic',
          }}>
            "{venue.description}"
          </div>
        )}

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

        {isExpanded && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            {venue.address && <div>📍 {venue.address}</div>}
            {(venue.verified_url || venue.website) && (
              <div>🌐 <a href={venue.verified_url || venue.website} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                {venue.verified_url || venue.website}
              </a>
              {venue.url_source && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                  ({venue.url_source})
                </span>
              )}
              </div>
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
            {venue.scraped_url && venue.scraped_url !== (venue.verified_url || venue.website) && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                🔍 Scraped from: {venue.scraped_url}
              </div>
            )}
          </div>
        )}

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

        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'keep',   label: '✓ Keep',   bg: decision === 'keep'   ? '#22C55E' : 'transparent', border: decision === 'keep'   ? '#22C55E' : 'rgba(34,197,94,0.4)',  color: decision === 'keep'   ? '#fff' : '#22C55E' },
            { id: 'remove', label: '✗ Remove', bg: decision === 'remove' ? '#EF4444' : 'transparent', border: decision === 'remove' ? '#EF4444' : 'rgba(239,68,68,0.4)',  color: decision === 'remove' ? '#fff' : '#EF4444' },
            { id: 'flag',   label: '? Flag',   bg: decision === 'flag'   ? '#F59E0B' : 'transparent', border: decision === 'flag'   ? '#F59E0B' : 'rgba(245,158,11,0.4)', color: decision === 'flag'   ? '#fff' : '#F59E0B' },
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

// ─── Main app ──────────────────────────────────────────────────────────────────
export default function CurationApp() {
  const { unlocked, input, setInput, attempt, wrongPassword } = usePasswordGate();
  const [venues, setVenues] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [notes, setNotes] = useState({});
  const [curatedImages, setCuratedImages] = useState({});  // venueId -> url[]
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [showReviewerPrompt, setShowReviewerPrompt] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        // Load venues in pages to avoid response size limits
        const PAGE = 1000;
        let allVenues = [];
        let from = 0;
        while (true) {
          const page = await supabaseRequest(
            'GET',
            `${VENUES_TABLE}?select=${VENUE_SELECT}&order=name.asc&limit=${PAGE}&offset=${from}`
          );
          if (!Array.isArray(page) || page.length === 0) break;
          allVenues = allVenues.concat(page);
          if (page.length < PAGE) break;
          from += PAGE;
        }
        setVenues(allVenues);

        try {
          const existing = await supabaseRequest('GET', `${DECISIONS_TABLE}?select=venue_id,decision,notes,curated_images`);
          if (Array.isArray(existing)) {
            const d = {}, n = {}, ci = {};
            existing.forEach(r => {
              d[r.venue_id] = r.decision;
              if (r.notes) n[r.venue_id] = r.notes;
              if (r.curated_images) ci[r.venue_id] = r.curated_images;
            });
            setDecisions(d);
            setNotes(n);
            setCuratedImages(ci);
          }
        } catch { /* decisions table may not exist yet */ }

        const stored = localStorage.getItem('assembl_reviewer');
        if (stored) setReviewer(stored);
        else setShowReviewerPrompt(true);
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const saveDecision = useCallback(async (venueId, decision, noteText, imgs) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        // Save curation decision
        await supabaseRequest('POST', DECISIONS_TABLE, [{
          venue_id: venueId,
          decision: decision || null,
          notes: noteText || null,
          curated_images: imgs !== undefined ? imgs : null,
          reviewer: reviewer || 'anonymous',
          updated_at: new Date().toISOString(),
        }]);
        // Write curated images directly back to venues table
        if (imgs !== undefined) {
          await supabaseRequest(
            'PATCH',
            `${VENUES_TABLE}?id=eq.${venueId}`,
            { image_urls: imgs }
          );
        }
        // Mark venue as removed in venues table
        if (decision === 'remove') {
          await supabaseRequest(
            'PATCH',
            `${VENUES_TABLE}?id=eq.${venueId}`,
            { curated_out: true }
          );
        }
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
    saveDecision(venueId, decision, notes[venueId], curatedImages[venueId]);
  };

  const handleNotes = (venueId, text) => {
    const next = { ...notes, [venueId]: text };
    setNotes(next);
    if (decisions[venueId]) saveDecision(venueId, decisions[venueId], text, curatedImages[venueId]);
  };

  const handleImageChange = (venueId, newImages) => {
    const next = { ...curatedImages, [venueId]: newImages };
    setCuratedImages(next);
    saveDecision(venueId, decisions[venueId], notes[venueId], newImages);
  };

  const handleToggleExpand = (venueId) => {
    setExpanded(e => ({ ...e, [venueId]: !e[venueId] }));
  };

  const filtered = venues.filter(v => {
    const dec = decisions[v.id];
    const matchFilter =
      filter === 'all' ? true :
      filter === 'unreviewed' ? !dec :
      filter === 'images_curated' ? !!curatedImages[v.id] :
      filter === 'no_images' ? parseImages(v.image_urls).length === 0 :
      dec === filter;
    const matchSearch = !search ||
      v.name?.toLowerCase().includes(search.toLowerCase()) ||
      v.locality?.toLowerCase().includes(search.toLowerCase()) ||
      v.area?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const total = venues.length;
  const kept = Object.values(decisions).filter(d => d === 'keep').length;
  const removed = Object.values(decisions).filter(d => d === 'remove').length;
  const flagged = Object.values(decisions).filter(d => d === 'flag').length;
  const reviewed = kept + removed + flagged;
  const imagesCurated = Object.keys(curatedImages).length;
  const noImages = venues.filter(v => parseImages(v.image_urls).length === 0).length;
  const progress = total > 0 ? (reviewed / total) * 100 : 0;

  const styles = `
    ${tokens}
    .filter-btn { 
      padding: 6px 14px; border-radius: var(--radius-full);
      border: 1.5px solid var(--border-default); background: transparent;
      color: var(--text-secondary); font-family: var(--font-display);
      font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
      white-space: nowrap;
    }
    .filter-btn:hover { color: var(--text-primary); }
    .filter-btn.active { background: var(--color-brand); border-color: var(--color-brand); color: #fff; }
    .search-input {
      background: var(--bg-elevated); border: 1px solid var(--border-default);
      border-radius: var(--radius-full); color: var(--text-primary);
      font-family: var(--font-body); font-size: 13px;
      padding: 8px 16px; outline: none; width: 240px;
    }
    .search-input:focus { border-color: var(--color-brand); }
    .search-input::placeholder { color: var(--text-muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  // ── Password screen ──
  if (!unlocked) return (
    <>
      <style>{styles}</style>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8,
          }}>assembl</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Venue Curation</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>Enter the password to continue</div>
          <input
            autoFocus type="password" placeholder="Password"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && attempt()}
            style={{
              width: '100%', background: wrongPassword ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)',
              border: `1px solid ${wrongPassword ? 'rgba(239,68,68,0.5)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)', fontSize: 14, padding: '11px 14px',
              outline: 'none', marginBottom: 12, textAlign: 'center', transition: 'border-color 0.2s, background 0.2s',
            }}
          />
          {wrongPassword && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-display)' }}>Incorrect password</div>}
          <button onClick={attempt} style={{
            width: '100%', padding: '12px', borderRadius: 'var(--radius-full)',
            border: 'none', backgroundImage: 'var(--color-brand-gradient)',
            color: '#fff', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>Enter →</button>
        </div>
      </div>
    </>
  );

  if (loading) return (
    <>
      <style>{styles}</style>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border-default)', borderTopColor: 'var(--color-brand)', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Loading venues...</div>
      </div>
    </>
  );

  if (loadError) return (
    <>
      <style>{styles}</style>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 32 }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>Failed to load venues</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', maxWidth: 400 }}>{loadError}</div>
      </div>
    </>
  );

  return (
    <>
      <style>{styles}</style>

      {showReviewerPrompt && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-default)', padding: 32, width: 340, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Who are you?</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>Your name will be saved with each decision.</div>
            <input
              autoFocus placeholder="Your name" value={reviewer}
              onChange={e => setReviewer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && reviewer.trim()) { localStorage.setItem('assembl_reviewer', reviewer.trim()); setShowReviewerPrompt(false); } }}
              style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 14, padding: '10px 14px', outline: 'none', marginBottom: 16, textAlign: 'center' }}
            />
            <button onClick={() => { if (reviewer.trim()) { localStorage.setItem('assembl_reviewer', reviewer.trim()); setShowReviewerPrompt(false); } }}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-full)', border: 'none', backgroundImage: 'var(--color-brand-gradient)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Let's go →
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(13,13,18,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-subtle)', padding: '0 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 24, padding: '16px 0', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, backgroundImage: 'var(--color-brand-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', flexShrink: 0 }}>assembl</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 16, flexShrink: 0 }}>Venue Curation</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
              <span>{reviewed.toLocaleString()} of {total.toLocaleString()} reviewed</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', backgroundImage: 'var(--color-brand-gradient)', borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, flexShrink: 0 }}>
            {[
              { label: 'Keep', count: kept, color: '#22C55E' },
              { label: 'Remove', count: removed, color: '#EF4444' },
              { label: 'Flagged', count: flagged, color: '#F59E0B' },
              { label: 'Imgs edited', count: imagesCurated, color: '#818CF8' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: s.color }}>{s.count}</div>
                <div style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
          {saving && <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Saving...</div>}
        </div>

        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', overflowX: 'auto' }}>
          {[
            { id: 'all',            label: `All (${total})` },
            { id: 'unreviewed',     label: `Unreviewed (${total - reviewed})` },
            { id: 'keep',           label: `Keep (${kept})` },
            { id: 'remove',         label: `Remove (${removed})` },
            { id: 'flag',           label: `Flagged (${flagged})` },
            { id: 'no_images',      label: `No images (${noImages})` },
            { id: 'images_curated', label: `Imgs edited (${imagesCurated})` },
          ].map(f => (
            <button key={f.id} className={`filter-btn${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <input className="search-input" placeholder="Search venues..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Venue grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No venues found</div>
            <div style={{ fontSize: 14 }}>Try adjusting your filter or search</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {filtered.map(venue => (
              <VenueCard
                key={venue.id}
                venue={venue}
                decision={decisions[venue.id]}
                notes={notes[venue.id]}
                curatedImages={curatedImages[venue.id]}
                isExpanded={!!expanded[venue.id]}
                onDecide={dec => handleDecide(venue.id, dec)}
                onNotes={text => handleNotes(venue.id, text)}
                onImageChange={imgs => handleImageChange(venue.id, imgs)}
                onToggle={() => handleToggleExpand(venue.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}