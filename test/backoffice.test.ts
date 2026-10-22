import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resoudreChemin } from '../serveur/statique.ts';
import { echapper, remplir } from '../serveur/pages.ts';
import { choisirMotDePasse, demarrer, page, requeteBrute } from './aide.ts';

const ecrans = [
  { chemin: '/enfants', titre: 'Enfants' },
  { chemin: '/equipe', titre: 'Équipe' },
  { chemin: '/repas', titre: 'Repas' },
  { chemin: '/traitements', titre: 'Traitements' },
];

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

test('remplir insère chaque valeur une seule fois et refuse un repère sans valeur', () => {
  assert.equal(remplir('<p>{{a}} et {{b}}</p>', { a: '{{b}}', b: 'deux' }), '<p>{{b}} et deux</p>');
  assert.throws(() => remplir('{{absent}}', {}), /Repère \{\{absent\}\} sans valeur/);
  assert.equal(echapper(`<a href="x">L'é & co</a>`), '&lt;a href=&quot;x&quot;&gt;L&#39;é &amp; co&lt;/a&gt;');
});

test('l’accueil du backoffice affiche le menu une fois connecté', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  const reponse = await page(adresse, '/', cookie);
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await reponse.text();
  assert.match(html, /<title>Accueil · Réglages de la crèche<\/title>/);
  assert.match(html, /<h1>Accueil<\/h1>/);
  for (const { chemin, titre } of ecrans) {
    assert.ok(html.includes(`<a href="${chemin}">${titre}</a>`), `lien ${chemin} absent de l’accueil`);
  }
  assert.ok(html.includes('<form method="post" action="/deconnexion">'), 'bouton de déconnexion absent');
});

test('chaque écran de réglages s’ouvre, avec le menu complet et sa propre entrée marquée', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  for (const ecran of ecrans) {
    const reponse = await page(adresse, ecran.chemin, cookie);
    assert.equal(reponse.status, 200, ecran.chemin);
    const html = await reponse.text();
    assert.match(html, new RegExp(`<h1>${ecran.titre}</h1>`));
    assert.match(html, new RegExp(`<title>${ecran.titre} · Réglages de la crèche</title>`));
    assert.equal(html.match(/aria-current="page"/g)?.length, 1, ecran.chemin);
    for (const autre of ecrans) {
      const lien = autre === ecran
        ? `<a href="${autre.chemin}" aria-current="page">${autre.titre}</a>`
        : `<a href="${autre.chemin}">${autre.titre}</a>`;
      assert.ok(html.includes(lien), `${ecran.chemin} : lien vers ${autre.chemin} absent ou mal marqué`);
    }
  }
});

test('le menu et l’en-tête viennent du gabarit commun', async (t) => {
  const racine = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  const dossier = join(racine, 'backoffice');
  cpSync(resolve(import.meta.dirname, '..', 'backoffice'), dossier, { recursive: true });
  writeFileSync(join(dossier, 'gabarit.html'), '<h1>{{titre}}</h1>[gabarit modifié]{{deconnexion}}{{menu}}{{contenu}}');
  const { adresse } = await demarrer(t, { dossierBackoffice: dossier });
  const cookie = await choisirMotDePasse(adresse);

  for (const chemin of ['/', ...ecrans.map((e) => e.chemin)]) {
    const html = await (await page(adresse, chemin, cookie)).text();
    assert.ok(html.includes('[gabarit modifié]'), chemin);
    assert.ok(html.includes('aria-label="Écrans de réglages"'), chemin);
  }
});

test('tous les liens et feuilles de style des pages répondent', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  for (const chemin of ['/', ...ecrans.map((e) => e.chemin)]) {
    const html = await (await page(adresse, chemin, cookie)).text();
    for (const [, cible] of html.matchAll(/href="([^"]+)"/g)) {
      const reponse = await page(adresse, cible!, cookie);
      assert.equal(reponse.status, 200, `${chemin} → ${cible}`);
    }
  }
});

test('la feuille de style est servie avec son type, sans connexion', async (t) => {
  const { adresse } = await demarrer(t);
  const reponse = await page(adresse, '/style.css');
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(reponse.headers.get('content-security-policy'), null);
});

test('les en-têtes de sécurité sont présents, la politique de contenu sur les pages', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  for (const chemin of ['/', '/connexion', '/style.css', '/api/sante', '/inconnue']) {
    const reponse = await page(adresse, chemin, cookie);
    assert.equal(reponse.headers.get('x-content-type-options'), 'nosniff', chemin);
    assert.equal(reponse.headers.get('x-frame-options'), 'DENY', chemin);
    assert.equal(reponse.headers.get('referrer-policy'), 'same-origin', chemin);
  }
  for (const [chemin, session] of [['/enfants', cookie], ['/connexion', undefined]] as const) {
    const reponse = await page(adresse, chemin, session);
    assert.equal(reponse.status, 200, chemin);
    assert.match(reponse.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(reponse.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(reponse.headers.get('cache-control'), 'no-store', chemin);
  }
});

test('HEAD renvoie les en-têtes sans le contenu', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  for (const chemin of ['/', '/style.css']) {
    const taille = (await (await page(adresse, chemin, cookie)).arrayBuffer()).byteLength;
    const head = await page(adresse, chemin, cookie, 'HEAD');
    assert.equal(head.status, 200, chemin);
    assert.equal(head.headers.get('content-length'), String(taille), chemin);
    assert.equal((await head.arrayBuffer()).byteLength, 0, chemin);
  }
});

test('les autres méthodes sont refusées sur les pages', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const reponse = await page(adresse, '/traitements', cookie, method);
    assert.equal(reponse.status, 405, method);
    assert.equal(reponse.headers.get('allow'), 'GET, HEAD');
  }
  const connexion = await page(adresse, '/connexion', cookie, 'PUT');
  assert.equal(connexion.status, 405);
  assert.equal(connexion.headers.get('allow'), 'GET, HEAD, POST');
});

test('une page inconnue répond 404, une route d’API inconnue aussi une fois connecté', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);
  const inconnue = await page(adresse, '/inconnue', cookie);
  assert.equal(inconnue.status, 404);
  assert.equal(await inconnue.text(), 'Page introuvable');

  for (const chemin of ['/api', '/api/inconnue']) {
    const api = await page(adresse, chemin, cookie);
    assert.equal(api.status, 404, chemin);
    assert.deepEqual(await api.json(), { erreur: 'Introuvable' });
  }
});

test('une méthode non prévue sur une route d’API existante répond 405', async (t) => {
  const { adresse } = await demarrer(t);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const reponse = await page(adresse, '/api/sante', undefined, method);
    assert.equal(reponse.status, 405, method);
    assert.equal(reponse.headers.get('allow'), 'GET');
    assert.deepEqual(await reponse.json(), { erreur: 'Méthode non autorisée' });
  }
});

test('une adresse mal formée répond 400 sans trace d’erreur', async (t) => {
  const { adresse } = await demarrer(t);
  const erreurs = t.mock.method(console, 'error', () => {});
  assert.equal(await requeteBrute(adresse, 'http://['), 400);
  assert.equal(erreurs.mock.callCount(), 0);
  assert.equal(await requeteBrute(adresse, '/style.css'), 200);
});

test('aucun fichier hors du dossier public ni fichier privé n’est servi', async (t) => {
  const racine = mkdtempSync(join(tmpdir(), 'creche-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  const dossier = join(racine, 'backoffice');
  cpSync(resolve(import.meta.dirname, '..', 'backoffice'), dossier, { recursive: true });
  mkdirSync(join(dossier, 'public', 'dossier.html'), { recursive: true });
  writeFileSync(join(dossier, 'public', 'notes.txt'), 'privé');
  writeFileSync(join(racine, 'secret.css'), 'secret');
  writeFileSync(join(racine, 'backoffice-secret.css'), 'secret');
  const { adresse } = await demarrer(t, { dossierBackoffice: dossier });
  const cookie = await choisirMotDePasse(adresse);

  assert.equal(await requeteBrute(adresse, '/style.css', cookie), 200);
  for (const chemin of [
    '/../secret.css',
    '/%2e%2e/secret.css',
    '/..%2fsecret.css',
    '/../backoffice-secret.css',
    '/../gabarit.html',
    '/%2e%2e/gabarit.html',
    '/../pages/enfants.html',
    '/pages/enfants.html',
    '/gabarit.html',
    '/notes.txt',
    '/dossier.html',
    '/dossier',
  ]) {
    assert.equal(await requeteBrute(adresse, chemin, cookie), 404, chemin);
  }
});

test('une erreur interne répond 500 sans arrêter le serveur', async (t) => {
  const { adresse, base } = await demarrer(t);
  t.mock.method(console, 'error', () => {});

  base.close();
  const erreur = await page(adresse, '/api/sante');
  assert.equal(erreur.status, 500);
  assert.deepEqual(await erreur.json(), { erreur: 'Erreur interne' });

  assert.equal((await page(adresse, '/style.css')).status, 200);
});
