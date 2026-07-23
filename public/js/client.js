const API = '/api/client';
const app = document.getElementById('app');

const state = {
  token: localStorage.getItem('hairsprit_token') || null,
  client: null,
  rewards: [],
  history: [],
  qrcode: null,
  authMode: 'login', // 'login' | 'register'
  loading: false,
  error: null,
  cardFlipped: false,
};

function saveToken(token) {
  state.token = token;
  localStorage.setItem('hairsprit_token', token);
}
function clearToken() {
  state.token = null;
  localStorage.removeItem('hairsprit_token');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
  return data;
}

function icon(name) {
  const icons = {
    scissors: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5 19 19M8.5 15.5 19 5"/></svg>',
    logout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    calendar: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  };
  return icons[name] || '';
}

/* ---------------- INIT ---------------- */
async function init() {
  if (state.token) {
    try {
      await loadClientData();
      renderDashboard();
      return;
    } catch (e) {
      clearToken();
    }
  }
  renderAuth();
}

// Rafraîchit automatiquement les données quand l'app repasse au premier plan
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.token && state.client) {
    try {
      await loadClientData();
      renderDashboard();
    } catch (e) { /* silent */ }
  }
});

async function loadClientData() {
  const meRes = await api('/me');
  state.client = meRes.client;
  const [rewardsRes, historyRes] = await Promise.all([api('/rewards'), api('/history')]);
  state.rewards = rewardsRes.rewards;
  state.history = historyRes.visits;
}

/* ---------------- AUTH SCREEN ---------------- */
function renderAuth() {
  const isRegister = state.authMode === 'register';
  app.innerHTML = `
    <div class="screen">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Carte de fidélité digitale</p>
      </div>

      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}

      <form id="auth-form" style="margin-top:26px;">
        ${isRegister ? `
          <div class="field">
            <label for="prenom">Prénom</label>
            <input id="prenom" name="prenom" placeholder="Karim" required />
          </div>
          <div class="field">
            <label for="nom">Nom</label>
            <input id="nom" name="nom" placeholder="Haddad" required />
          </div>
        ` : ''}
        <div class="field">
          <label for="telephone">Téléphone</label>
          <input id="telephone" name="telephone" type="tel" placeholder="06 12 34 56 78" required />
        </div>
        <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '...' : (isRegister ? 'Créer mon compte' : 'Se connecter')}
        </button>
      </form>

      <div class="switch-mode">
        ${isRegister
          ? `Déjà client ? <button id="switch">Se connecter</button>`
          : `Nouveau chez Hairsprit ? <button id="switch">Créer un compte</button>`}
      </div>
    </div>
  `;

  document.getElementById('switch').onclick = () => {
    state.authMode = isRegister ? 'login' : 'register';
    state.error = null;
    renderAuth();
  };

  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    state.error = null;
    state.loading = true;
    renderAuth();
    const fd = new FormData(e.target);
    try {
      let res;
      if (isRegister) {
        res = await api('/register', {
          method: 'POST',
          body: JSON.stringify({
            nom: fd.get('nom'),
            prenom: fd.get('prenom'),
            telephone: fd.get('telephone'),
          }),
        });
      } else {
        res = await api('/login', {
          method: 'POST',
          body: JSON.stringify({ telephone: fd.get('telephone') }),
        });
      }
      saveToken(res.token);
      state.client = res.client;
      await loadClientData();
      state.loading = false;
      renderDashboard();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderAuth();
    }
  };
}

/* ---------------- DASHBOARD ---------------- */
async function toggleCardFlip() {
  state.cardFlipped = !state.cardFlipped;
  if (state.cardFlipped && !state.qrcode) {
    try {
      const res = await api('/qrcode');
      state.qrcode = res.qrcode;
    } catch (e) { /* silent */ }
  }
  renderDashboard();
}

function unlockedRewards() {
  return state.rewards.filter(r => state.client.points >= r.points_required);
}

function checkNewlyUnlockedRewards(client, rewards) {
  const key = `hairsprit_celebrated_${client.id}`;
  const previousMax = parseInt(localStorage.getItem(key) || '0', 10);
  const newlyUnlocked = rewards.filter(r => r.points_required <= client.points && r.points_required > previousMax);
  localStorage.setItem(key, String(client.points));
  return newlyUnlocked;
}

function showCelebration(rewards) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" style="text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🎉</div>
      <h3>Récompense débloquée !</h3>
      <div class="sub">Félicitations, vous pouvez maintenant profiter de :</div>
      ${rewards.map(r => `
        <div class="reward-card unlocked" style="margin-bottom:10px;text-align:left;">
          <div>
            <div class="reward-name">${r.name}</div>
            <div class="reward-desc">${r.description || ''}</div>
          </div>
          <span class="badge-unlocked">Débloqué</span>
        </div>
      `).join('')}
      <button class="btn btn-primary" id="close-celebration" style="margin-top:8px;">Super, merci !</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.querySelector('#close-celebration').onclick = () => backdrop.remove();
}

function renderDashboard() {
  const c = state.client;
  const initials = `${c.prenom[0] || ''}${c.nom[0] || ''}`.toUpperCase();
  const newlyUnlocked = checkNewlyUnlockedRewards(c, state.rewards);

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <img src="/logo.jpg" alt="Hairsprit" class="brand-logo" />
        <span class="tag">Membre</span>
      </div>
      <button class="icon-btn" id="logout-btn" title="Déconnexion">${icon('logout')}</button>
    </div>

    <div class="screen">
      <div class="card-stage">
        <div class="loyalty-card ${state.cardFlipped ? 'flipped' : ''}" id="loyalty-card">
          <div class="card-face front">
            <div class="card-top-row">
              <span class="card-logo">HAIRSPRIT</span>
              <div class="card-chip">${icon('scissors')}</div>
            </div>
            <div>
              <div class="card-name">${c.prenom} ${c.nom}</div>
            </div>
            <div class="card-bottom-row">
              <div>
                <div class="card-points-label">Points fidélité</div>
                <div class="card-points-value">${c.points}</div>
              </div>
              <div class="card-hint">Toucher pour<br>le QR code →</div>
            </div>
          </div>
          <div class="card-face back">
            ${state.qrcode ? `<img src="${state.qrcode}" alt="QR code fidélité" />` : `<div class="loading-spin"></div>`}
            <div class="back-label">Présentez ce code à votre barbier</div>
          </div>
        </div>
      </div>
      <div class="card-flip-note">${initials} · Carte n°${c.id.slice(0, 8).toUpperCase()}</div>

      <div class="section-title">Récompenses</div>
      <div class="rewards-grid">
        ${state.rewards.length === 0 ? `<div class="empty-state">Aucune récompense disponible pour le moment.</div>` : ''}
        ${state.rewards.map(r => {
          const unlocked = c.points >= r.points_required;
          return `
            <div class="reward-card ${unlocked ? 'unlocked' : ''}">
              <div>
                <div class="reward-name">${r.name}</div>
                <div class="reward-desc">${r.description || ''}</div>
              </div>
              ${unlocked
                ? `<span class="badge-unlocked">Débloqué</span>`
                : `<span class="reward-points">${r.points_required} pts</span>`}
            </div>
          `;
        }).join('')}
      </div>

      <div class="section-title">Historique des visites</div>
      <div class="history-list">
        ${state.history.length === 0 ? `<div class="empty-state">Aucune visite enregistrée pour l'instant.<br>Votre première coupe apparaîtra ici.</div>` : ''}
        ${state.history.map(v => `
          <div class="history-item">
            <div>
              <div>${v.note || 'Prestation en salon'}</div>
              <div class="date">${formatDate(v.created_at)}</div>
            </div>
            <div class="pts">+${v.points_added} pt${v.points_added > 1 ? 's' : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="book-cta">
      <button class="btn btn-primary" id="book-btn">${icon('calendar')} Réserver une coupe</button>
    </div>
  `;

  document.getElementById('loyalty-card').onclick = toggleCardFlip;
  document.getElementById('logout-btn').onclick = () => {
    clearToken();
    state.client = null;
    state.qrcode = null;
    state.cardFlipped = false;
    renderAuth();
  };
  document.getElementById('book-btn').onclick = openBookingSheet;

  if (newlyUnlocked.length > 0) {
    showCelebration(newlyUnlocked);
  }
}

function formatDate(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------------- BOOKING SHEET ---------------- */
function openBookingSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h3>Réserver une coupe</h3>
      <div class="sub">Précisez vos disponibilités, votre barbier vous recontactera pour confirmer.</div>
      <div id="booking-error"></div>
      <form id="booking-form">
        <div class="field">
          <label for="message">Message (jour, heure souhaitée, prestation...)</label>
          <textarea id="message" name="message" rows="3" placeholder="Ex : Samedi matin, taille de barbe + coupe"></textarea>
        </div>
        <button class="btn btn-primary" type="submit">Envoyer la demande</button>
        <button class="btn btn-ghost" type="button" id="cancel-booking" style="margin-top:10px;">Annuler</button>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.querySelector('#cancel-booking').onclick = () => backdrop.remove();

  backdrop.querySelector('#booking-form').onsubmit = async (e) => {
    e.preventDefault();
    const message = e.target.message.value;
    try {
      await api('/booking', { method: 'POST', body: JSON.stringify({ message }) });
      backdrop.querySelector('.sheet').innerHTML = `
        <h3>Demande envoyée ✓</h3>
        <div class="success-msg" style="margin-top:14px;">Votre demande a bien été transmise à Hairsprit. Vous serez recontacté pour confirmer votre rendez-vous.</div>
        <button class="btn btn-outline" id="close-sheet">Fermer</button>
      `;
      backdrop.querySelector('#close-sheet').onclick = () => backdrop.remove();
    } catch (err) {
      backdrop.querySelector('#booking-error').innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  };
}

init();
