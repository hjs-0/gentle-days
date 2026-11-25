// Draft test data: a demo account with a month of made-up entries.  Run: npm run seed
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { PRESETS, PALETTE } = require('../defaults');
const prisma = new PrismaClient();
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

(async () => {
  await prisma.user.deleteMany({ where: { email: 'demo@gentledays.app' } });
  const u = await prisma.user.create({
    data: {
      email: 'demo@gentledays.app', displayName: 'Demo', passwordHash: await bcrypt.hash('gentledays123', 10),
      symptoms: { create: PRESETS.map((name, i) => ({ name, color: PALETTE[i], sortOrder: i })) },
      notes: { create: [{ slot: 0, text: 'Take meds with breakfast' }, { slot: 1, text: 'Book follow-up appointment' }, { slot: 2, text: 'Drink water!' }] },
      todos: { create: [{ text: 'Refill iron supplement' }, { text: 'Email Dr. Patel the symptom log' }, { text: 'Book blood work', isDone: true }] },
    },
    include: { symptoms: true },
  });
  const notes = ['Slept badly, rough morning.', 'Good day overall, took a walk.', 'Headache came on after lunch.', 'Flare after a stressful meeting.', 'Felt steadier today.'];
  for (let i = 0; i < 35; i++) {
    if (rnd() < 0.25) continue; // some days are left unlogged
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
    const pick = [...u.symptoms].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
    await prisma.entry.create({
      data: {
        userId: u.id, date: d, mood: 1 + Math.floor(rnd() * 5), isSaved: true,
        note: rnd() < 0.4 ? notes[Math.floor(rnd() * notes.length)] : null,
        symptoms: { create: pick.map(p => ({ symptomId: p.id, severity: 1 + Math.floor(rnd() * 5) })) },
      },
    });
  }
  console.log('Seeded demo account: demo@gentledays.app / gentledays123');
})().finally(() => prisma.$disconnect());
