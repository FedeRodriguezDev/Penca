/* ============================================================
   PENCA MUNDIAL 2026 — Frontend App
   ============================================================ */

const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let allMatches = {};
let activeGroup = 'all';
let toastTimer = null;
let currentPage = 'matches';
let pageRefreshTimer = null;
let phoneIti = null;
const UTC_MINUS_3_OFFSET_MS = -3 * 60 * 60 * 1000;
const PAGE_AUTO_REFRESH_MS = 60 * 1000;

function getResetTokenFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('reset_token') || '';
  } catch {
    return '';
  }
}

function clearResetTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // no-op
  }
}

// ──────────────────────────────────────────
// SECURITY HELPERS
// ──────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeSrc(url) {
  if (!url || typeof url !== 'string') return '';
  return /^https?:\/\//i.test(url) ? url : '';
}

// ──────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const resetToken = getResetTokenFromUrl();
  if (resetToken) {
    showAuth();
    showResetPasswordForm(resetToken);
    return;
  }

  // Initialize phone number input with country selector
  const phoneEl = document.getElementById('reg-phone');
  if (phoneEl && window.intlTelInput) {
    phoneIti = window.intlTelInput(phoneEl, {
      initialCountry: 'uy',
      preferredCountries: ['uy', 'ar', 'br', 'py', 'bo', 'cl', 'pe', 'ec', 'co', 've'],
    });
  }

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
    document.getElementById('admin-tab-mobile').style.display = '';
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
  document.getElementById('forgot-password-form').classList.add('hidden');
  document.getElementById('reset-password-form').classList.add('hidden');
  if (tab !== 'register') document.getElementById('register-success').classList.add('hidden');
  hideAuthMsg();
}

function showForgotPassword() {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-tab')[0].classList.add('active');
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('register-success').classList.add('hidden');
  document.getElementById('reset-password-form').classList.add('hidden');
  document.getElementById('forgot-password-form').classList.remove('hidden');
  document.getElementById('forgot-email').value = document.getElementById('login-email').value.trim();
  hideAuthMsg();
}

function showResetPasswordForm(resetToken) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-tab')[0].classList.add('active');
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('register-success').classList.add('hidden');
  document.getElementById('forgot-password-form').classList.add('hidden');
  document.getElementById('reset-password-form').classList.remove('hidden');
  document.getElementById('reset-token').value = resetToken || '';
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
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      try {
        await apiFetch('/auth/resend-verification', 'POST', { email });
        return showAuthMsg('Tu cuenta aún no está verificada. Te reenviamos el correo de validación.', true);
      } catch {
        return showAuthMsg('Tu cuenta aún no está verificada. No pudimos reenviar el correo ahora.', true);
      }
    }
    showAuthMsg(err.message);
  }
}

async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;
  if (!username || !email || !password || !passwordConfirm) return showAuthMsg('Completá todos los campos');
  if (password !== passwordConfirm) return showAuthMsg('Las contraseñas no coinciden');

  // Validate phone number (required)
  let phone_number = null;
  if (phoneIti) {
    const rawPhone = document.getElementById('reg-phone').value.trim();
    if (!rawPhone) return showAuthMsg('El número de teléfono es requerido');
    if (!phoneIti.isValidNumber()) {
      return showAuthMsg('El número de teléfono no es válido para el país seleccionado');
    }
    phone_number = phoneIti.getNumber(); // E.164 format e.g. +59812345678
  }

  try {
    await apiFetch('/auth/register', 'POST', { username, email, password, phone_number });
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('register-success-email').textContent = email;
    document.getElementById('register-success').classList.remove('hidden');
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = '';
  } catch (err) {
    showAuthMsg(err.message);
  }
}

async function requestPasswordReset() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showAuthMsg('Ingresá tu email');

  try {
    const data = await apiFetch('/auth/forgot-password', 'POST', { email });
    showAuthTab('login');
    document.getElementById('login-email').value = email;
    showAuthMsg(data.message || 'Te enviamos un enlace para cambiar tu contraseña si la cuenta existe.', false);
  } catch (err) {
    showAuthMsg(err.message);
  }
}

async function submitPasswordReset() {
  const tokenValue = document.getElementById('reset-token').value.trim();
  const newPassword = document.getElementById('reset-password').value;
  const confirmPassword = document.getElementById('reset-password-confirm').value;

  if (!tokenValue) return showAuthMsg('El enlace de recuperación no es válido');
  if (!newPassword || !confirmPassword) return showAuthMsg('Completá todos los campos');
  if (newPassword.length < 6) return showAuthMsg('La contraseña debe tener al menos 6 caracteres');
  if (newPassword !== confirmPassword) return showAuthMsg('Las contraseñas no coinciden');

  try {
    const data = await apiFetch('/auth/reset-password', 'POST', {
      token: tokenValue,
      new_password: newPassword,
    });
    clearResetTokenFromUrl();
    showAuthTab('login');
    document.getElementById('reset-password').value = '';
    document.getElementById('reset-password-confirm').value = '';
    showAuthMsg(data.message || 'Contraseña actualizada correctamente.', false);
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
  document.getElementById('admin-tab-mobile').style.display = 'none';
  showAuth();
}

// ──────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(t => t.classList.add('active'));
  resetPageAutoRefresh(page);

  if (page === 'matches') loadMatches();
  if (page === 'leaderboard') loadLeaderboard();
  if (page === 'admin') loadAdmin();
}

function resetPageAutoRefresh(page) {
  if (pageRefreshTimer) {
    window.clearInterval(pageRefreshTimer);
    pageRefreshTimer = null;
  }

  if (!['matches', 'leaderboard'].includes(page)) return;

  pageRefreshTimer = window.setInterval(() => {
    if (document.hidden || currentPage !== page) return;
    if (page === 'matches' && document.activeElement?.classList?.contains('score-input')) return;

    if (page === 'matches') loadMatches({ silent: true, preserveScroll: true });
    if (page === 'leaderboard') loadLeaderboard({ silent: true, preserveScroll: true });
  }, PAGE_AUTO_REFRESH_MS);
}

function restoreScrollPosition(scrollY) {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: 'auto' });
  });
}

// ──────────────────────────────────────────
// MATCHES PAGE
// ──────────────────────────────────────────
async function loadMatches({ silent = false, preserveScroll = false } = {}) {
  const container = document.getElementById('matches-container');
  const scrollY = preserveScroll ? window.scrollY : null;
  if (!silent) {
    container.innerHTML = loadingHtml();
  }
  try {
    const data = await apiFetch('/matches/groups');
    allMatches = data;
    renderGroupFilter(data);
    renderMatches(data);
    if (preserveScroll && scrollY !== null) {
      restoreScrollPosition(scrollY);
    }
  } catch (err) {
    if (!silent) {
      container.innerHTML = `<div class="empty">
        <p>Error cargando partidos</p>
        <p class="hint">${escapeHtml(err.message)}</p>
        <button class="btn btn-primary" onclick="loadMatches()" style="margin-top:1rem">Reintentar</button>
      </div>`;
    }
  }
}

function renderGroupFilter(data) {
  const filter = document.getElementById('group-filter');
  const groups = Object.keys(data);
  if (activeGroup !== 'all' && !groups.includes(activeGroup)) {
    activeGroup = 'all';
  }
  filter.innerHTML = `
    <button class="filter-btn ${activeGroup === 'all' ? 'active' : ''}" data-group="all">Todos</button>
    ${groups.map(g => `<button class="filter-btn ${activeGroup === g ? 'active' : ''}" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
  `;
  filter.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => filterGroup(btn.dataset.group, e.currentTarget));
  });
}

function filterGroup(group, targetBtn) {
  activeGroup = group;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (targetBtn) targetBtn.classList.add('active');
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

function renderTeamCrest(url, teamName) {
  const safeUrl = safeSrc(url);
  if (!safeUrl) {
    return `<div class="team-crest team-crest-placeholder" aria-hidden="true">${escapeHtml(teamName.slice(0, 1))}</div>`;
  }
  return `<img class="team-crest" src="${safeUrl}" alt="Escudo de ${escapeHtml(teamName)}" loading="lazy">`;
}

function renderMatchCard(m) {
  const canPredict = Boolean(m.can_predict);
  const statusLabel = { upcoming: 'PRÓXIMO', live: 'EN VIVO', finished: 'FINALIZADO' }[m.status] || 'DESCONOCIDO';
  const statusClass = `status-${{ upcoming: 'upcoming', live: 'live', finished: 'finished' }[m.status] || 'unknown'}`;
  const dateStr = formatMatchDateTime(m);

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
  } else if (hasPred && canPredict) {
    pointsHtml = `<span class="points-badge pts-pending">✏️ ${predScore}</span>`;
  }

  const realScoreHtml = !canPredict
    ? `<div class="real-score">${m.home_score ?? '-'} - ${m.away_score ?? '-'}</div>`
    : `<div class="vs-badge">VS</div>`;

  const homePredictionField = canPredict
    ? `
      <div class="team-prediction-field">
        <span class="team-prediction-label">Tu gol</span>
        <input class="score-input" type="number" id="ph-${m.id}" min="0" max="20" value="${hasPred ? m.pred_home : ''}" placeholder="-">
      </div>
    `
    : '';

  const awayPredictionField = canPredict
    ? `
      <div class="team-prediction-field">
        <span class="team-prediction-label">Tu gol</span>
        <input class="score-input" type="number" id="pa-${m.id}" min="0" max="20" value="${hasPred ? m.pred_away : ''}" placeholder="-">
      </div>
    `
    : '';

  let predictionHtml = '';
  if (hasPred && !canPredict) {
    predictionHtml = `<div class="pred-display">Mi pronóstico: <span>${predScore}</span></div>`;
  } else if (!canPredict) {
    predictionHtml = `<div class="pred-display" style="color:#666">No pronosticaste</div>`;
  }

  return `
    <div class="match-card ${!canPredict ? 'finished' : ''}" id="mc-${m.id}">
      <div class="match-header">
        <div class="match-meta">
          <strong>#${m.match_number}</strong> · ${dateStr}
          <span class="venue"> · ${escapeHtml(m.city || '')}</span>
        </div>
        <span class="match-status ${statusClass}">${statusLabel}</span>
        ${pointsHtml}
      </div>
      <div class="match-body">
        <div class="team-crest-rail home">
          ${renderTeamCrest(m.home_flag, m.home_team)}
        </div>
        <div class="match-main">
          <div class="match-body-row teams-row">
            <div class="team-column home">
              <div class="team home">
                <span class="team-name">${escapeHtml(m.home_team)}</span>
              </div>
            </div>
            <div class="match-center">${realScoreHtml}</div>
            <div class="team-column away">
              <div class="team away">
                <span class="team-name">${escapeHtml(m.away_team)}</span>
              </div>
            </div>
          </div>
          <div class="match-body-row predictions-row ${canPredict ? '' : 'hidden'}" id="pr-${m.id}" data-match-id="${m.id}" data-last-home="${hasPred ? m.pred_home : ''}" data-last-away="${hasPred ? m.pred_away : ''}" onfocusout="queueAutoSavePrediction(${m.id})">
            <div class="team-column home">
              ${homePredictionField}
            </div>
            <div class="match-center prediction-center-spacer"></div>
            <div class="team-column away">
              ${awayPredictionField}
            </div>
          </div>
        </div>
        <div class="team-crest-rail away">
          ${renderTeamCrest(m.away_flag, m.away_team)}
        </div>
      </div>
      ${predictionHtml ? `<div class="match-footer">${predictionHtml}</div>` : ''}
    </div>
  `;
}

function queueAutoSavePrediction(matchId) {
  window.setTimeout(() => {
    const predictionRow = document.getElementById(`pr-${matchId}`);
    if (!predictionRow) return;
    if (predictionRow.contains(document.activeElement)) return;
    autoSavePrediction(matchId);
  }, 0);
}

async function autoSavePrediction(matchId) {
  const predictionRow = document.getElementById(`pr-${matchId}`);
  if (!predictionRow || predictionRow.dataset.saving === 'true') return;

  const homeInput = document.getElementById(`ph-${matchId}`);
  const awayInput = document.getElementById(`pa-${matchId}`);
  if (!homeInput || !awayInput) return;

  const homeValue = homeInput.value.trim();
  const awayValue = awayInput.value.trim();

  if (!homeValue && !awayValue) return;
  if (!homeValue || !awayValue) return;
  if (predictionRow.dataset.lastHome === homeValue && predictionRow.dataset.lastAway === awayValue) return;

  predictionRow.dataset.saving = 'true';
  homeInput.disabled = true;
  awayInput.disabled = true;

  try {
    await apiFetch('/predictions', 'POST', {
      match_id: matchId,
      home_score: Number.parseInt(homeValue, 10),
      away_score: Number.parseInt(awayValue, 10),
    });
    predictionRow.dataset.lastHome = homeValue;
    predictionRow.dataset.lastAway = awayValue;
    showToast('Pronóstico guardado ✅');
    await loadMatches({ silent: true, preserveScroll: true });
  } catch (err) {
    homeInput.disabled = false;
    awayInput.disabled = false;
    predictionRow.dataset.saving = 'false';
    showToast(err.message, true);
  }
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
async function loadLeaderboard({ silent = false, preserveScroll = false } = {}) {
  const scrollY = preserveScroll ? window.scrollY : null;
  if (!silent) {
    document.getElementById('leaderboard-container').innerHTML = loadingHtml();
  }
  try {
    const [leaders, stats] = await Promise.all([
      apiFetch('/leaderboard'),
      apiFetch('/leaderboard/stats')
    ]);
    renderStats(stats);
    renderLeaderboard(leaders);
    if (preserveScroll && scrollY !== null) {
      restoreScrollPosition(scrollY);
    }
  } catch (err) {
    if (!silent) {
      document.getElementById('leaderboard-container').innerHTML = `<div class="empty">Error: ${err.message}</div>`;
    }
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
          <div class="lb-username">${escapeHtml(u.username)}${u.username === currentUser?.username ? ' <span style="color:var(--text-muted);font-size:0.75rem">(vos)</span>' : ''}</div>
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
    const statusColors = { finished: '#888', live: '#ff8a8a', upcoming: 'var(--green-light)' };
    container.innerHTML = matches.map(m => `
      <div class="admin-match-card">
        <div class="admin-match-info">
          <div class="admin-match-teams">#${m.match_number} ${escapeHtml(m.home_team)} vs ${escapeHtml(m.away_team)}</div>
          <div class="admin-match-meta">${escapeHtml(m.stage)}${m.group_name ? ` · Grupo ${escapeHtml(m.group_name)}` : ''} · ${formatMatchDateTime(m)} · <span style="color:${statusColors[m.status] || 'var(--green-light)'}">${escapeHtml(m.status)}</span></div>
          ${m.status === 'finished' ? `<div class="result-saved">✅ Resultado: ${m.home_score} - ${m.away_score}</div>` : ''}
        </div>
        <div class="admin-result-form">
          <input type="date" id="md-${m.id}" value="${getInputDateValue(m)}">
          <input type="time" id="mt-${m.id}" value="${getInputTimeValue(m)}">
          <button class="btn-small" onclick="saveMatchSchedule(${m.id})">Guardar horario</button>
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

async function saveMatchSchedule(matchId) {
  const match_date = document.getElementById(`md-${matchId}`).value;
  const match_time = document.getElementById(`mt-${matchId}`).value;

  if (match_time && !match_date) {
    return showToast('Cargá una fecha junto con la hora', true);
  }

  try {
    await apiFetch(`/admin/match/${matchId}`, 'PUT', {
      match_date: match_date || null,
      match_time: match_time || null,
    });
    showToast('Horario actualizado ✅');
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
    match_time: document.getElementById('am-time').value,
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
  if (body.match_time && !body.match_date) {
    msg.textContent = 'Si cargás hora, también tenés que cargar la fecha';
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
        <div class="users-header">
          <div>Usuario</div>
          <div>Email</div>
          <div>Registrado</div>
          <div>Rol</div>
          <div>Acciones</div>
        </div>
        ${users.map(u => {
          const createdAt = u.created_at ? new Date(u.created_at).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-';
          const isSelf = u.id === currentUser?.id;
          return `
          <div class="user-row" id="user-row-${u.id}">
            <div class="user-display-${u.id}">
              <strong>${escapeHtml(u.username)}</strong>
              <span class="user-id-badge">#${u.id}</span>
            </div>
            <div class="user-display-${u.id}" style="color:var(--text-muted);font-size:0.85rem">${escapeHtml(u.email)}</div>
            <div style="color:var(--text-muted);font-size:0.82rem">${createdAt}</div>
            <div>${u.is_admin ? '<span class="user-admin-badge">ADMIN</span>' : '<span class="user-normal-badge">USER</span>'}</div>
            <div class="user-actions">
              <button class="btn-small btn-primary-sm user-edit-btn" data-userid="${u.id}">✏️ Editar</button>
              ${!isSelf ? `<button class="btn-small ${u.is_admin ? 'btn-logout' : 'btn-gold'}" onclick="toggleAdmin(${u.id}, ${u.is_admin ? 'true' : 'false'})">${u.is_admin ? '⬇️ Quitar admin' : '⬆️ Hacer admin'}</button>` : '<span class="user-self-label">Vos</span>'}
            </div>
          </div>
          <div class="user-edit-form hidden" id="user-edit-${u.id}">
            <div class="user-edit-inner">
              <div class="field">
                <label>Nombre de usuario</label>
                <input type="text" id="edit-username-${u.id}" value="${escapeHtml(u.username)}">
              </div>
              <div class="field">
                <label>Email</label>
                <input type="email" id="edit-email-${u.id}" value="${escapeHtml(u.email)}">
              </div>
              <div class="user-edit-actions">
                <button class="btn-primary btn-sm" onclick="saveEditUser(${u.id})">Guardar</button>
                <button class="btn-secondary btn-sm" onclick="closeEditUser(${u.id})">Cancelar</button>
                <span class="user-edit-msg hidden" id="edit-msg-${u.id}"></span>
              </div>
            </div>
          </div>
        `}).join('')}
      </div>
    `;
    // Bind edit buttons via data attribute (avoids onclick with user data in HTML attrs)
    container.querySelectorAll('.user-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditUser(Number(btn.dataset.userid)));
    });
  } catch (err) {
    container.innerHTML = `<div class="empty">Error: ${err.message}</div>`;
  }
}

function openEditUser(userId) {
  document.querySelectorAll('.user-edit-form').forEach(f => f.classList.add('hidden'));
  document.getElementById(`user-edit-${userId}`).classList.remove('hidden');
  document.getElementById(`edit-username-${userId}`).focus();
}

function closeEditUser(userId) {
  document.getElementById(`user-edit-${userId}`).classList.add('hidden');
}

async function saveEditUser(userId) {
  const username = document.getElementById(`edit-username-${userId}`).value.trim();
  const email = document.getElementById(`edit-email-${userId}`).value.trim();
  const msgEl = document.getElementById(`edit-msg-${userId}`);
  if (!username || !email) {
    msgEl.textContent = 'Completá todos los campos';
    msgEl.className = 'user-edit-msg error';
    msgEl.classList.remove('hidden');
    return;
  }
  try {
    await apiFetch(`/admin/users/${userId}`, 'PUT', { username, email });
    showToast('Usuario actualizado ✅');
    loadUsers();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'user-edit-msg error';
    msgEl.classList.remove('hidden');
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
async function apiFetch(endpoint, method = 'GET', body = null, { retries, timeoutMs = 15000 } = {}) {
  // Only retry GET requests — mutations could create duplicates
  const maxRetries = retries ?? (method === 'GET' ? 3 : 0);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal = controller.signal;

    try {
      const res = await fetch(`${API}${endpoint}`, opts);
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok) {
        const error = new Error(data.error || 'Error del servidor');
        error.code = data.code;
        throw error;
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      // Only retry on network errors (TypeError / AbortError), not HTTP errors
      if (err.code) throw err; // HTTP-level error, don't retry
      lastError = err;
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1s, 2s
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError || new Error('Error de conexión');
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

function getUtcMinus3Parts(kickoffAt) {
  if (!kickoffAt) return null;
  const kickoff = new Date(kickoffAt);
  if (Number.isNaN(kickoff.getTime())) return null;

  const shifted = new Date(kickoff.getTime() + UTC_MINUS_3_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
    shifted,
  };
}

function getInputDateValue(match) {
  return getUtcMinus3Parts(match.kickoff_at)?.date || match.match_date || '';
}

function getInputTimeValue(match) {
  return getUtcMinus3Parts(match.kickoff_at)?.time || (match.match_time ? match.match_time.slice(0, 5) : '');
}

function formatMatchDateTime(match) {
  const utcMinus3 = getUtcMinus3Parts(match.kickoff_at);
  if (utcMinus3) {
    const formattedDate = utcMinus3.shifted.toLocaleDateString('es-UY', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return `${formattedDate} · ${utcMinus3.time} UTC-3`;
  }

  if (!match.match_date) return 'Fecha TBD';
  const formattedDate = formatDate(match.match_date);
  return match.match_time ? `${formattedDate} · ${match.match_time.slice(0, 5)} UTC-3` : formattedDate;
}

function loadingHtml() {
  return `<div class="loading"><span class="spinner">⚽</span>Cargando...</div>`;
}

// Enter key on login/register
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('register-form').classList.contains('hidden')) register();
  else if (!document.getElementById('forgot-password-form').classList.contains('hidden')) requestPasswordReset();
  else if (!document.getElementById('reset-password-form').classList.contains('hidden')) submitPasswordReset();
  else if (!document.getElementById('login-form').classList.contains('hidden')) login();
});
