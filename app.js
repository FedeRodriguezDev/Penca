/* ============================================================
   PENCA MUNDIAL 2026 — Frontend App
   ============================================================ */

const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let allMatches = {};
let activeGroup = 'all';
let toastTimer = null;

// ──────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (token) {
    try {
      const me = await apiFetch('/auth/me');
      currentUser = me;
      showApp();
    } catch {
      localStorage.removeItem('token');
      token = null;
      showAuth();
    }
  } else {
    showAuth();
  }
});

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('nav-username').textContent = `👤 ${currentUser.username}`;
  if (currentUser.is_admin) {
    document.getElementById('admin-tab').style.display = '';
  }
  showPage('matches');
}

// ──────────────────────────────────────────
// AUTH TABS
// ──────────────────────────────────────────
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-tab')[tab === 'login' ? 0 : 1].classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  hideAuthMsg();
}

function showAuthMsg(msg, isError = true) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = `auth-msg ${isError ? 'error' : 'success'}`;
  el.classList.remove('hidden');
}
function hideAuthMsg() { document.getElementById('auth-msg').classList.add('hidden'); }

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showAuthMsg('Completá todos los campos');
  try {
    const data = await apiFetch('/auth/login', 'POST', { email, password });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = { username: data.username, is_admin: data.is_admin };
    showApp();
  } catch (err) {
    showAuthMsg(err.message);
  }
}

async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!username || !email || !password) return showAuthMsg('Completá todos los campos');
  try {
    const data = await apiFetch('/auth/register', 'POST', { username, email, password });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = { username: data.username, is_admin: data.is_admin };
    showAuthMsg(data.message || '¡Bienvenido!', false);
    setTimeout(showApp, 900);
  } catch (err) {
    showAuthMsg(err.message);
  }
}

function logout() {
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  allMatches = {};
  document.getElementById('admin-tab').style.display = 'none';
  showAuth();
}

// ──────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  const navTab = document.querySelector(`[data-page="${page}"]`);
  if (navTab) navTab.classList.add('active');

  if (page === 'matches') loadMatches();
  if (page === 'leaderboard') loadLeaderboard();
  if (page === 'admin') loadAdmin();
}

// ──────────────────────────────────────────
// MATCHES PAGE
// ──────────────────────────────────────────
async function loadMatches() {
  const container = document.getElementById('matches-container');
  container.innerHTML = loadingHtml();
  try {
    const data = await apiFetch('/matches/groups');
    allMatches = data;
    renderGroupFilter(data);
    renderMatches(data);
  } catch (err) {
    container.innerHTML = `<div class="empty">Error cargando partidos: ${err.message}</div>`;
  }
}

function renderGroupFilter(data) {
  const filter = document.getElementById('group-filter');
  const groups = Object.keys(data);
  filter.innerHTML = `
    <button class="filter-btn active" onclick="filterGroup('all')">Todos</button>
    ${groups.map(g => `<button class="filter-btn" onclick="filterGroup('${g}')">${g}</button>`).join('')}
  `;
}

function filterGroup(group) {
  activeGroup = group;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderMatches(allMatches);
}

function renderMatches(data) {
  const container = document.getElementById('matches-container');
  const groups = activeGroup === 'all' ? Object.keys(data) : [activeGroup];
  if (!groups.length) { container.innerHTML = '<div class="empty">No hay partidos</div>'; return; }

  container.innerHTML = groups.map(groupName => {
    const matches = data[groupName];
    return `
      <div class="group-section">
        <div class="group-title">⚽ ${groupName}</div>
        ${matches.map(renderMatchCard).join('')}
      </div>
    `;
  }).join('');
}

function renderMatchCard(m) {
  const canPredict = m.status === 'upcoming';
  const statusLabel = { upcoming: 'PRÓXIMO', live: 'EN VIVO', finished: 'FINALIZADO' }[m.status] || m.status;
  const statusClass = `status-${m.status}`;
  const dateStr = m.match_date ? formatDate(m.match_date) : 'Fecha TBD';

  const hasPred = m.pred_home !== null && m.pred_home !== undefined;
  const predScore = hasPred ? `${m.pred_home} - ${m.pred_away}` : '';

  let pointsHtml = '';
  if (m.status === 'finished' && hasPred) {
    const pts = m.pred_points;
    const cls = pts === 3 ? 'pts-3' : pts === 1 ? 'pts-1' : 'pts-0';
    const label = pts === 3 ? '🏆 +3 EXACTO' : pts === 1 ? '✅ +1 RESULTADO' : '❌ +0';
    pointsHtml = `<span class="points-badge ${cls}">${label}</span>`;
  } else if (m.status === 'finished' && !hasPred) {
    pointsHtml = `<span class="points-badge pts-0">❌ Sin pronóstico</span>`;
  } else if (hasPred && m.status === 'upcoming') {
    pointsHtml = `<span class="points-badge pts-pending">✏️ ${predScore}</span>`;
  }

  const realScoreHtml = m.status !== 'upcoming'
    ? `<div class="real-score">${m.home_score ?? '-'} - ${m.away_score ?? '-'}</div>`
    : `<div class="vs-badge">VS</div>`;

  let predictionHtml = '';
  if (canPredict) {
    predictionHtml = `
      <div class="prediction-row">
        <span class="pred-label">Mi pronóstico:</span>
        <input class="score-input" type="number" id="ph-${m.id}" min="0" max="20" value="${hasPred ? m.pred_home : ''}" placeholder="-">
        <span class="score-dash">-</span>
        <input class="score-input" type="number" id="pa-${m.id}" min="0" max="20" value="${hasPred ? m.pred_away : ''}" placeholder="-">
        <button class="btn-gold btn-small btn-save" onclick="savePrediction(${m.id})">Guardar</button>
      </div>
    `;
  } else if (hasPred) {
    predictionHtml = `<div class="pred-display">Mi pronóstico: <span>${predScore}</span></div>`;
  } else if (m.status !== 'upcoming') {
    predictionHtml = `<div class="pred-display" style="color:#666">No pronosticaste</div>`;
  }

  return `
    <div class="match-card ${m.status !== 'upcoming' ? 'finished' : ''}" id="mc-${m.id}">
      <div class="match-header">
        <div class="match-meta">
          <strong>#${m.match_number}</strong> · ${dateStr}
          <span class="venue"> · ${m.city || ''}</span>
        </div>
        <span class="match-status ${statusClass}">${statusLabel}</span>
        ${pointsHtml}
      </div>
      <div class="match-body">
        <div class="team home"><span>${m.home_team}</span></div>
        <div class="match-center">${realScoreHtml}</div>
        <div class="team away"><span>${m.away_team}</span></div>
      </div>
      <div style="margin-top:12px">${predictionHtml}</div>
    </div>
  `;
}

async function savePrediction(matchId) {
  const home = parseInt(document.getElementById(`ph-${matchId}`).value);
  const away = parseInt(document.getElementById(`pa-${matchId}`).value);
  if (isNaN(home) || isNaN(away)) return showToast('Completá ambos marcadores', true);
  try {
    await apiFetch('/predictions', 'POST', { match_id: matchId, home_score: home, away_score: away });
    showToast('Pronóstico guardado ✅');
    loadMatches();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ──────────────────────────────────────────
// LEADERBOARD PAGE
// ──────────────────────────────────────────
async function loadLeaderboard() {
  document.getElementById('leaderboard-container').innerHTML = loadingHtml();
  try {
    const [leaders, stats] = await Promise.all([
      apiFetch('/leaderboard'),
      apiFetch('/leaderboard/stats')
    ]);
    renderStats(stats);
    renderLeaderboard(leaders);
  } catch (err) {
    document.getElementById('leaderboard-container').innerHTML = `<div class="empty">Error: ${err.message}</div>`;
  }
}

function renderStats(s) {
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat-card"><div class="stat-value">${s.finishedMatches}</div><div class="stat-label">Partidos jugados</div></div>
    <div class="stat-card"><div class="stat-value">${s.totalMatches}</div><div class="stat-label">Total partidos</div></div>
    <div class="stat-card"><div class="stat-value">${s.totalPredictions}</div><div class="stat-label">Pronósticos</div></div>
    <div class="stat-card"><div class="stat-value">${s.exactScores}</div><div class="stat-label">Marcadores exactos</div></div>
  `;
}

function renderLeaderboard(leaders) {
  if (!leaders.length) {
    document.getElementById('leaderboard-container').innerHTML = '<div class="empty">Aún no hay datos</div>';
    return;
  }
  const rankIcon = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
  const rankCls = (i) => i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';

  document.getElementById('leaderboard-container').innerHTML = `
    <div class="leaderboard-table">
      <div class="lb-header">
        <div>#</div>
        <div>Jugador</div>
        <div style="text-align:center">Puntos</div>
        <div class="lb-col-hide" style="text-align:center">Exactos</div>
        <div class="lb-col-hide" style="text-align:center">Resultados</div>
        <div class="lb-col-hide" style="text-align:center">Jugados</div>
      </div>
      ${leaders.map((u, i) => `
        <div class="lb-row ${u.username === currentUser?.username ? 'my-row' : ''}">
          <div class="lb-rank ${rankCls(i)}">${rankIcon(i)}</div>
          <div class="lb-username">${u.username}${u.username === currentUser?.username ? ' <span style="color:var(--text-muted);font-size:0.75rem">(vos)</span>' : ''}</div>
          <div class="lb-pts">${u.total_points}</div>
          <div class="lb-num lb-col-hide lb-exact">🏆 ${u.exact_scores}</div>
          <div class="lb-num lb-col-hide">✅ ${u.correct_results}</div>
          <div class="lb-num lb-col-hide">${u.predictions_made}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ──────────────────────────────────────────
// ADMIN PAGE
// ──────────────────────────────────────────
async function loadAdmin() {
  if (!currentUser?.is_admin) return;
  loadAdminMatches();
}

async function loadAdminMatches() {
  const container = document.getElementById('admin-matches-list');
  container.innerHTML = loadingHtml();
  try {
    const matches = await apiFetch('/admin/matches');
    if (!matches.length) { container.innerHTML = '<div class="empty">No hay partidos</div>'; return; }
    container.innerHTML = matches.map(m => `
      <div class="admin-match-card">
        <div class="admin-match-info">
          <div class="admin-match-teams">#${m.match_number} ${m.home_team} vs ${m.away_team}</div>
          <div class="admin-match-meta">${m.stage}${m.group_name ? ` · Grupo ${m.group_name}` : ''} · ${m.match_date || 'Sin fecha'} · <span style="color:${m.status === 'finished' ? '#888' : 'var(--green-light)'}">${m.status}</span></div>
          ${m.status === 'finished' ? `<div class="result-saved">✅ Resultado: ${m.home_score} - ${m.away_score}</div>` : ''}
        </div>
        <div class="admin-result-form">
          <input class="score-input" type="number" id="ah-${m.id}" min="0" max="30" value="${m.home_score ?? ''}" placeholder="0">
          <span class="score-dash">-</span>
          <input class="score-input" type="number" id="aa-${m.id}" min="0" max="30" value="${m.away_score ?? ''}" placeholder="0">
          <button class="btn-gold btn-small" onclick="saveResult(${m.id})">Guardar</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty">Error: ${err.message}</div>`;
  }
}

async function saveResult(matchId) {
  const home = parseInt(document.getElementById(`ah-${matchId}`).value);
  const away = parseInt(document.getElementById(`aa-${matchId}`).value);
  if (isNaN(home) || isNaN(away)) return showToast('Completá el marcador', true);
  try {
    await apiFetch('/admin/result', 'POST', { match_id: matchId, home_score: home, away_score: away, status: 'finished' });
    showToast('Resultado guardado y puntos actualizados ✅');
    loadAdminMatches();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addMatch() {
  const body = {
    match_number: parseInt(document.getElementById('am-num').value),
    stage: document.getElementById('am-stage').value,
    home_team: document.getElementById('am-home').value.trim(),
    away_team: document.getElementById('am-away').value.trim(),
    match_date: document.getElementById('am-date').value,
    venue: document.getElementById('am-venue').value.trim(),
    city: document.getElementById('am-city').value.trim(),
  };
  const msg = document.getElementById('admin-add-msg');
  if (!body.match_number || !body.home_team || !body.away_team) {
    msg.textContent = 'Completá los campos requeridos';
    msg.className = 'auth-msg error';
    msg.classList.remove('hidden');
    return;
  }
  try {
    await apiFetch('/admin/match', 'POST', body);
    msg.textContent = '✅ Partido agregado exitosamente';
    msg.className = 'auth-msg success';
    msg.classList.remove('hidden');
    showToast('Partido agregado ✅');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'auth-msg error';
    msg.classList.remove('hidden');
  }
}

async function loadUsers() {
  const container = document.getElementById('users-list');
  container.innerHTML = loadingHtml();
  try {
    const users = await apiFetch('/admin/users');
    container.innerHTML = `
      <div class="users-table">
        ${users.map(u => `
          <div class="user-row">
            <div><strong>${u.username}</strong></div>
            <div style="color:var(--text-muted);font-size:0.82rem">${u.email}</div>
            <div>${u.is_admin ? '<span class="user-admin-badge">ADMIN</span>' : ''}</div>
            <div>
              <button class="btn-small ${u.is_admin ? 'btn-logout' : 'btn-gold'}" onclick="toggleAdmin(${u.id}, ${u.is_admin})">
                ${u.is_admin ? 'Quitar admin' : 'Hacer admin'}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty">Error: ${err.message}</div>`;
  }
}

async function toggleAdmin(userId, currentlyAdmin) {
  if (userId === currentUser?.id) return showToast('No podés quitarte el admin a vos mismo', true);
  try {
    await apiFetch(`/admin/users/${userId}/admin`, 'PUT', { is_admin: !currentlyAdmin });
    showToast('Usuario actualizado');
    loadUsers();
  } catch (err) {
    showToast(err.message, true);
  }
}

function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`admin-${tab}`).classList.remove('hidden');
  if (tab === 'users') loadUsers();
  if (tab === 'results') loadAdminMatches();
}

// ──────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────
async function apiFetch(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function loadingHtml() {
  return `<div class="loading"><span class="spinner">⚽</span>Cargando...</div>`;
}

// Enter key on login/register
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('register-form').classList.contains('hidden')) register();
  else if (!document.getElementById('login-form').classList.contains('hidden')) login();
});
