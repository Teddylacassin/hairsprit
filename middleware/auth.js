const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'hairsprit-secret-2026-xk9m2p';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '365d' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function requireClientAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'client') return res.status(403).json({ error: 'Accès refusé.' });
    req.clientId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide, reconnectez-vous.' });
  }
}

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Accès refusé.' });
    req.adminId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide, reconnectez-vous.' });
  }
}

module.exports = { signToken, verifyToken, requireClientAuth, requireAdminAuth };
