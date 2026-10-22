import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Config } from './config.ts';
import { ouvrirBase } from './base.ts';
import { creerServeur } from './app.ts';

export interface ServeurDemarre {
  port: number;
  arreter(): Promise<void>;
}

// Ouvre la base et lance le serveur. arreter() attend la fin des requêtes en
// cours puis referme la base : c'est l'arrêt propre, sur tous les systèmes.
export async function demarrer(config: Config): Promise<ServeurDemarre> {
  const base = ouvrirBase(join(config.dossierDonnees, 'creche.sqlite'));
  const serveur = creerServeur(base);
  try {
    await new Promise<void>((ok, echec) => {
      serveur.once('error', echec);
      serveur.listen(config.port, ok);
    });
  } catch (erreur) {
    base.close();
    if ((erreur as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Le port ${config.port} est déjà utilisé par un autre programme.`);
    }
    throw erreur;
  }

  return {
    port: (serveur.address() as AddressInfo).port,
    arreter: () => new Promise((ok, echec) => {
      serveur.close((erreur) => {
        base.close();
        if (erreur) echec(erreur);
        else ok();
      });
    }),
  };
}
