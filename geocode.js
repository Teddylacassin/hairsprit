// Transforme une adresse texte en coordonnées GPS (lat/lng) via Nominatim (OpenStreetMap), gratuit.
// Politique d'usage Nominatim : max 1 requête/seconde, User-Agent obligatoire. Notre usage est ponctuel
// (uniquement quand un trajet démarre et que le client n'a pas encore été géocodé), donc sans risque.
async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Hairsprit-App/1.0 (contact: hairspritbarber@hotmail.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.error('[Hairsprit] Erreur géocodage:', e.message);
    return null;
  }
}

module.exports = { geocodeAddress };
