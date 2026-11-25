# Gentle Days

A symptom tracker with a scrapbook look. Express API + Postgres (Neon) via Prisma, plain HTML/CSS/JS frontend, deployed on Vercel.

## Run it locally

1. Make a free Neon project at neon.tech. Copy two connection strings from the dashboard (Connection details):
   the **pooled** one and the **direct** one.
2. `cp .env.example .env` and fill in `DATABASE_URL`, `DIRECT_URL` and `JWT_SECRET`.
3. `npm install`
4. `npx prisma migrate dev --name init`   (creates the tables from `prisma/schema.prisma`)
5. `npm run seed`                          (demo@gentledays.app / gentledays123, plus 5 weeks of test entries)
6. `npm run dev`  then open http://localhost:3000

## Look inside the database (project requirement)

- `npx prisma studio` opens a browser data viewer, or
- connect pgAdmin / DBeaver / TablePlus using the **direct** connection string.
Take screenshots of the `User`, `Symptom`, `Entry` and `EntrySymptom` tables for your slides.

## Deploy (Vercel)

1. Push this folder to a GitHub repo (`.env` is git-ignored, so your secrets stay off GitHub).
2. On vercel.com choose Add New > Project and import the repo. No framework preset needed.
3. Before deploying, add Environment Variables: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`.
4. Deploy. `postinstall` runs `prisma generate` automatically. The `public/` folder is the frontend and
   `api/index.js` is the backend; `vercel.json` sends every `/api/*` request to it.
5. Run the migration against Neon once from your computer (step 4 above already did this if your `.env`
   points at the same database).

## API

All routes except register, login and health need the login cookie.

| Method | Path | What it does |
|---|---|---|
| POST | /api/auth/register | create account (also creates preset symptoms and 3 sticky notes) |
| POST | /api/auth/login, /api/auth/logout | start or end a session |
| GET | /api/auth/me | who am I |
| GET / POST | /api/symptoms | list / add a symptom |
| PUT / DELETE | /api/symptoms/:id | rename, recolour / delete (its history goes too) |
| GET | /api/entries?from=&to= | entries in a date range, with symptoms |
| GET | /api/entries/:date | one day (YYYY-MM-DD) |
| POST | /api/entries | create a day's entry |
| PUT | /api/entries/:date | update mood, note, saved flag, and replace the symptom list |
| DELETE | /api/entries/:date | delete a day's entry |
| GET | /api/patterns?days=30 | per-symptom counts and average severity |
| GET / POST | /api/todos | list / add |
| PUT / DELETE | /api/todos/:id | edit or tick / delete |
| GET | /api/notes | the three sticky notes |
| PUT | /api/notes/:slot | save a sticky note (slot 0, 1 or 2) |

## Quick test with curl

    curl -c jar -H "Content-Type: application/json" -d '{"email":"demo@gentledays.app","password":"gentledays123"}' localhost:3000/api/auth/login
    curl -b jar localhost:3000/api/entries?from=2026-11-01\&to=2026-11-30
    curl -b jar localhost:3000/api/patterns

Bad input returns an error message, e.g. `severity` of 9 gives a 400, a duplicate symptom name gives a 409.
