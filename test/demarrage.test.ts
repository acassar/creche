import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { demarrer } from '../serveur/demarrage.ts';

const index = resolve(import.meta.dirname, '..', 'serveur', 'index.ts');

function dossierTemporaire(t: TestContext): string {
  const dossier = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

// Occupe un port libre, comme le ferait un autre programme.
async function portOccupe(t: TestContext): Promise<number> {
  const occupant = createServer().listen(0);
  await once(occupant, 'listening');
  t.after(() => { occupant.close(); });
  return (occupant.address() as AddressInfo).port;
}

function lancer(env: Record<string, string>): ChildProcess {
  const processus = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', index], {
    env: { ...process.env, ...env },
  });
  processus.stdout!.setEncoding('utf8');
  processus.stderr!.setEncoding('utf8');
  return processus;
}

function lireTout(flux: NodeJS.ReadableStream): () => string {
  let texte = '';
  flux.on('data', (morceau: string) => { texte += morceau; });
  return () => texte;
}

test('demarrer lance le serveur, arreter le ferme et referme la base', async (t) => {
  const dossier = dossierTemporaire(t);
  const serveur = await demarrer({ port: 0, dossierDonnees: dossier });

  const sante = await fetch(`http://127.0.0.1:${serveur.port}/api/sante`);
  assert.equal(sante.status, 200);

  await serveur.arreter();
  await assert.rejects(fetch(`http://127.0.0.1:${serveur.port}/api/sante`));
  // SQLite supprime le journal WAL quand la dernière connexion se ferme.
  assert.ok(existsSync(join(dossier, 'creche.sqlite')));
  assert.equal(existsSync(join(dossier, 'creche.sqlite-wal')), false);
});

test('demarrer sur un port déjà pris échoue clairement et referme la base', async (t) => {
  const dossier = dossierTemporaire(t);
  const port = await portOccupe(t);
  await assert.rejects(demarrer({ port, dossierDonnees: dossier }), {
    message: `Le port ${port} est déjà utilisé par un autre programme.`,
  });
  assert.equal(existsSync(join(dossier, 'creche.sqlite-wal')), false);
});

test('le serveur lancé en ligne de commande répond, puis s’arrête proprement', async (t) => {
  const dossier = dossierTemporaire(t);
  const processus = lancer({ PORT: '0', CRECHE_DONNEES: dossier });
  const fin = once(processus, 'exit');

  const [ligne] = await once(processus.stdout!, 'data') as [string];
  const port = /port (\d+)/.exec(ligne)?.[1];
  assert.ok(port, `port absent du message : ${ligne}`);
  assert.ok(ligne.includes(`données : ${dossier}`), ligne);
  const sante = await fetch(`http://127.0.0.1:${port}/api/sante`);
  assert.equal(sante.status, 200);

  processus.kill('SIGTERM');
  const [code] = await fin;
  // Windows n'a pas de signaux : kill() y termine le processus sans passer par
  // l'arrêt propre, testé plus haut directement avec arreter().
  if (process.platform !== 'win32') assert.equal(code, 0);
});

test('un PORT invalide arrête le serveur avec un message clair', async () => {
  const processus = lancer({ PORT: 'abc' });
  const erreurs = lireTout(processus.stderr!);
  const [code] = await once(processus, 'exit');
  assert.equal(code, 1);
  assert.match(erreurs(), /PORT invalide : « abc »/);
});

test('un port déjà pris arrête le serveur avec un message clair', async (t) => {
  const dossier = dossierTemporaire(t);
  const port = await portOccupe(t);
  const processus = lancer({ PORT: String(port), CRECHE_DONNEES: dossier });
  const erreurs = lireTout(processus.stderr!);
  const [code] = await once(processus, 'exit');
  assert.equal(code, 1);
  assert.match(erreurs(), new RegExp(`Le port ${port} est déjà utilisé`));
});
