const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET env var no configurado en producción');
    process.exit(1);
  }
  console.warn('⚠️  JWT_SECRET no configurado — usando valor de desarrollo. NO usar en producción.');
  return 'mundial2026_secret_cambia_esto_en_produccion';
})();

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Acceso solo para administradores' });
    next();
  });
}

module.exports = { authMiddleware, adminMiddleware, JWT_SECRET };
