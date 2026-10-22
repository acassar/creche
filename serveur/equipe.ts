import type { DatabaseSync } from 'node:sqlite';
import { lireTexte, ordreAlphabetique } from './reglages.ts';

// Une professionnelle de la crèche : c'est elle qui signera les saisies sur la tablette.
export interface Membre {
  id: number;
  prenom: string;
  couleur: string; // une clé de `couleurs`
  desactiveLe: string | null; // AAAA-MM-JJ
}

export type SaisieMembre = Pick<Membre, 'prenom' | 'couleur'>;

// Couleurs proposées pour reconnaître chacune d'un coup d'œil sur la tablette.
// Toutes assez foncées pour des initiales en blanc ; le dessin est dans
// backoffice/public/style.css (classe couleur-<clé>).
export const couleurs = new Map([
  ['sapin', 'Sapin'],
  ['ciel', 'Ciel'],
  ['lavande', 'Lavande'],
  ['framboise', 'Framboise'],
  ['corail', 'Corail'],
  ['ambre', 'Ambre'],
  ['olive', 'Olive'],
  ['ardoise', 'Ardoise'],
]);

const longueurPrenom = 30;

// « Marie » → « M », « Marie L. » ou « Marie-Laure » → « ML ».
export function initiales(prenom: string): string {
  return prenom.split(/[\s-]+/).filter((mot) => mot !== '').slice(0, 2)
    .map((mot) => [...mot][0] ?? '').join('').toLocaleUpperCase('fr');
}

/**
 * Vérifie le formulaire d'une professionnelle. `equipe` sert à refuser un
 * prénom déjà porté par une autre professionnelle active : sur la tablette,
 * on ne saurait pas qui a fait la saisie.
 */
export function verifierMembre(
  champs: URLSearchParams, equipe: readonly Membre[], idModifie?: number,
): { saisie: SaisieMembre } | { erreur: string } {
  const prenom = lireTexte(champs, 'prenom', 'le prénom', longueurPrenom, true);
  if ('erreur' in prenom) return prenom;
  const doublon = homonyme(equipe, prenom.texte, idModifie);
  if (doublon) return { erreur: messageHomonyme(doublon) };

  const couleur = champs.get('couleur') ?? '';
  if (!couleurs.has(couleur)) return { erreur: 'Choisissez une couleur.' };
  return { saisie: { prenom: prenom.texte, couleur } };
}

// Autre professionnelle active du même prénom (sans tenir compte des majuscules ni des accents).
export function homonyme(equipe: readonly Membre[], prenom: string, idModifie?: number): Membre | undefined {
  return equipe.find((m) => m.id !== idModifie && m.desactiveLe === null && ordreAlphabetique.compare(m.prenom, prenom) === 0);
}

export function messageHomonyme(membre: Membre): string {
  return `${membre.prenom} est déjà dans l’équipe : ajoutez l’initiale du nom (ex. ${membre.prenom} L.).`;
}

// Première couleur que personne d'active n'a encore, pour une nouvelle fiche.
export function couleurLibre(equipe: readonly Membre[]): string {
  const prises = new Set(equipe.filter((m) => m.desactiveLe === null).map((m) => m.couleur));
  return [...couleurs.keys()].find((cle) => !prises.has(cle)) ?? 'sapin';
}

interface Ligne {
  id: number;
  prenom: string;
  couleur: string;
  desactive_le: string | null;
}

function versMembre(ligne: Ligne): Membre {
  return { id: ligne.id, prenom: ligne.prenom, couleur: ligne.couleur, desactiveLe: ligne.desactive_le };
}

// Toute l'équipe, actives et désactivées, triée par prénom.
export function listerEquipe(base: DatabaseSync): Membre[] {
  const lignes = base.prepare('SELECT * FROM equipe').all() as unknown as Ligne[];
  return lignes.map(versMembre).sort((a, b) => ordreAlphabetique.compare(a.prenom, b.prenom) || a.id - b.id);
}

// Celles qui peuvent signer une saisie aujourd'hui (pour la tablette).
export function listerEquipeActive(base: DatabaseSync): Membre[] {
  return listerEquipe(base).filter((m) => m.desactiveLe === null);
}

export function lireMembre(base: DatabaseSync, id: number): Membre | undefined {
  const ligne = base.prepare('SELECT * FROM equipe WHERE id = ?').get(id) as Ligne | undefined;
  return ligne === undefined ? undefined : versMembre(ligne);
}

export function ajouterMembre(base: DatabaseSync, saisie: SaisieMembre): number {
  const resultat = base.prepare('INSERT INTO equipe (prenom, couleur) VALUES (?, ?)').run(saisie.prenom, saisie.couleur);
  return Number(resultat.lastInsertRowid);
}

// Renvoie false si la professionnelle n'existe pas.
export function modifierMembre(base: DatabaseSync, id: number, saisie: SaisieMembre): boolean {
  return base.prepare('UPDATE equipe SET prenom = ?, couleur = ? WHERE id = ?').run(saisie.prenom, saisie.couleur, id).changes === 1;
}

// Désactiver garde la première date ; réactiver l'efface. Renvoie false si la professionnelle n'existe pas.
export function desactiverMembre(base: DatabaseSync, id: number, aujourdhui: string): boolean {
  return base.prepare('UPDATE equipe SET desactive_le = coalesce(desactive_le, ?) WHERE id = ?').run(aujourdhui, id).changes === 1;
}

export function reactiverMembre(base: DatabaseSync, id: number): boolean {
  return base.prepare('UPDATE equipe SET desactive_le = NULL WHERE id = ?').run(id).changes === 1;
}
