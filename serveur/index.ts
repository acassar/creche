import { lireConfig } from './config.ts';
import { demarrer, type ServeurDemarre } from './demarrage.ts';

let serveur: ServeurDemarre;
try {
  const config = lireConfig(process.env);
  serveur = await demarrer(config);
  console.log(`Serveur crèche prêt sur le port ${serveur.port} (données : ${config.dossierDonnees})`);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
}

// Sous Windows, seul Ctrl+C (SIGINT) arrive jusqu'ici. Un second signal
// n'est plus intercepté : il force l'arrêt.
function arreter(): void {
  serveur.arreter().then(() => process.exit(0), (erreur: unknown) => {
    console.error(erreur);
    process.exit(1);
  });
}
process.once('SIGINT', arreter);
process.once('SIGTERM', arreter);
