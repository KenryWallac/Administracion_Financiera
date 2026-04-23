/*
═══════════════════════════════════════════════════════════════
  FINFLOW — SERVER.JS (PLANTILLA DE BACKEND — FASE 2)
  ─────────────────────────────────────────────────────────────
  Esta es una plantilla lista para expandir la app con backend
  real usando Node.js + Express + SQLite + integración Gmail.
  
  REQUISITOS:
    npm install express better-sqlite3 cors dotenv imap-simple
                mailparser googleapis nodemon
  
  EJECUTAR:
    node server.js   (o)   nodemon server.js
  
  VARIABLES DE ENTORNO (.env):
    PORT=3001
    GOOGLE_CLIENT_ID=...
    GOOGLE_CLIENT_SECRET=...
    GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
═══════════════════════════════════════════════════════════════
*/

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const Database   = require('better-sqlite3');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ─── Middleware ─── */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Sirve el frontend

/* ─────────────────────────────────────────────────
   BASE DE DATOS SQLite
   Se crea automáticamente si no existe
───────────────────────────────────────────────── */
const db = new Database(path.join(__dirname, 'finflow.db'));

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS movimientos (
    id          TEXT PRIMARY KEY,
    tipo        TEXT NOT NULL,
    monto       REAL NOT NULL,
    fecha       TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    categoria   TEXT,
    cuenta_id   TEXT,
    creado_en   TEXT DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS cuentas (
    id     TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo   TEXT,
    color  TEXT,
    notas  TEXT
  );

  CREATE TABLE IF NOT EXISTS patrones (
    id        TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    tipo      TEXT NOT NULL,
    categoria TEXT,
    keywords  TEXT NOT NULL,
    regex     TEXT
  );
`);

/* ─────────────────────────────────────────────────
   API: MOVIMIENTOS
───────────────────────────────────────────────── */

// GET todos los movimientos
app.get('/api/movimientos', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM movimientos ORDER BY fecha DESC').all();
    res.json(rows.map(r => ({
      ...r,
      cuentaId: r.cuenta_id,
      creadoEn: r.creado_en,
      actualizadoEn: r.actualizado_en
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST nuevo movimiento
app.post('/api/movimientos', (req, res) => {
  const { id, tipo, monto, fecha, descripcion, categoria, cuentaId } = req.body;

  if (!tipo || !monto || !fecha || !descripcion) {
    return res.status(400).json({ error: 'Campos obligatorios faltantes' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO movimientos (id, tipo, monto, fecha, descripcion, categoria, cuenta_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, tipo, monto, fecha, descripcion, categoria || null, cuentaId || null);
    res.status(201).json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT actualizar movimiento
app.put('/api/movimientos/:id', (req, res) => {
  const { tipo, monto, fecha, descripcion, categoria, cuentaId } = req.body;
  try {
    const stmt = db.prepare(`
      UPDATE movimientos SET tipo=?, monto=?, fecha=?, descripcion=?, categoria=?, cuenta_id=?, actualizado_en=CURRENT_TIMESTAMP
      WHERE id=?
    `);
    stmt.run(tipo, monto, fecha, descripcion, categoria, cuentaId || null, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE movimiento
app.delete('/api/movimientos/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM movimientos WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────────────────────────────
   API: CUENTAS
───────────────────────────────────────────────── */
app.get('/api/cuentas', (_, res) => {
  res.json(db.prepare('SELECT * FROM cuentas').all());
});

app.post('/api/cuentas', (req, res) => {
  const { id, nombre, tipo, color, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  db.prepare('INSERT INTO cuentas (id,nombre,tipo,color,notas) VALUES (?,?,?,?,?)')
    .run(id, nombre, tipo, color, notas || null);
  res.status(201).json({ success: true });
});

app.put('/api/cuentas/:id', (req, res) => {
  const { nombre, tipo, color, notas } = req.body;
  db.prepare('UPDATE cuentas SET nombre=?,tipo=?,color=?,notas=? WHERE id=?')
    .run(nombre, tipo, color, notas, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cuentas/:id', (req, res) => {
  db.prepare('DELETE FROM cuentas WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

/* ─────────────────────────────────────────────────
   INTEGRACIÓN GMAIL (ESQUELETO — Requiere OAuth2)
   Para activar:
   1. Crea un proyecto en console.cloud.google.com
   2. Habilita Gmail API
   3. Descarga credenciales OAuth2 y ponlas en .env
   4. Instala: npm install googleapis
───────────────────────────────────────────────── */
/*
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Ruta para iniciar OAuth
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly']
  });
  res.redirect(url);
});

// Callback de OAuth
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  // Guardar tokens en DB o sesión
  res.redirect('/');
});

// Leer correos de notificaciones bancarias
app.get('/api/correos/analizar', async (req, res) => {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const result = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:notificaciones@banco.com subject:cargo',
    maxResults: 20
  });

  const mensajes = [];
  for (const msg of result.data.messages || []) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id });
    const payload = full.data.payload;
    const subject = payload.headers.find(h => h.name === 'Subject')?.value || '';
    const body    = Buffer.from(payload.body.data || '', 'base64').toString('utf-8');
    mensajes.push({ asunto: subject, cuerpo: body, fecha: new Date().toISOString() });
  }

  res.json(mensajes);
});
*/

/* ─────────────────────────────────────────────────
   INICIAR SERVIDOR
───────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`✅ FinFlow Backend corriendo en http://localhost:${PORT}`);
  console.log(`   Base de datos: finflow.db`);
  console.log(`   Frontend:      http://localhost:${PORT}/index.html`);
});
