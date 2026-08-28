// Logique de synchronisation des transactions bancaires (Ponto), utilisée à la fois
// par le bouton "Synchroniser" dans l'admin, et par le planificateur quotidien automatique.
// Chaque transaction est classée automatiquement (positif = recette, négatif = dépense)
// dès son arrivée, pour qu'elle compte directement dans les statistiques/comptabilité.
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { listPontoAccounts, listPontoTransactions } = require('./ponto');

async function syncBankTransactions() {
  const accounts = await listPontoAccounts();
  let newCount = 0;
  for (const account of accounts) {
    const transactions = await listPontoTransactions(account.id);
    for (const tx of transactions) {
      const attrs = tx.attributes || {};
      const amount = parseFloat(attrs.amount) || 0;
      const valueDate = attrs.valueDate || attrs.executionDate || new Date().toISOString().slice(0, 10);
      const description = attrs.description || attrs.remittanceInformation || null;
      const counterpartName = attrs.counterpartName || null;
      const label = description || counterpartName || 'Transaction bancaire';

      const bankTxId = uuidv4();
      const insertResult = await db.pool.query(
        `INSERT INTO bank_transactions (id, ponto_id, value_date, amount, description, counterpart_name)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ponto_id) DO NOTHING`,
        [bankTxId, tx.id, valueDate, amount, description, counterpartName]
      );
      if (insertResult.rowCount === 0) continue; // déjà connue, on ne la re-classe pas

      // Classement automatique : négatif = dépense (catégorie "autre" par défaut, ajustable ensuite),
      // positif = recette (méthode "virement" puisque ça vient de la banque).
      if (amount < 0) {
        const expenseId = uuidv4();
        await db.run('INSERT INTO expenses (id, expense_date, amount, category, note) VALUES (?,?,?,?,?)',
          [expenseId, valueDate, Math.abs(amount), 'autre', label]);
        await db.run('UPDATE bank_transactions SET reviewed = true, linked_expense_id = ? WHERE id = ?', [expenseId, bankTxId]);
      } else if (amount > 0) {
        const revenueId = uuidv4();
        await db.run('INSERT INTO manual_revenue (id, entry_date, amount, note, payment_method) VALUES (?,?,?,?,?)',
          [revenueId, valueDate, amount, label, 'virement']);
        await db.run('UPDATE bank_transactions SET reviewed = true, linked_revenue_id = ? WHERE id = ?', [revenueId, bankTxId]);
      }
      newCount++;
    }
  }
  return newCount;
}

function startBankSyncScheduler() {
  // Une première synchronisation 2 minutes après le démarrage (le temps que tout soit prêt),
  // puis une fois toutes les 24h.
  setTimeout(async () => {
    try {
      const newCount = await syncBankTransactions();
      console.log(`[Hairsprit] Synchronisation bancaire automatique : ${newCount} nouvelle(s) transaction(s).`);
    } catch (e) {
      console.error('[Hairsprit] Erreur synchronisation bancaire automatique:', e.message);
    }
  }, 2 * 60 * 1000);

  setInterval(async () => {
    try {
      const newCount = await syncBankTransactions();
      console.log(`[Hairsprit] Synchronisation bancaire automatique : ${newCount} nouvelle(s) transaction(s).`);
    } catch (e) {
      console.error('[Hairsprit] Erreur synchronisation bancaire automatique:', e.message);
    }
  }, 24 * 60 * 60 * 1000);
}

module.exports = { syncBankTransactions, startBankSyncScheduler };
