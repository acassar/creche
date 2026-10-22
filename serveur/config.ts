import { resolve } from 'node:path';

export interface Config {
  port: number;
  dossierDonnees: string;
}

// Par défaut, les données vont dans ./donnees à la racine du projet, quel que
// soit le dossier depuis lequel le serveur est lancé.
const dossierParDefaut = resolve(import.meta.dirname, '..', 'donnees');

export function lireConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: lirePort(env.PORT),
    dossierDonnees: lireDossier(env.CRECHE_DONNEES),
  };
}

function lirePort(valeur: string | undefined): number {
  if (valeur === undefined) return 8080;
  const port = Number(valeur);
  if (!/^\d+$/.test(valeur) || port > 65535) {
    throw new Error(`PORT invalide : « ${valeur} » (attendu : un nombre entre 0 et 65535).`);
  }
  return port;
}

function lireDossier(valeur: string | undefined): string {
  if (valeur === undefined) return dossierParDefaut;
  if (valeur.trim() === '') throw new Error('CRECHE_DONNEES est vide.');
  return resolve(valeur);
}
