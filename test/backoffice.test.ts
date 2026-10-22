import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { ouvrirBase } from '../serveur/base.ts';
import { creerServeur } from '../serveur/app.ts';
import { resoudreChemin } from '../serveur/statique.ts';

const ecrans = [
  { chemin: '/enfants', titre: 'Enfants' },
  { chemin: '/equipe', titre: 'Équipe' },
  { chemin: '/repas', titre: 'Repas' },
  { chemin: '/traitements', titre: 'Traitements' },
];

async function demarrer(t: TestContext, dossierBackoffice?: string): Promise<string> {
  const base = ouvrirBase(':memory:');
  const serveur = creerServeur(base, dossierBackoffice).listen(0);
  t.after(() => { serveur.close(); base.close(); });
  await new Promise<void>((ok) => serveur.once('listening', ok));
  return `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
}

// fetch normalise les « .. » de l'adresse : pour tester le chemin brut, on passe par node:http.
function requeteBrute(adresse: string, chemin: string): Promise<number> {
  const { port } = new URL(adresse);
  return new Promise((ok, echec) => {
    request({ host: '127.0.0.1', port, path: chemin }, (reponse) => {
      reponse.resume();
      ok(reponse.statusCode ?? 0);
    }).on('error', echec).end();
  });
}

test('resoudreChemin associe les adresses aux fichiers du dossier', () => {
  const dossier = resolve('/srv/backoffice');
  assert.equal(resoudreChemin(dossier, '/'), join(dossier, 'index.html'));
  assert.equal(resoudreChemin(dossier, '/enfants'), join(dossier, 'enfants.html'));
  assert.equal(resoudreChemin(dossier, '/enfants.html'), join(dossier, 'enfants.html'));
  assert.equal(resoudreChemin(dossier, '/style.css'), join(dossier, 'style.css'));
  assert.equal(resoudreChemin(dossier, '/sous/'), join(dossier, 'sous', 'index.html'));
  assert.equal(resoudreChemin(dossier, '/%C3%A9quipe'), join(dossier, 'équipe.html'));
});

test('resoudreChemin refuse de sortir du dossier ou de servir un fichier privé', () => {
  const dossier = resolve('/srv/backoffice');
  for (const chemin of [
    '/../package.json',
    '/../../etc/passwd.html',
    '/%2e%2e/package.json',
    '/sous/%2e%2e/%2e%2e/secret.css',
    '/..%2fsecret.css',
    '/..%5csecret.css',
    '/a%00.html',
    '/%E0%A4%A',
    '/creche.sqlite',
    '/notes.txt',
    '/index.html.bak',
  ]) {
    assert.equal(resoudreChemin(dossier, chemin), null, chemin);
  }
});

test('l’adresse du serveur affiche le backoffice avec son menu', async (t) => {
  const adresse = await demarrer(t);
  const reponse = await fetch(`${adresse}/`);
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await reponse.text();
  assert.match(html, /<title>Accueil · Réglages de la crèche<\/title>/);
  for (const { chemin, titre } of ecrans) {
    assert.ok(html.includes(`<a href="${chemin}">${titre}</a>`), `lien ${chemin} absent de l’accueil`);
  }
});

test('chaque écran de réglages s’ouvre, avec le menu complet et sa propre entrée marquée', async (t) => {
  const adresse = await demarrer(t);
  for (const ecran of ecrans) {
    const reponse = await fetch(`${adresse}${ecran.chemin}`);
    assert.equal(reponse.status, 200, ecran.chemin);
    const html = await reponse.text();
    assert.match(html, new RegExp(`<h1>${ecran.titre}</h1>`));
    assert.equal(html.match(/aria-current="page"/g)?.length, 1, ecran.chemin);
    for (const autre of ecrans) {
      const lien = autre === ecran
        ? `<a href="${autre.chemin}" aria-current="page">${autre.titre}</a>`
        : `<a href="${autre.chemin}">${autre.titre}</a>`;
      assert.ok(html.includes(lien), `${ecran.chemin} : lien vers ${autre.chemin} absent ou mal marqué`);
    }
  }
});

test('tous les liens et feuilles de style des pages répondent', async (t) => {
  const adresse = await demarrer(t);
  for (const page of ['/', ...ecrans.map((e) => e.chemin)]) {
    const html = await (await fetch(`${adresse}${page}`)).text();
    for (const [, cible] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reponse = await fetch(`${adresse}${cible}`);
      assert.equal(reponse.status, 200, `${page} → ${cible}`);
    }
  }
});

test('la feuille de style est servie avec son type', async (t) => {
  const adresse = await demarrer(t);
  const reponse = await fetch(`${adresse}/style.css`);
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(reponse.headers.get('content-security-policy'), null);
});

test('les en-têtes de sécurité sont présents, la politique de contenu sur les pages', async (t) => {
  const adresse = await demarrer(t);
  for (const chemin of ['/', '/style.css', '/api/sante', '/inconnue']) {
    const reponse = await fetch(`${adresse}${chemin}`);
    assert.equal(reponse.headers.get('x-content-type-options'), 'nosniff', chemin);
    assert.equal(reponse.headers.get('x-frame-options'), 'DENY', chemin);
    assert.equal(reponse.headers.get('referrer-policy'), 'no-referrer', chemin);
  }
  const page = await fetch(`${adresse}/enfants`);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});

test('HEAD renvoie les en-têtes sans le contenu', async (t) => {
  const adresse = await demarrer(t);
  const get = await fetch(`${adresse}/`);
  const taille = (await get.arrayBuffer()).byteLength;
  const head = await fetch(`${adresse}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(taille));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('les autres méthodes sont refusées sur les pages', async (t) => {
  const adresse = await demarrer(t);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const reponse = await fetch(`${adresse}/enfants`, { method });
    assert.equal(reponse.status, 405, method);
    assert.equal(reponse.headers.get('allow'), 'GET, HEAD');
  }
});

test('une page inconnue répond 404, une route d’API inconnue aussi, en JSON', async (t) => {
  const adresse = await demarrer(t);
  const page = await fetch(`${adresse}/inconnue`);
  assert.equal(page.status, 404);
  assert.equal(await page.text(), 'Page introuvable');

  for (const chemin of ['/api', '/api/inconnue']) {
    const api = await fetch(`${adresse}${chemin}`);
    assert.equal(api.status, 404, chemin);
    assert.deepEqual(await api.json(), { erreur: 'Introuvable' });
  }
});

test('une méthode non prévue sur une route d’API existante répond 405', async (t) => {
  const adresse = await demarrer(t);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const reponse = await fetch(`${adresse}/api/sante`, { method });
    assert.equal(reponse.status, 405, method);
    assert.equal(reponse.headers.get('allow'), 'GET');
    assert.deepEqual(await reponse.json(), { erreur: 'Méthode non autorisée' });
  }
  const inconnue = await fetch(`${adresse}/api/inconnue`, { method: 'POST' });
  assert.equal(inconnue.status, 404);
});

test('une adresse mal formée répond 400 sans trace d’erreur', async (t) => {
  const adresse = await demarrer(t);
  const erreurs = t.mock.method(console, 'error', () => {});
  assert.equal(await requeteBrute(adresse, 'http://['), 400);
  assert.equal(erreurs.mock.callCount(), 0);
  assert.equal(await requeteBrute(adresse, '/'), 200);
});

test('aucun fichier hors du backoffice ni fichier privé n’est servi', async (t) => {
  const racine = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  const dossier = join(racine, 'backoffice');
  mkdirSync(join(dossier, 'dossier.html'), { recursive: true });
  writeFileSync(join(dossier, 'index.html'), 'accueil');
  writeFileSync(join(dossier, 'notes.txt'), 'privé');
  writeFileSync(join(racine, 'secret.css'), 'secret');
  writeFileSync(join(racine, 'backoffice-secret.css'), 'secret');
  const adresse = await demarrer(t, dossier);

  assert.equal(await requeteBrute(adresse, '/'), 200);
  for (const chemin of [
    '/../secret.css',
    '/%2e%2e/secret.css',
    '/..%2fsecret.css',
    '/../backoffice-secret.css',
    '/notes.txt',
    '/dossier.html',
    '/dossier',
  ]) {
    assert.equal(await requeteBrute(adresse, chemin), 404, chemin);
  }
});

test('une erreur interne répond 500 sans arrêter le serveur', async (t) => {
  const base = ouvrirBase(':memory:');
  const serveur = creerServeur(base).listen(0);
  t.after(() => { serveur.close(); });
  await new Promise<void>((ok) => serveur.once('listening', ok));
  const adresse = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  t.mock.method(console, 'error', () => {});

  base.close();
  const erreur = await fetch(`${adresse}/api/sante`);
  assert.equal(erreur.status, 500);
  assert.deepEqual(await erreur.json(), { erreur: 'Erreur interne' });

  const page = await fetch(`${adresse}/`);
  assert.equal(page.status, 200);
});
