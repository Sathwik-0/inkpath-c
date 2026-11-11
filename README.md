# Inkpath

Study like you read. Give it a topic, PDF, DOCX, text or YouTube link and it writes a serial story where each plot problem needs a concept to solve. A learner model decides what each chapter teaches, reviews and pays off; recall questions decide what comes back. See `FOUNDATION.md` for the design.

Stack: Next.js 15, Supabase (Postgres, Auth, RLS), Vercel. AI: Gemini, OpenAI or Claude (bring your own key), plus an optional platform Gemini key for 3 free chapters.

## Deploy (about 15 minutes)

### 1. Supabase (already created: rpdwtqvkamfgkehrienf)
The database migrations are already applied. If you use a fresh project, run the files in `supabase/migrations/` in order in the SQL editor.

In **Authentication -> URL Configuration** set:
- Site URL: your Vercel URL (for example `https://inkpath.vercel.app`)
- Redirect URLs: add `https://YOUR-URL/auth/callback` and `http://localhost:3000/auth/callback`

Optional: enable the Google provider under **Authentication -> Providers**. Email sign-up works without it.

### 2. GitHub
Push this folder to `Sathwik-0/inkpath-c`:
```
git init && git add . && git commit -m "Inkpath" && git branch -M main
git remote add origin https://github.com/Sathwik-0/inkpath-c.git && git push -u origin main
```

### 3. Vercel
Import the repo, then add these environment variables (see `.env.example`):

| Name | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | already in `.env.example` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | already in `.env.example` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase -> Project Settings -> API -> service_role (secret) |
| `KEY_ENCRYPTION_SECRET` | run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` once; never change it afterwards or saved user keys become unreadable |
| `JOB_RUNNER_SECRET` | any long random string |
| `APP_URL` | your Vercel URL |
| `GEMINI_PLATFORM_KEY` | optional; pays for the 3 free chapters. Set a spending cap on it. Without it, users must bring their own key. |

Deploy. Generation routes use `maxDuration = 300` seconds; this needs Vercel's default Fluid compute (on by default for new projects). If your plan caps functions lower, chapters may time out.

### 4. Check it works
1. Open `/api/health` (should say `{"ok":true}`).
2. Sign up, go to **AI keys**, paste a Gemini key, and save (it is validated with a free call).
3. **New story**, type a topic, then write chapter 1, read it, and answer the recall questions.

## Before you rely on it
- The AI calls have not been run against live provider keys yet. The pipeline is tested with a fake model and an in-memory database (`npm test`); the first real run is the real test. Model names in `src/lib/ai/config.ts` are overridable by env variable.
- If you used a Gemini key in any other tool and it appeared in a log or chat, revoke it and make a new one.
- Spaced-repetition constants are defaults, not tuned on real learners.
- Only upload material you have the right to use.

## Scripts
`npm run dev`, `npm run build`, `npm test`
