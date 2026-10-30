# Naga Shreeshyl — Portfolio

An editorial portfolio that rewrites its own content from GitHub.

- **Facts about me** come from the profile README at [Nagashreeshyl/Nagashreeshyl](https://github.com/Nagashreeshyl/Nagashreeshyl).
- **Projects** come from every public, non-fork repo: README, languages and manifests.
- **Copy** is written by free LLMs (Groq → OpenRouter → OpenCode, first that answers), told to use only facts in the material.

## How it updates

`.github/workflows/refresh.yml` runs every hour. `scripts/generate.mjs` rewrites only repos whose last push changed,
commits `content/portfolio.json` if anything changed, and Vercel redeploys on that commit.
Run it by hand from the Actions tab ("Run workflow").

## Local

```bash
npm install
npm run generate   # needs .env.local with GROQ_API_KEY / OPENROUTER_API_KEY / OPENCODE_API_KEY (GITHUB_TOKEN optional)
npm run dev
npm test
```

## Setup

1. Repo secrets: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`.
2. Import the repo in Vercel (framework: Next.js, no env vars needed: the site is static).
