const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-please';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '180d' });
}

function requireClientAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'client') throw new Error('bad role');
    req.clientId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide, reconnectez-vous.' });
  }
}

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('bad role');
    req.adminId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide, reconnectez-vous.' });
  }
}

module.exports = { signToken, requireClientAuth, requireAdminAuth };
