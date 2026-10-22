import { join, resolve } from 'node:path';
import { ouvrirBase } from './base.ts';
import { creerServeur } from './app.ts';

const dossierDonnees = resolve(process.env.CRECHE_DONNEES ?? 'donnees');
const port = Number(process.env.PORT ?? 8080);

const base = ouvrirBase(join(dossierDonnees, 'creche.sqlite'));
const serveur = creerServeur(base);

serveur.listen(port, () => {
  console.log(`Serveur crèche prêt sur le port ${port} (données : ${dossierDonnees})`);
});

function arreter(): void {
  serveur.close(() => {
    base.close();
    process.exit(0);
  });
}
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
