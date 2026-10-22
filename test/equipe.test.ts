import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ouvrirBase } from '../serveur/base.ts';
import {
  ajouterMembre, couleurLibre, couleurs, desactiverMembre, initiales, lireMembre, listerEquipe, listerEquipeActive,
  modifierMembre, reactiverMembre, verifierMembre, type Membre,
} from '../serveur/equipe.ts';
import { idDe, lireTexte, messageFait } from '../serveur/reglages.ts';
import { choisirMotDePasse, demarrer, envoyerFormulaire, page } from './aide.ts';

// Le 22 octobre 2026 à midi, heure du PC.
const maintenant = () => new Date(2026, 9, 22, 12).getTime();

const marie = { prenom: 'Marie', couleur: 'ciel' };

function membre(id: number, prenom: string, desactiveLe: string | null = null, couleur = 'sapin'): Membre {
  return { id, prenom, couleur, desactiveLe };
}

async function connecte(t: Parameters<typeof demarrer>[0]) {
  const serveur = await demarrer(t, { maintenant });
  const cookie = await choisirMotDePasse(serveur.adresse);
  const poster = (chemin: string, champs: Record<string, string> = {}, origine: string | null = serveur.adresse) =>
    envoyerFormulaire(serveur.adresse, chemin, champs, { cookie, origine });
  const voir = (chemin: string) => page(serveur.adresse, chemin, cookie);
  return { ...serveur, cookie, poster, voir };
}

test('idDe n’accepte qu’un entier positif écrit simplement', () => {
  assert.equal(idDe('12'), 12);
  assert.equal(idDe('999999999'), 999999999);
  for (const texte of [null, '', '0', '01', '-1', '1.5', 'abc', '1e3', '1234567890', ' 1']) {
    assert.equal(idDe(texte), undefined, String(texte));
  }
});

test('messageFait ne connaît que les écritures prévues', () => {
  assert.equal(messageFait('ajoute', 'Marie'), 'Fiche de Marie ajoutée.');
  assert.equal(messageFait('desactive', 'Marie'), 'Fiche de Marie désactivée.');
  assert.equal(messageFait('ajoute', undefined), undefined);
  for (const fait of [null, '', '__proto__', 'constructor', 'toString', 'inconnu']) {
    assert.equal(messageFait(fait, 'Marie'), undefined, String(fait));
  }
});

test('lireTexte nettoie, compte après normalisation et refuse les caractères de contrôle', () => {
  const champs = (valeur: string) => new URLSearchParams({ nom: valeur });
  assert.deepEqual(lireTexte(champs('  Lèo  '), 'nom', 'le nom', 5, true), { texte: 'Lèo' });
  assert.deepEqual(lireTexte(new URLSearchParams(), 'nom', 'le nom', 5, false), { texte: '' });
  assert.deepEqual(lireTexte(new URLSearchParams(), 'nom', 'le nom', 5, true), { erreur: 'Indiquez le nom.' });
  assert.deepEqual(lireTexte(champs('abcdef'), 'nom', 'le nom', 5, true), { erreur: 'Le nom fait au plus 5 caractères.' });
  assert.deepEqual(lireTexte(champs('a\tb'), 'nom', 'le nom', 5, true), { erreur: 'Le nom contient un caractère invalide.' });
  assert.ok('erreur' in lireTexte(champs('क़'.repeat(3)), 'nom', 'le nom', 5, true), 'trois caractères qui en font six une fois normalisés');
});

test('les initiales viennent des deux premiers mots du prénom', () => {
  assert.equal(initiales('Marie'), 'M');
  assert.equal(initiales('Marie L.'), 'ML');
  assert.equal(initiales('marie-laure'), 'ML');
  assert.equal(initiales('Anne Marie Louise'), 'AM');
  assert.equal(initiales('élodie'), 'É');
  assert.equal(initiales('  Zoé  '), 'Z');
});

test('une saisie correcte est nettoyée, une incorrecte refusée avec un message clair', () => {
  const champs = (valeurs: Record<string, string>) => new URLSearchParams(valeurs);
  assert.deepEqual(verifierMembre(champs({ prenom: '  Marie L. ', couleur: 'ciel' }), []), { saisie: { prenom: 'Marie L.', couleur: 'ciel' } });
  assert.ok('saisie' in verifierMembre(champs({ prenom: 'é'.repeat(30), couleur: 'ardoise' }), []));

  const cas: [Record<string, string>, RegExp][] = [
    [{ couleur: 'ciel' }, /Indiquez le prénom/],
    [{ prenom: '   ', couleur: 'ciel' }, /Indiquez le prénom/],
    [{ prenom: 'x'.repeat(31), couleur: 'ciel' }, /au plus 30 caractères/],
    [{ prenom: 'Ma\nrie', couleur: 'ciel' }, /caractère invalide/],
    [{ prenom: 'Marie' }, /Choisissez une couleur/],
    [{ prenom: 'Marie', couleur: 'rose' }, /Choisissez une couleur/],
    [{ prenom: 'Marie', couleur: '__proto__' }, /Choisissez une couleur/],
    [{ prenom: 'Marie', couleur: 'constructor' }, /Choisissez une couleur/],
  ];
  for (const [valeurs, message] of cas) {
    const resultat = verifierMembre(champs(valeurs), []);
    assert.ok('erreur' in resultat, JSON.stringify(valeurs));
    assert.match(resultat.erreur, message, JSON.stringify(valeurs));
  }
});

test('deux professionnelles actives ne peuvent pas porter le même prénom', () => {
  const equipe = [membre(1, 'Marie'), membre(2, 'Inès', '2026-01-01')];
  const verifier = (prenom: string, idModifie?: number) => verifierMembre(new URLSearchParams({ prenom, couleur: 'ciel' }), equipe, idModifie);
  for (const prenom of ['Marie', 'marie', 'MARIE', 'Marié', ' Marie ']) {
    assert.deepEqual(verifier(prenom), { erreur: 'Marie est déjà dans l’équipe : ajoutez l’initiale du nom (ex. Marie L.).' }, prenom);
  }
  // Les accents ne suffisent pas à distinguer « Ines » d'« Inès » sur la tablette, mais Inès est désactivée.
  assert.ok('saisie' in verifier('Ines'));
  assert.ok('saisie' in verifier('Marie L.'));
  // Marie peut enregistrer sa propre fiche sans changer de prénom.
  assert.ok('saisie' in verifier('Marie', 1));
});

test('une nouvelle fiche propose la première couleur libre', () => {
  const cles = [...couleurs.keys()];
  assert.equal(couleurLibre([]), cles[0]);
  assert.equal(couleurLibre([membre(1, 'A', null, cles[0]!)]), cles[1]);
  assert.equal(couleurLibre([membre(1, 'A', '2026-01-01', cles[0]!)]), cles[0], 'la couleur d’une désactivée est libre');
  assert.equal(couleurLibre(cles.map((cle, i) => membre(i + 1, `P${i}`, null, cle))), cles[0], 'toutes prises : la première');
});

test('chaque couleur proposée a son dessin dans la feuille de style', () => {
  const css = readFileSync(new URL('../backoffice/public/style.css', import.meta.url), 'utf8');
  for (const cle of couleurs.keys()) {
    assert.match(cle, /^[a-z]{1,20}$/, 'clé utilisable comme classe et acceptée par la base');
    assert.match(css, new RegExp(`\\.couleur-${cle} \\{ background: #[0-9A-F]{6}; \\}`), cle);
  }
});

test('l’équipe s’ajoute, se modifie, se désactive et se réactive sans jamais disparaître', () => {
  const base = ouvrirBase(':memory:');
  const id = ajouterMembre(base, marie);
  const autre = ajouterMembre(base, { prenom: 'Awa', couleur: 'corail' });
  assert.deepEqual(lireMembre(base, id), { id, prenom: 'Marie', couleur: 'ciel', desactiveLe: null });

  assert.equal(modifierMembre(base, id, { prenom: 'Marie L.', couleur: 'olive' }), true);
  assert.deepEqual(lireMembre(base, id), { id, prenom: 'Marie L.', couleur: 'olive', desactiveLe: null });
  assert.equal(modifierMembre(base, 999, marie), false);

  assert.equal(desactiverMembre(base, id, '2026-10-01'), true);
  assert.equal(desactiverMembre(base, id, '2026-10-22'), true);
  assert.equal(lireMembre(base, id)?.desactiveLe, '2026-10-01', 'la première date est gardée');
  assert.deepEqual(listerEquipe(base).map((m) => m.prenom), ['Awa', 'Marie L.']);
  assert.deepEqual(listerEquipeActive(base).map((m) => m.id), [autre]);

  assert.equal(reactiverMembre(base, id), true);
  assert.equal(lireMembre(base, id)?.desactiveLe, null);
  assert.equal(listerEquipeActive(base).length, 2);
  assert.equal(desactiverMembre(base, 999, '2026-10-22'), false);
  assert.equal(reactiverMembre(base, 999), false);
  base.close();
});

test('la base refuse une fiche incohérente même sans passer par le formulaire', () => {
  const base = ouvrirBase(':memory:');
  const inserer = base.prepare('INSERT INTO equipe (prenom, couleur) VALUES (?, ?)');
  assert.throws(() => inserer.run('', 'ciel'), /CHECK/);
  assert.throws(() => inserer.run('x'.repeat(31), 'ciel'), /CHECK/);
  assert.throws(() => inserer.run('Marie', ''), /CHECK/);
  assert.throws(() => inserer.run('Marie', null), /NOT NULL/);
  base.close();
});

test('écran Équipe : sans personne, la fiche propose d’ajouter une professionnelle', async (t) => {
  const { voir } = await connecte(t);
  const reponse = await voir('/equipe');
  assert.equal(reponse.status, 200);
  const html = await reponse.text();
  assert.match(html, /Personne dans l’équipe pour l’instant/);
  assert.match(html, /<h2 id="titre-fiche">Ajouter une professionnelle<\/h2>/);
  assert.match(html, /<form method="post" action="\/equipe">/);
  assert.equal(html.match(/type="radio" name="couleur"/g)?.length, couleurs.size);
  assert.match(html, /value="sapin" checked/);
  assert.ok(!html.includes('<table>'));
});

test('écran Équipe : la direction ajoute une professionnelle et la retrouve avec sa pastille', async (t) => {
  const { poster, voir, base } = await connecte(t);
  const reponse = await poster('/equipe', { prenom: 'Marie L.', couleur: 'ciel' });
  assert.equal(reponse.status, 303);
  const id = listerEquipe(base)[0]?.id;
  assert.equal(reponse.headers.get('location'), `/equipe?id=${id}&fait=ajoute&membre=${id}`);

  const html = await (await voir(reponse.headers.get('location')!)).text();
  assert.match(html, /<p class="succes" role="status">Fiche de Marie L\. ajoutée\.<\/p>/);
  assert.match(html, /1 professionnelle · /);
  assert.match(html, new RegExp(`<tr aria-current="true">\\s*<td><span class="pastille couleur-ciel" aria-hidden="true">ML</span> <a href="/equipe\\?id=${id}">Marie L\\.</a></td>\\s*<td>Ciel</td>`));
  assert.match(html, /<h2 id="titre-fiche">Marie L\.<\/h2>/);
  assert.match(html, new RegExp(`<form method="post" action="/equipe/${id}">`));
  assert.match(html, /value="ciel" checked/);
  assert.match(html, /Désactiver Marie L\./);

  // La fiche suivante propose une autre couleur que celle de Marie.
  assert.match(await (await voir('/equipe')).text(), /value="sapin" checked/);
});

test('écran Équipe : une modification est enregistrée', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/equipe', marie);
  const id = listerEquipe(base)[0]!.id;
  const reponse = await poster(`/equipe/${id}`, { prenom: 'Marie', couleur: 'ambre' });
  assert.equal(reponse.status, 303);
  assert.equal(reponse.headers.get('location'), `/equipe?id=${id}&fait=enregistre&membre=${id}`);
  assert.equal(lireMembre(base, id)?.couleur, 'ambre');
  assert.match(await (await voir(reponse.headers.get('location')!)).text(), /Fiche de Marie enregistrée\./);
});

test('écran Équipe : une erreur de saisie garde ce qui a été tapé', async (t) => {
  const { poster, base } = await connecte(t);
  await poster('/equipe', marie);
  const reponse = await poster('/equipe', { prenom: 'marie', couleur: 'olive' });
  assert.equal(reponse.status, 400);
  const html = await reponse.text();
  assert.match(html, /<p class="erreur" role="alert">Marie est déjà dans l’équipe : ajoutez l’initiale du nom \(ex\. Marie L\.\)\.<\/p>/);
  assert.match(html, /value="marie"/);
  assert.match(html, /value="olive" checked/);
  assert.equal(listerEquipe(base).length, 1);

  // Erreur sur une fiche existante : la fiche reste celle de la professionnelle.
  const id = listerEquipe(base)[0]!.id;
  const modif = await poster(`/equipe/${id}`, { prenom: 'Marie', couleur: 'rose' });
  assert.equal(modif.status, 400);
  const page = await modif.text();
  assert.match(page, /Choisissez une couleur\./);
  assert.match(page, new RegExp(`action="/equipe/${id}"`));
  assert.ok(!page.includes(' checked'), 'aucune couleur inventée n’est cochée');
  assert.equal(lireMembre(base, id)?.couleur, 'ciel');
});

test('écran Équipe : un prénom piégé est affiché comme du texte', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/equipe', { prenom: '<img src=x onerror=alert(1)>', couleur: 'ciel' });
  const id = listerEquipe(base)[0]!.id;
  const html = await (await voir(`/equipe?id=${id}`)).text();
  assert.ok(!html.includes('<img'), 'balise injectée');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('écran Équipe : désactiver retire la professionnelle de la liste, réactiver la remet', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/equipe', marie);
  await poster('/equipe', { prenom: 'Awa', couleur: 'corail' });
  const id = listerEquipe(base).find((m) => m.prenom === 'Marie')!.id;

  const desactive = await poster(`/equipe/${id}/desactiver`);
  assert.equal(desactive.status, 303);
  assert.equal(desactive.headers.get('location'), `/equipe?fait=desactive&membre=${id}`);
  assert.equal(lireMembre(base, id)?.desactiveLe, '2026-10-22');
  let html = await (await voir(desactive.headers.get('location')!)).text();
  assert.match(html, /Fiche de Marie désactivée\./);
  assert.match(html, /1 professionnelle · /);
  assert.ok(!html.includes(`href="/equipe?id=${id}"`));
  assert.match(html, /<summary>Professionnelles désactivées \(1\)<\/summary>/);
  assert.match(html, /Marie · désactivée le 22\/10\/2026/);
  assert.equal((await voir(`/equipe?id=${id}`)).status, 404);

  const reactive = await poster(`/equipe/${id}/reactiver`);
  assert.equal(reactive.status, 303);
  html = await (await voir(reactive.headers.get('location')!)).text();
  assert.match(html, /Fiche de Marie réactivée\./);
  assert.match(html, /2 professionnelles · /);
  assert.ok(!html.includes('désactivées'));
});

test('écran Équipe : pas de réactivation si une homonyme est arrivée entre-temps', async (t) => {
  const { poster, base } = await connecte(t);
  await poster('/equipe', marie);
  const ancienne = listerEquipe(base)[0]!.id;
  await poster(`/equipe/${ancienne}/desactiver`);
  assert.equal((await poster('/equipe', { prenom: 'Marie', couleur: 'olive' })).status, 303);

  const reponse = await poster(`/equipe/${ancienne}/reactiver`);
  assert.equal(reponse.status, 409);
  assert.match(await reponse.text(), /Impossible de réactiver : Marie est déjà dans l’équipe/);
  assert.equal(lireMembre(base, ancienne)?.desactiveLe, '2026-10-22');
});

test('écran Équipe : une professionnelle inconnue ou une adresse fantaisiste est refusée', async (t) => {
  const { poster, voir, base } = await connecte(t);
  for (const chemin of ['/equipe/999', '/equipe/999/desactiver', '/equipe/999/reactiver']) {
    const reponse = await poster(chemin, marie);
    assert.equal(reponse.status, 404, chemin);
    assert.match(await reponse.text(), /Cette professionnelle n’existe pas\./);
  }
  for (const id of ['999', 'abc', '0', '']) {
    assert.equal((await voir(`/equipe?id=${id}`)).status, 404, `id=${id}`);
  }
  // Chaque écran n'accepte que ses propres actions.
  await poster('/equipe', marie);
  await poster('/enfants', { prenom: 'Jade', naissance: '2024-03-02', jours: '1' });
  for (const chemin of ['/equipe/0', '/equipe/01', '/equipe/1/archiver', '/equipe/1/supprimer', '/enfants/1/desactiver', '/inconnu/1']) {
    assert.equal((await poster(chemin, marie)).status, 405, chemin);
  }
  assert.equal(listerEquipe(base)[0]?.desactiveLe, null);
  const html = await (await voir('/equipe?fait=ajoute&membre=abc')).text();
  assert.ok(!html.includes('class="succes"'));
});

test('écran Équipe : réservé à la direction et protégé contre les autres sites', async (t) => {
  const { adresse, poster, base } = await connecte(t);
  assert.equal((await page(adresse, '/equipe')).headers.get('location'), '/connexion');
  const sansSession = await envoyerFormulaire(adresse, '/equipe', marie);
  assert.equal(sansSession.headers.get('location'), '/connexion');
  for (const origine of [null, 'http://site-malveillant.example']) {
    assert.equal((await poster('/equipe', marie, origine)).status, 403, `origine ${origine}`);
  }
  assert.equal(listerEquipe(base).length, 0);

  await poster('/equipe', marie);
  const id = listerEquipe(base)[0]!.id;
  assert.equal((await poster(`/equipe/${id}/desactiver`, {}, 'http://site-malveillant.example')).status, 403);
  assert.equal(lireMembre(base, id)?.desactiveLe, null);
});

test('écran Équipe : méthodes permises', async (t) => {
  const { adresse, cookie } = await connecte(t);
  for (const [chemin, method, permis] of [
    ['/equipe', 'PUT', 'GET, HEAD, POST'],
    ['/equipe/1', 'GET', 'POST'],
    ['/equipe/1/desactiver', 'GET', 'POST'],
    ['/equipe/1', 'DELETE', 'POST'],
  ] as const) {
    const reponse = await page(adresse, chemin, cookie, method);
    assert.equal(reponse.status, 405, `${method} ${chemin}`);
    assert.equal(reponse.headers.get('allow'), permis, `${method} ${chemin}`);
  }
});

test('écran Équipe : une couleur inattendue en base est échappée dans la pastille', async (t) => {
  const { base, voir } = await connecte(t);
  // La base ne contrôle que la longueur de la couleur : on ne fait pas confiance à son contenu.
  base.prepare('INSERT INTO equipe (prenom, couleur) VALUES (?, ?)').run('Inès', 'x" data-piege="1');
  const html = await (await voir('/equipe')).text();
  assert.ok(!html.includes('data-piege="1"'), 'attribut injecté dans la page');
  assert.match(html, /couleur-x&quot; data-piege=&quot;1/);
});
