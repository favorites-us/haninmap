# Haninmap

Korean business directory for the US, Canada, and Australia.

## Tech Stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (PostgreSQL) + Prisma ORM
- Vercel deployment, Google OAuth (NextAuth)

## Project Structure

```
src/
  app/           Pages and API routes (App Router)
  components/    React UI components
  lib/           Business logic, DB, SEO, i18n, enrichment
  hooks/         Custom React hooks
scripts/
  ops/           Periodic operational scripts (crawlers, trust scores)
  analytics/     Analysis and querying (GA4, GSC, audits)
  data/          Data ingestion, seeding, import, promotion
  migration/     One-time DB/category fixes
  seo/           SEO auditing and URL submission
data/            Static guide content (markdown)
prisma/          Database schema
reports/archive/ Historical audit reports
docs/            Design specs and plans
```

## Dev Commands

```bash
npm run dev          # Local dev server
npm run build        # Production build (runs prisma generate first)
npm run lint         # ESLint
npm run db:studio    # Prisma Studio (DB browser)
npm run db:push      # Push schema changes to DB
npm run db:migrate   # Run Prisma migrations
```

## Conventions

- **Commits:** conventional commits — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `style:`, `perf:`
- **Branches:** `feat/`, `fix/`, `chore/` prefix → merge to main → delete branch
- **Language:** Korean commit body OK, prefix always English
- **Small changes:** direct commits to main are fine
