import type { Page } from './pages.ts';

// Ce qu'un écran de réglages répond : une page, ou une redirection après une écriture réussie.
export type Resultat = { statut: number; page: Page } | { redirection: string };

/**
 * Écran de réglages fait d'une liste et d'une fiche (enfants, équipe…). Le
 * serveur s'occupe du HTTP ; l'écran reçoit des champs déjà lus et répond.
 *   GET  <chemin>                 liste, fiche d'ajout ou ?id=N
 *   POST <chemin>                 ajoute
 *   POST <chemin>/N               enregistre la fiche N
 *   POST <chemin>/N/<action>      archiver, réactiver…
 */
export interface EcranFiches {
  chemin: string;
  actions: ReadonlySet<string>;
  afficher(parametres: URLSearchParams): Resultat;
  ecrire(champs: URLSearchParams, id: number | undefined, action: string | undefined): Resultat;
}

// Une Map, pour que « ?fait=constructor » ou « __proto__ » ne trouvent rien.
const participes = new Map([
  ['ajoute', 'ajoutée'],
  ['enregistre', 'enregistrée'],
  ['archive', 'archivée'],
  ['desactive', 'désactivée'],
  ['reactive', 'réactivée'],
]);

// Message affiché après une écriture réussie, d'après ?fait=… et le prénom concerné.
export function messageFait(fait: string | null, prenom: string | undefined): string | undefined {
  const participe = participes.get(fait ?? '');
  return participe && prenom !== undefined ? `Fiche de ${prenom} ${participe}.` : undefined;
}

// Identifiant d'enregistrement lu dans l'adresse : un entier positif, sinon undefined.
export function idDe(texte: string | null): number | undefined {
  return texte !== null && /^[1-9]\d{0,8}$/.test(texte) ? Number(texte) : undefined;
}

// Lettres de contrôle (retour à la ligne, tabulation…) : jamais utiles dans un prénom ou une note courte.
const controle = /\p{Cc}/u;

/**
 * Lit un champ texte. NFC d'abord (un « é » tapé sur deux claviers différents
 * est le même), puis les longueurs se vérifient sur ce qui sera réellement
 * enregistré. Renvoie le texte, ou le message d'erreur.
 */
export function lireTexte(
  champs: URLSearchParams, nom: string, libelle: string, longueurMax: number, obligatoire: boolean,
): { texte: string } | { erreur: string } {
  const texte = (champs.get(nom) ?? '').normalize('NFC').trim();
  if (obligatoire && texte === '') return { erreur: `Indiquez ${libelle}.` };
  if ([...texte].length > longueurMax) return { erreur: `${majuscule(libelle)} fait au plus ${longueurMax} caractères.` };
  if (controle.test(texte)) return { erreur: `${majuscule(libelle)} contient un caractère invalide.` };
  return { texte };
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

export const ordreAlphabetique = new Intl.Collator('fr', { sensitivity: 'base' });
