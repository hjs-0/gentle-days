require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { PRESETS, PALETTE } = require('./defaults');

const prisma = global.prisma || (global.prisma = new PrismaClient());
const PROD = process.env.NODE_ENV === 'production';
if (PROD && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // local dev; Vercel serves /public itself

// ---------- helpers ----------
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) bad(r.error.issues.map(i => (i.path.join('.') ? i.path.join('.') + ': ' : '') + i.message).join('; '));
  return r.data;
};
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #6c6fa3');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const uuid = z.string().uuid();
const toDate = s => {
  const d = new Date(s + 'T00:00:00.000Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) bad('Invalid date');
  return d;
};
const nn = v => (v === undefined ? undefined : v || null); // '' becomes null
const owned = async (model, id, uid) => {
  const row = await prisma[model].findFirst({ where: { id: parse(uuid, id), userId: uid } });
  if (!row) bad('Not found', 404);
  return row;
};
const INC = { symptoms: true };
const fmt = e => ({
  date: e.date.toISOString().slice(0, 10), mood: e.mood, note: e.note, isSaved: e.isSaved,
  symptoms: e.symptoms.map(s => ({ symptomId: s.symptomId, severity: s.severity })),
});

// ---------- auth ----------
const publicUser = u => ({ id: u.id, email: u.email, displayName: u.displayName });
const sendToken = (res, u) =>
  res.cookie('gd_token', jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' }), {
    httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 864e5,
  });
const auth = (req, res, next) => {
  try { req.uid = jwt.verify(req.cookies.gd_token || '', SECRET).uid; next(); }
  catch (e) { res.status(401).json({ error: 'Please log in' }); }
};

app.post('/api/auth/register', wrap(async (req, res) => {
  const b = parse(z.object({
    email: z.string().email().max(120),
    password: z.string().min(8, 'must be at least 8 characters').max(100),
    displayName: z.string().trim().max(40).optional(),
  }), req.body);
  const email = b.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) bad('That email is already registered', 409);
  const user = await prisma.user.create({
    data: {
      email, displayName: b.displayName || null, passwordHash: await bcrypt.hash(b.password, 10),
      symptoms: { create: PRESETS.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length], sortOrder: i })) },
      notes: { create: [0, 1, 2].map(slot => ({ slot })) },
    },
  });
  sendToken(res, user);
  res.status(201).json(publicUser(user));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const b = parse(z.object({ email: z.string().max(120), password: z.string().max(100) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(b.password, user.passwordHash))) bad('Wrong email or password', 401);
  sendToken(res, user);
  res.json(publicUser(user));
}));

app.post('/api/auth/logout', (req, res) => { res.clearCookie('gd_token'); res.json({ ok: true }); });

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.uid } });
  if (!user) bad('Please log in', 401);
  res.json(publicUser(user));
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- symptoms ----------
app.get('/api/symptoms', auth, wrap(async (req, res) => {
  res.json(await prisma.symptom.findMany({ where: { userId: req.uid }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }));
}));

app.post('/api/symptoms', auth, wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(40), color: hex.optional() }), req.body);
  const all = await prisma.symptom.findMany({ where: { userId: req.uid } });
  const used = all.map(s => s.color);
  const color = b.color || PALETTE.find(c => !used.includes(c)) || PALETTE[all.length % PALETTE.length];
  res.status(201).json(await prisma.symptom.create({ data: { userId: req.uid, name: b.name, color, sortOrder: all.length } }));
}));

app.put('/api/symptoms/:id', auth, wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), color: hex.optional(), sortOrder: z.number().int().optional() }), req.body);
  await owned('symptom', req.params.id, req.uid);
  res.json(await prisma.symptom.update({ where: { id: req.params.id }, data: b }));
}));

app.delete('/api/symptoms/:id', auth, wrap(async (req, res) => {
  await owned('symptom', req.params.id, req.uid);
  await prisma.symptom.delete({ where: { id: req.params.id } }); // its logged severities cascade away
  res.json({ ok: true });
}));

// ---------- entries (one per day) ----------
const entryBody = z.object({
  date: dateStr,
  mood: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  isSaved: z.boolean().optional(),
  symptoms: z.array(z.object({ symptomId: uuid, severity: z.number().int().min(1).max(5) })).max(50).optional(),
});
const checkSymptoms = async (uid, list) => {
  const ids = [...new Set(list.map(s => s.symptomId))];
  if (ids.length !== list.length) bad('Each symptom can only appear once per entry');
  if ((await prisma.symptom.count({ where: { userId: uid, id: { in: ids } } })) !== ids.length) bad('Unknown symptom');
};

app.get('/api/entries', auth, wrap(async (req, res) => {
  const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
  const where = { userId: req.uid };
  if (q.from || q.to) where.date = { ...(q.from && { gte: toDate(q.from) }), ...(q.to && { lte: toDate(q.to) }) };
  res.json((await prisma.entry.findMany({ where, include: INC, orderBy: { date: 'asc' }, take: 1000 })).map(fmt));
}));

app.get('/api/entries/:date', auth, wrap(async (req, res) => {
  const date = toDate(parse(dateStr, req.params.date));
  const e = await prisma.entry.findUnique({ where: { userId_date: { userId: req.uid, date } }, include: INC });
  if (!e) bad('No entry for that day', 404);
  res.json(fmt(e));
}));

app.post('/api/entries', auth, wrap(async (req, res) => {
  const b = parse(entryBody, req.body);
  const sy = b.symptoms || [];
  await checkSymptoms(req.uid, sy);
  const e = await prisma.entry.create({
    data: { userId: req.uid, date: toDate(b.date), mood: b.mood ?? null, note: nn(b.note) ?? null, isSaved: b.isSaved ?? false, symptoms: { create: sy } },
    include: INC,
  });
  res.status(201).json(fmt(e));
}));

app.put('/api/entries/:date', auth, wrap(async (req, res) => {
  const date = toDate(parse(dateStr, req.params.date));
  const b = parse(entryBody.partial(), req.body);
  const cur = await prisma.entry.findUnique({ where: { userId_date: { userId: req.uid, date } } });
  if (!cur) bad('No entry for that day', 404);
  const ops = [];
  if (b.symptoms) { // replace the day's symptom list in one transaction
    await checkSymptoms(req.uid, b.symptoms);
    ops.push(
      prisma.entrySymptom.deleteMany({ where: { entryId: cur.id } }),
      prisma.entrySymptom.createMany({ data: b.symptoms.map(s => ({ entryId: cur.id, ...s })) })
    );
  }
  ops.push(prisma.entry.update({ where: { id: cur.id }, data: { mood: b.mood, note: nn(b.note), isSaved: b.isSaved }, include: INC }));
  const r = await prisma.$transaction(ops);
  res.json(fmt(r[r.length - 1]));
}));

app.delete('/api/entries/:date', auth, wrap(async (req, res) => {
  const date = toDate(parse(dateStr, req.params.date));
  const r = await prisma.entry.deleteMany({ where: { userId: req.uid, date } });
  if (!r.count) bad('No entry for that day', 404);
  res.json({ ok: true });
}));

// ---------- patterns (aggregated for "Last 30 Days") ----------
app.get('/api/patterns', auth, wrap(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - (days - 1));
  const groups = await prisma.entrySymptom.groupBy({
    by: ['symptomId'], where: { entry: { userId: req.uid, date: { gte: since } } },
    _count: { _all: true }, _avg: { severity: true },
  });
  const syms = await prisma.symptom.findMany({ where: { userId: req.uid } });
  const daysLogged = await prisma.entry.count({
    where: { userId: req.uid, date: { gte: since }, OR: [{ mood: { not: null } }, { note: { not: null } }, { symptoms: { some: {} } }] },
  });
  const symptoms = groups
    .map(g => { const s = syms.find(x => x.id === g.symptomId); return s && { symptomId: s.id, name: s.name, color: s.color, days: g._count._all, avgSeverity: g._avg.severity }; })
    .filter(Boolean).sort((a, b) => b.days - a.days);
  res.json({ days, daysLogged, symptoms });
}));

// ---------- to-dos ----------
app.get('/api/todos', auth, wrap(async (req, res) => {
  res.json(await prisma.todo.findMany({ where: { userId: req.uid }, orderBy: { createdAt: 'asc' } }));
}));
app.post('/api/todos', auth, wrap(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(1).max(200) }), req.body);
  res.status(201).json(await prisma.todo.create({ data: { userId: req.uid, text: b.text } }));
}));
app.put('/api/todos/:id', auth, wrap(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(1).max(200).optional(), isDone: z.boolean().optional() }), req.body);
  await owned('todo', req.params.id, req.uid);
  res.json(await prisma.todo.update({ where: { id: req.params.id }, data: b }));
}));
app.delete('/api/todos/:id', auth, wrap(async (req, res) => {
  await owned('todo', req.params.id, req.uid);
  await prisma.todo.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- sticky notes (slots 0-2) ----------
app.get('/api/notes', auth, wrap(async (req, res) => {
  res.json(await prisma.stickyNote.findMany({ where: { userId: req.uid }, orderBy: { slot: 'asc' } }));
}));
app.put('/api/notes/:slot', auth, wrap(async (req, res) => {
  const slot = parse(z.coerce.number().int().min(0).max(2), req.params.slot);
  const b = parse(z.object({ text: z.string().max(300) }), req.body);
  res.json(await prisma.stickyNote.upsert({
    where: { userId_slot: { userId: req.uid, slot } },
    update: { text: b.text }, create: { userId: req.uid, slot, text: b.text },
  }));
}));

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.code === 'P2002') return res.status(409).json({ error: 'That already exists' });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end' });
});

module.exports = app;
