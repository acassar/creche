import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { lireConfig } from '../serveur/config.ts';

const racine = resolve(import.meta.dirname, '..');

test('sans variable, port 8080 et données à la racine du projet', () => {
  assert.deepEqual(lireConfig({}), { port: 8080, dossierDonnees: resolve(racine, 'donnees') });
});

test('les variables PORT et CRECHE_DONNEES sont prises en compte', () => {
  assert.deepEqual(lireConfig({ PORT: '3000', CRECHE_DONNEES: '/srv/creche' }), {
    port: 3000,
    dossierDonnees: resolve('/srv/creche'),
  });
  assert.equal(lireConfig({ PORT: '0' }).port, 0);
  assert.equal(lireConfig({ PORT: '65535' }).port, 65535);
});

for (const port of ['', ' ', 'abc', '80a', '-1', '1.5', '1e3', '65536']) {
  test(`PORT « ${port} » est refusé`, () => {
    assert.throws(() => lireConfig({ PORT: port }), /PORT invalide/);
  });
}

test('CRECHE_DONNEES vide est refusé', () => {
  assert.throws(() => lireConfig({ CRECHE_DONNEES: '' }), /CRECHE_DONNEES est vide/);
  assert.throws(() => lireConfig({ CRECHE_DONNEES: '  ' }), /CRECHE_DONNEES est vide/);
});
