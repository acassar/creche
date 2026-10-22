import type { DatabaseSync } from 'node:sqlite';

const cle = 'direction_mot_de_passe';

export function lireEmpreinte(base: DatabaseSync): string | undefined {
  const ligne = base.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle) as { valeur: string } | undefined;
  return ligne?.valeur;
}

// N'écrit que si aucun mot de passe n'existe encore : renvoie false sinon,
// pour que deux premiers choix simultanés ne s'écrasent pas.
export function enregistrerPremiereEmpreinte(base: DatabaseSync, empreinte: string): boolean {
  const resultat = base.prepare('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO NOTHING').run(cle, empreinte);
  return resultat.changes === 1;
}
