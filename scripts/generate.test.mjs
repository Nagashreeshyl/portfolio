import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, orderRepos, buildSkills, uniqueSkills } from './generate.mjs';

test('extractJson strips fences and thinking', () => {
  assert.deepEqual(extractJson('<think>{no}</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('sorry'));
});

test('orderRepos: README links first, then most recent push', () => {
  const r = (name, pushed_at) => ({ name, pushed_at });
  const out = orderRepos([r('old', '2026-01-01'), r('new', '2026-09-01'), r('Yogstra', '2025-01-01'), r('code-port', '2025-02-01')],
    '[a](https://github.com/Nagashreeshyl/Yogstra) [b](https://github.com/Nagashreeshyl/code-port)');
  assert.deepEqual(out.map((x) => x.name), ['Yogstra', 'code-port', 'new', 'old']);
});

test('buildSkills merges aliases, drops ungrounded skills, maps projects', () => {
  const all = uniqueSkills([['Rust', 'Firebase Auth'], ['firebase auth', 'Firestore']]);
  assert.deepEqual(all, ['Rust', 'Firebase Auth', 'Firestore']);
  const projects = [{ slug: 'langp', stack: ['Rust'] }, { slug: 'vote', stack: ['Firestore'] }];
  const out = buildSkills([{ name: 'Langs', skills: [{ name: 'Rust' }, { name: 'Kotlin' }, { name: 'rust' }] },
    { name: 'Data', skills: [{ name: 'Firebase', aliases: ['Firebase Auth', 'Firestore'] }] }], all, projects);
  assert.deepEqual(out, [
    { name: 'Langs', skills: [{ name: 'Rust', projects: ['langp'] }] },
    { name: 'Data', skills: [{ name: 'Firebase', projects: ['vote'] }] },
  ]);
  assert.equal(buildSkills(null, all, projects)[0].skills.length, 3);
});
