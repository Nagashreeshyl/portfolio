// Reads GitHub (profile README + own repos), has a free LLM write the copy, saves content/portfolio.json.
// Only repos whose pushed_at changed are rewritten, to stay inside free-tier limits.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const USER = 'Nagashreeshyl';
const OUT = new URL('../content/portfolio.json', import.meta.url);
// The portfolio's own repo shouldn't list itself as a project.
const SITE_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1];

// Tried in order; free model lineups change often, edit here when one disappears.
const PROVIDERS = [
  { name: 'groq', url: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'openai/gpt-oss-120b', extra: { reasoning_effort: 'low' } },
  { name: 'openrouter', url: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  { name: 'opencode', url: 'https://opencode.ai/inference/openai/v1', key: 'OPENCODE_API_KEY', model: 'big-pickle' },
];

const MANIFESTS = ['package.json', 'Cargo.toml', 'Package.swift', 'requirements.txt', 'pyproject.toml', 'go.mod'];

// ---------- GitHub ----------

async function gh(path, raw = false) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status} ${await res.text()}`);
  return raw ? res.text() : res.json();
}

async function repoMaterial(repo) {
  const [readme, languages, root] = await Promise.all([
    gh(`/repos/${USER}/${repo.name}/readme`, true),
    gh(`/repos/${USER}/${repo.name}/languages`),
    gh(`/repos/${USER}/${repo.name}/contents/`),
  ]);
  const files = Array.isArray(root) ? root.map((f) => f.name) : [];
  const manifests = await Promise.all(
    MANIFESTS.filter((m) => files.includes(m)).map(async (m) => `--- ${m}\n${(await gh(`/repos/${USER}/${repo.name}/contents/${m}`, true))?.slice(0, 3000)}`),
  );
  return { readme: readme ?? '', languages: languages ?? {}, files, manifests };
}

// ---------- LLM ----------

export function extractJson(text) {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON in model reply');
  return JSON.parse(body.slice(start, end + 1));
}

const SYSTEM = `You write copy for a software engineer's portfolio, in a calm, precise, editorial voice.
Hard rules:
- Use ONLY facts present in the material you are given. Never invent features, metrics, users, awards or links.
- If the material is thin, write less. Short and true beats long and padded.
- No hype words (revolutionary, cutting-edge, seamless, robust, leverage, passionate).
- Reply with a single JSON object and nothing else.`;

async function ask(prompt) {
  const errors = [];
  for (const p of PROVIDERS) {
    const key = process.env[p.key];
    if (!key) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${p.url}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: p.model, temperature: 0.4, max_tokens: 12000, ...p.extra, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(120_000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 20_000)); continue; }
        if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
        return extractJson(data.choices[0].message.content ?? '');
      } catch (e) {
        errors.push(`${p.name}: ${e.message}`);
        break;
      }
    }
  }
  throw new Error(`all providers failed → ${errors.join(' | ')}`);
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

async function writeProject(repo, m) {
  const out = await ask(`Write the portfolio entry for this repository.

Repository: ${repo.name}
GitHub description: ${repo.description ?? '(none)'}
Topics: ${repo.topics.join(', ') || '(none)'}
Languages (bytes): ${JSON.stringify(m.languages)}
Root files: ${m.files.join(', ')}
${m.manifests.join('\n')}

README:
${m.readme.slice(0, 9000) || '(no README)'}

Return JSON:
{
  "title": "human-readable project name",
  "tagline": "one line, max 90 characters, what it is",
  "summary": "2-3 sentences: what it does and for whom",
  "problem": "one short paragraph: the problem it addresses (empty string if the material doesn't say)",
  "howItWorks": ["3-6 short sentences on how it works / architecture, fewer if the material is thin"],
  "highlights": ["notable engineering decisions or details, only if stated in the material"],
  "stack": ["technologies actually used, canonical names, e.g. Next.js, TypeScript, Firebase"],
  "category": "one of: AI & Voice, Full-stack, Systems, Security, Tools"
}`);
  return {
    title: str(out.title) || repo.name,
    tagline: str(out.tagline) || str(repo.description),
    summary: str(out.summary),
    problem: str(out.problem),
    howItWorks: list(out.howItWorks),
    highlights: list(out.highlights),
    stack: list(out.stack),
    category: str(out.category) || 'Tools',
  };
}

async function writeProfile(readme) {
  const out = await ask(`This is the engineer's GitHub profile README. Turn it into structured portfolio data.

${readme}

Return JSON:
{
  "name": "full name as written",
  "headline": "max 8 words, what they build, lowercase except proper nouns",
  "intro": "2-3 sentences in first person, faithful to the README",
  "education": "degree and college, or empty string",
  "now": [{ "title": "short name", "body": "1-2 sentences" }]  // one entry for EVERY current role, venture or product the README describes as ongoing work,
  "stack": ["technologies listed in the README"],
  "availability": "one sentence on what work they are open to, or empty string"
}`);
  return {
    name: str(out.name) || USER,
    headline: str(out.headline),
    intro: str(out.intro),
    education: str(out.education),
    now: Array.isArray(out.now) ? out.now.filter((n) => n?.title).map((n) => ({ title: str(n.title), body: str(n.body) })) : [],
    stack: list(out.stack),
    availability: str(out.availability),
    // Contact links are copied verbatim, never model-written.
    email: readme.match(/mailto:([^\s)"']+)/)?.[1] ?? null,
    linkedin: readme.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w-]+/)?.[0] ?? null,
  };
}

async function groupSkills(skills) {
  const out = await ask(`Build a skills section from this raw list of technologies found across the engineer's projects.
- Group into 4-6 categories (e.g. Languages, Frontend, Backend & Data, AI & Voice, Infrastructure & Tooling).
- Merge duplicates and versions into one clean name ("Next.js 15" + "Next.js" -> "Next.js"; "Firebase Auth" + "Firestore" -> "Firebase").
- Drop tiny utility libraries (clsx, jszip, idb-keyval, icon packs, linters) unless they are notable.
- LLM, speech, voice and telephony services (Groq, OpenRouter, Sarvam, LiveKit, Dograh, Whisper, Twilio, Plivo, Gemini) go in "AI & Voice".
- At most 10 skills per category, the most significant first.
- "aliases" lists EVERY raw item merged into that skill, copied exactly from the list.

${JSON.stringify(skills)}

Return JSON: { "groups": [{ "name": "category", "skills": [{ "name": "clean name", "aliases": ["raw item", "..."] }] }] }`);
  return out.groups;
}

// ---------- pure helpers (tested) ----------

// README-linked repos first, in the order written; the rest by last push.
export function orderRepos(repos, readme) {
  const linked = [...readme.matchAll(new RegExp(`github\\.com/${USER}/([\\w.-]+)`, 'gi'))].map((m) => m[1].toLowerCase());
  const rank = (r) => { const i = linked.indexOf(r.name.toLowerCase()); return i < 0 ? Infinity : i; };
  return [...repos].sort((a, b) => rank(a) - rank(b) || b.pushed_at.localeCompare(a.pushed_at));
}

// Keeps only skills grounded in a real raw item, and attaches the projects that use each one.
export function buildSkills(groups, allSkills, projects) {
  const raw = new Map(allSkills.map((s) => [s.toLowerCase(), s]));
  const seen = new Set();
  const out = (Array.isArray(groups) ? groups : []).map((g) => ({
    name: str(g?.name),
    skills: (Array.isArray(g?.skills) ? g.skills : []).map((sk) => {
      const name = str(sk?.name);
      const aliases = new Set([name, ...list(sk?.aliases)].map((a) => a.toLowerCase()).filter((a) => raw.has(a)));
      if (!name || !aliases.size || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { name, projects: projects.filter((p) => p.stack.some((t) => aliases.has(t.toLowerCase()))).map((p) => p.slug) };
    }).filter(Boolean),
  })).filter((g) => g.name && g.skills.length);
  // Model gave nothing usable: show the raw list rather than an empty section.
  return out.length ? out : [{ name: 'Stack', skills: allSkills.map((s) => ({ name: s, projects: projects.filter((p) => p.stack.some((t) => t.toLowerCase() === s.toLowerCase())).map((p) => p.slug) })) }];
}

export function uniqueSkills(lists) {
  const seen = new Map();
  for (const s of lists.flat()) if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  return [...seen.values()];
}

// ---------- main ----------

async function main() {
  const prev = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
  const prevProjects = new Map((prev.projects ?? []).map((p) => [p.slug, p]));

  const [user, profileRepo, readme, allRepos] = await Promise.all([
    gh(`/users/${USER}`),
    gh(`/repos/${USER}/${USER}`),
    gh(`/repos/${USER}/${USER}/readme`, true),
    gh(`/users/${USER}/repos?per_page=100&type=owner`),
  ]);
  const repos = orderRepos(
    allRepos.filter((r) => !r.fork && !r.archived && !r.private && r.name !== USER && r.name !== SITE_REPO),
    readme ?? '',
  );

  let changed = false;
  let profile = prev.profile;
  let profileVersion = prev.profileVersion;
  if (!profile || profileVersion !== profileRepo?.pushed_at) {
    try {
      console.log('✎ profile');
      profile = await writeProfile(readme ?? '');
      profileVersion = profileRepo?.pushed_at ?? null;
      changed = true;
    } catch (e) {
      if (!profile) throw e;
      console.warn(`profile kept (${e.message})`);
    }
  }

  const projects = [];
  for (const repo of repos) {
    const old = prevProjects.get(repo.name);
    const facts = {
      slug: repo.name,
      url: repo.html_url,
      homepage: repo.homepage || null,
      stars: repo.stargazers_count,
      createdAt: repo.created_at,
      pushedAt: repo.pushed_at,
    };
    if (old?.ai && old.pushedAt === repo.pushed_at) { projects.push({ ...old, ...facts }); continue; }
    try {
      console.log(`✎ ${repo.name}`);
      const m = await repoMaterial(repo);
      const total = Object.values(m.languages).reduce((a, b) => a + b, 0) || 1;
      const languages = Object.entries(m.languages).map(([name, bytes]) => ({ name, pct: Math.round((bytes / total) * 1000) / 10 }));
      projects.push({ ...facts, languages, ...(await writeProject(repo, m)), ai: true });
    } catch (e) {
      // Never drop a project because a free model hiccuped: keep the old copy, or fall back to GitHub's own text.
      console.warn(`${repo.name} not rewritten (${e.message})`);
      projects.push(old ? { ...old, ...facts } : {
        ...facts, languages: repo.language ? [{ name: repo.language, pct: 100 }] : [],
        title: repo.name, tagline: repo.description ?? '', summary: repo.description ?? '',
        problem: '', howItWorks: [], highlights: [], stack: repo.language ? [repo.language] : [], category: 'Tools', ai: false,
      });
    }
    changed = true;
  }
  if (projects.length !== prevProjects.size) changed = true;

  let skills = prev.skills;
  if (changed || !skills) {
    changed = true;
    const all = uniqueSkills([profile.stack, ...projects.map((p) => p.stack)]);
    try {
      console.log('✎ skills');
      skills = buildSkills(await groupSkills(all), all, projects);
    } catch (e) {
      console.warn(`skills ungrouped (${e.message})`);
      skills = buildSkills([], all, projects);
    }
  }

  if (!changed) return console.log('nothing changed');
  const data = {
    updatedAt: new Date().toISOString(),
    profileVersion,
    profile: { ...profile, avatar: user.avatar_url, github: user.html_url },
    projects,
    skills,
  };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${projects.length} projects`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
