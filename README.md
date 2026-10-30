# Renda Fixa Copilot

A daily email about the best Brazilian CDBs, compared with LCIs, LCAs and Tesouro Direto bonds (Selic, Prefixado, IPCA+). Every offer is simulated for the same amount, net of income tax and fees. Each comes with its FGC or government guarantee, its term, and the app or broker to invest through (Nubank, Inter, PicPay, XP...). The email then suggests where to put money for each time horizon.

Runs on a GitHub Actions cron, every weekday at 08:00 Brasília time.

> **Status:** Tesouro Direto, Banco Central rates and the simulations run on live data. The web search for bank offers and the email need a Groq key and a Gmail app password (see [Setup](#setup)).

## What's in the email

Only long-term investments are recommended: nothing with daily liquidity, and only CDBs that run for 2 years or more. LCIs, LCAs and Tesouro can have any term.

- **Best CDBs** come first: the top 5 CDBs for 2 to 3 years, 3 to 6 years and over 6 years, always including the best prefixed, post-fixed and IPCA+ CDB found for each term. Each pick shows:
  - where to invest, the rate, the maturity, and the net profit for each amount (R$ 75k, 100k and 150k by default) after 2, 5 and 7 years and at maturity
  - its net return a year, compared with a CDB at 100% of CDI
  - the FGC guarantee, why it was picked, and what to watch (FGC limit, minimum investment)
- **Compared with Tesouro, LCI and LCA:** the top 3 of everything for up to 1 year, 1 to 3 years, 3 to 6 years and over 6 years
- **Fixed rate or inflation-linked?** the inflation at which a Prefixado and an IPCA+ bond pay the same, against the Focus survey's forecast
- **Since the last report:** rate moves, plus new offers and offers that went away (needs a database)
- **A short summary** written by a model from the computed numbers

## How it works

```
Banco Central SGS ──── CDI, IPCA ─────────────┐
Banco Central Focus ── Selic/IPCA forecasts ──┤
Tesouro Direto ─────── bonds on sale ─────────┼─► simulate ─► rank ─► summary ─► email (Gmail)
Groq web search ─► extract ─► verify ─────────┘                                      │
                    (bank CDB/LCI/LCA offers)                           Neon: snapshot for tomorrow's diff
```

1. **Rates and forecasts** come from Banco Central's open APIs: CDI (SGS 4389), 12-month IPCA (SGS 13522) and the Focus survey's medians for Selic and IPCA by year. No key is needed.
2. **Tesouro Direto** publishes every bond on sale with its current rate as JSON. Renda+, Educa+ and the coupon bonds are left out, since a hold-to-maturity simulation would misstate them.
3. **Bank offers have no public API**, so a model searches the web for them: `gpt-oss-120b` on Groq with the built-in `browser_search` tool. It opens daily rankings and news pages, then answers with the offers as JSON, validated with Zod.
   - The search and the reading happen in one call. A second call over the fetched pages would be about 20k tokens, well past the free tier's 8k a minute.
   - An LLM asked for rates without search makes them up. So every extracted offer has to pass checks in code, or it is dropped:
     - its source URL is one the search actually returned
     - its quote appears verbatim on that page
     - the quote states the rate
     - the rate is plausible for its index (e.g. 80 to 150% of CDI)
     - it matures between 30 days and 15 years from now
4. **Simulation** is plain code, never the model:
   - Floating rates are projected year by year from the Focus survey.
   - Income tax follows the regressive table (22.5% down to 15%). LCI and LCA are exempt, with the taxed rate that would pay the same shown next to them.
   - Tesouro's 0.20% custody fee is charged on the average balance; Tesouro Selic pays none on the first R$10,000.
5. **The summary** is written by a model from facts computed in code. Every number in it must appear in those facts; if any doesn't, the email uses a plain template instead.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run report:dry           # writes out/report.html without sending
npm run report               # sends the email
```

| Variable | What it is |
|----------|------------|
| `GROQ_API_KEY` | Free at [console.groq.com/keys](https://console.groq.com/keys). Used for the web search and the summary |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | The Gmail account that sends the report, with an [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| `REPORT_TO` | Who gets it; defaults to `GMAIL_USER` |
| `INVEST_AMOUNTS` | Amounts to simulate, in reais, separated by commas (default 75000,100000,150000) |
| `DATABASE_URL` | Optional Postgres (Neon) for history; run `npm run db:migrate` once |

For the daily run, add the same names as repository secrets (`gh secret set GROQ_API_KEY`, etc.). `INVEST_AMOUNTS` can be a repository variable. Use **Actions → Daily report → Run workflow** to run it by hand; tick *dry run* to get the HTML as an artifact without sending it.

## Stack

| Area | Choice |
|------|--------|
| Runtime | Node 22, TypeScript, tsx |
| AI | Vercel AI SDK 6 (`ai`, `@ai-sdk/groq`, `@ai-sdk/google`) with Groq's free tier |
| Validation | Zod |
| Email | Nodemailer over Gmail SMTP |
| Database | Neon Postgres + Drizzle ORM (optional) |
| Tests | Vitest, PGlite, real API responses as fixtures |
| Scheduling | GitHub Actions cron |

## Project structure

```
src/
  report.ts            # the daily run (CLI)
  sources/
    bcb.ts             # CDI, IPCA, Focus survey
    tesouro.ts         # Tesouro Direto bonds on sale
    web-offers.ts      # web search, extraction and verification of bank offers
  lib/
    simulate.ts        # net-of-tax simulation, custody fee, CDI comparison
    benchmarks.ts      # projected CDI and IPCA by year
    rank.ts            # term buckets, long-term filter, reasons, break-even inflation
    fgc.ts             # FGC and government guarantee
    summary.ts         # model summary with a numbers check and a template fallback
    changes.ts         # what moved since the last report
  email/               # HTML and text rendering, Gmail sending
  db/                  # Drizzle schema and report history
tests/                 # Vitest, with fixtures from the live APIs
```

## Limits

- Bank offers come from public pages, so they are whatever the search finds that day, and can be stale. Each is marked "confirm at the broker".
- Projections assume the Focus survey's forecasts hold. Tesouro bonds other than Selic are simulated to maturity; selling earlier is at market price.
- This is an automated comparison for personal use, not financial advice.
