const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// CONFIG — GANTI INI!
// =====================
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_YOUR_GROQ_KEY_HERE';
const JWT_SECRET   = process.env.JWT_SECRET   || 'copypost_wnjstudio_secret_2025';
const FREE_LIMIT   = 5;   // generate gratis per hari
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'YOUR_MIDTRANS_KEY';

// =====================
// DATABASE SETUP
// =====================
const db = new Database('./copypost.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, date)
  );

  CREATE TABLE IF NOT EXISTS captions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    produk TEXT,
    platform TEXT,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// =====================
// MIDDLEWARE
// =====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// =====================
// AUTH ROUTES
// =====================

// Register
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Semua field wajib diisi!' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter!' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
    const result = stmt.run(name, email.toLowerCase(), hashed);
    const token = jwt.sign({ id: result.lastInsertRowid, email, name, plan: 'free' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: result.lastInsertRowid, name, email, plan: 'free' } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email sudah terdaftar!' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email & password wajib diisi!' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Email tidak ditemukan!' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Password salah!' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
});

// =====================
// USAGE CHECK
// =====================
function getTodayUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT count FROM usage_log WHERE user_id = ? AND date = ?').get(userId, today);
  return row ? row.count : 0;
}

function incrementUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO usage_log (user_id, date, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
  `).run(userId, today);
}

// =====================
// GENERATE CAPTION
// =====================
app.post('/api/generate', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  // Check limit for free users
  if (user.plan === 'free') {
    const usage = getTodayUsage(userId);
    if (usage >= FREE_LIMIT) {
      return res.status(403).json({
        error: 'limit_reached',
        message: `Kamu sudah pakai ${FREE_LIMIT} generate hari ini. Upgrade ke Premium untuk unlimited! 🚀`,
        usage, limit: FREE_LIMIT
      });
    }
  }

  const { produk, deskripsi, harga, cta, platform, tone, goal, audience, lang, length, useEmoji, useHash, varCount } = req.body;

  if (!produk || !deskripsi) return res.status(400).json({ error: 'Produk & deskripsi wajib diisi!' });

  const lenMap = { 1: 'Short (50-80 words)', 2: 'Medium (100-150 words)', 3: 'Long (200-250 words)' };

  const prompt = `You are a world-class copywriter specializing in social media content for small businesses (UMKM) in Indonesia.

Create ${varCount || 2} different caption variation(s) for ${platform} with these details:
- Product: ${produk}
- Description: ${deskripsi}
- Price: ${harga || 'not mentioned'}
- Tone: ${tone}
- Goal: ${goal}
- Target Audience: ${audience}
- Language: ${lang}
- Length: ${lenMap[length] || lenMap[2]}
- Emojis: ${useEmoji ? 'Yes, use relevant emojis' : 'No emojis'}
- Hashtags: ${useHash ? 'Yes, include at least 5 relevant hashtags' : 'No hashtags'}
- CTA: ${cta || 'contact us for more info'}

Rules:
- Each variation MUST have a completely different opening hook & approach
- Variation 1: Direct & punchy hook
- Variation 2: Emotional/storytelling approach
- Variation 3 (if requested): Unique/creative angle

Format EXACTLY like this:
===VAR1===
[caption 1]
===VAR2===
[caption 2]
===VAR3===
[caption 3 if requested]`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({ model: 'llama3-8b-8192', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.choices?.[0]?.message?.content || '';

    // Increment usage
    incrementUsage(userId);

    // Save to history
    db.prepare('INSERT INTO captions (user_id, produk, platform, content) VALUES (?, ?, ?, ?)').run(userId, produk, platform, text);

    const usage = getTodayUsage(userId);
    const remaining = user.plan === 'premium' ? 'unlimited' : Math.max(0, FREE_LIMIT - usage);

    res.json({ success: true, text, usage, remaining, plan: user.plan });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal generate. Coba lagi!' });
  }
});

// =====================
// USER PROFILE & USAGE
// =====================
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, name, email, plan, created_at FROM users WHERE id = ?').get(req.user.id);
  const usage = getTodayUsage(req.user.id);
  const remaining = user.plan === 'premium' ? 'unlimited' : Math.max(0, FREE_LIMIT - usage);
  res.json({ user, usage, remaining, limit: FREE_LIMIT });
});

// Caption history
app.get('/api/history', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM captions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json({ history: rows });
});

// =====================
// PAYMENT - MIDTRANS
// =====================
app.post('/api/create-order', authMiddleware, async (req, res) => {
  const { plan } = req.body; // 'monthly' or 'lifetime'
  const amount = plan === 'lifetime' ? 99000 : 29000;
  const orderId = `CP-${req.user.id}-${Date.now()}`;

  // Save order
  db.prepare('INSERT INTO orders (user_id, order_id, amount) VALUES (?, ?, ?)').run(req.user.id, orderId, amount);

  // Midtrans payload
  const payload = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    customer_details: { first_name: req.user.name, email: req.user.email },
    item_details: [{ id: plan, price: amount, quantity: 1, name: `CopyPost Pro - ${plan === 'lifetime' ? 'Lifetime' : 'Monthly'}` }]
  };

  try {
    const mtRes = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64')
      },
      body: JSON.stringify(payload)
    });
    const mtData = await mtRes.json();
    res.json({ snap_token: mtData.token, order_id: orderId, amount });
  } catch (e) {
    res.status(500).json({ error: 'Gagal membuat order!' });
  }
});

// Midtrans webhook
app.post('/api/payment-webhook', async (req, res) => {
  const { order_id, transaction_status, fraud_status } = req.body;

  if (transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept')) {
    // Find order
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);
    if (order) {
      db.prepare('UPDATE orders SET status = ? WHERE order_id = ?').run('paid', order_id);
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('premium', order.user_id);
    }
  }
  res.json({ status: 'ok' });
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`\n🚀 CopyPost Pro Server running on port ${PORT}`);
  console.log(`📦 Database: copypost.db`);
  console.log(`🆓 Free limit: ${FREE_LIMIT} generates/day\n`);
});
