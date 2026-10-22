import type { DatabaseSync } from 'node:sqlite';
import { lireTexte, ordreAlphabetique } from './reglages.ts';

// Un bouton de l'écran Repas de la tablette (Entrée, Plat, Biberon…).
export interface Bouton {
  id: number;
  libelle: string;
  comportement: string; // une clé de `comportements`
  // Âges en mois révolus, bornes comprises ; null : pas de limite de ce côté.
  ageMin: number | null;
  ageMax: number | null;
  ordre: number;
  desactiveLe: string | null; // AAAA-MM-JJ
}

export type SaisieBouton = Pick<Bouton, 'libelle' | 'comportement' | 'ageMin' | 'ageMax'>;

// Ce que fait un tap sur le bouton, côté tablette.
export const comportements = new Map([
  ['compteur', { nom: 'Compteur', aide: 'chaque tap ajoute 1' }],
  ['appreciation', { nom: 'Appréciation', aide: 'Tout, Bien, Peu ou Rien' }],
  ['quantite', { nom: 'Quantité en ml', aide: 'la quantité bue, en ml' }],
]);

const longueurLibelle = 30;
// 7 ans : au-delà, aucun enfant de la crèche n'est concerné.
export const ageMaximum = 84;

// « Tous les âges », « Jusqu’à 12 mois », « À partir de 13 mois », « De 12 à 24 mois ».
export function agesLisibles(ageMin: number | null, ageMax: number | null): string {
  if (ageMin === null && ageMax === null) return 'Tous les âges';
  if (ageMin === null) return `Jusqu’à ${ageMax} mois`;
  if (ageMax === null) return `À partir de ${ageMin} mois`;
  if (ageMin === ageMax) return `${ageMin} mois`;
  return `De ${ageMin} à ${ageMax} mois`;
}

export function pourAge(bouton: Pick<Bouton, 'ageMin' | 'ageMax'>, ageEnMois: number): boolean {
  return (bouton.ageMin === null || ageEnMois >= bouton.ageMin) && (bouton.ageMax === null || ageEnMois <= bouton.ageMax);
}

// Deux tranches d'âge ont-elles au moins un âge en commun ?
function chevauchent(a: Pick<Bouton, 'ageMin' | 'ageMax'>, b: Pick<Bouton, 'ageMin' | 'ageMax'>): boolean {
  return Math.max(a.ageMin ?? 0, b.ageMin ?? 0) <= Math.min(a.ageMax ?? ageMaximum, b.ageMax ?? ageMaximum);
}

// Âge saisi : vide (pas de limite) ou un nombre entier de mois.
function lireAge(champs: URLSearchParams, nom: string): number | null | undefined {
  const texte = (champs.get(nom) ?? '').trim();
  if (texte === '') return null;
  if (!/^\d{1,3}$/.test(texte)) return undefined;
  const age = Number(texte);
  return age <= ageMaximum ? age : undefined;
}

/**
 * Vérifie le formulaire d'un bouton. `boutons` sert à refuser un libellé déjà
 * affiché au même âge : la tablette montrerait deux boutons identiques.
 */
export function verifierBouton(
  champs: URLSearchParams, boutons: readonly Bouton[], idModifie?: number,
): { saisie: SaisieBouton } | { erreur: string } {
  const libelle = lireTexte(champs, 'libelle', 'le libellé', longueurLibelle, true);
  if ('erreur' in libelle) return libelle;

  const comportement = champs.get('comportement') ?? '';
  if (!comportements.has(comportement)) return { erreur: 'Choisissez ce que fait le bouton.' };

  const ageMin = lireAge(champs, 'age_min');
  const ageMax = lireAge(champs, 'age_max');
  if (ageMin === undefined || ageMax === undefined) {
    return { erreur: `Les âges sont en mois, de 0 à ${ageMaximum}, ou vides pour ne pas limiter.` };
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { erreur: 'L’âge de début est après l’âge de fin.' };
  }

  const saisie = { libelle: libelle.texte, comportement, ageMin, ageMax };
  const doublon = homonyme(boutons, saisie, idModifie);
  if (doublon) return { erreur: messageHomonyme(doublon) };
  return { saisie };
}

// Autre bouton actif du même libellé dont la tranche d'âge recoupe celle-ci.
export function homonyme(boutons: readonly Bouton[], saisie: SaisieBouton, idModifie?: number): Bouton | undefined {
  return boutons.find((b) => b.id !== idModifie && b.desactiveLe === null
    && ordreAlphabetique.compare(b.libelle, saisie.libelle) === 0 && chevauchent(b, saisie));
}

export function messageHomonyme(bouton: Bouton): string {
  return `Un bouton « ${bouton.libelle} » existe déjà pour ces âges (${agesLisibles(bouton.ageMin, bouton.ageMax).toLowerCase()}).`;
}

interface Ligne {
  id: number;
  libelle: string;
  comportement: string;
  age_min: number | null;
  age_max: number | null;
  ordre: number;
  desactive_le: string | null;
}

function versBouton(ligne: Ligne): Bouton {
  return {
    id: ligne.id,
    libelle: ligne.libelle,
    comportement: ligne.comportement,
    ageMin: ligne.age_min,
    ageMax: ligne.age_max,
    ordre: ligne.ordre,
    desactiveLe: ligne.desactive_le,
  };
}

// Tous les boutons, actifs et désactivés, dans l'ordre d'affichage.
export function listerBoutons(base: DatabaseSync): Bouton[] {
  const lignes = base.prepare('SELECT * FROM boutons_repas ORDER BY ordre, id').all() as unknown as Ligne[];
  return lignes.map(versBouton);
}

// Les boutons que la tablette affiche à un enfant de cet âge, dans l'ordre.
export function boutonsPourAge(base: DatabaseSync, ageEnMois: number): Bouton[] {
  return listerBoutons(base).filter((b) => b.desactiveLe === null && pourAge(b, ageEnMois));
}

export function lireBouton(base: DatabaseSync, id: number): Bouton | undefined {
  const ligne = base.prepare('SELECT * FROM boutons_repas WHERE id = ?').get(id) as Ligne | undefined;
  return ligne === undefined ? undefined : versBouton(ligne);
}

// Un nouveau bouton se place en dernier.
export function ajouterBouton(base: DatabaseSync, saisie: SaisieBouton): number {
  const resultat = base.prepare(`INSERT INTO boutons_repas (libelle, comportement, age_min, age_max, ordre)
    VALUES (?, ?, ?, ?, (SELECT coalesce(max(ordre), 0) + 1 FROM boutons_repas))`)
    .run(saisie.libelle, saisie.comportement, saisie.ageMin, saisie.ageMax);
  return Number(resultat.lastInsertRowid);
}

// Renvoie false si le bouton n'existe pas.
export function modifierBouton(base: DatabaseSync, id: number, saisie: SaisieBouton): boolean {
  return base.prepare('UPDATE boutons_repas SET libelle = ?, comportement = ?, age_min = ?, age_max = ? WHERE id = ?')
    .run(saisie.libelle, saisie.comportement, saisie.ageMin, saisie.ageMax, id).changes === 1;
}

/**
 * Échange la place du bouton avec celle du bouton actif voisin (au-dessus
 * ou en dessous). Renvoie false s'il est déjà au bout, ou n'existe pas.
 */
export function deplacerBouton(base: DatabaseSync, id: number, sens: 'monter' | 'descendre'): boolean {
  const actifs = listerBoutons(base).filter((b) => b.desactiveLe === null);
  const position = actifs.findIndex((b) => b.id === id);
  const voisin = position === -1 ? undefined : actifs[sens === 'monter' ? position - 1 : position + 1];
  const bouton = actifs[position];
  if (bouton === undefined || voisin === undefined) return false;
  const placer = base.prepare('UPDATE boutons_repas SET ordre = ? WHERE id = ?');
  base.exec('BEGIN');
  try {
    placer.run(voisin.ordre, bouton.id);
    placer.run(bouton.ordre, voisin.id);
    base.exec('COMMIT');
  } catch (erreur) {
    base.exec('ROLLBACK');
    throw erreur;
  }
  return true;
}

// Désactiver garde la première date ; réactiver l'efface. Renvoie false si le bouton n'existe pas.
export function desactiverBouton(base: DatabaseSync, id: number, aujourdhui: string): boolean {
  return base.prepare('UPDATE boutons_repas SET desactive_le = coalesce(desactive_le, ?) WHERE id = ?').run(aujourdhui, id).changes === 1;
}

export function reactiverBouton(base: DatabaseSync, id: number): boolean {
  return base.prepare('UPDATE boutons_repas SET desactive_le = NULL WHERE id = ?').run(id).changes === 1;
}
