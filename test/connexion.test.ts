import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { ouvrirBase } from '../serveur/base.ts';
import { dureeBlocage, dureeSession, maxEchecs } from '../serveur/app.ts';
import { enregistrerPremiereEmpreinte, lireEmpreinte } from '../serveur/direction.ts';
import { hacher, verifier } from '../serveur/mot-de-passe.ts';
import { creerLimiteur } from '../serveur/limiteur.ts';
import { creerSessions } from '../serveur/sessions.ts';
import {
  choisirMotDePasse, cookieDe, demarrer, envoyerFormulaire, motDePasse, page, seConnecter,
} from './aide.ts';

const pagesPrivees = ['/', '/enfants', '/equipe', '/repas', '/traitements'];

// Horloge que les tests font avancer à la main.
function horloge(): { maintenant: () => number; avancer: (ms: number) => void } {
  let temps = 1_000_000;
  return { maintenant: () => temps, avancer: (ms) => { temps += ms; } };
}

test('le mot de passe est haché avec un sel, et seul le bon est accepté', async () => {
  const empreinte = await hacher('crèche-2026');
  assert.match(empreinte, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.ok(!empreinte.includes('crèche-2026'));
  assert.notEqual(await hacher('crèche-2026'), empreinte);
  assert.equal(await verifier('crèche-2026', empreinte), true);
  assert.equal(await verifier('crèche-2025', empreinte), false);
  assert.equal(await verifier('', empreinte), false);
  // « è » composé ou décomposé : même mot de passe.
  assert.equal(await verifier('cre\u0300che-2026', empreinte), true);
});

test('une empreinte illisible ne valide aucun mot de passe', async () => {
  for (const empreinte of ['', 'texte-en-clair', 'scrypt$x$8$1$abc$def', 'bcrypt$16384$8$1$abc$def', 'scrypt$16384$8$1$abc']) {
    assert.equal(await verifier('texte-en-clair', empreinte), false, empreinte);
  }
});

test('le premier mot de passe ne s’enregistre qu’une fois', () => {
  const base = ouvrirBase(':memory:');
  assert.equal(lireEmpreinte(base), undefined);
  assert.equal(enregistrerPremiereEmpreinte(base, 'premiere'), true);
  assert.equal(enregistrerPremiereEmpreinte(base, 'seconde'), false);
  assert.equal(lireEmpreinte(base), 'premiere');
  base.close();
});

test('une session expire après la durée d’inactivité, et chaque passage la prolonge', () => {
  const { maintenant, avancer } = horloge();
  const sessions = creerSessions(1000, maintenant);
  const jeton = sessions.ouvrir();
  assert.notEqual(sessions.ouvrir(), jeton);
  assert.equal(sessions.valider(undefined), false);
  assert.equal(sessions.valider('inventé'), false);
  avancer(999);
  assert.equal(sessions.valider(jeton), true);
  avancer(999);
  assert.equal(sessions.valider(jeton), true);
  avancer(1000);
  assert.equal(sessions.valider(jeton), false);
  const autre = sessions.ouvrir();
  sessions.fermer(autre);
  assert.equal(sessions.valider(autre), false);
});

test('le limiteur bloque après trop d’échecs, se débloque avec le temps et oublie après une réussite', () => {
  const { maintenant, avancer } = horloge();
  const limiteur = creerLimiteur(3, 1000, maintenant);
  limiteur.echec('a');
  limiteur.echec('a');
  limiteur.reussite('a');
  limiteur.echec('a');
  limiteur.echec('a');
  assert.equal(limiteur.bloque('a'), false);
  limiteur.echec('a');
  assert.equal(limiteur.bloque('a'), true);
  assert.equal(limiteur.bloque('b'), false);
  avancer(1000);
  assert.equal(limiteur.bloque('a'), false);
});

test('premier lancement sur le PC : sans mot de passe, le backoffice propose de le choisir', async (t) => {
  const { adresse, base } = await demarrer(t);
  for (const chemin of pagesPrivees) {
    const reponse = await page(adresse, chemin);
    assert.equal(reponse.status, 303, chemin);
    assert.equal(reponse.headers.get('location'), '/connexion', chemin);
  }
  const html = await (await page(adresse, '/connexion')).text();
  assert.match(html, /<h1>Premier lancement<\/h1>/);
  assert.match(html, /autocomplete="new-password" minlength="8"/);
  assert.ok(!html.includes('aria-label="Écrans de réglages"'), 'menu affiché avant connexion');
  assert.ok(!html.includes('/deconnexion'), 'déconnexion affichée avant connexion');

  const court = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: '1234567', confirmation: '1234567' });
  assert.equal(court.status, 400);
  assert.match(await court.text(), /au moins 8 caractères/);

  const different = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: motDePasse, confirmation: `${motDePasse}x` });
  assert.equal(different.status, 400);
  assert.match(await different.text(), /pas identiques/);
  assert.equal(lireEmpreinte(base), undefined);

  const reponse = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: motDePasse, confirmation: motDePasse });
  assert.equal(reponse.status, 303);
  assert.equal(reponse.headers.get('location'), '/');
  assert.match(reponse.headers.get('set-cookie') ?? '', /^session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.equal((await page(adresse, '/', cookieDe(reponse))).status, 200);

  const empreinte = lireEmpreinte(base) ?? '';
  assert.ok(empreinte.startsWith('scrypt$'));
  assert.ok(!empreinte.includes(motDePasse));
});

test('une fois choisi, le mot de passe ne peut plus être remplacé par le formulaire', async (t) => {
  const { adresse, base } = await demarrer(t);
  await choisirMotDePasse(adresse);
  const empreinte = lireEmpreinte(base);

  const html = await (await page(adresse, '/connexion')).text();
  assert.match(html, /<h1>Connexion<\/h1>/);
  assert.match(html, /autocomplete="current-password"/);

  const reponse = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: 'autre-mot-de-passe', confirmation: 'autre-mot-de-passe' });
  assert.equal(reponse.status, 401);
  assert.equal(lireEmpreinte(base), empreinte);
});

test('connexion : un mauvais mot de passe est refusé, le bon ouvre les réglages', async (t) => {
  const { adresse } = await demarrer(t);
  await choisirMotDePasse(adresse);

  const mauvais = await seConnecter(adresse, 'pas-le-bon');
  assert.equal(mauvais.status, 401);
  assert.equal(mauvais.headers.get('set-cookie'), null);
  assert.match(await mauvais.text(), /<p class="erreur" role="alert">Mot de passe incorrect\.<\/p>/);

  const vide = await seConnecter(adresse, '');
  assert.equal(vide.status, 401);

  const bon = await seConnecter(adresse);
  assert.equal(bon.status, 303);
  assert.equal(bon.headers.get('location'), '/');
  const cookie = cookieDe(bon);
  for (const chemin of pagesPrivees) {
    assert.equal((await page(adresse, chemin, cookie)).status, 200, chemin);
  }
  const dejaConnecte = await page(adresse, '/connexion', cookie);
  assert.equal(dejaConnecte.status, 303);
  assert.equal(dejaConnecte.headers.get('location'), '/');
});

test('un jeton de session inventé ou mal formé ne donne accès à rien', async (t) => {
  const { adresse } = await demarrer(t);
  await choisirMotDePasse(adresse);
  for (const cookie of ['session=inventé', 'session=', 'autre=1', 'session', `session=${'a'.repeat(43)}`]) {
    assert.equal((await page(adresse, '/enfants', cookie)).status, 303, cookie);
    assert.equal((await page(adresse, '/api/reglages', cookie)).status, 401, cookie);
  }
});

test('la session expire après 30 minutes sans activité', async (t) => {
  const { maintenant, avancer } = horloge();
  const { adresse } = await demarrer(t, { maintenant });
  const cookie = await choisirMotDePasse(adresse);

  avancer(dureeSession - 1);
  assert.equal((await page(adresse, '/', cookie)).status, 200);
  avancer(dureeSession - 1);
  assert.equal((await page(adresse, '/', cookie)).status, 200);
  avancer(dureeSession);
  const expiree = await page(adresse, '/', cookie);
  assert.equal(expiree.status, 303);
  assert.equal(expiree.headers.get('location'), '/connexion');
});

test('la déconnexion ferme la session et efface le cookie', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);

  const reponse = await envoyerFormulaire(adresse, '/deconnexion', {}, { cookie });
  assert.equal(reponse.status, 303);
  assert.equal(reponse.headers.get('location'), '/connexion');
  assert.match(reponse.headers.get('set-cookie') ?? '', /^session=; .*Max-Age=0/);
  assert.equal((await page(adresse, '/', cookie)).status, 303);

  // Se déconnecter sans session ne pose pas de problème.
  assert.equal((await envoyerFormulaire(adresse, '/deconnexion', {})).status, 303);
});

test('un formulaire venu d’un autre site, ou sans origine, est refusé', async (t) => {
  const { adresse } = await demarrer(t);
  const cookie = await choisirMotDePasse(adresse);

  for (const origine of [null, 'http://site-malveillant.example', 'null', `${adresse}.example`]) {
    const connexion = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: motDePasse }, { origine });
    assert.equal(connexion.status, 403, `connexion, origine ${origine}`);
    assert.equal(connexion.headers.get('set-cookie'), null);

    const deconnexion = await envoyerFormulaire(adresse, '/deconnexion', {}, { cookie, origine });
    assert.equal(deconnexion.status, 403, `déconnexion, origine ${origine}`);
  }
  assert.equal((await page(adresse, '/', cookie)).status, 200);
});

test(`après ${maxEchecs} mots de passe faux, les essais sont bloqués quelques minutes`, async (t) => {
  const { maintenant, avancer } = horloge();
  const { adresse } = await demarrer(t, { maintenant });
  await choisirMotDePasse(adresse);

  for (let i = 0; i < maxEchecs; i++) assert.equal((await seConnecter(adresse, `faux-${i}`)).status, 401);
  const bloque = await seConnecter(adresse);
  assert.equal(bloque.status, 429);
  assert.equal(bloque.headers.get('set-cookie'), null);
  assert.match(await bloque.text(), /Trop d’essais/);

  avancer(dureeBlocage);
  assert.equal((await seConnecter(adresse)).status, 303);
});

test('un formulaire trop long est refusé', async (t) => {
  const { adresse, base } = await demarrer(t);
  const long = 'x'.repeat(5000);
  const reponse = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: long, confirmation: long });
  assert.equal(reponse.status, 413);
  assert.equal(lireEmpreinte(base), undefined);
});

test('l’API exige la connexion, sauf la route de santé', async (t) => {
  const { adresse } = await demarrer(t);
  assert.equal((await page(adresse, '/api/sante')).status, 200);
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const reponse = await page(adresse, '/api/reglages', undefined, method);
    assert.equal(reponse.status, 401, method);
    assert.deepEqual(await reponse.json(), { erreur: 'Connexion requise' });
  }
  const cookie = await choisirMotDePasse(adresse);
  assert.equal((await page(adresse, '/api/reglages', cookie, 'POST')).status, 404);
});

// Depuis une tablette du Wi-Fi, la connexion arrive par l'adresse réseau du PC, pas par 127.0.0.1.
const adresseReseau = Object.values(networkInterfaces()).flat()
  .find((i) => i !== undefined && i.family === 'IPv4' && !i.internal)?.address;

function depuisLeReseau(adresse: string, chemin: string, method: string, corps = ''): Promise<{ statut: number; texte: string }> {
  const { port } = new URL(adresse);
  return new Promise((ok, echec) => {
    const requete = request({
      host: adresseReseau, port, path: chemin, method,
      headers: { Origin: `http://${adresseReseau}:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (reponse) => {
      let texte = '';
      reponse.setEncoding('utf8').on('data', (m: string) => { texte += m; });
      reponse.on('end', () => ok({ statut: reponse.statusCode ?? 0, texte }));
    });
    requete.on('error', echec).end(corps);
  });
}

test('depuis une tablette, le premier mot de passe ne peut pas être choisi', { skip: adresseReseau === undefined && 'pas d’interface réseau' }, async (t) => {
  const { adresse, base } = await demarrer(t);

  const pageConnexion = await depuisLeReseau(adresse, '/connexion', 'GET');
  assert.equal(pageConnexion.statut, 200);
  assert.match(pageConnexion.texte, /uniquement depuis le navigateur du PC du bureau/);
  assert.ok(!pageConnexion.texte.includes('<form'));

  const corps = new URLSearchParams({ mot_de_passe: motDePasse, confirmation: motDePasse }).toString();
  const essai = await depuisLeReseau(adresse, '/connexion', 'POST', corps);
  assert.equal(essai.statut, 403);
  assert.equal(lireEmpreinte(base), undefined);

  // Une fois le mot de passe choisi sur le PC, la tablette voit le formulaire de connexion.
  await choisirMotDePasse(adresse);
  assert.match((await depuisLeReseau(adresse, '/connexion', 'GET')).texte, /<h1>Connexion<\/h1>/);
  const connexion = await depuisLeReseau(adresse, '/connexion', 'POST', new URLSearchParams({ mot_de_passe: motDePasse }).toString());
  assert.equal(connexion.statut, 303);
});

test('des essais envoyés tous en même temps ne contournent pas le blocage', async (t) => {
  const { adresse } = await demarrer(t);
  await choisirMotDePasse(adresse);

  const statuts = (await Promise.all(
    Array.from({ length: 20 }, (_, i) => seConnecter(adresse, `faux-${i}`)),
  )).map((reponse) => reponse.status);
  assert.equal(statuts.filter((s) => s === 401).length, maxEchecs, statuts.join(' '));
  assert.equal(statuts.filter((s) => s === 429).length, 20 - maxEchecs, statuts.join(' '));
});

// Un site malveillant peut faire pointer son propre nom vers 127.0.0.1 (« DNS
// rebinding ») : la requête vient alors bien du PC, mais avec son nom à lui.
function sousUnAutreNom(adresse: string, method: string, corps = ''): Promise<{ statut: number; texte: string }> {
  const { port } = new URL(adresse);
  const nom = `site-malveillant.example:${port}`;
  return new Promise((ok, echec) => {
    const requete = request({
      host: '127.0.0.1', port, path: '/connexion', method,
      headers: { Host: nom, Origin: `http://${nom}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (reponse) => {
      let texte = '';
      reponse.setEncoding('utf8').on('data', (m: string) => { texte += m; });
      reponse.on('end', () => ok({ statut: reponse.statusCode ?? 0, texte }));
    });
    requete.on('error', echec).end(corps);
  });
}

test('un autre site pointé vers le PC ne peut pas choisir le premier mot de passe', async (t) => {
  const { adresse, base } = await demarrer(t);

  const pageConnexion = await sousUnAutreNom(adresse, 'GET');
  assert.match(pageConnexion.texte, /uniquement depuis le navigateur du PC du bureau/);
  assert.ok(!pageConnexion.texte.includes('<form'));

  const corps = new URLSearchParams({ mot_de_passe: motDePasse, confirmation: motDePasse }).toString();
  assert.equal((await sousUnAutreNom(adresse, 'POST', corps)).statut, 403);
  assert.equal(lireEmpreinte(base), undefined);

  // Les noms du PC lui-même restent acceptés.
  for (const nom of ['localhost', '127.0.0.1']) {
    const { port } = new URL(adresse);
    const html = await (await fetch(`http://${nom}:${port}/connexion`)).text();
    assert.match(html, /<h1>Premier lancement<\/h1>/, nom);
  }
});
