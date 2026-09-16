// Notifications push envoyées à l'admin (Teddy) sur son téléphone, dès qu'une nouvelle
// réservation arrive. Nécessite VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY sur le serveur,
// et que Teddy ait activé les notifications depuis son admin (bouton dédié).
const webpush = require('web-push');
const db = require('./db');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails('mailto:hairspritbarber@hotmail.com', publicKey, privateKey);
  configured = true;
  return true;
}

async function saveSubscription(subscription) {
  const existing = await db.get('SELECT id FROM admin_push_subscriptions WHERE endpoint = ?', [subscription.endpoint]);
  if (existing) return;
  const { v4: uuidv4 } = require('uuid');
  await db.run(
    'INSERT INTO admin_push_subscriptions (id, endpoint, keys_p256dh, keys_auth) VALUES (?,?,?,?)',
    [uuidv4(), subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
}

async function sendPushToAdmins({ title, body, url }) {
  if (!ensureConfigured()) {
    console.log('[Hairsprit] Notification push non envoyée : clés VAPID manquantes.');
    return;
  }
  const subs = await db.all('SELECT * FROM admin_push_subscriptions');
  const payload = JSON.stringify({ title, body, url: url || '/admin' });

  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, payload);
    } catch (e) {
      // Abonnement expiré ou invalide (410/404) -> on le retire silencieusement
      if (e.statusCode === 410 || e.statusCode === 404) {
        await db.run('DELETE FROM admin_push_subscriptions WHERE id = ?', [sub.id]);
      } else {
        console.error('[Hairsprit] Erreur envoi notification push:', e.message);
      }
    }
  }
}

module.exports = { saveSubscription, sendPushToAdmins, ensureConfigured };
