import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { ouvrirBase, versionSchema } from '../serveur/base.ts';
import { migrations } from '../serveur/migrations.ts';
import { creerServeur } from '../serveur/app.ts';

function dossierTemporaire(t: TestContext): string {
  const dossier = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

test('la base est créée au premier démarrage, migrée, puis rouverte sans rien rejouer', (t) => {
  const chemin = join(dossierTemporaire(t), 'sous-dossier', 'creche.sqlite');

  const base = ouvrirBase(chemin);
  assert.equal(versionSchema(base), migrations.length);
  base.prepare('INSERT INTO parametres (cle, valeur) VALUES (?, ?)').run('nom', 'Les Petits Pas');
  base.close();

  const rouverte = ouvrirBase(chemin);
  assert.equal(versionSchema(rouverte), migrations.length);
  const ligne = rouverte.prepare('SELECT valeur FROM parametres WHERE cle = ?').get('nom') as { valeur: string };
  assert.equal(ligne.valeur, 'Les Petits Pas');
  rouverte.close();
});

test('une migration en échec est annulée et la version ne bouge pas', (t) => {
  const chemin = join(dossierTemporaire(t), 'creche.sqlite');
  ouvrirBase(chemin, migrations).close();

  assert.throws(
    () => ouvrirBase(chemin, [...migrations, 'CREATE TABLE ok (id INTEGER); SELECT * FROM absente;']),
    /Échec de la migration 2/,
  );
  // SQLite supprime le journal WAL quand la dernière connexion se ferme :
  // s'il reste, la base n'a pas été refermée après l'échec.
  assert.equal(existsSync(`${chemin}-wal`), false);

  const base = ouvrirBase(chemin);
  assert.equal(versionSchema(base), migrations.length);
  const compte = base.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ok'").get() as { n: number };
  assert.equal(compte.n, 0);
  base.close();
});

test('une base plus récente que le serveur est refusée', (t) => {
  const chemin = join(dossierTemporaire(t), 'creche.sqlite');
  ouvrirBase(chemin, [...migrations, 'CREATE TABLE future (id INTEGER);']).close();
  assert.throws(() => ouvrirBase(chemin), /plus récente que ce serveur/);
});

test('GET /api/sante répond avec la version du schéma, le reste en 404', async (t) => {
  const base = ouvrirBase(':memory:');
  const serveur = creerServeur(base).listen(0);
  t.after(() => { serveur.close(); base.close(); });
  await new Promise<void>((ok) => serveur.once('listening', ok));
  const adresse = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;

  const sante = await fetch(`${adresse}/api/sante`);
  assert.equal(sante.status, 200);
  assert.deepEqual(await sante.json(), { ok: true, schema: migrations.length });

  const inconnue = await fetch(`${adresse}/nimporte-quoi`);
  assert.equal(inconnue.status, 404);
});
