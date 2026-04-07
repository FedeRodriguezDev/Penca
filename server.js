const express = require('express');
const path = require('path');
const cors = require('cors');

// Initialize database (runs on import)
require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/leaderboard', require('./routes/leaderboard'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚽ Penca Mundial 2026 corriendo en http://localhost:${PORT}`);
  console.log(`📝 El primer usuario registrado será administrador`);
});
