import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../serveur/base.ts';
import { ajouterEnfant } from '../serveur/enfants.ts';
import {
  agesLisibles, ajouterBouton, boutonsPourAge, deplacerBouton, desactiverBouton, lireBouton, listerBoutons, modifierBouton,
  pourAge, reactiverBouton, verifierBouton, type Bouton, type SaisieBouton,
} from '../serveur/repas.ts';
import { choisirMotDePasse, demarrer, envoyerFormulaire, page } from './aide.ts';

// Le 22 octobre 2026 à midi, heure du PC.
const maintenant = () => new Date(2026, 9, 22, 12).getTime();

const plat = { libelle: 'Plat', comportement: 'appreciation', age_min: '', age_max: '' };
const biberon = { libelle: 'Biberon', comportement: 'quantite', age_min: '', age_max: '12' };

function bouton(id: number, libelle: string, ageMin: number | null, ageMax: number | null, desactiveLe: string | null = null): Bouton {
  return { id, libelle, comportement: 'compteur', ageMin, ageMax, ordre: id, desactiveLe };
}

function saisie(libelle: string, ageMin: number | null = null, ageMax: number | null = null, comportement = 'appreciation'): SaisieBouton {
  return { libelle, comportement, ageMin, ageMax };
}

async function connecte(t: Parameters<typeof demarrer>[0]) {
  const serveur = await demarrer(t, { maintenant });
  const cookie = await choisirMotDePasse(serveur.adresse);
  const poster = (chemin: string, champs: Record<string, string> = {}, origine: string | null = serveur.adresse) =>
    envoyerFormulaire(serveur.adresse, chemin, champs, { cookie, origine });
  const voir = (chemin: string) => page(serveur.adresse, chemin, cookie);
  return { ...serveur, cookie, poster, voir };
}

test('les tranches d’âge se lisent en clair, bornes comprises', () => {
  assert.equal(agesLisibles(null, null), 'Tous les âges');
  assert.equal(agesLisibles(null, 12), 'Jusqu’à 12 mois');
  assert.equal(agesLisibles(13, null), 'À partir de 13 mois');
  assert.equal(agesLisibles(12, 24), 'De 12 à 24 mois');
  assert.equal(agesLisibles(6, 6), '6 mois');

  const tranche = { ageMin: 12, ageMax: 24 };
  assert.deepEqual([11, 12, 18, 24, 25].map((age) => pourAge(tranche, age)), [false, true, true, true, false]);
  assert.ok(pourAge({ ageMin: null, ageMax: null }, 0));
  assert.ok(pourAge({ ageMin: null, ageMax: 12 }, 0));
  assert.ok(!pourAge({ ageMin: 13, ageMax: null }, 12));
});

test('une saisie correcte est nettoyée', () => {
  const champs = (valeurs: Record<string, string>) => new URLSearchParams(valeurs);
  assert.deepEqual(verifierBouton(champs({ libelle: ' Entrée ', comportement: 'appreciation', age_min: '', age_max: '' }), []),
    { saisie: saisie('Entrée') });
  assert.deepEqual(verifierBouton(champs({ libelle: 'Biberon', comportement: 'quantite', age_min: '0', age_max: ' 12 ' }), []),
    { saisie: saisie('Biberon', 0, 12, 'quantite') });
  assert.deepEqual(verifierBouton(champs({ libelle: 'Goûter', comportement: 'compteur', age_min: '84', age_max: '84' }), []),
    { saisie: saisie('Goûter', 84, 84, 'compteur') });
  // Des champs d'âge absents valent « pas de limite ».
  assert.deepEqual(verifierBouton(champs({ libelle: 'Eau', comportement: 'compteur' }), []), { saisie: saisie('Eau', null, null, 'compteur') });
});

test('une saisie incorrecte est refusée avec un message clair', () => {
  const base = { libelle: 'Plat', comportement: 'appreciation', age_min: '', age_max: '' };
  const cas: [Record<string, string>, RegExp][] = [
    [{ ...base, libelle: '' }, /Indiquez le libellé/],
    [{ ...base, libelle: 'x'.repeat(31) }, /au plus 30 caractères/],
    [{ ...base, libelle: 'Pl\tat' }, /caractère invalide/],
    [{ ...base, comportement: '' }, /Choisissez ce que fait le bouton/],
    [{ ...base, comportement: 'gramme' }, /Choisissez ce que fait le bouton/],
    [{ ...base, comportement: '__proto__' }, /Choisissez ce que fait le bouton/],
    [{ ...base, age_min: '-1' }, /de 0 à 84/],
    [{ ...base, age_min: '1.5' }, /de 0 à 84/],
    [{ ...base, age_min: 'douze' }, /de 0 à 84/],
    [{ ...base, age_max: '85' }, /de 0 à 84/],
    [{ ...base, age_max: '1e2' }, /de 0 à 84/],
    [{ ...base, age_max: '0012' }, /de 0 à 84/],
    [{ ...base, age_min: '24', age_max: '12' }, /début est après l’âge de fin/],
  ];
  for (const [valeurs, message] of cas) {
    const resultat = verifierBouton(new URLSearchParams(valeurs), []);
    assert.ok('erreur' in resultat, JSON.stringify(valeurs));
    assert.match(resultat.erreur, message, JSON.stringify(valeurs));
  }
  assert.ok('saisie' in verifierBouton(new URLSearchParams({ ...base, libelle: 'é'.repeat(30) }), []));
});

test('un même libellé est refusé seulement quand les âges se recoupent', () => {
  const boutons = [bouton(1, 'Plat', null, 12), bouton(2, 'Dessert', 13, null), bouton(3, 'Purée', null, null, '2026-01-01')];
  const verifier = (libelle: string, age_min: string, age_max: string, id?: number) =>
    verifierBouton(new URLSearchParams({ libelle, comportement: 'compteur', age_min, age_max }), boutons, id);

  assert.deepEqual(verifier('plat', '', ''), { erreur: 'Un bouton « Plat » existe déjà pour ces âges (jusqu’à 12 mois).' });
  assert.ok('erreur' in verifier('PLAT', '12', '24'), 'borne commune : 12 mois');
  assert.ok('saisie' in verifier('Plat', '13', ''), 'Plat des grands à côté de celui des bébés');
  assert.ok('erreur' in verifier('Dessert', '', '13'));
  assert.ok('saisie' in verifier('Dessert', '0', '12'));
  assert.ok('saisie' in verifier('Purée', '', ''), 'un bouton désactivé ne compte pas');
  assert.ok('saisie' in verifier('Plat', '', '24', 1), 'un bouton peut élargir sa propre tranche');
});

test('les boutons s’ajoutent en dernier, se réordonnent, se désactivent et se réactivent', () => {
  const base = ouvrirBase(':memory:');
  const entree = ajouterBouton(base, saisie('Entrée', 13));
  const platId = ajouterBouton(base, saisie('Plat'));
  const dessert = ajouterBouton(base, saisie('Dessert'));
  const ordre = () => listerBoutons(base).filter((b) => b.desactiveLe === null).map((b) => b.libelle);
  assert.deepEqual(ordre(), ['Entrée', 'Plat', 'Dessert']);
  assert.deepEqual(lireBouton(base, entree), { id: entree, libelle: 'Entrée', comportement: 'appreciation', ageMin: 13, ageMax: null, ordre: 1, desactiveLe: null });

  assert.equal(deplacerBouton(base, dessert, 'monter'), true);
  assert.deepEqual(ordre(), ['Entrée', 'Dessert', 'Plat']);
  assert.equal(deplacerBouton(base, entree, 'monter'), false, 'déjà en haut');
  assert.equal(deplacerBouton(base, platId, 'descendre'), false, 'déjà en bas');
  assert.equal(deplacerBouton(base, 999, 'monter'), false);

  // Un bouton désactivé est sauté : Plat passe directement au-dessus de Entrée.
  assert.equal(desactiverBouton(base, dessert, '2026-10-01'), true);
  assert.equal(desactiverBouton(base, dessert, '2026-10-22'), true);
  assert.equal(lireBouton(base, dessert)?.desactiveLe, '2026-10-01', 'la première date est gardée');
  assert.equal(deplacerBouton(base, platId, 'monter'), true);
  assert.deepEqual(ordre(), ['Plat', 'Entrée']);
  assert.equal(deplacerBouton(base, dessert, 'monter'), false, 'un bouton désactivé ne se déplace pas');

  assert.equal(reactiverBouton(base, dessert), true);
  assert.equal(listerBoutons(base).length, 3);
  assert.equal(modifierBouton(base, platId, saisie('Plat mixé', null, 12)), true);
  assert.equal(lireBouton(base, platId)?.libelle, 'Plat mixé');
  assert.equal(modifierBouton(base, 999, saisie('X')), false);
  assert.equal(desactiverBouton(base, 999, '2026-10-22'), false);
  assert.equal(reactiverBouton(base, 999), false);
  base.close();
});

test('la tablette reçoit les boutons actifs de l’âge de l’enfant, dans l’ordre', () => {
  const base = ouvrirBase(':memory:');
  const biberonId = ajouterBouton(base, saisie('Biberon', null, 12, 'quantite'));
  ajouterBouton(base, saisie('Entrée', 13));
  ajouterBouton(base, saisie('Plat'));
  const eau = ajouterBouton(base, saisie('Eau', 6, 24, 'compteur'));
  desactiverBouton(base, eau, '2026-10-22');
  deplacerBouton(base, biberonId, 'descendre');

  const libelles = (age: number) => boutonsPourAge(base, age).map((b) => b.libelle);
  // Ordre : Entrée, Biberon, Plat (Eau désactivé).
  assert.deepEqual(libelles(3), ['Biberon', 'Plat']);
  assert.deepEqual(libelles(12), ['Biberon', 'Plat']);
  assert.deepEqual(libelles(13), ['Entrée', 'Plat']);
  assert.deepEqual(libelles(40), ['Entrée', 'Plat']);
  base.close();
});

test('la base refuse un bouton incohérent même sans passer par le formulaire', () => {
  const base = ouvrirBase(':memory:');
  const inserer = base.prepare('INSERT INTO boutons_repas (libelle, comportement, age_min, age_max, ordre) VALUES (?, ?, ?, ?, 1)');
  assert.throws(() => inserer.run('', 'compteur', null, null), /CHECK/);
  assert.throws(() => inserer.run('x'.repeat(31), 'compteur', null, null), /CHECK/);
  assert.throws(() => inserer.run('Plat', 'gramme', null, null), /CHECK/);
  assert.throws(() => inserer.run('Plat', 'compteur', -1, null), /CHECK/);
  assert.throws(() => inserer.run('Plat', 'compteur', null, 85), /CHECK/);
  assert.throws(() => inserer.run('Plat', 'compteur', 24, 12), /CHECK/);
  assert.throws(() => inserer.run('Plat', 'compteur', 'douze', null), /cannot store TEXT/);
  base.close();
});

test('écran Repas : sans bouton, la fiche propose d’en ajouter un avec un exemple', async (t) => {
  const { voir } = await connecte(t);
  const reponse = await voir('/repas');
  assert.equal(reponse.status, 200);
  const html = await reponse.text();
  assert.match(html, /Aucun bouton pour l’instant\. Par exemple : « Biberon »/);
  assert.match(html, /<h2 id="titre-fiche">Ajouter un bouton<\/h2>/);
  assert.match(html, /<form method="post" action="\/repas">/);
  assert.equal(html.match(/type="radio" name="comportement"/g)?.length, 3);
  assert.match(html, /value="appreciation" checked/);
  assert.match(html, /name="age_min" type="number" min="0" max="84"/);
  assert.ok(!html.includes('<table>'));
});

test('écran Repas : la direction ajoute un bouton et voit combien d’enfants le verront', async (t) => {
  const { poster, voir, base } = await connecte(t);
  ajouterEnfant(base, { prenom: 'Mila', naissance: '2026-02-18', aSavoir: '', jours: 31 }); // 8 mois
  ajouterEnfant(base, { prenom: 'Jade', naissance: '2024-03-02', aSavoir: '', jours: 31 }); // 31 mois
  const archive = ajouterEnfant(base, { prenom: 'Léo', naissance: '2026-01-01', aSavoir: '', jours: 31 });
  base.prepare("UPDATE enfants SET archive_le = '2026-10-01' WHERE id = ?").run(archive);

  const reponse = await poster('/repas', biberon);
  assert.equal(reponse.status, 303);
  const id = listerBoutons(base)[0]?.id;
  assert.equal(reponse.headers.get('location'), `/repas?id=${id}&fait=ajoute&bouton=${id}`);

  const html = await (await voir(reponse.headers.get('location')!)).text();
  assert.match(html, /<p class="succes" role="status">Bouton « Biberon » ajouté\.<\/p>/);
  assert.match(html, /1 bouton · la tablette montre/);
  assert.match(html, new RegExp(`<tr aria-current="true">\\s*<td class="ordre"></td>\\s*<td><a href="/repas\\?id=${id}">Biberon</a></td>\\s*<td>Quantité en ml</td>\\s*<td>Jusqu’à 12 mois</td>\\s*<td>1 enfant</td>`));
  assert.match(html, /<h2 id="titre-fiche">Bouton « Biberon »<\/h2>/);
  assert.match(html, /value="quantite" checked/);
  assert.match(html, /name="age_max" type="number" min="0" max="84" step="1" value="12"/);
  assert.match(html, /Désactiver ce bouton/);

  await poster('/repas', { ...plat, age_min: '60' });
  assert.match(await (await voir('/repas')).text(), /<td>À partir de 60 mois<\/td>\s*<td><span class="vide">aucun<\/span><\/td>/);
});

test('écran Repas : les flèches changent l’ordre', async (t) => {
  const { poster, voir, base } = await connecte(t);
  for (const libelle of ['Entrée', 'Plat', 'Dessert']) await poster('/repas', { ...plat, libelle });
  const [entree, platId, dessert] = listerBoutons(base).map((b) => b.id);

  let html = await (await voir('/repas')).text();
  assert.ok(!html.includes(`/repas/${entree}/monter`), 'pas de flèche vers le haut pour le premier');
  assert.ok(!html.includes(`/repas/${dessert}/descendre`), 'pas de flèche vers le bas pour le dernier');
  assert.match(html, /aria-label="Monter « Plat »">↑<\/button>/);

  const reponse = await poster(`/repas/${dessert}/monter`);
  assert.equal(reponse.status, 303);
  assert.equal(reponse.headers.get('location'), '/repas');
  assert.deepEqual(listerBoutons(base).map((b) => b.id), [entree, dessert, platId]);
  html = await (await voir('/repas')).text();
  assert.ok(html.indexOf('>Dessert</a>') < html.indexOf('>Plat</a>'));

  // Au bout de la liste, la demande ne change rien.
  assert.equal((await poster(`/repas/${entree}/monter`)).status, 303);
  assert.deepEqual(listerBoutons(base).map((b) => b.id), [entree, dessert, platId]);
});

test('écran Repas : une erreur de saisie garde ce qui a été tapé', async (t) => {
  const { poster, base } = await connecte(t);
  await poster('/repas', plat);
  const reponse = await poster('/repas', { libelle: 'plat', comportement: 'compteur', age_min: '12', age_max: '24' });
  assert.equal(reponse.status, 400);
  const html = await reponse.text();
  assert.match(html, /<p class="erreur" role="alert">Un bouton « Plat » existe déjà pour ces âges \(tous les âges\)\.<\/p>/);
  assert.match(html, /value="plat"/);
  assert.match(html, /value="compteur" checked/);
  assert.match(html, /name="age_min" type="number" min="0" max="84" step="1" value="12"/);
  assert.match(html, /name="age_max" type="number" min="0" max="84" step="1" value="24"/);
  assert.equal(listerBoutons(base).length, 1);

  // Erreur sur un bouton existant : la fiche reste la sienne, rien n'est enregistré.
  const id = listerBoutons(base)[0]!.id;
  const modif = await poster(`/repas/${id}`, { ...plat, age_min: '"><b>' });
  assert.equal(modif.status, 400);
  const page = await modif.text();
  assert.match(page, new RegExp(`action="/repas/${id}"`));
  assert.match(page, /value="&quot;&gt;&lt;b&gt;"/);
  assert.equal(lireBouton(base, id)?.ageMin, null);
});

test('écran Repas : un libellé piégé est affiché comme du texte', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/repas', { ...plat, libelle: '<script>x</script>' });
  await poster('/repas', { ...plat, libelle: 'Dessert' });
  const id = listerBoutons(base)[0]!.id;
  const html = await (await voir(`/repas?id=${id}&fait=ajoute&bouton=${id}`)).text();
  assert.ok(!html.includes('<script>x'), 'balise injectée');
  assert.ok(html.includes('Bouton « &lt;script&gt;x&lt;/script&gt; » ajouté.'));
  assert.ok(html.includes('aria-label="Descendre « &lt;script&gt;x&lt;/script&gt; »"'));
});

test('écran Repas : désactiver retire le bouton de la liste, réactiver le remet', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/repas', plat);
  await poster('/repas', biberon);
  const id = listerBoutons(base)[0]!.id;

  const desactive = await poster(`/repas/${id}/desactiver`);
  assert.equal(desactive.status, 303);
  assert.equal(desactive.headers.get('location'), `/repas?fait=desactive&bouton=${id}`);
  let html = await (await voir(desactive.headers.get('location')!)).text();
  assert.match(html, /Bouton « Plat » désactivé\./);
  assert.match(html, /1 bouton · /);
  assert.match(html, /<summary>Boutons désactivés \(1\)<\/summary>/);
  assert.match(html, /Plat · Appréciation · tous les âges · désactivé le 22\/10\/2026/);
  assert.equal((await voir(`/repas?id=${id}`)).status, 404);

  const reactive = await poster(`/repas/${id}/reactiver`);
  assert.equal(reactive.status, 303);
  html = await (await voir(reactive.headers.get('location')!)).text();
  assert.match(html, /Bouton « Plat » réactivé\./);
  assert.match(html, /2 boutons · /);
});

test('écran Repas : pas de réactivation si un bouton du même nom couvre déjà ces âges', async (t) => {
  const { poster, base } = await connecte(t);
  await poster('/repas', plat);
  const ancien = listerBoutons(base)[0]!.id;
  await poster(`/repas/${ancien}/desactiver`);
  assert.equal((await poster('/repas', { ...plat, age_min: '13' })).status, 303);

  const reponse = await poster(`/repas/${ancien}/reactiver`);
  assert.equal(reponse.status, 409);
  assert.match(await reponse.text(), /Impossible de réactiver : Un bouton « Plat » existe déjà pour ces âges \(à partir de 13 mois\)/);
  assert.notEqual(lireBouton(base, ancien)?.desactiveLe, null);
});

test('écran Repas : un bouton inconnu ou une adresse fantaisiste est refusé', async (t) => {
  const { poster, voir, base } = await connecte(t);
  for (const chemin of ['/repas/999', '/repas/999/monter', '/repas/999/desactiver', '/repas/999/reactiver']) {
    const reponse = await poster(chemin, plat);
    assert.equal(reponse.status, 404, chemin);
    assert.match(await reponse.text(), /Ce bouton n’existe pas\./);
  }
  for (const id of ['999', 'abc', '0', '']) {
    assert.equal((await voir(`/repas?id=${id}`)).status, 404, `id=${id}`);
  }
  await poster('/repas', plat);
  for (const chemin of ['/repas/0', '/repas/1/archiver', '/repas/1/supprimer', '/equipe/1/monter']) {
    assert.equal((await poster(chemin, plat)).status, 405, chemin);
  }
  assert.equal(listerBoutons(base).length, 1);
  for (const fait of ['__proto__', 'constructor', 'inconnu']) {
    assert.ok(!(await (await voir(`/repas?fait=${fait}&bouton=1`)).text()).includes('class="succes"'), fait);
  }
});

test('écran Repas : réservé à la direction et protégé contre les autres sites', async (t) => {
  const { adresse, poster, base } = await connecte(t);
  assert.equal((await page(adresse, '/repas')).headers.get('location'), '/connexion');
  assert.equal((await envoyerFormulaire(adresse, '/repas', plat)).headers.get('location'), '/connexion');
  for (const origine of [null, 'http://site-malveillant.example']) {
    assert.equal((await poster('/repas', plat, origine)).status, 403, `origine ${origine}`);
  }
  assert.equal(listerBoutons(base).length, 0);

  await poster('/repas', plat);
  await poster('/repas', biberon);
  const [premier, second] = listerBoutons(base).map((b) => b.id);
  assert.equal((await poster(`/repas/${second}/monter`, {}, 'http://site-malveillant.example')).status, 403);
  assert.deepEqual(listerBoutons(base).map((b) => b.id), [premier, second]);
});

test('écran Repas : méthodes permises', async (t) => {
  const { adresse, cookie } = await connecte(t);
  for (const [chemin, method, permis] of [
    ['/repas', 'PUT', 'GET, HEAD, POST'],
    ['/repas/1', 'GET', 'POST'],
    ['/repas/1/monter', 'GET', 'POST'],
    ['/repas/1', 'DELETE', 'POST'],
  ] as const) {
    const reponse = await page(adresse, chemin, cookie, method);
    assert.equal(reponse.status, 405, `${method} ${chemin}`);
    assert.equal(reponse.headers.get('allow'), permis, `${method} ${chemin}`);
  }
});
