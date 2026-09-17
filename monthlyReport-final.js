// Calcule les statistiques d'un mois donné (revenus, visites, nouveaux clients, panier moyen)
// et gère l'envoi automatique de l'email de bilan le 1er de chaque mois.
const db = require('./db');

function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function computeMonthStats(monthStr) {
  const { start, end } = monthBounds(monthStr);

  const revenueRow = await db.get(`
    WITH combined AS (
      SELECT b.slot_datetime AS d, (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme' AND b.slot_datetime <= now()
      UNION ALL
      SELECT entry_date AS d, amount FROM manual_revenue
    )
    SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as visits
    FROM combined WHERE d >= ? AND d < ?
  `, [start, end]);

  const newClientsRow = await db.get(
    `SELECT COUNT(*) as c FROM clients WHERE created_at >= ? AND created_at < ?`,
    [start, end]
  );

  const revenue = parseFloat(revenueRow.total);
  const visits = parseInt(revenueRow.visits, 10);
  const avgBasket = visits > 0 ? revenue / visits : 0;

  return {
    month: monthStr,
    revenue,
    visits,
    newClients: parseInt(newClientsRow.c, 10),
    avgBasket,
  };
}

async function computeSixMonthTrend(monthStr) {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(monthStr, -i));
  const results = [];
  for (const m of months) {
    const stats = await computeMonthStats(m);
    results.push(stats);
  }
  return results;
}

function trendArrow(current, previous) {
  if (previous === 0 && current === 0) return { symbol: '', diff: 0 };
  const diff = current - previous;
  return { symbol: diff >= 0 ? '▲' : '▼', diff };
}

async function sendMonthlyReportEmail() {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) {
    console.log('[Hairsprit] Rapport mensuel non envoyé : RESEND_API_KEY ou NOTIFY_EMAIL manquant.');
    return;
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const targetMonth = shiftMonth(currentMonth, -1); // le mois qui vient de se terminer

  const thisStats = await computeMonthStats(targetMonth);
  const prevStats = await computeMonthStats(shiftMonth(targetMonth, -1));

  const monthLabel = new Date(`${targetMonth}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const revenueTrend = trendArrow(thisStats.revenue, prevStats.revenue);
  const visitsTrend = trendArrow(thisStats.visits, prevStats.visits);
  const clientsTrend = trendArrow(thisStats.newClients, prevStats.newClients);
  const basketTrend = trendArrow(thisStats.avgBasket, prevStats.avgBasket);

  const row = (label, value, trend, isEuro) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:#444;font-size:13px;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:15px;font-weight:700;">
        ${value}${trend.symbol ? ` <span style="font-size:11px;color:${trend.diff >= 0 ? '#0a8a3e' : '#cc2222'};">${trend.symbol} ${trend.diff >= 0 ? '+' : ''}${isEuro ? trend.diff.toFixed(2) + '€' : Math.round(trend.diff)}</span>` : ''}
      </td>
    </tr>
  `;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">📊 Ton bilan Hairsprit — ${monthLabel}</h2>
      <p style="color:#666;font-size:13px;margin-top:0;">Voici comment le mois s'est passé, comparé au précédent.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        ${row("Chiffre d'affaires", `${thisStats.revenue.toFixed(2)}€`, revenueTrend, true)}
        ${row('Visites', thisStats.visits, visitsTrend, false)}
        ${row('Nouveaux clients', thisStats.newClients, clientsTrend, false)}
        ${row('Panier moyen', `${thisStats.avgBasket.toFixed(2)}€`, basketTrend, true)}
      </table>
      <p style="margin-top:20px;">
        <a href="https://app.hairsprit.be/admin" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
          Voir le rapport complet
        </a>
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Hairsprit <contact@mail.hairsprit.be>',
        to: [toEmail],
        subject: `📊 Ton bilan Hairsprit — ${monthLabel}`,
        html,
      }),
    });
    if (!res.ok) console.error('[Hairsprit] Erreur envoi rapport mensuel:', res.status, await res.text());
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi rapport mensuel:', e.message);
  }
}

async function checkAndSendMonthlyReport() {
  const now = new Date();
  if (now.getDate() !== 1) return; // seulement le 1er du mois
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const state = await db.get('SELECT * FROM monthly_report_state WHERE id = ?', ['default']);
  if (state && state.last_sent_month === currentMonth) return; // déjà envoyé ce mois-ci

  await sendMonthlyReportEmail();

  if (state) {
    await db.run('UPDATE monthly_report_state SET last_sent_month = ? WHERE id = ?', [currentMonth, 'default']);
  } else {
    await db.run('INSERT INTO monthly_report_state (id, last_sent_month) VALUES (?,?)', ['default', currentMonth]);
  }
}

function startMonthlyReportScheduler() {
  checkAndSendMonthlyReport().catch(e => console.error(e));
  setInterval(() => { checkAndSendMonthlyReport().catch(e => console.error(e)); }, 6 * 60 * 60 * 1000); // vérifie 4x/jour
}

module.exports = { computeMonthStats, computeSixMonthTrend, sendMonthlyReportEmail, startMonthlyReportScheduler, shiftMonth };
