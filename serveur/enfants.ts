import type { DatabaseSync } from 'node:sqlite';

export interface Enfant {
  id: number;
  prenom: string;
  naissance: string; // AAAA-MM-JJ
  aSavoir: string;
  jours: number; // lundi = 1, mardi = 2, mercredi = 4, jeudi = 8, vendredi = 16
  archiveLe: string | null;
}

export type Saisie = Pick<Enfant, 'prenom' | 'naissance' | 'aSavoir' | 'jours'>;

export const joursDeLaSemaine = [
  { bit: 1, court: 'Lun', nom: 'Lundi' },
  { bit: 2, court: 'Mar', nom: 'Mardi' },
  { bit: 4, court: 'Mer', nom: 'Mercredi' },
  { bit: 8, court: 'Jeu', nom: 'Jeudi' },
  { bit: 16, court: 'Ven', nom: 'Vendredi' },
] as const;

export const tousLesJours = 31;
const longueurPrenom = 50;
const longueurASavoir = 200;
// Au-delà, c'est presque sûrement une faute de frappe dans l'année.
const ageMaximumEnAnnees = 7;

// Date du jour (heure du PC) au format AAAA-MM-JJ.
export function dateDuJour(maintenant: number): string {
  const jour = new Date(maintenant);
  return [jour.getFullYear(), jour.getMonth() + 1, jour.getDate()].map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('-');
}

function decouper(date: string): [number, number, number] {
  const [annee = 0, mois = 0, jour = 0] = date.split('-').map(Number);
  return [annee, mois, jour];
}

export function ageEnMois(naissance: string, aujourdhui: string): number {
  const [a1, m1, j1] = decouper(naissance);
  const [a2, m2, j2] = decouper(aujourdhui);
  return (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0);
}

export function ageLisible(naissance: string, aujourdhui: string): string {
  const mois = ageEnMois(naissance, aujourdhui);
  if (mois < 1) return 'moins d’un mois';
  if (mois < 24) return `${mois} mois`;
  const ans = Math.floor(mois / 12);
  const reste = mois % 12;
  return reste === 0 ? `${ans} ans` : `${ans} ans ${reste} mois`;
}

export function dateLisible(date: string): string {
  const [annee, mois, jour] = decouper(date);
  return `${String(jour).padStart(2, '0')}/${String(mois).padStart(2, '0')}/${annee}`;
}

export function joursLisibles(jours: number): string {
  if (jours === tousLesJours) return 'Tous les jours';
  return joursDeLaSemaine.filter(({ bit }) => jours & bit).map(({ court }) => court).join(', ');
}

function dateValide(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [annee, mois, jour] = decouper(date);
  const verif = new Date(Date.UTC(annee, mois - 1, jour));
  return verif.getUTCFullYear() === annee && verif.getUTCMonth() === mois - 1 && verif.getUTCDate() === jour;
}

// Lettres de contrôle (retour à la ligne, tabulation…) : jamais utiles dans un prénom ou une note courte.
const controle = /\p{Cc}/u;

/**
 * Vérifie le formulaire d'un enfant. Renvoie la saisie nettoyée, ou le
 * message d'erreur à montrer à la direction.
 */
export function verifierSaisie(champs: URLSearchParams, aujourdhui: string): { saisie: Saisie } | { erreur: string } {
  // NFC d'abord (un « é » tapé sur deux claviers différents est le même), et
  // les longueurs se vérifient ensuite, sur ce qui sera réellement enregistré.
  const prenom = (champs.get('prenom') ?? '').normalize('NFC').trim();
  const naissance = (champs.get('naissance') ?? '').trim();
  const aSavoir = (champs.get('a_savoir') ?? '').normalize('NFC').trim();
  const joursCoches = champs.getAll('jours');

  if (prenom === '') return { erreur: 'Indiquez le prénom.' };
  if ([...prenom].length > longueurPrenom) return { erreur: `Le prénom fait au plus ${longueurPrenom} caractères.` };
  if (controle.test(prenom)) return { erreur: 'Le prénom contient un caractère invalide.' };

  if (!dateValide(naissance)) return { erreur: 'Indiquez une date de naissance valide.' };
  if (naissance > aujourdhui) return { erreur: 'La date de naissance est dans le futur.' };
  if (ageEnMois(naissance, aujourdhui) >= ageMaximumEnAnnees * 12) {
    return { erreur: `La date de naissance donne plus de ${ageMaximumEnAnnees} ans : vérifiez l’année.` };
  }

  if ([...aSavoir].length > longueurASavoir) return { erreur: `« Allergie ou régime » fait au plus ${longueurASavoir} caractères.` };
  if (controle.test(aSavoir)) return { erreur: '« Allergie ou régime » contient un caractère invalide.' };

  let jours = 0;
  for (const coche of joursCoches) {
    const jour = joursDeLaSemaine.find(({ bit }) => String(bit) === coche);
    if (jour === undefined) return { erreur: 'Jour de présence inconnu.' };
    jours |= jour.bit;
  }
  if (jours === 0) return { erreur: 'Cochez au moins un jour de présence.' };

  return { saisie: { prenom, naissance, aSavoir, jours } };
}

interface Ligne {
  id: number;
  prenom: string;
  naissance: string;
  a_savoir: string;
  jours: number;
  archive_le: string | null;
}

function versEnfant(ligne: Ligne): Enfant {
  return {
    id: ligne.id,
    prenom: ligne.prenom,
    naissance: ligne.naissance,
    aSavoir: ligne.a_savoir,
    jours: ligne.jours,
    archiveLe: ligne.archive_le,
  };
}

const ordreAlphabetique = new Intl.Collator('fr', { sensitivity: 'base' });

// Tous les enfants, actifs et archivés, triés par prénom (« Élise » entre « Adam » et « Zoé »).
export function listerEnfants(base: DatabaseSync): Enfant[] {
  const lignes = base.prepare('SELECT * FROM enfants').all() as unknown as Ligne[];
  return lignes.map(versEnfant).sort((a, b) => ordreAlphabetique.compare(a.prenom, b.prenom) || a.id - b.id);
}

export function lireEnfant(base: DatabaseSync, id: number): Enfant | undefined {
  const ligne = base.prepare('SELECT * FROM enfants WHERE id = ?').get(id) as Ligne | undefined;
  return ligne === undefined ? undefined : versEnfant(ligne);
}

export function ajouterEnfant(base: DatabaseSync, saisie: Saisie): number {
  const resultat = base.prepare('INSERT INTO enfants (prenom, naissance, a_savoir, jours) VALUES (?, ?, ?, ?)')
    .run(saisie.prenom, saisie.naissance, saisie.aSavoir, saisie.jours);
  return Number(resultat.lastInsertRowid);
}

// Renvoie false si l'enfant n'existe pas.
export function modifierEnfant(base: DatabaseSync, id: number, saisie: Saisie): boolean {
  const resultat = base.prepare('UPDATE enfants SET prenom = ?, naissance = ?, a_savoir = ?, jours = ? WHERE id = ?')
    .run(saisie.prenom, saisie.naissance, saisie.aSavoir, saisie.jours, id);
  return resultat.changes === 1;
}

// Archiver garde la première date d'archivage ; réactiver l'efface. Renvoie false si l'enfant n'existe pas.
export function archiverEnfant(base: DatabaseSync, id: number, aujourdhui: string): boolean {
  const resultat = base.prepare('UPDATE enfants SET archive_le = coalesce(archive_le, ?) WHERE id = ?').run(aujourdhui, id);
  return resultat.changes === 1;
}

export function reactiverEnfant(base: DatabaseSync, id: number): boolean {
  return base.prepare('UPDATE enfants SET archive_le = NULL WHERE id = ?').run(id).changes === 1;
}
