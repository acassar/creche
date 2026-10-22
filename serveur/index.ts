import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { lireConfig, type Config } from './config.ts';
import { ouvrirBase } from './base.ts';
import { creerServeur } from './app.ts';

let config: Config;
try {
  config = lireConfig(process.env);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
}

const base = ouvrirBase(join(config.dossierDonnees, 'creche.sqlite'));
const serveur = creerServeur(base);

serveur.listen(config.port, () => {
  const { port } = serveur.address() as AddressInfo;
  console.log(`Serveur crèche prêt sur le port ${port} (données : ${config.dossierDonnees})`);
});

function arreter(): void {
  serveur.close(() => {
    base.close();
    process.exit(0);
  });
}
process.once('SIGINT', arreter);
process.once('SIGTERM', arreter);
