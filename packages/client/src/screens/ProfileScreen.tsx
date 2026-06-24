/**
 * ProfileScreen (`/u/:username`) — a public player profile (Social feature).
 *
 * Shows the name, tier + rank badges, accent flair, tagline/bio, "Member since",
 * a stats grid, and an achievements showcase (reusing the ProfilePanel pattern).
 * When signed in and viewing someone else, a context action lets you Add friend /
 * see Requested / Respond / Friends, plus a Message button (→ /friends?to=:id).
 * When viewing yourself, an inline edit form posts to `/api/me/profile`.
 *
 * All server-derived text is sanitized on render.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ACHIEVEMENTS_BY_KEY } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead, TierBadge, RankBadge, CharCount, InlineLoader } from '../components/common.js';
import { PUBLIC_PROFILE } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { ACCENT_OPTIONS, memberSinceLabel, normalizeAccent, isOnline } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { PublicProfile } from '../lib/api.js';

function winRate(won: number, played: number): string {
  if (played <= 0) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

export function ProfileScreen() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);

  async function reload(): Promise<void> {
    const p = await api.fetchPublicProfile(username);
    setProfile(p);
  }

  useEffect(() => {
    let live = true;
    setProfile(undefined);
    void api.fetchPublicProfile(username).then((p) => {
      if (live) setProfile(p);
    });
    return () => {
      live = false;
    };
  }, [username]);

  if (profile === undefined) {
    return (
      <div className="page stack">
        <div className="panel panel-pad center" style={{ minHeight: 120 }}>
          <InlineLoader label={PUBLIC_PROFILE.loading} />
        </div>
      </div>
    );
  }
  if (profile === null) {
    return (
      <div className="page stack">
        <div className="panel panel-pad center stack" style={{ minHeight: 120 }}>
          <span className="muted">{PUBLIC_PROFILE.notFound}</span>
          <Link className="btn btn-sm" to="/community">
            ← {/* back to the boards */}
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = profile.friendship === 'self';
  const accent = normalizeAccent(profile.accent);
  const since = memberSinceLabel(profile.memberSince);
  const online = isOnline(profile.lastSeen);

  async function onFriendAction(): Promise<void> {
    if (!profile) return;
    if (profile.friendship === 'none') {
      const res = await api.requestFriend(profile.username);
      if (res.ok) {
        pushInfo(res.result === 'accepted' ? PUBLIC_PROFILE.friends : PUBLIC_PROFILE.requested);
        await reload();
      }
    } else if (profile.friendship === 'pending_in') {
      navigate('/friends');
    } else if (profile.friendship === 'friends') {
      navigate(`/friends?to=${encodeURIComponent(profile.id)}`);
    }
  }

  return (
    <div className="page stack">
      <div className={`panel panel-pad stack profile-card profile-public ${accent ? `accent-${accent}` : ''}`}>
        <div className="profile-head">
          <div className="stack" style={{ gap: 4 }}>
            <div className="profile-name-row">
              {online && <span className="online-dot online-on" title={PUBLIC_PROFILE.respond} aria-hidden="true" />}
              <span className="profile-name">{sanitizeInline(profile.username)}</span>
            </div>
            <div className="faint">
              {since ? PUBLIC_PROFILE.memberSince(since) : PUBLIC_PROFILE.memberSinceUnknown}
            </div>
          </div>
          <div className="profile-badges">
            <TierBadge totalPoints={profile.stats?.totalPoints ?? 0} />
            {profile.ranked && (
              <RankBadge
                rankKey={profile.ranked.rank}
                rankName={profile.ranked.rankName}
                mmr={profile.ranked.mmr}
              />
            )}
          </div>
        </div>

        {profile.tagline && <div className="profile-tagline">{sanitizeInline(profile.tagline)}</div>}
        {profile.bio && <div className="profile-bio">{sanitizeText(profile.bio)}</div>}

        {/* Context actions: edit (self) or friend/message (others). */}
        {isSelf ? (
          <EditForm profile={profile} onSaved={reload} />
        ) : (
          <FriendActions profile={profile} me={me} onAction={onFriendAction} navigate={navigate} />
        )}
      </div>

      {/* Stats grid. */}
      <div className="panel panel-pad stack profile-card">
        <DecoHead>{PUBLIC_PROFILE.stats}</DecoHead>
        <div className="profile-stats">
          <Stat label={PUBLIC_PROFILE.totalPoints} value={`${profile.stats?.totalPoints ?? 0}`} hero />
          <Stat label={PUBLIC_PROFILE.gamesPlayed} value={String(profile.stats?.gamesPlayed ?? 0)} />
          <Stat label={PUBLIC_PROFILE.gamesWon} value={String(profile.stats?.gamesWon ?? 0)} />
          <Stat
            label={PUBLIC_PROFILE.survived}
            value={String(profile.stats?.gamesSurvived ?? 0)}
          />
          <Stat
            label="Win rate"
            value={winRate(profile.stats?.gamesWon ?? 0, profile.stats?.gamesPlayed ?? 0)}
          />
          {profile.ranked && <Stat label="MMR" value={String(profile.ranked.mmr)} />}
        </div>
      </div>

      {/* Achievements showcase. */}
      <div className="panel panel-pad stack profile-card">
        <DecoHead>{PUBLIC_PROFILE.achievements}</DecoHead>
        {profile.achievements.length === 0 ? (
          <span className="faint">{PUBLIC_PROFILE.noAchievements}</span>
        ) : (
          <div className="achv-grid">
            {profile.achievements.map((key) => {
              const def = ACHIEVEMENTS_BY_KEY[key];
              return (
                <div key={key} className="achv achv-on">
                  <div className="achv-row">
                    <span className="achv-medal" aria-hidden="true">
                      ★
                    </span>
                    <span className="achv-name">{sanitizeInline(def?.name ?? key)}</span>
                    {def && <span className="achv-pts">{def.points}</span>}
                  </div>
                  {def && <div className="achv-desc">{sanitizeInline(def.description)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FriendActions({
  profile,
  me,
  onAction,
  navigate,
}: {
  profile: PublicProfile;
  me: { isGuest: boolean } | null;
  onAction: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  // Friendship is null for guests/anon viewers: nudge them to sign in.
  if (profile.friendship === null) {
    return <p className="faint" style={{ margin: 0 }}>{PUBLIC_PROFILE.signInToFriend}</p>;
  }
  void me;
  const label =
    profile.friendship === 'friends'
      ? PUBLIC_PROFILE.friends
      : profile.friendship === 'pending_out'
        ? PUBLIC_PROFILE.requested
        : profile.friendship === 'pending_in'
          ? PUBLIC_PROFILE.respond
          : PUBLIC_PROFILE.addFriend;
  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`btn btn-sm ${profile.friendship === 'none' ? 'btn-primary' : ''}`}
        onClick={onAction}
        disabled={profile.friendship === 'pending_out'}
      >
        {label}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => navigate(`/friends?to=${encodeURIComponent(profile.id)}`)}
      >
        {PUBLIC_PROFILE.message}
      </button>
    </div>
  );
}

function EditForm({ profile, onSaved }: { profile: PublicProfile; onSaved: () => void }) {
  const pushInfo = useStore((s) => s.pushInfo);
  const [open, setOpen] = useState(false);
  const [tagline, setTagline] = useState(profile.tagline ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [accent, setAccent] = useState(normalizeAccent(profile.accent));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  if (!open) {
    return (
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          {PUBLIC_PROFILE.edit}
        </button>
      </div>
    );
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(false);
    const ok = await api.saveProfile({
      tagline: tagline.slice(0, 80),
      bio: bio.slice(0, 500),
      accent,
    });
    setSaving(false);
    if (ok) {
      pushInfo(PUBLIC_PROFILE.saved);
      setSaved(true);
      onSaved();
    } else {
      setError(true);
      pushInfo(PUBLIC_PROFILE.saveFailed);
    }
  }

  return (
    <form className="stack profile-edit" onSubmit={save}>
      <DecoHead>{PUBLIC_PROFILE.editHeading}</DecoHead>
      <div className="field">
        <label htmlFor="profile-tagline">{PUBLIC_PROFILE.taglinePlaceholder}</label>
        <input
          id="profile-tagline"
          className="board-input"
          value={tagline}
          onChange={(e) => {
            setTagline(e.target.value.slice(0, 80));
            setSaved(false);
          }}
          placeholder={PUBLIC_PROFILE.taglinePlaceholder}
          maxLength={80}
          aria-describedby="profile-tagline-count"
        />
        <CharCount id="profile-tagline-count" len={tagline.length} max={80} />
      </div>
      <div className="field">
        <label htmlFor="profile-bio">{PUBLIC_PROFILE.bioPlaceholder}</label>
        <textarea
          id="profile-bio"
          className="board-input profile-bio-input"
          value={bio}
          onChange={(e) => {
            setBio(e.target.value.slice(0, 500));
            setSaved(false);
          }}
          placeholder={PUBLIC_PROFILE.bioPlaceholder}
          maxLength={500}
          rows={4}
          aria-describedby="profile-bio-count"
        />
        <CharCount id="profile-bio-count" len={bio.length} max={500} />
      </div>
      <label className="row" style={{ gap: 8 }}>
        <span className="faint">{PUBLIC_PROFILE.accentLabel}</span>
        <select
          className="board-input"
          value={accent}
          onChange={(e) => setAccent(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {ACCENT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {saved && (
        <div className="field-success" role="status">
          {PUBLIC_PROFILE.saved}
        </div>
      )}
      {error && (
        <div className="error-text" role="alert">
          {PUBLIC_PROFILE.saveFailed}
        </div>
      )}
      <div className="row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          {saving ? PUBLIC_PROFILE.saving : PUBLIC_PROFILE.save}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={saving}>
          {PUBLIC_PROFILE.cancel}
        </button>
      </div>
    </form>
  );
}

function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={`profile-stat ${hero ? 'profile-stat-hero' : ''}`}>
      <div className="profile-stat-val">{value}</div>
      <div className="profile-stat-label">{label}</div>
    </div>
  );
}
