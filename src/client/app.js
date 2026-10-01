import { POSITIONS, GROUPS, MAX_PLAYERS, SUB, groupOf, positionByCode } from '../lib/positions.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const ME_KEY = 'matchday.me';
// The app can live under a sub-path (e.g. /matchday on a Webflow site).
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

let me = null;
let players = [];
let playerFilter = 'ALL';

// ---- utilities -------------------------------------------------------------

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function storedMe() {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
}

function setStoredMe(id) {
  try {
    if (id) localStorage.setItem(ME_KEY, id);
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* private mode: identity just won't persist */
  }
}

let toastTimer;
function toast(message, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast${bad ? ' bad' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/** Run an async action from a button, disabling it meanwhile and showing errors as toasts. */
async function act(button, fn) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

const initials = (p) => `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase() || '?';
const when = (e) => new Date(`${e.date}T${e.time}`);
const fmtDate = (e) => when(e).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (e) => when(e).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const groupTone = { GK: 'butter', DEF: 'sky', MID: 'mint', FWD: 'rose' };
const posChip = (code) => `<span class="chip ${groupTone[groupOf(code)]}">${esc(code)}</span>`;
const STATUS_LABEL = { in: 'In', plus1: 'In +1', out: 'Out' };
const STATUS_TONE = { in: 'mint', plus1: 'sky', out: 'rose' };

// ---- pitch -----------------------------------------------------------------

const PITCH_LINES = `
  <svg class="lines" viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
    <g fill="none" stroke="var(--pitch-line)" stroke-width="0.6">
      <rect x="3" y="3" width="62" height="94" rx="1" />
      <line x1="3" y1="50" x2="65" y2="50" />
      <ellipse cx="34" cy="50" rx="8" ry="5.5" />
      <rect x="15" y="3" width="38" height="15" />
      <rect x="25" y="3" width="18" height="6" />
      <rect x="15" y="82" width="38" height="15" />
      <rect x="25" y="91" width="18" height="6" />
      <path d="M27 18 Q34 23 41 18" />
      <path d="M27 82 Q34 77 41 82" />
    </g>
    <g fill="var(--pitch-line)">
      <ellipse cx="34" cy="50" rx="0.8" ry="0.55" />
      <ellipse cx="34" cy="13" rx="0.6" ry="0.45" />
      <ellipse cx="34" cy="87" rx="0.6" ry="0.45" />
    </g>
  </svg>`;

function pitchPicker(selected) {
  const spots = POSITIONS.map(
    (p) => `
      <button type="button" class="spot${p.code === selected ? ' selected' : ''}" data-pos="${p.code}"
        style="left:${p.x}%;top:${p.y}%" aria-pressed="${p.code === selected}" aria-label="${esc(p.name)}">
        <span class="dot">${p.code}</span>
        <span class="label">${esc(p.name)}</span>
      </button>`,
  ).join('');
  return `
    <div class="pitch" data-picker>${PITCH_LINES}${spots}</div>
    <p class="picked muted" data-picked>${selected ? `You play <strong>${esc(positionByCode[selected].name)}</strong>` : 'Tap your position on the pitch'}</p>`;
}

/** Wire up a pitch picker inside `root`; returns a getter for the chosen position. */
function bindPicker(root, initial) {
  let value = initial ?? null;
  root.querySelector('[data-picker]').addEventListener('click', (e) => {
    const spot = e.target.closest('[data-pos]');
    if (!spot) return;
    value = spot.dataset.pos;
    root.querySelectorAll('[data-pos]').forEach((s) => {
      s.classList.toggle('selected', s === spot);
      s.setAttribute('aria-pressed', s === spot);
    });
    root.querySelector('[data-picked]').innerHTML = `You play <strong>${esc(positionByCode[value].name)}</strong>`;
  });
  return () => value;
}

function pitchLineup(team, cls) {
  const spots = POSITIONS.map((pos) => {
    const p = team.find((t) => t.slot === pos.code);
    if (!p) {
      return `<div class="spot empty-slot" style="left:${pos.x}%;top:${pos.y}%"><span class="dot">${pos.code}</span><span class="label">Open</span></div>`;
    }
    const outOfPosition = p.position !== pos.code ? ` (${p.position})` : '';
    return `
      <div class="spot${p.guest ? ' guest' : ''}" style="left:${pos.x}%;top:${pos.y}%" title="${esc(`${p.name} · ${pos.code}${outOfPosition} · ${p.rating}`)}">
        <span class="dot">${p.rating}</span>
        <span class="label">${esc(shortName(p.name))}</span>
      </div>`;
  }).join('');
  const subs = team.filter((p) => p.slot === SUB);
  return `
    <div class="pitch ${cls}">${PITCH_LINES}${spots}</div>
    <div class="bench">
      <span class="chip lavender">Sub</span>
      ${subs.length ? subs.map((p) => `<span>${esc(p.name)} · ${posChip(p.position)} ${p.rating}</span>`).join('') : '<span class="muted">No substitute</span>'}
    </div>`;
}

function shortName(name) {
  const parts = name.split(' ');
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : name;
}

// ---- player card -------------------------------------------------------------

function playerCard(p, { large = false } = {}) {
  const group = groupOf(p.position);
  return `
    <article class="pcard ${group}${p.id === me?.id ? ' me' : ''}${large ? ' large' : ''}">
      <div class="top">
        <div class="rating">${p.rating}<small>Rating</small></div>
        <span class="pos">${esc(p.position)}</span>
      </div>
      <div class="avatar">${esc(initials(p))}</div>
      <div class="name">${esc(p.firstName)}<br />${esc(p.lastName)}</div>
      <div class="sub">${esc(positionByCode[p.position]?.name)} · ${p.age} yrs</div>
      <div class="bar">
        <div class="progress" title="${p.rating} / 100"><span style="width:${p.rating}%"></span></div>
        <div class="sub">${p.games} game${p.games === 1 ? '' : 's'} played</div>
      </div>
    </article>`;
}

// ---- views -----------------------------------------------------------------

function onboardingView() {
  const options = players.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.position})</option>`).join('');
  app.innerHTML = `
    <section class="onboard">
      <div class="hero">
        <h1>Join the squad</h1>
        <p>Tell us who you are and where you like to play. 9-a-side · 8 on the pitch, 1 on the bench.</p>
      </div>
      <form class="card" id="onboard-form" novalidate>
        <div id="form-error"></div>
        <div class="row">
          <div class="field"><label for="first">First name</label><input id="first" name="firstName" autocomplete="given-name" maxlength="30" required /></div>
          <div class="field"><label for="last">Last name</label><input id="last" name="lastName" autocomplete="family-name" maxlength="30" required /></div>
        </div>
        <div class="field" style="max-width:160px"><label for="age">Age</label><input id="age" name="age" type="number" min="8" max="90" inputmode="numeric" required /></div>
        <div class="field">
          <label>Playing position</label>
          ${pitchPicker(null)}
        </div>
        <button class="btn mint block" type="submit">Create my player card</button>
      </form>
      ${
        players.length
          ? `<div class="divider">Already in the squad?</div>
             <form class="card" id="signin-form">
               <div class="field"><label for="who">Pick your name</label><select id="who">${options}</select></div>
               <button class="btn block" type="submit">Continue</button>
             </form>`
          : ''
      }
    </section>`;

  const form = document.getElementById('onboard-form');
  const getPosition = bindPicker(form, null);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    act(form.querySelector('[type=submit]'), async () => {
      try {
        const player = await api('/players', {
          method: 'POST',
          body: { firstName: fd.get('firstName'), lastName: fd.get('lastName'), age: Number(fd.get('age')), position: getPosition() },
        });
        setStoredMe(player.id);
        toast(`Welcome, ${player.firstName}!`);
        location.hash = '#/';
        render();
      } catch (err) {
        document.getElementById('form-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  });

  document.getElementById('signin-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    setStoredMe(document.getElementById('who').value);
    location.hash = '#/';
    render();
  });
}

async function gamesView() {
  const events = await api(`/events?me=${me.id}`);
  const upcoming = events.filter((e) => e.status !== 'completed');
  const past = events.filter((e) => e.status === 'completed').reverse();
  const today = new Date().toISOString().slice(0, 10);

  const gameRow = (e) => {
    const mine = e.responses.find((r) => r.playerId === me.id);
    const count = e.roster.confirmed.length;
    const d = when(e);
    return `
      <a class="card game" href="#/event/${e.id}">
        <div class="date-badge"><span class="d">${d.getDate()}</span><span class="m">${d.toLocaleDateString(undefined, { month: 'short' })}</span></div>
        <div>
          <h3>${esc(e.title)}</h3>
          <div class="meta">${esc(fmtDate(e))} · ${esc(fmtTime(e))}${e.location ? ` · ${esc(e.location)}` : ''}</div>
        </div>
        <div class="side">
          ${
            e.status === 'completed'
              ? `<span class="chip lavender">${e.ratedBy.includes(me.id) ? 'Rated' : 'Played'}</span>`
              : `<span class="chip ${count >= MAX_PLAYERS ? 'peach' : 'mint'}">${count}/${MAX_PLAYERS} in</span>`
          }
          ${mine ? `<span class="chip ${STATUS_TONE[mine.status]}">You: ${STATUS_LABEL[mine.status]}</span>` : e.status === 'completed' ? '' : '<span class="chip">Not answered</span>'}
        </div>
      </a>`;
  };

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Games</h1><p class="muted">Hi ${esc(me.firstName)} — are you in?</p></div>
      <button class="btn mint" id="toggle-create">+ New game</button>
    </div>
    <form class="card" id="create-form" hidden>
      <h2>New game</h2>
      <div id="create-error"></div>
      <div class="field"><label for="title">Title</label><input id="title" name="title" value="Weekly 9-a-side" maxlength="60" /></div>
      <div class="row">
        <div class="field"><label for="date">Date</label><input id="date" name="date" type="date" min="${today}" required /></div>
        <div class="field"><label for="time">Kick-off</label><input id="time" name="time" type="time" value="19:00" required /></div>
      </div>
      <div class="field"><label for="location">Location</label><input id="location" name="location" placeholder="e.g. Riverside Astro, pitch 2" maxlength="80" /></div>
      <button class="btn mint" type="submit">Create game</button>
    </form>
    <div class="section-title"><h2>Upcoming</h2></div>
    ${upcoming.length ? upcoming.map(gameRow).join('') : '<div class="card empty"><span class="big">🗓️</span>No games planned yet. Create one and get the poll going.</div>'}
    ${past.length ? `<div class="section-title"><h2>Played</h2></div>${past.map(gameRow).join('')}` : ''}`;

  const form = document.getElementById('create-form');
  document.getElementById('toggle-create').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('#date').focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    act(form.querySelector('[type=submit]'), async () => {
      try {
        const event = await api('/events', { method: 'POST', body: { ...Object.fromEntries(fd), createdBy: me.id } });
        location.hash = `#/event/${event.id}`;
      } catch (err) {
        document.getElementById('create-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  });
}

async function eventView(id) {
  let event;
  try {
    event = await api(`/events/${id}?me=${me.id}`);
  } catch (err) {
    app.innerHTML = `<div class="card empty"><span class="big">🤷</span>${esc(err.message)}<br /><br /><a class="btn" href="#/">Back to games</a></div>`;
    return;
  }

  const done = event.status === 'completed';
  const mine = event.responses.find((r) => r.playerId === me.id);
  const { confirmed, waitlist, out } = event.roster;
  const myIndex = confirmed.findIndex((p) => p.id === me.id);
  const onWaitlist = waitlist.some((p) => p.id === me.id);
  const teams = event.teams;
  const played = teams ? [...teams.a, ...teams.b].filter((p) => !p.guest) : [];
  const iPlayed = played.some((p) => p.id === me.id);

  const rosterItem = (p, i) => `
    <li>
      <span class="num">${i + 1}</span>
      <span class="who">${esc(p.name)}${p.guest ? ' <span class="chip">guest</span>' : ''}${p.id === me.id ? ' <span class="chip lavender">you</span>' : ''}</span>
      ${posChip(p.position)}
      <span class="chip">${p.rating}</span>
    </li>`;

  const pollCard = done
    ? ''
    : `
    <section class="card">
      <h2>Are you playing?</h2>
      <p class="muted small">${
        myIndex >= 0
          ? `You're in — spot ${myIndex + 1} of ${MAX_PLAYERS}.`
          : onWaitlist
            ? `The game is full — you're on the waitlist (#${waitlist.findIndex((p) => p.id === me.id) + 1}).`
            : `${Math.max(0, MAX_PLAYERS - confirmed.length)} spots left. First come, first served.`
      }</p>
      <div class="poll" id="poll">
        ${['in', 'out', 'plus1'].map((s) => `<button type="button" data-status="${s}" aria-pressed="${mine?.status === s}">${STATUS_LABEL[s]}</button>`).join('')}
      </div>
      <form class="guest-form" id="guest-form" ${mine?.status === 'plus1' ? '' : 'hidden'}>
        <div><label for="guest-name">Guest's name</label><input id="guest-name" maxlength="40" placeholder="Who are you bringing?" value="${esc(mine?.guestName ?? '')}" /></div>
        <div><label for="guest-pos">Their position</label>
          <select id="guest-pos">${POSITIONS.map((p) => `<option value="${p.code}" ${(mine?.guestPosition ?? me.position) === p.code ? 'selected' : ''}>${p.code} · ${esc(p.name)}</option>`).join('')}</select>
        </div>
        <button class="btn mint" type="submit">${mine?.status === 'plus1' ? 'Update' : 'Confirm +1'}</button>
      </form>
    </section>`;

  const rosterCard = `
    <section class="card">
      <div class="team-head"><h2>Squad</h2><span class="chip ${confirmed.length >= MAX_PLAYERS ? 'peach' : 'mint'}">${confirmed.length}/${MAX_PLAYERS}</span></div>
      <div class="progress" style="margin-bottom:0.75rem"><span style="width:${(confirmed.length / MAX_PLAYERS) * 100}%"></span></div>
      ${confirmed.length ? `<ul class="roster">${confirmed.map(rosterItem).join('')}</ul>` : '<p class="muted">Nobody yet — be the first!</p>'}
      ${waitlist.length ? `<h3 style="margin-top:1rem">Waitlist</h3><ul class="roster">${waitlist.map((p, i) => rosterItem(p, confirmed.length + i)).join('')}</ul>` : ''}
      ${out.length ? `<p class="small muted" style="margin-top:1rem"><strong>Out:</strong> ${out.map((p) => esc(p.name)).join(', ')}</p>` : ''}
    </section>`;

  const teamsCard = `
    <section class="card">
      <div class="team-head">
        <h2>Teams</h2>
        ${done ? '' : `<button class="btn" id="make-teams" ${confirmed.length < 2 ? 'disabled' : ''}>${teams ? '↻ Rebalance' : 'Make balanced teams'}</button>`}
      </div>
      ${teams?.stale ? '<div class="notice">The squad has changed since these teams were made — rebalance to include everyone.</div>' : ''}
      ${
        teams
          ? `<div class="grid-2">
              <div class="team-a">
                <div class="team-head"><h3><span class="chip sky">Team Sky</span></h3><span class="muted small">avg ${teams.statsA.average}</span></div>
                ${pitchLineup(teams.a, 'team-a')}
              </div>
              <div class="team-b">
                <div class="team-head"><h3><span class="chip peach">Team Peach</span></h3><span class="muted small">avg ${teams.statsB.average}</span></div>
                ${pitchLineup(teams.b, 'team-b')}
              </div>
            </div>
            <p class="small muted" style="margin-top:1rem">Teams are balanced on player ratings and positions. Numbers on the shirts are ratings out of 100.</p>
            ${done ? '' : '<button class="btn mint block" id="complete">✓ Game played — open ratings</button>'}`
          : `<p class="muted">${confirmed.length < 2 ? 'Teams can be made once players are in.' : 'Once the squad is set, make teams — we balance them on ratings and positions.'}</p>`
      }
    </section>`;

  let ratingCard = '';
  if (done) {
    const others = played.filter((p) => p.id !== me.id);
    const given = event.myRatings ?? {};
    ratingCard = `
      <section class="card">
        <div class="team-head"><h2>Rate the players</h2><span class="chip lavender">${event.ratedBy.length}/${played.length} rated</span></div>
        ${
          !iPlayed
            ? '<p class="muted">Only players from this game can rate it.</p>'
            : `<p class="muted small">How did everyone play? 1 = rough day, 10 = man of the match. Ratings update each player's score out of 100 so future teams stay balanced.${event.myRatings ? ' You can change your ratings any time.' : ''}</p>
               <form id="rate-form">
                 <div class="rate-list">
                   ${others
                     .map((p) => {
                       const v = given[p.id] ?? 6;
                       const side = teams.a.some((t) => t.id === p.id) ? 'sky' : 'peach';
                       return `<div class="rate-row">
                         <div class="who"><span>${esc(p.name)}</span><span class="chip ${side}">${p.slot === SUB ? SUB : esc(p.slot)}</span></div>
                         <input type="range" min="1" max="10" step="1" value="${v}" name="${p.id}" aria-label="Rating for ${esc(p.name)}" />
                         <output>${v}</output>
                       </div>`;
                     })
                     .join('')}
                 </div>
                 <button class="btn mint block" type="submit" style="margin-top:1rem">${event.myRatings ? 'Update my ratings' : 'Submit ratings'}</button>
               </form>`
        }
      </section>`;
  }

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/" class="small muted">← All games</a>
        <h1>${esc(event.title)}</h1>
        <p class="muted">${esc(fmtDate(event))} · ${esc(fmtTime(event))}${event.location ? ` · ${esc(event.location)}` : ''}</p>
        <p class="small muted">Organised by ${esc(event.createdByName)}</p>
      </div>
      <span class="chip ${done ? 'lavender' : 'mint'}">${done ? 'Played' : 'Polling open'}</span>
    </div>
    ${pollCard}
    ${done ? ratingCard + teamsCard : teamsCard}
    ${rosterCard}
    ${!done && event.createdBy === me.id ? '<p style="text-align:center"><button class="btn ghost" id="delete">Delete game</button></p>' : ''}`;

  const refresh = () => eventView(id);

  document.getElementById('poll')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-status]');
    if (!button) return;
    const status = button.dataset.status;
    if (status === 'plus1') {
      document.getElementById('guest-form').hidden = false;
      document.getElementById('guest-name').focus();
      return;
    }
    act(button, async () => {
      await api(`/events/${id}/poll`, { method: 'POST', body: { playerId: me.id, status } });
      toast(status === 'in' ? "You're in! ⚽" : 'Maybe next time');
      await refresh();
    });
  });

  document.getElementById('guest-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api(`/events/${id}/poll`, {
        method: 'POST',
        body: {
          playerId: me.id,
          status: 'plus1',
          guestName: document.getElementById('guest-name').value,
          guestPosition: document.getElementById('guest-pos').value,
        },
      });
      toast("You and your guest are in! ⚽");
      await refresh();
    });
  });

  document.getElementById('make-teams')?.addEventListener('click', (e) =>
    act(e.currentTarget, async () => {
      await api(`/events/${id}/teams`, { method: 'POST', body: { playerId: me.id } });
      toast('Teams are ready');
      await refresh();
    }),
  );

  document.getElementById('complete')?.addEventListener('click', (e) => {
    if (!confirm('Mark this game as played? The poll and teams will be locked and ratings open.')) return;
    act(e.currentTarget, async () => {
      await api(`/events/${id}/complete`, { method: 'POST', body: { playerId: me.id } });
      await refresh();
    });
  });

  document.getElementById('delete')?.addEventListener('click', (e) => {
    if (!confirm('Delete this game for everyone?')) return;
    act(e.currentTarget, async () => {
      await api(`/events/${id}?me=${me.id}`, { method: 'DELETE' });
      location.hash = '#/';
    });
  });

  const rateForm = document.getElementById('rate-form');
  rateForm?.addEventListener('input', (e) => {
    if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value;
  });
  rateForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const ratings = Object.fromEntries([...new FormData(rateForm)].map(([k, v]) => [k, Number(v)]));
    act(e.submitter, async () => {
      await api(`/events/${id}/ratings`, { method: 'POST', body: { raterId: me.id, ratings } });
      toast('Thanks — ratings saved');
      await refresh();
    });
  });
}

function playersView() {
  const shown = playerFilter === 'ALL' ? players : players.filter((p) => groupOf(p.position) === playerFilter);
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Players</h1><p class="muted">${players.length} in the squad · ranked by rating</p></div>
      <div class="filters" id="filters">
        ${[['ALL', 'All'], ...Object.entries(GROUPS)].map(([k, label]) => `<button type="button" data-g="${k}" aria-pressed="${playerFilter === k}">${label}</button>`).join('')}
      </div>
    </div>
    ${shown.length ? `<div class="cards">${shown.map((p) => playerCard(p)).join('')}</div>` : '<div class="card empty">No players here yet.</div>'}`;
  document.getElementById('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    playerFilter = b.dataset.g;
    playersView();
  });
}

function meView() {
  const history = me.history ?? [];
  app.innerHTML = `
    <div class="page-head"><div><h1>My card</h1><p class="muted">Your rating moves with every game you're rated in.</p></div></div>
    <div class="grid-2">
      <div>
        ${playerCard(me, { large: true })}
        <div class="card" style="margin-top:1rem">
          <h3>Form</h3>
          ${
            history.length
              ? `<ul class="roster">${history
                  .slice()
                  .reverse()
                  .map((h) => `<li><span class="who">${esc(new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span><span class="chip butter">match ${h.matchScore}</span><span class="chip lavender">→ ${h.rating}</span></li>`)
                  .join('')}</ul>`
              : '<p class="muted small">No rated games yet. Play a game and your teammates will rate you.</p>'
          }
        </div>
      </div>
      <form class="card" id="edit-form" novalidate>
        <h2>Edit profile</h2>
        <div id="edit-error"></div>
        <div class="row">
          <div class="field"><label for="first">First name</label><input id="first" name="firstName" value="${esc(me.firstName)}" maxlength="30" /></div>
          <div class="field"><label for="last">Last name</label><input id="last" name="lastName" value="${esc(me.lastName)}" maxlength="30" /></div>
        </div>
        <div class="field" style="max-width:160px"><label for="age">Age</label><input id="age" name="age" type="number" min="8" max="90" value="${me.age}" /></div>
        <div class="field"><label>Playing position</label>${pitchPicker(me.position)}</div>
        <button class="btn mint block" type="submit">Save changes</button>
        <button class="btn ghost block" type="button" id="switch" style="margin-top:0.5rem">Switch player</button>
      </form>
    </div>`;

  const form = document.getElementById('edit-form');
  const getPosition = bindPicker(form, me.position);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    act(e.submitter, async () => {
      try {
        await api(`/players/${me.id}`, {
          method: 'PUT',
          body: { firstName: fd.get('firstName'), lastName: fd.get('lastName'), age: Number(fd.get('age')), position: getPosition() },
        });
        toast('Profile saved');
        render();
      } catch (err) {
        document.getElementById('edit-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  });
  document.getElementById('switch').addEventListener('click', () => {
    setStoredMe(null);
    me = null;
    render();
  });
}

// ---- router ----------------------------------------------------------------

async function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  try {
    players = await api('/players');
  } catch (err) {
    app.innerHTML = `<div class="card empty"><span class="big">📡</span>Can't reach the server: ${esc(err.message)}</div>`;
    return;
  }
  me = players.find((p) => p.id === storedMe()) ?? null;
  nav.hidden = !me;
  if (me) document.getElementById('nav-me').textContent = me.firstName;

  const section = route.startsWith('/players') ? 'players' : route.startsWith('/me') ? 'me' : 'games';
  nav.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));

  if (!me) return onboardingView();
  const eventMatch = route.match(/^\/event\/([\w-]+)$/);
  if (eventMatch) return eventView(eventMatch[1]);
  if (section === 'players') return playersView();
  if (section === 'me') return meView();
  return gamesView();
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
render();
