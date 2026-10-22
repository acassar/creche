import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../serveur/base.ts';
import {
  ageEnMois, ageLisible, ajouterEnfant, archiverEnfant, dateDuJour, dateLisible, joursLisibles, lireEnfant,
  listerEnfants, modifierEnfant, reactiverEnfant, verifierSaisie,
} from '../serveur/enfants.ts';
import { choisirMotDePasse, demarrer, envoyerFormulaire, page } from './aide.ts';

// Le 22 octobre 2026 à midi, heure du PC.
const maintenant = () => new Date(2026, 9, 22, 12).getTime();
const aujourdhui = '2026-10-22';

function champs(valeurs: Record<string, string | string[]>): URLSearchParams {
  const resultat = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    for (const v of [valeur].flat()) resultat.append(cle, v);
  }
  return resultat;
}

const jade = { prenom: 'Jade', naissance: '2024-03-02', a_savoir: 'Sans arachide', jours: ['1', '2', '8'] };

async function connecte(t: Parameters<typeof demarrer>[0]) {
  const serveur = await demarrer(t, { maintenant });
  const cookie = await choisirMotDePasse(serveur.adresse);
  // Comme envoyerFormulaire, mais accepte plusieurs valeurs par champ (cases à cocher).
  const poster = (chemin: string, valeurs: Record<string, string | string[]> = {}, origine: string | null = serveur.adresse) => {
    const entetes: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie };
    if (origine !== null) entetes.Origin = origine;
    return fetch(`${serveur.adresse}${chemin}`, { method: 'POST', redirect: 'manual', headers: entetes, body: champs(valeurs) });
  };
  const voir = async (chemin: string) => page(serveur.adresse, chemin, cookie);
  return { ...serveur, cookie, poster, voir };
}

test('dateDuJour donne la date du PC au format AAAA-MM-JJ', () => {
  assert.equal(dateDuJour(maintenant()), aujourdhui);
  assert.equal(dateDuJour(new Date(2026, 0, 5, 0, 0, 1).getTime()), '2026-01-05');
  assert.equal(dateDuJour(new Date(2026, 11, 31, 23, 59, 59).getTime()), '2026-12-31');
});

test('l’âge se compte en mois révolus, puis en ans au-delà de 2 ans', () => {
  const cas: [string, string, number, string][] = [
    ['2026-10-22', '2026-10-22', 0, 'moins d’un mois'],
    ['2026-09-23', '2026-10-22', 0, 'moins d’un mois'],
    ['2026-09-22', '2026-10-22', 1, '1 mois'],
    ['2026-01-31', '2026-02-28', 0, 'moins d’un mois'],
    ['2026-01-31', '2026-03-01', 1, '1 mois'],
    ['2024-02-29', '2025-02-28', 11, '11 mois'],
    ['2024-02-29', '2025-03-01', 12, '12 mois'],
    ['2024-10-23', '2026-10-22', 23, '23 mois'],
    ['2024-10-22', '2026-10-22', 24, '2 ans'],
    ['2023-07-15', '2026-10-22', 39, '3 ans 3 mois'],
    ['2025-12-31', '2026-01-01', 0, 'moins d’un mois'],
  ];
  for (const [naissance, jour, mois, texte] of cas) {
    assert.equal(ageEnMois(naissance, jour), mois, `${naissance} → ${jour}`);
    assert.equal(ageLisible(naissance, jour), texte, `${naissance} → ${jour}`);
  }
});

test('dates et jours s’affichent à la française', () => {
  assert.equal(dateLisible('2024-03-02'), '02/03/2024');
  assert.equal(joursLisibles(31), 'Tous les jours');
  assert.equal(joursLisibles(1 | 2 | 8), 'Lun, Mar, Jeu');
  assert.equal(joursLisibles(16), 'Ven');
});

test('une saisie correcte est nettoyée', () => {
  const resultat = verifierSaisie(champs({ prenom: '  Jade ', naissance: '2024-03-02', a_savoir: ' Sans arachide ', jours: ['1', '2', '8'] }), aujourdhui);
  assert.deepEqual(resultat, { saisie: { prenom: 'Jade', naissance: '2024-03-02', aSavoir: 'Sans arachide', jours: 11 } });

  const sansNote = verifierSaisie(champs({ prenom: 'Inès', naissance: aujourdhui, jours: '16' }), aujourdhui);
  assert.deepEqual(sansNote, { saisie: { prenom: 'Inès', naissance: aujourdhui, aSavoir: '', jours: 16 } });

  // Un « è » décomposé est enregistré sous sa forme composée.
  const decompose = verifierSaisie(champs({ prenom: 'Lèo', naissance: '2025-01-01', jours: '1' }), aujourdhui);
  assert.ok('saisie' in decompose && decompose.saisie.prenom === 'Lèo');

  // Un jour coché deux fois ne compte qu'une fois.
  const double = verifierSaisie(champs({ prenom: 'Tom', naissance: '2025-01-01', jours: ['4', '4'] }), aujourdhui);
  assert.ok('saisie' in double && double.saisie.jours === 4);
});

test('une saisie incorrecte est refusée avec un message clair', () => {
  const base = { prenom: 'Jade', naissance: '2024-03-02', jours: '1' };
  const cas: [Record<string, string | string[]>, RegExp][] = [
    [{ ...base, prenom: '' }, /Indiquez le prénom/],
    [{ ...base, prenom: '   ' }, /Indiquez le prénom/],
    [{ naissance: '2024-03-02', jours: '1' }, /Indiquez le prénom/],
    [{ ...base, prenom: 'x'.repeat(51) }, /au plus 50 caractères/],
    [{ ...base, prenom: 'Ja\nde' }, /caractère invalide/],
    [{ ...base, prenom: 'Ja\u0000de' }, /caractère invalide/],
    [{ ...base, naissance: '' }, /date de naissance valide/],
    [{ ...base, naissance: '02/03/2024' }, /date de naissance valide/],
    [{ ...base, naissance: '2024-02-30' }, /date de naissance valide/],
    [{ ...base, naissance: '2025-02-29' }, /date de naissance valide/],
    [{ ...base, naissance: '2024-13-01' }, /date de naissance valide/],
    [{ ...base, naissance: '2024-3-2' }, /date de naissance valide/],
    [{ ...base, naissance: '2026-10-23' }, /dans le futur/],
    [{ ...base, naissance: '2019-10-22' }, /plus de 7 ans/],
    [{ ...base, a_savoir: 'x'.repeat(201) }, /au plus 200 caractères/],
    [{ ...base, a_savoir: 'lait\tHA' }, /caractère invalide/],
    [{ prenom: 'Jade', naissance: '2024-03-02' }, /au moins un jour/],
    [{ ...base, jours: '32' }, /Jour de présence inconnu/],
    [{ ...base, jours: '3' }, /Jour de présence inconnu/],
    [{ ...base, jours: 'lundi' }, /Jour de présence inconnu/],
  ];
  for (const [valeurs, message] of cas) {
    const resultat = verifierSaisie(champs(valeurs), aujourdhui);
    assert.ok('erreur' in resultat, JSON.stringify(valeurs));
    assert.match(resultat.erreur, message, JSON.stringify(valeurs));
  }
  // Limites exactes acceptées.
  assert.ok('saisie' in verifierSaisie(champs({ ...base, prenom: 'é'.repeat(50), a_savoir: 'é'.repeat(200) }), aujourdhui));
  assert.ok('saisie' in verifierSaisie(champs({ ...base, naissance: '2019-10-23' }), aujourdhui));
});

test('les enfants s’ajoutent, se modifient, s’archivent et se réactivent sans jamais disparaître', () => {
  const base = ouvrirBase(':memory:');
  const id = ajouterEnfant(base, { prenom: 'Jade', naissance: '2024-03-02', aSavoir: '', jours: 31 });
  assert.deepEqual(lireEnfant(base, id), { id, prenom: 'Jade', naissance: '2024-03-02', aSavoir: '', jours: 31, archiveLe: null });

  assert.equal(modifierEnfant(base, id, { prenom: 'Jade', naissance: '2024-03-03', aSavoir: 'Lait HA', jours: 3 }), true);
  assert.equal(lireEnfant(base, id)?.aSavoir, 'Lait HA');
  assert.equal(modifierEnfant(base, 999, { prenom: 'X', naissance: '2024-03-03', aSavoir: '', jours: 1 }), false);

  assert.equal(archiverEnfant(base, id, '2026-10-01'), true);
  assert.equal(archiverEnfant(base, id, '2026-10-22'), true);
  assert.equal(lireEnfant(base, id)?.archiveLe, '2026-10-01', 'la première date d’archivage est gardée');
  assert.equal(listerEnfants(base).length, 1, 'un enfant archivé reste en base');

  assert.equal(reactiverEnfant(base, id), true);
  assert.equal(lireEnfant(base, id)?.archiveLe, null);
  assert.equal(archiverEnfant(base, 999, aujourdhui), false);
  assert.equal(reactiverEnfant(base, 999), false);
  base.close();
});

test('la base refuse une fiche incohérente même sans passer par le formulaire', () => {
  const base = ouvrirBase(':memory:');
  const inserer = base.prepare('INSERT INTO enfants (prenom, naissance, a_savoir, jours) VALUES (?, ?, ?, ?)');
  assert.throws(() => inserer.run('', '2024-03-02', '', 1), /CHECK/);
  assert.throws(() => inserer.run('Jade', '02/03/2024', '', 1), /CHECK/);
  assert.throws(() => inserer.run('Jade', '2024-03-02', '', 0), /CHECK/);
  assert.throws(() => inserer.run('Jade', '2024-03-02', '', 32), /CHECK/);
  assert.throws(() => inserer.run('Jade', '2024-03-02', 'x'.repeat(201), 1), /CHECK/);
  base.close();
});

test('la liste est triée par prénom à la française', () => {
  const base = ouvrirBase(':memory:');
  for (const prenom of ['Zoé', 'élise', 'Adam', 'Émile', 'eva']) {
    ajouterEnfant(base, { prenom, naissance: '2024-01-01', aSavoir: '', jours: 31 });
  }
  assert.deepEqual(listerEnfants(base).map((e) => e.prenom), ['Adam', 'élise', 'Émile', 'eva', 'Zoé']);
  base.close();
});

test('écran Enfants : sans enfant, la fiche propose d’en ajouter un', async (t) => {
  const { voir } = await connecte(t);
  const reponse = await voir('/enfants');
  assert.equal(reponse.status, 200);
  const html = await reponse.text();
  assert.match(html, /Aucun enfant inscrit pour l’instant/);
  assert.match(html, /<h2 id="titre-fiche">Ajouter un enfant<\/h2>/);
  assert.match(html, /<form method="post" action="\/enfants">/);
  assert.match(html, /max="2026-10-22"/);
  assert.equal(html.match(/type="checkbox" name="jours" value="\d+" checked/g)?.length, 5, 'tous les jours cochés par défaut');
  assert.ok(!html.includes('<table>'));
});

test('écran Enfants : la direction crée un enfant et le retrouve avec son âge', async (t) => {
  const { poster, voir, base } = await connecte(t);
  const reponse = await poster('/enfants', jade);
  assert.equal(reponse.status, 303);
  const id = listerEnfants(base)[0]?.id;
  assert.equal(reponse.headers.get('location'), `/enfants?id=${id}&fait=ajoute&enfant=${id}`);

  const html = await (await voir(reponse.headers.get('location')!)).text();
  assert.match(html, /<p class="succes" role="status">Fiche de Jade ajoutée\.<\/p>/);
  assert.match(html, /1 enfant · l’âge est calculé/);
  assert.match(html, new RegExp(`<tr aria-current="true">\\s*<td><a href="/enfants\\?id=${id}">Jade</a></td>\\s*<td>02/03/2024</td>\\s*<td>2 ans 7 mois</td>\\s*<td><span class="a-savoir">Sans arachide</span></td>\\s*<td>Lun, Mar, Jeu</td>`));
  assert.match(html, /<h2 id="titre-fiche">Jade<\/h2>/);
  assert.match(html, /<p class="age">2 ans 7 mois<\/p>/);
  assert.match(html, new RegExp(`<form method="post" action="/enfants/${id}">`));
  assert.match(html, /value="1" checked> Lundi/);
  assert.match(html, /value="4"> Mercredi/);
  assert.match(html, /Archiver Jade/);
});

test('écran Enfants : une modification est enregistrée', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/enfants', jade);
  const id = listerEnfants(base)[0]!.id;

  const reponse = await poster(`/enfants/${id}`, { prenom: 'Jade', naissance: '2024-03-02', a_savoir: '', jours: ['16'] });
  assert.equal(reponse.status, 303);
  assert.equal(reponse.headers.get('location'), `/enfants?id=${id}&fait=enregistre&enfant=${id}`);
  assert.deepEqual(lireEnfant(base, id), { id, prenom: 'Jade', naissance: '2024-03-02', aSavoir: '', jours: 16, archiveLe: null });
  const html = await (await voir(reponse.headers.get('location')!)).text();
  assert.match(html, /Fiche de Jade enregistrée\./);
  assert.match(html, /<td><span class="vide">—<\/span><\/td>\s*<td>Ven<\/td>/);
});

test('écran Enfants : une erreur de saisie garde ce qui a été tapé', async (t) => {
  const { poster, base } = await connecte(t);
  const reponse = await poster('/enfants', { prenom: 'Léo', naissance: '2027-01-01', a_savoir: 'Lait "HA"', jours: ['2', '16'] });
  assert.equal(reponse.status, 400);
  const html = await reponse.text();
  assert.match(html, /<p class="erreur" role="alert">La date de naissance est dans le futur\.<\/p>/);
  assert.match(html, /value="Léo"/);
  assert.match(html, /value="2027-01-01"/);
  assert.match(html, /value="Lait &quot;HA&quot;"/);
  assert.match(html, /value="2" checked> Mardi/);
  assert.match(html, /value="1"> Lundi/);
  assert.equal(listerEnfants(base).length, 0);

  // Erreur sur une fiche existante : la fiche reste celle de l'enfant.
  await poster('/enfants', jade);
  const id = listerEnfants(base)[0]!.id;
  const modif = await poster(`/enfants/${id}`, { prenom: '', naissance: '2024-03-02', jours: '1' });
  assert.equal(modif.status, 400);
  assert.match(await modif.text(), new RegExp(`action="/enfants/${id}"`));
  assert.equal(lireEnfant(base, id)?.prenom, 'Jade');
});

test('écran Enfants : un prénom piégé est affiché comme du texte', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/enfants', { prenom: '<script>alert(1)</script>', naissance: '2024-03-02', a_savoir: '<b>x</b>', jours: '1' });
  const id = listerEnfants(base)[0]!.id;
  const html = await (await voir(`/enfants?id=${id}`)).text();
  assert.ok(!html.includes('<script>alert(1)'), 'balise script injectée');
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('écran Enfants : archiver retire l’enfant de la liste, réactiver le remet', async (t) => {
  const { poster, voir, base } = await connecte(t);
  await poster('/enfants', jade);
  await poster('/enfants', { ...jade, prenom: 'Noah' });
  const id = listerEnfants(base).find((e) => e.prenom === 'Jade')!.id;

  const archive = await poster(`/enfants/${id}/archiver`);
  assert.equal(archive.status, 303);
  assert.equal(archive.headers.get('location'), `/enfants?fait=archive&enfant=${id}`);
  assert.equal(lireEnfant(base, id)?.archiveLe, aujourdhui);
  let html = await (await voir(archive.headers.get('location')!)).text();
  assert.match(html, /Fiche de Jade archivée\./);
  assert.match(html, /1 enfant · /);
  assert.ok(!html.includes(`href="/enfants?id=${id}"`), 'enfant archivé encore dans la liste');
  assert.match(html, /<summary>Enfants archivés \(1\)<\/summary>/);
  assert.match(html, /Jade · né\(e\) le 02\/03\/2024 · archivé le 22\/10\/2026/);

  const fiche = await voir(`/enfants?id=${id}`);
  assert.equal(fiche.status, 404);
  assert.match(await fiche.text(), /n’existe pas ou a été archivé/);

  const reactive = await poster(`/enfants/${id}/reactiver`);
  assert.equal(reactive.status, 303);
  html = await (await voir(reactive.headers.get('location')!)).text();
  assert.match(html, /Fiche de Jade réactivée\./);
  assert.match(html, /2 enfants · /);
  assert.ok(!html.includes('Enfants archivés'));
});

test('écran Enfants : un enfant inconnu ou une adresse fantaisiste est refusé', async (t) => {
  const { poster, voir, base } = await connecte(t);
  for (const chemin of ['/enfants/999', '/enfants/999/archiver', '/enfants/999/reactiver']) {
    const reponse = await poster(chemin, jade);
    assert.equal(reponse.status, 404, chemin);
    assert.match(await reponse.text(), /Cet enfant n’existe pas\./);
  }
  for (const id of ['999', 'abc', '0', '-1', '1.5', '']) {
    assert.equal((await voir(`/enfants?id=${id}`)).status, 404, `id=${id}`);
  }
  // Adresses qui ne désignent aucune fiche : refusées comme toute page sans écriture.
  for (const chemin of ['/enfants/0', '/enfants/abc', '/enfants/1/supprimer', '/enfants/01']) {
    assert.equal((await poster(chemin, jade)).status, 405, chemin);
  }
  assert.equal(listerEnfants(base).length, 0);
  // Un message « fait » sans enfant valide est simplement ignoré.
  const html = await (await voir('/enfants?fait=ajoute&enfant=abc')).text();
  assert.ok(!html.includes('class="succes"'));
});

test('écran Enfants : réservé à la direction et protégé contre les autres sites', async (t) => {
  const { adresse, poster, base } = await connecte(t);
  assert.equal((await page(adresse, '/enfants')).headers.get('location'), '/connexion');
  const sansSession = await envoyerFormulaire(adresse, '/enfants', { prenom: 'Jade', naissance: '2024-03-02', jours: '1' });
  assert.equal(sansSession.status, 303);
  assert.equal(sansSession.headers.get('location'), '/connexion');

  for (const origine of [null, 'http://site-malveillant.example']) {
    assert.equal((await poster('/enfants', jade, origine)).status, 403, `origine ${origine}`);
  }
  assert.equal(listerEnfants(base).length, 0);

  await poster('/enfants', jade);
  const id = listerEnfants(base)[0]!.id;
  assert.equal((await poster(`/enfants/${id}/archiver`, {}, 'http://site-malveillant.example')).status, 403);
  assert.equal(lireEnfant(base, id)?.archiveLe, null);
});

test('écran Enfants : méthodes permises', async (t) => {
  const { adresse, cookie } = await connecte(t);
  for (const [chemin, method, permis] of [
    ['/enfants', 'PUT', 'GET, HEAD, POST'],
    ['/enfants', 'DELETE', 'GET, HEAD, POST'],
    ['/enfants/1', 'GET', 'POST'],
    ['/enfants/1/archiver', 'GET', 'POST'],
    ['/enfants/1', 'DELETE', 'POST'],
  ] as const) {
    const reponse = await page(adresse, chemin, cookie, method);
    assert.equal(reponse.status, 405, `${method} ${chemin}`);
    assert.equal(reponse.headers.get('allow'), permis, `${method} ${chemin}`);
  }
});
