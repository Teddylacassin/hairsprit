// Connexion à l'API Ponto (intégration personnalisée) pour récupérer automatiquement
// les transactions du compte bancaire professionnel Belfius de Teddy.
//
// ⚠️ NOTE IMPORTANTE : les adresses exactes de l'API Ponto n'ont pas pu être vérifiées
// à 100% via la documentation (site en JavaScript, inaccessible pour la recherche web).
// Ce module utilise la structure standard d'une API Ibanity/Ponto. Un premier test réel
// sera nécessaire pour confirmer/ajuster ces adresses si la connexion échoue.

const PONTO_BASE_URL = 'https://api.ibanity.com/ponto-connect';

let cachedToken = null;
let cachedTokenExpiry = 0;

// Récupère un token d'accès valide (les tokens Ponto expirent après 30 minutes)
async function getPontoAccessToken() {
  const clientId = process.env.PONTO_CLIENT_ID;
  const clientSecret = process.env.PONTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PONTO_CLIENT_ID ou PONTO_CLIENT_SECRET manquant dans les variables d\'environnement.');
  }

  // Réutilise le token en cache s'il est encore valide (avec 60s de marge)
  if (cachedToken && Date.now() < cachedTokenExpiry - 60000) {
    return cachedToken;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${PONTO_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur d'authentification Ponto (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in || 1800) * 1000;
  return cachedToken;
}

// Liste les comptes bancaires accessibles
async function listPontoAccounts() {
  const token = await getPontoAccessToken();
  const res = await fetch(`${PONTO_BASE_URL}/accounts`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur récupération comptes Ponto (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.data || [];
}

// Récupère les transactions d'un compte donné
async function listPontoTransactions(accountId) {
  const token = await getPontoAccessToken();
  const res = await fetch(`${PONTO_BASE_URL}/accounts/${accountId}/transactions?page[limit]=100`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur récupération transactions Ponto (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.data || [];
}

module.exports = { getPontoAccessToken, listPontoAccounts, listPontoTransactions };
