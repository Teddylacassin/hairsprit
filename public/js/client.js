const API = '/api/client';
const app = document.getElementById('app');

const state = {
  token: localStorage.getItem('hairsprit_token') || null,
  client: null,
  rewards: [],
  history: [],
  bookings: [],
  services: [],
  qrcode: null,
  authMode: 'login', // 'login' | 'register'
  authStep: 'form', // 'form' | 'pin' | 'setup-pin'
  pendingPhone: null,
  loading: false,
  error: null,
  cardFlipped: false,
  dashboardTab: 'card',
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

// Versets bibliques (Louis Segond 1910, domaine public) associés à chaque tampon gagné
const BIBLE_VERSES = [
  '« Car Dieu a tant aimé le monde qu\'il a donné son Fils unique… » — Jean 3:16',
  '« Dieu prouve son amour envers nous, en ce que, lorsque nous étions encore des pécheurs, Christ est mort pour nous. » — Romains 5:8',
  '« Celui qui n\'aime pas n\'a pas connu Dieu, car Dieu est amour. » — 1 Jean 4:8',
  '« L\'amour de Dieu a été manifesté envers nous en ce que Dieu a envoyé son Fils unique dans le monde… » — 1 Jean 4:9',
  '« Cet amour consiste, non en ce que nous avons aimé Dieu, mais en ce qu\'il nous a aimés… » — 1 Jean 4:10',
  '« Dieu est amour; et celui qui demeure dans l\'amour demeure en Dieu… » — 1 Jean 4:16',
  '« Je t\'aime d\'un amour éternel; c\'est pourquoi je te conserve ma bonté. » — Jérémie 31:3',
  '« Parce que tu as du prix à mes yeux, parce que tu es honoré et que je t\'aime… » — Ésaïe 43:4',
  '« L\'Éternel, ton Dieu, est au milieu de toi… il fera de toi sa plus grande joie. » — Sophonie 3:17',
  '« Rien ne pourra nous séparer de l\'amour de Dieu manifesté en Jésus-Christ notre Seigneur. » — Romains 8:38-39',
  '« Ne crains rien, car je suis avec toi; ne promène pas des regards inquiets, car je suis ton Dieu. » — Ésaïe 41:10',
  '« Fortifie-toi et prends courage! Ne t\'effraie point, car l\'Éternel, ton Dieu, est avec toi… » — Josué 1:9',
  '« L\'Éternel lui-même marchera devant toi, il sera lui-même avec toi. » — Deutéronome 31:8',
  '« L\'Éternel est ma lumière et mon salut: de qui aurais-je crainte? » — Psaume 27:1',
  '« Fortifiez-vous et que votre cœur s\'affermisse, vous tous qui espérez en l\'Éternel! » — Psaume 31:25',
  '« Dieu est pour nous un refuge et un appui, un secours qui ne manque jamais dans la détresse. » — Psaume 46:2',
  '« Remets ton sort à l\'Éternel, et il te soutiendra. » — Psaume 55:23',
  '« Mon secours vient de l\'Éternel, qui a fait les cieux et la terre. » — Psaume 121:2',
  '« Je puis tout par celui qui me fortifie. » — Philippiens 4:13',
  '« Ce n\'est pas un esprit de timidité que Dieu nous a donné, mais un esprit de force, d\'amour et de sagesse. » — 2 Timothée 1:7',
  '« L\'Éternel est près de ceux qui ont le cœur brisé. » — Psaume 34:19',
  '« L\'Éternel délivre le juste de toutes ses détresses. » — Psaume 34:18',
  '« Quand je marche dans la vallée de l\'ombre de la mort, je ne crains aucun mal, car tu es avec moi. » — Psaume 23:4',
  '« Ceux qui connaissent ton nom se confient en toi. » — Psaume 9:10',
  '« Tu regardes cependant, car tu vois la peine et la souffrance. » — Psaume 10:14',
  '« Dans ma détresse, j\'ai invoqué l\'Éternel… » — Psaume 18:7',
  '« J\'avais mis en l\'Éternel mon espérance; et il s\'est incliné vers moi… » — Psaume 40:2-3',
  '« Pourquoi t\'abats-tu, mon âme? Espère en Dieu… » — Psaume 42:12',
  '« L\'Éternel est bon, il est un refuge au jour de la détresse. » — Nahum 1:7',
  '« Je vous laisse la paix, je vous donne ma paix. » — Jean 14:27',
  '« Ne vous inquiétez de rien; en toute chose faites connaître vos besoins à Dieu… » — Philippiens 4:6-7',
  '« À celui qui est ferme dans ses sentiments tu assures la paix, parce qu\'il se confie en toi. » — Ésaïe 26:3',
  '« Je me couche et aussitôt je m\'endors en paix, car toi seul, ô Éternel, tu me donnes la sécurité. » — Psaume 4:9',
  '« Que la paix de Christ règne dans vos cœurs. » — Colossiens 3:15',
  '« Que le Seigneur de la paix vous donne lui-même la paix en tout temps! » — 2 Thessaloniciens 3:16',
  '« Que le Dieu de l\'espérance vous remplisse de toute joie et de toute paix dans la foi. » — Romains 15:13',
  '« L\'Éternel donne la force à son peuple; l\'Éternel bénit son peuple et le rend heureux. » — Psaume 29:11',
  '« Confie-toi en l\'Éternel de tout ton cœur… » — Proverbes 3:5-6',
  '« Venez à moi, vous tous qui êtes fatigués et chargés, et je vous donnerai du repos. » — Matthieu 11:28',
  '« Je connais les projets que j\'ai formés sur vous… un avenir et de l\'espérance. » — Jérémie 29:11',
  '« Toutes choses concourent au bien de ceux qui aiment Dieu. » — Romains 8:28',
  '« Réjouissez-vous en espérance. Soyez patients dans l\'affliction. » — Romains 12:12',
  '« Retenons fermement la profession de notre espérance, car celui qui a fait la promesse est fidèle. » — Hébreux 10:23',
  '« Espère en Dieu, car je le louerai encore. » — Psaume 42:6',
  '« J\'espère en l\'Éternel, mon âme espère… » — Psaume 130:5',
  '« Les bontés de l\'Éternel ne sont pas épuisées… elles se renouvellent chaque matin. » — Lamentations 3:22-23',
  '« Ceux qui se confient en l\'Éternel renouvellent leur force. » — Ésaïe 40:31',
  '« Car tu es mon espérance, Seigneur Éternel! » — Psaume 71:5',
  '« Le Dieu de toute grâce vous affermira, vous fortifiera, vous rendra inébranlables. » — 1 Pierre 5:10',
  '« Recommande ton sort à l\'Éternel, mets en lui ta confiance, et il agira. » — Psaume 37:5',
  '« Je me confie en Dieu, je ne crains rien. » — Psaume 56:4',
  '« Confiez-vous en lui en tout temps; répandez vos cœurs en sa présence! » — Psaume 62:9',
  '« Recommande à l\'Éternel tes œuvres, et tes projets réussiront. » — Proverbes 16:3',
  '« Le nom de l\'Éternel est une tour forte; le juste s\'y réfugie. » — Proverbes 18:10',
  '« Je dis à l\'Éternel: Mon refuge et ma forteresse, mon Dieu en qui je me confie! » — Psaume 91:2',
  '« Il ne craint point les mauvaises nouvelles; son cœur est ferme, confiant en l\'Éternel. » — Psaume 112:7',
  '« Ceux qui se confient en l\'Éternel sont comme la montagne de Sion. » — Psaume 125:1',
  '« Dieu est ma délivrance, je serai plein de confiance, et je ne craindrai rien. » — Ésaïe 12:2',
  '« L\'Éternel est pour moi, je ne crains rien. » — Psaume 118:6',
  '« L\'Éternel est miséricordieux et compatissant, lent à la colère et riche en bonté. » — Psaume 103:8',
  '« Autant l\'orient est éloigné de l\'occident, autant il éloigne de nous nos transgressions. » — Psaume 103:12',
  '« Si vos péchés sont comme le cramoisi, ils deviendront blancs comme la neige. » — Ésaïe 1:18',
  '« Quel Dieu est semblable à toi, qui pardonnes l\'iniquité… » — Michée 7:18',
  '« Si nous confessons nos péchés, il est fidèle et juste pour nous les pardonner. » — 1 Jean 1:9',
  '« En lui nous avons la rédemption par son sang, le pardon des péchés. » — Éphésiens 1:7',
  '« Pardonnez-vous réciproquement, comme Christ vous a pardonné. » — Colossiens 3:13',
  '« Soyez donc miséricordieux, comme votre Père est miséricordieux. » — Luc 6:36',
  '« Repentez-vous donc et convertissez-vous, pour que vos péchés soient effacés. » — Actes 3:19',
  '« Heureux celui à qui la transgression est remise, à qui le péché est pardonné! » — Psaume 32:1',
  '« Fortifiez-vous et ayez du courage! L\'Éternel, ton Dieu, marchera lui-même avec toi. » — Deutéronome 31:6',
  '« L\'Éternel agira en ma faveur. » — Psaume 138:8',
  '« Si tu traverses les eaux, je serai avec toi… » — Ésaïe 43:2',
  '« L\'Éternel est mon rocher, ma forteresse, mon libérateur. » — Psaume 18:3',
  '« L\'Éternel est ma force et mon bouclier; en lui mon cœur se confie. » — Psaume 28:7',
  '« Arrêtez, et sachez que je suis Dieu. » — Psaume 46:11',
  '« Fortifiez-vous dans le Seigneur, et par sa force toute-puissante. » — Éphésiens 6:10',
  '« Veillez, demeurez fermes dans la foi, soyez des hommes, fortifiez-vous. » — 1 Corinthiens 16:13',
  '« Le Seigneur est mon aide, je ne craindrai rien. » — Hébreux 13:6',
  '« Ma grâce te suffit, car ma puissance s\'accomplit dans la faiblesse. » — 2 Corinthiens 12:9',
  '« Le soir arrivent les pleurs, et le matin l\'allégresse. » — Psaume 30:6',
  '« Il y a d\'abondantes joies devant ta face. » — Psaume 16:11',
  '« C\'est ici la journée que l\'Éternel a faite: qu\'elle soit pour nous un sujet de joie! » — Psaume 118:24',
  '« La joie de l\'Éternel sera votre force. » — Néhémie 8:10',
  '« Un cœur joyeux est un bon remède. » — Proverbes 17:22',
  '« Ne nous lassons pas de faire le bien. » — Galates 6:9',
  '« Faisons du bien à tous, et surtout à ceux qui sont de la famille de la foi. » — Galates 6:10',
  '« Que votre lumière luise ainsi devant les hommes, afin qu\'ils voient vos bonnes œuvres. » — Matthieu 5:16',
  '« N\'oubliez pas la bienfaisance et la libéralité. » — Hébreux 13:16',
  '« Soyez toujours joyeux. » — 1 Thessaloniciens 5:16',
  '« L\'Éternel est mon berger: je ne manquerai de rien. » — Psaume 23:1',
  '« L\'Éternel te gardera de tout mal, il gardera ton âme. » — Psaume 121:7',
  '« L\'Éternel gardera ton départ et ton arrivée, dès maintenant et à jamais. » — Psaume 121:8',
  '« Il guérit ceux qui ont le cœur brisé, et il panse leurs blessures. » — Psaume 147:3',
  '« Il donne de la force à celui qui est fatigué, et augmente la vigueur de celui qui tombe en défaillance. » — Ésaïe 40:29',
  '« Ne vous inquiétez donc pas du lendemain… » — Matthieu 6:34',
  '« Déchargez-vous sur lui de tous vos soucis, car lui-même prend soin de vous. » — 1 Pierre 5:7',
  '« Celui qui a commencé en vous cette bonne œuvre la rendra parfaite. » — Philippiens 1:6',
  '« Sentez et voyez combien l\'Éternel est bon! Heureux l\'homme qui cherche en lui son refuge! » — Psaume 34:9',
  '« Que le Dieu de la persévérance et de la consolation vous donne d\'avoir les mêmes sentiments les uns envers les autres. » — Romains 15:5',
];

function icon(name) {
  const icons = {
    scissors: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="12" rx="2"/><line x1="9" y1="15" x2="9" y2="20"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="15" y1="15" x2="15" y2="20"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
    logout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    calendar: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
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
  const [rewardsRes, historyRes, bookingsRes, servicesRes] = await Promise.all([api('/rewards'), api('/history'), api('/bookings'), api('/services')]);
  state.rewards = rewardsRes.rewards;
  state.history = historyRes.visits;
  state.bookings = bookingsRes.bookings;
  state.services = servicesRes.services;
}

/* ---------------- AUTH SCREEN ---------------- */
function renderAuth() {
  if (state.authMode === 'register') return renderAuthRegister();
  if (state.authStep === 'pin') return renderAuthPin();
  if (state.authStep === 'setup-pin') return renderAuthSetupPin();
  return renderAuthPhone();
}

function renderAuthPhone() {
  app.innerHTML = `
    <div class="screen">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Carte de fidélité digitale</p>
      </div>

      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}

      <form id="phone-form" style="margin-top:26px;">
        <div class="field">
          <label for="telephone">Téléphone</label>
          <input id="telephone" name="telephone" type="tel" placeholder="06 12 34 56 78" required />
        </div>
        <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '...' : 'Continuer'}
        </button>
      </form>

      <div class="switch-mode">
        Nouveau chez Hairsprit ? <button id="switch">Créer un compte</button>
      </div>
    </div>
  `;

  document.getElementById('switch').onclick = () => {
    state.authMode = 'register';
    state.error = null;
    renderAuth();
  };

  document.getElementById('phone-form').onsubmit = async (e) => {
    e.preventDefault();
    state.error = null;
    state.loading = true;
    renderAuth();
    const fd = new FormData(e.target);
    const telephone = fd.get('telephone');
    try {
      const res = await api('/check-phone', { method: 'POST', body: JSON.stringify({ telephone }) });
      state.pendingPhone = telephone;
      state.authStep = res.needsPinSetup ? 'setup-pin' : 'pin';
      state.loading = false;
      renderAuth();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderAuth();
    }
  };
}

function renderAuthPin() {
  app.innerHTML = `
    <div class="screen">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Entrez votre code PIN</p>
      </div>

      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}

      <form id="pin-form" style="margin-top:26px;">
        <div class="field">
          <label for="pin">Code PIN (4 chiffres)</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required autofocus />
        </div>
        <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '...' : 'Se connecter'}
        </button>
        <button class="btn btn-ghost" type="button" id="back-btn" style="margin-top:10px;">← Changer de numéro</button>
      </form>
    </div>
  `;

  document.getElementById('back-btn').onclick = () => {
    state.authStep = 'form';
    state.error = null;
    renderAuth();
  };

  document.getElementById('pin-form').onsubmit = async (e) => {
    e.preventDefault();
    state.error = null;
    state.loading = true;
    renderAuth();
    const fd = new FormData(e.target);
    try {
      const res = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ telephone: state.pendingPhone, pin: fd.get('pin') }),
      });
      saveToken(res.token);
      state.client = res.client;
      await loadClientData();
      state.loading = false;
      state.authStep = 'form';
      renderDashboard();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderAuth();
    }
  };
}

function renderAuthSetupPin() {
  app.innerHTML = `
    <div class="screen">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Créez votre code PIN</p>
      </div>
      <div class="sub" style="text-align:center;color:var(--argent);font-size:13px;margin-bottom:10px;">
        C'est la première fois qu'on ajoute cette sécurité. Choisissez un code à 4 chiffres pour protéger votre compte.
      </div>

      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}

      <form id="setup-pin-form" style="margin-top:16px;">
        <div class="field">
          <label for="pin">Nouveau code PIN (4 chiffres)</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required autofocus />
        </div>
        <div class="field">
          <label for="pin2">Confirmez le code PIN</label>
          <input id="pin2" name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required />
        </div>
        <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '...' : 'Valider'}
        </button>
        <button class="btn btn-ghost" type="button" id="back-btn" style="margin-top:10px;">← Changer de numéro</button>
      </form>
    </div>
  `;

  document.getElementById('back-btn').onclick = () => {
    state.authStep = 'form';
    state.error = null;
    renderAuth();
  };

  document.getElementById('setup-pin-form').onsubmit = async (e) => {
    e.preventDefault();
    state.error = null;
    const fd = new FormData(e.target);
    const pin = fd.get('pin');
    const pin2 = fd.get('pin2');
    if (pin !== pin2) {
      state.error = 'Les deux codes ne correspondent pas.';
      renderAuth();
      return;
    }
    state.loading = true;
    renderAuth();
    try {
      const res = await api('/set-pin', {
        method: 'POST',
        body: JSON.stringify({ telephone: state.pendingPhone, pin }),
      });
      saveToken(res.token);
      state.client = res.client;
      await loadClientData();
      state.loading = false;
      state.authStep = 'form';
      renderDashboard();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderAuth();
    }
  };
}

function renderAuthRegister() {
  app.innerHTML = `
    <div class="screen">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Carte de fidélité digitale</p>
      </div>

      ${state.referralCode ? `<div class="success-msg">🎁 Vous avez été invité(e) par un ami — vous recevrez 1 point bonus à l'inscription !</div>` : ''}
      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}

      <form id="auth-form" style="margin-top:26px;">
        <div class="field">
          <label for="prenom">Prénom</label>
          <input id="prenom" name="prenom" placeholder="Karim" required />
        </div>
        <div class="field">
          <label for="nom">Nom</label>
          <input id="nom" name="nom" placeholder="Haddad" required />
        </div>
        <div class="field">
          <label for="address">Adresse (optionnel, pour prestation à domicile)</label>
          <input id="address" name="address" placeholder="12 rue des Lilas, 75011 Paris" />
        </div>
        <div class="field">
          <label for="telephone">Téléphone</label>
          <input id="telephone" name="telephone" type="tel" placeholder="06 12 34 56 78" required />
        </div>
        <div class="field">
          <label for="pin">Code PIN (4 chiffres, pour protéger votre compte)</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required />
        </div>
        <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '...' : 'Créer mon compte'}
        </button>
      </form>

      <div class="switch-mode">
        Déjà client ? <button id="switch">Se connecter</button>
      </div>
    </div>
  `;

  document.getElementById('switch').onclick = () => {
    state.authMode = 'login';
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
      const res = await api('/register', {
        method: 'POST',
        body: JSON.stringify({
          nom: fd.get('nom'),
          prenom: fd.get('prenom'),
          telephone: fd.get('telephone'),
          address: fd.get('address'),
          pin: fd.get('pin'),
          ref: state.referralCode || undefined,
        }),
      });
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

/* ---------------- TEMPS RÉEL (nouveau tampon en direct) ---------------- */
function connectPointsStream() {
  if (state.eventSource) return; // déjà connecté
  try {
    const es = new EventSource(`${API}/points-stream?token=${encodeURIComponent(state.token)}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'point_added') {
          state.client.points = data.points;
          playStampCelebration();
          if (state.dashboardTab === 'card') renderDashboardTabContent();
        } else if (data.type === 'reset') {
          state.client.points = data.points;
          if (state.dashboardTab === 'card') renderDashboardTabContent();
        }
      } catch (err) { /* silent */ }
    };
    es.onerror = () => {
      // La connexion se rétablit automatiquement ; rien à faire ici.
    };
    state.eventSource = es;
  } catch (e) { /* EventSource non disponible, tant pis */ }
}

function playStampCelebration() {
  const overlay = document.createElement('div');
  overlay.className = 'stamp-celebration';
  const emojis = ['✂️', '🎉', '⭐', '✨'];
  let confetti = '';
  for (let i = 0; i < 18; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    confetti += `<span class="confetti-piece" style="left:${left}%;animation-delay:${delay}s;">${emoji}</span>`;
  }
  overlay.innerHTML = `
    ${confetti}
    <div class="stamp-celebration-badge">
      <div class="stamp-celebration-icon">✂️</div>
      <div class="stamp-celebration-text">Nouveau tampon !</div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (navigator.vibrate) { try { navigator.vibrate([40, 30, 40]); } catch (e) {} }
  setTimeout(() => overlay.remove(), 2200);
}

function celebrateRewardTap(rewardName) {
  const overlay = document.createElement('div');
  overlay.className = 'stamp-celebration';
  const emojis = ['🎁', '🎉', '⭐', '✨', '🏆'];
  let confetti = '';
  for (let i = 0; i < 22; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    confetti += `<span class="confetti-piece" style="left:${left}%;animation-delay:${delay}s;">${emoji}</span>`;
  }
  overlay.innerHTML = `
    ${confetti}
    <div class="stamp-celebration-badge">
      <div class="stamp-celebration-icon">🎁</div>
      <div class="stamp-celebration-text">${rewardName}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (navigator.vibrate) { try { navigator.vibrate([30, 20, 30, 20, 60]); } catch (e) {} }
  setTimeout(() => overlay.remove(), 1800);
}

function shakeLockedReward(card, remaining) {
  card.classList.add('reward-shake');
  if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
  const existingHint = card.querySelector('.reward-hint');
  if (existingHint) existingHint.remove();
  const hint = document.createElement('div');
  hint.className = 'reward-hint';
  hint.textContent = `🔒 Encore ${remaining} point${remaining > 1 ? 's' : ''} !`;
  card.appendChild(hint);
  setTimeout(() => {
    card.classList.remove('reward-shake');
    hint.remove();
  }, 1400);
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

function checkBookingStatusChanges(client, bookings) {
  const key = `hairsprit_booking_status_${client.id}`;
  const previousMap = JSON.parse(localStorage.getItem(key) || '{}');
  const changed = [];
  bookings.forEach(b => {
    const prevStatus = previousMap[b.id];
    if ((b.status === 'confirme' || b.status === 'annule') && prevStatus !== b.status) {
      changed.push(b);
    }
  });
  const newMap = {};
  bookings.forEach(b => { newMap[b.id] = b.status; });
  localStorage.setItem(key, JSON.stringify(newMap));
  return changed;
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

function showBookingNotification(bookings) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" style="text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">${bookings[0].status === 'confirme' ? '✅' : 'ℹ️'}</div>
      <h3>${bookings.length > 1 ? 'Mise à jour de vos réservations' : (bookings[0].status === 'confirme' ? 'Réservation confirmée !' : 'Réservation annulée')}</h3>
      ${bookings.map(b => `
        <div class="history-item" style="text-align:left;margin-top:10px;">
          <div>
            <div>${b.slot_datetime ? formatDate(b.slot_datetime) : (b.message || 'Votre demande')}</div>
          </div>
          <span class="pill status-${b.status}">${b.status.replace('_', ' ')}</span>
        </div>
      `).join('')}
      <button class="btn btn-primary" id="close-booking-notif" style="margin-top:14px;">OK</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.querySelector('#close-booking-notif').onclick = () => backdrop.remove();
}

const DASHBOARD_TABS = [
  { id: 'card', label: 'Carte' },
  { id: 'services', label: 'Tarifs' },
  { id: 'rewards', label: 'Récompenses' },
  { id: 'bookings', label: 'Réservations' },
  { id: 'history', label: 'Historique' },
];

function renderDashboard() {
  const c = state.client;
  const newlyUnlocked = checkNewlyUnlockedRewards(c, state.rewards);
  const bookingChanges = checkBookingStatusChanges(c, state.bookings);
  connectPointsStream();

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <img src="/logo.jpg" alt="Hairsprit" class="brand-logo" />
        <span class="tag">Membre</span>
      </div>
      <div style="display:flex;">
        <button class="icon-btn" id="edit-address-btn" title="Modifier mon adresse" style="margin-right:8px;">${icon('pin')}</button>
        <button class="icon-btn" id="logout-btn" title="Déconnexion">${icon('logout')}</button>
      </div>
    </div>

    <div class="admin-nav" style="padding:0 20px;margin-bottom:6px;flex-direction:row;overflow-x:auto;">
      ${DASHBOARD_TABS.map(t => `<button data-tab="${t.id}" class="${state.dashboardTab === t.id ? 'active' : ''}" style="white-space:nowrap;">${t.label}</button>`).join('')}
    </div>

    <div class="screen" id="dashboard-content"></div>

    <div class="book-cta">
      <button class="btn btn-primary" id="book-btn">${icon('calendar')} Réserver une coupe</button>
    </div>
  `;

  document.querySelectorAll('.admin-nav button').forEach(btn => {
    btn.onclick = () => {
      state.dashboardTab = btn.dataset.tab;
      renderDashboard();
    };
  });
  document.getElementById('edit-address-btn').onclick = openAddressSheet;
  document.getElementById('logout-btn').onclick = () => {
    if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    clearToken();
    state.client = null;
    state.qrcode = null;
    state.cardFlipped = false;
    renderAuth();
  };
  document.getElementById('book-btn').onclick = openBookingSheet;

  renderDashboardTabContent();

  if (bookingChanges.length > 0) {
    showBookingNotification(bookingChanges);
  } else if (newlyUnlocked.length > 0) {
    showCelebration(newlyUnlocked);
  }
}

function renderDashboardTabContent() {
  const c = state.client;
  const zone = document.getElementById('dashboard-content');
  if (!zone) return;

  if (state.dashboardTab === 'card') {
    const initials = `${c.prenom[0] || ''}${c.nom[0] || ''}`.toUpperCase();
    const activeThresholds = state.rewards.filter(r => r.points_required > 0).map(r => r.points_required);
    const nextThreshold = activeThresholds.filter(t => t > c.points).sort((a, b) => a - b)[0];
    const stampGoal = Math.max(nextThreshold || 0, ...activeThresholds, c.points, 10);
    const remaining = nextThreshold ? nextThreshold - c.points : 0;
    const walkPercent = Math.min(96, Math.max(4, Math.round((c.points / stampGoal) * 100)));
    const isHappy = c.points > 0 && activeThresholds.includes(c.points);
    const milestonesHtml = activeThresholds.filter(t => t <= stampGoal).map(t => {
      const pos = Math.min(100, Math.round((t / stampGoal) * 100));
      const reached = c.points >= t;
      return `<div class="milestone ${reached ? 'reached' : ''}" style="left:${pos}%;" title="${t} points"></div>`;
    }).join('');
    zone.innerHTML = `
      <div class="card-stage">
        <div class="loyalty-card ${state.cardFlipped ? 'flipped' : ''}" id="loyalty-card">
          <div class="card-face front">
            <div class="card-top-row">
              <span class="card-logo">HAIRSPRIT</span>
              <div class="card-chip"><img src="/logo.jpg" alt="" class="card-chip-logo" /></div>
            </div>
            <div>
              <div class="card-name">${c.prenom} ${c.nom}</div>
            </div>
            <div class="path-wrap">
              <div class="path-line"></div>
              <div class="path-progress" style="width:${walkPercent}%;"></div>
              ${milestonesHtml}
              <div class="house">🏆</div>
              ${!isHappy ? `<div class="puff puff1" style="left:${Math.max(0, walkPercent - 9)}%;"></div><div class="puff puff2" style="left:${Math.max(0, walkPercent - 12)}%;"></div>` : `
                <div class="sparkle" style="left:${walkPercent - 6}%;top:14px;--dx:-14px;--dy:-10px;">✨</div>
                <div class="sparkle" style="left:${walkPercent + 6}%;top:18px;--dx:12px;--dy:-14px;animation-delay:0.3s;">⭐</div>
                <div class="honk" style="left:${walkPercent - 5}%;top:0;">Toot!</div>
              `}
              <div class="van ${isHappy ? 'happy' : 'driving'}" style="left:${walkPercent}%;">
                <svg viewBox="0 0 36 26" fill="none">
                  <path class="van-body" d="M2 10 L2 20 L34 20 L34 12 L26 12 L22 6 L8 6 L2 10 Z"/>
                  <rect x="9" y="8" width="7" height="5" rx="1" fill="#cfe8ff"/>
                  <rect x="18" y="8" width="6" height="5" rx="1" fill="#cfe8ff"/>
                  <circle class="wheel" cx="10" cy="20" r="3.4" fill="#111"/>
                  <circle class="wheel" cx="27" cy="20" r="3.4" fill="#111"/>
                  <circle cx="10" cy="20" r="1.2" fill="#666"/>
                  <circle cx="27" cy="20" r="1.2" fill="#666"/>
                </svg>
              </div>
            </div>
            <div class="pole-row">
              <div class="pole-info">
                <div class="pole-pts">${c.points} <span class="pole-total">/ ${stampGoal}</span></div>
                ${remaining > 0 ? `<div class="pole-caption">✂️ Plus que ${remaining} coupe${remaining > 1 ? 's' : ''}</div><div class="pole-sub">avant ta récompense !</div>` : (c.points > 0 ? `<div class="pole-caption">🎉 Récompense débloquée !</div>` : '')}
              </div>
            </div>
            ${c.points > 0 ? `<div class="verse-caption">${BIBLE_VERSES[Math.floor(Math.random() * BIBLE_VERSES.length)]}</div>` : ''}
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
      <a href="https://g.page/r/CRa_yp8Pnc2EEBM/review" target="_blank" rel="noopener" class="btn btn-outline" style="text-decoration:none;text-align:center;display:block;margin-bottom:10px;">
        ⭐ Laisser un avis Google
      </a>
      <button class="btn btn-outline" id="open-referral-btn" style="text-align:center;display:block;">
        🎁 Parrainer un ami
      </button>
    `;
    document.getElementById('loyalty-card').onclick = toggleCardFlip;
    document.getElementById('open-referral-btn').onclick = openReferralSheet;
    return;
  }

  if (state.dashboardTab === 'services') {
    zone.innerHTML = `
      <div class="section-title" style="margin-top:0;">Tarifs</div>
      ${state.services.length === 0 ? `<div class="empty-state">Aucun tarif renseigné pour le moment.</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${state.services.map(s => `
          <div class="history-item">
            <div>
              <div>${s.name}</div>
              ${s.description ? `<div class="date">${s.description}</div>` : ''}
            </div>
            <div class="pts">${parseFloat(s.price).toFixed(2)}€</div>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  if (state.dashboardTab === 'rewards') {
    zone.innerHTML = `
      <div class="section-title" style="margin-top:0;">Récompenses</div>
      <div class="rewards-grid">
        ${state.rewards.length === 0 ? `<div class="empty-state">Aucune récompense disponible pour le moment.</div>` : ''}
        ${state.rewards.map(r => {
          const unlocked = c.points >= r.points_required;
          const remaining = Math.max(0, r.points_required - c.points);
          return `
            <div class="reward-card ${unlocked ? 'unlocked' : ''}" data-reward-id="${r.id}" data-unlocked="${unlocked}" data-remaining="${remaining}" data-name="${r.name.replace(/"/g, '&quot;')}" style="cursor:pointer;">
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
    `;
    zone.querySelectorAll('.reward-card[data-reward-id]').forEach(card => {
      card.onclick = () => {
        if (card.dataset.unlocked === 'true') {
          celebrateRewardTap(card.dataset.name);
        } else {
          shakeLockedReward(card, parseInt(card.dataset.remaining, 10));
        }
      };
    });
    return;
  }

  if (state.dashboardTab === 'bookings') {
    const visibleBookings = state.bookings.filter(b => b.status !== 'annule');
    zone.innerHTML = `
      <div class="section-title" style="margin-top:0;">Mes réservations</div>
      ${visibleBookings.length === 0 ? `<div class="empty-state">Aucune réservation pour le moment.<br>Utilisez le bouton en bas pour réserver une coupe.</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${visibleBookings.map(b => `
          <div class="history-item" data-id="${b.id}" style="align-items:flex-start;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;">
              <div>
                <div>${b.slot_datetime ? formatDate(b.slot_datetime) : (b.message || 'Demande de réservation')}</div>
                ${b.people_count > 1 ? `<div class="date">👥 ${b.people_count} personnes</div>` : ''}
                ${b.booking_details ? `<div class="date">${b.booking_details}</div>` : (b.service_name ? `<div class="date">${b.service_name} · ${parseFloat(b.service_price).toFixed(2)}€</div>` : '')}
                ${b.slot_datetime && b.message ? `<div class="date">${b.message}</div>` : ''}
              </div>
              <span class="pill status-${b.status}">${b.status.replace('_', ' ')}</span>
            </div>
            <button class="btn btn-outline cancel-booking-btn" style="width:auto;padding:8px 14px;font-size:12.5px;">Annuler cette réservation</button>
          </div>
        `).join('')}
      </div>
    `;
    zone.querySelectorAll('.cancel-booking-btn').forEach(btn => {
      btn.onclick = async () => {
        const row = btn.closest('[data-id]');
        const bookingId = row.dataset.id;
        if (!confirm('Confirmer l\'annulation de cette réservation ?')) return;
        btn.disabled = true;
        btn.textContent = 'Annulation...';
        try {
          await api(`/booking/${bookingId}/cancel`, { method: 'PUT' });
          const bookingsRes = await api('/bookings');
          state.bookings = bookingsRes.bookings;
          renderDashboardTabContent();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Annuler cette réservation';
          alert(err.message);
        }
      };
    });
    return;
  }

  if (state.dashboardTab === 'history') {
    zone.innerHTML = `
      <div class="section-title" style="margin-top:0;">Historique des visites</div>
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
    `;
  }
}

function formatDate(iso) {
  let s = iso;
  if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------------- REFERRAL SHEET ---------------- */
async function openReferralSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" style="text-align:center;">
      <h3>Parrainer un ami</h3>
      <div class="sub">Montrez ce QR code à un ami. Quand il crée son compte, vous recevez chacun 1 point bonus !</div>
      <div id="referral-zone"><div class="loading-spin"></div></div>
      <button class="btn btn-ghost" id="close-referral" style="margin-top:14px;">Fermer</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.querySelector('#close-referral').onclick = () => backdrop.remove();

  const zone = backdrop.querySelector('#referral-zone');
  try {
    const res = await api('/referral-qrcode');
    zone.innerHTML = `
      <img src="${res.qrcode}" alt="QR code de parrainage" style="width:200px;height:200px;margin:16px auto;display:block;border-radius:12px;" />
      <div style="background:var(--panel);border:1px solid var(--ligne);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--argent);word-break:break-all;margin-bottom:10px;">${res.url}</div>
      <button class="btn btn-outline" id="share-referral-btn">Copier le lien</button>
    `;
    const shareBtn = zone.querySelector('#share-referral-btn');
    shareBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(res.url);
        shareBtn.textContent = '✓ Lien copié !';
        setTimeout(() => { shareBtn.textContent = 'Copier le lien'; }, 1500);
      } catch (e) {
        alert(res.url);
      }
    };
  } catch (err) {
    zone.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

/* ---------------- ADDRESS SHEET ---------------- */
function openAddressSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h3>Mon adresse</h3>
      <div class="sub">Utilisée pour les prestations à domicile.</div>
      <div id="address-error"></div>
      <form id="address-form">
        <div class="field">
          <label for="address-input">Adresse</label>
          <input id="address-input" name="address" placeholder="12 rue des Lilas, 75011 Paris" value="${(state.client.address || '').replace(/"/g, '&quot;')}" />
        </div>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <button class="btn btn-ghost" type="button" id="cancel-address" style="margin-top:10px;">Annuler</button>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.querySelector('#cancel-address').onclick = () => backdrop.remove();

  backdrop.querySelector('#address-form').onsubmit = async (e) => {
    e.preventDefault();
    const address = e.target.address.value;
    try {
      const res = await api('/me', { method: 'PUT', body: JSON.stringify({ address }) });
      state.client = res.client;
      backdrop.remove();
      renderDashboard();
    } catch (err) {
      backdrop.querySelector('#address-error').innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  };
}

/* ---------------- BOOKING SHEET ---------------- */
function openBookingSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h3>Réserver une coupe</h3>
      <div class="sub">Combien de personnes, et quelle prestation pour chacune ?</div>
      <div id="booking-error"></div>
      <div id="slots-zone"><div class="loading-spin"></div></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

  let selectedSlot = null;
  let peopleCount = 1;
  let personServiceIds = [];
  let allServices = [];

  function personPrice(s) {
    if (!s) return 0;
    if (peopleCount >= 3 && s.group_price != null && s.group_price !== '') return parseFloat(s.group_price);
    return parseFloat(s.price);
  }
  function totalDuration() {
    return personServiceIds.reduce((sum, sid) => {
      const s = allServices.find(sv => sv.id === sid);
      return sum + (s ? s.duration_minutes : 30);
    }, 0);
  }
  function totalPrice() {
    return personServiceIds.reduce((sum, sid) => {
      const s = allServices.find(sv => sv.id === sid);
      return sum + personPrice(s);
    }, 0);
  }
  function bookingDetailsText() {
    return personServiceIds.map((sid, i) => {
      const s = allServices.find(sv => sv.id === sid);
      return `Personne ${i + 1} : ${s ? s.name : 'Prestation'} (${personPrice(s).toFixed(2)}€, ${s ? s.duration_minutes : 30}min)`;
    }).join(' · ');
  }

  async function loadPeopleAndServices() {
    const zone = backdrop.querySelector('#slots-zone');
    try {
      const servicesRes = await api('/services');
      allServices = servicesRes.services;
    } catch (e) { allServices = []; }

    if (allServices.length === 0) {
      // Pas de tarifs configurés : on passe directement au choix du créneau (durée standard)
      loadSlots(zone);
      return;
    }

    if (personServiceIds.length !== peopleCount) {
      personServiceIds = Array.from({ length: peopleCount }, (_, i) => personServiceIds[i] || allServices[0].id);
    }

    zone.innerHTML = `
      <div class="section-title" style="margin-top:0;">Combien de personnes ?</div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <button type="button" class="btn btn-outline" id="people-minus" style="width:44px;">−</button>
        <span style="font-family:var(--font-mono);font-size:20px;min-width:24px;text-align:center;">${peopleCount}</span>
        <button type="button" class="btn btn-outline" id="people-plus" style="width:44px;">+</button>
      </div>
      ${peopleCount >= 3 ? `<div style="color:var(--succes);font-size:12.5px;margin-bottom:14px;">🎉 Tarif groupe appliqué (3 personnes ou plus)</div>` : ''}
      ${personServiceIds.map((sid, i) => `
        <div class="field">
          <label>Prestation — Personne ${i + 1}</label>
          <select class="person-service-select" data-index="${i}" style="width:100%;background:var(--panel);border:1px solid var(--ligne);color:var(--blanc);padding:12px 14px;border-radius:10px;font-size:14px;">
            ${allServices.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${s.name} — ${personPrice(s).toFixed(2)}€${peopleCount >= 3 && s.group_price != null ? ' (groupe)' : ''} (${s.duration_minutes}min)</option>`).join('')}
          </select>
        </div>
      `).join('')}
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--argent);margin:10px 0 18px;">
        <span>Durée totale estimée</span>
        <span style="font-family:var(--font-mono);color:var(--argent-clair);">${totalDuration()} min · ${totalPrice().toFixed(2)}€</span>
      </div>
      <button class="btn btn-primary" id="see-slots-btn">Voir les créneaux disponibles</button>
    `;

    zone.querySelector('#people-minus').onclick = () => {
      if (peopleCount > 1) { peopleCount--; loadPeopleAndServices(); }
    };
    zone.querySelector('#people-plus').onclick = () => {
      if (peopleCount < 6) { peopleCount++; loadPeopleAndServices(); }
    };
    zone.querySelectorAll('.person-service-select').forEach(sel => {
      sel.onchange = () => {
        personServiceIds[parseInt(sel.dataset.index, 10)] = sel.value;
        loadPeopleAndServices();
      };
    });
    zone.querySelector('#see-slots-btn').onclick = () => loadSlots(zone);
  }

  async function loadSlots(zone) {
    const duration = allServices.length > 0 ? totalDuration() : null;
    zone.innerHTML = `<div class="loading-spin"></div>`;
    try {
      const res = await api(`/available-slots${duration ? `?duration=${duration}` : ''}`);
      if (res.slots.length === 0) {
        zone.innerHTML = `<div class="empty-state">Aucun créneau disponible pour cette durée. Essayez avec moins de personnes, ou contactez le salon directement.</div>
          <button class="btn btn-ghost" id="back-to-people" style="margin-top:14px;">← Retour</button>`;
        zone.querySelector('#back-to-people').onclick = () => loadPeopleAndServices();
        return;
      }
      const byDay = {};
      res.slots.forEach(iso => {
        const d = new Date(iso);
        const dayKey = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        if (!byDay[dayKey]) byDay[dayKey] = [];
        byDay[dayKey].push(iso);
      });
      zone.innerHTML = `
        ${allServices.length > 0 ? `<div class="section-title" style="margin-top:0;">${peopleCount > 1 ? `${peopleCount} personnes` : bookingDetailsText()} · ${res.durationMinutes} min</div>` : ''}
        <div style="max-height:340px;overflow-y:auto;">
          ${Object.entries(byDay).map(([day, slots]) => `
            <div class="section-title" style="margin-top:16px;">${day}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${slots.map(iso => `
                <button type="button" class="btn btn-outline slot-btn" data-slot="${iso}" style="width:auto;padding:10px 14px;font-size:13px;">
                  ${new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </button>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div class="field" style="margin-top:18px;">
          <label for="message">Message (optionnel)</label>
          <textarea id="message" name="message" rows="2" placeholder="Précision sur la prestation..."></textarea>
        </div>
        <button class="btn btn-primary" id="confirm-slot-btn" disabled>Choisissez un créneau</button>
        <button class="btn btn-ghost" type="button" id="back-to-people-2" style="margin-top:10px;">← Retour</button>
      `;

      zone.querySelectorAll('.slot-btn').forEach(btn => {
        btn.onclick = () => {
          zone.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('unlocked'));
          btn.classList.add('unlocked');
          selectedSlot = btn.dataset.slot;
          const confirmBtn = zone.querySelector('#confirm-slot-btn');
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Réserver le ${new Date(selectedSlot).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${new Date(selectedSlot).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        };
      });

      const backBtn = zone.querySelector('#back-to-people-2');
      if (backBtn) backBtn.onclick = () => loadPeopleAndServices();

      zone.querySelector('#confirm-slot-btn').onclick = async () => {
        if (!selectedSlot) return;
        const message = zone.querySelector('#message').value;
        const confirmBtn = zone.querySelector('#confirm-slot-btn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Envoi en cours...';
        try {
          await api('/booking', {
            method: 'POST',
            body: JSON.stringify({
              message,
              slot_datetime: selectedSlot,
              service_id: personServiceIds[0] || null,
              people_count: peopleCount,
              total_duration_minutes: duration || undefined,
              booking_details: allServices.length > 0 ? bookingDetailsText() : undefined,
            }),
          });
          backdrop.querySelector('.sheet').innerHTML = `
            <h3>Demande envoyée ✓</h3>
            <div class="success-msg" style="margin-top:14px;">Votre demande a bien été transmise à Hairsprit. Vous serez recontacté pour confirmer votre rendez-vous.</div>
            <button class="btn btn-outline" id="close-sheet">Fermer</button>
          `;
          backdrop.querySelector('#close-sheet').onclick = () => backdrop.remove();
        } catch (err) {
          backdrop.querySelector('#booking-error').innerHTML = `<div class="error-msg">${err.message}</div>`;
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Réessayer';
        }
      };
    } catch (err) {
      zone.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  loadPeopleAndServices();
}

// Récupère le code de parrainage éventuel dans l'URL (?ref=...)
const urlParams = new URLSearchParams(window.location.search);
const refParam = urlParams.get('ref');
if (refParam) {
  state.referralCode = refParam;
  state.authMode = 'register';
}

init();
