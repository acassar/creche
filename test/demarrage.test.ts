import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';

const index = resolve(import.meta.dirname, '..', 'serveur', 'index.ts');

function lancer(t: TestContext, env: Record<string, string>): ChildProcess {
  const processus = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', index], {
    env: { ...process.env, ...env },
  });
  t.after(() => { processus.kill('SIGKILL'); });
  return processus;
}

function lire(flux: NodeJS.ReadableStream): () => string {
  let texte = '';
  flux.setEncoding('utf8');
  flux.on('data', (morceau: string) => { texte += morceau; });
  return () => texte;
}

test('le serveur démarre, répond, puis s’arrête proprement sur SIGTERM', async (t) => {
  const dossier = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  const processus = lancer(t, { PORT: '0', CRECHE_DONNEES: dossier });
  processus.stdout!.setEncoding('utf8');

  const [ligne] = await once(processus.stdout!, 'data') as [string];
  const port = /port (\d+)/.exec(ligne)?.[1];
  assert.ok(port, `port absent du message : ${ligne}`);
  assert.ok(ligne.includes(`données : ${dossier}`), ligne);

  const sante = await fetch(`http://127.0.0.1:${port}/api/sante`);
  assert.equal(sante.status, 200);
  assert.ok(existsSync(join(dossier, 'creche.sqlite')));

  processus.kill('SIGTERM');
  const [code] = await once(processus, 'exit');
  assert.equal(code, 0);
});

test('un PORT invalide arrête le serveur avec un message clair', async (t) => {
  const processus = lancer(t, { PORT: 'abc' });
  const erreurs = lire(processus.stderr!);
  const [code] = await once(processus, 'exit');
  assert.equal(code, 1);
  assert.match(erreurs(), /PORT invalide : « abc »/);
});
