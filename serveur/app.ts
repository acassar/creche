import { createServer, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { versionSchema } from './base.ts';
import { servirFichier } from './statique.ts';

const backofficeParDefaut = resolve(import.meta.dirname, '..', 'backoffice');

// Envoyés sur toutes les réponses : pas d'affichage dans un cadre, pas de
// devinette de type par le navigateur, pas d'adresse transmise aux liens.
const entetesSecurite = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export function creerServeur(base: DatabaseSync, dossierBackoffice = backofficeParDefaut): Server {
  return createServer(async (requete, reponse) => {
    for (const [nom, valeur] of Object.entries(entetesSecurite)) reponse.setHeader(nom, valeur);
    try {
      await traiter(requete.method ?? 'GET', requete.url ?? '/', reponse);
    } catch (erreur) {
      console.error(erreur);
      if (!reponse.headersSent) envoyerJson(reponse, 500, { erreur: 'Erreur interne' });
      else reponse.destroy();
    }
  });

  async function traiter(methode: string, url: string, reponse: ServerResponse): Promise<void> {
    if (!URL.canParse(url, 'http://localhost')) {
      return envoyerJson(reponse, 400, { erreur: 'Adresse invalide' });
    }
    const { pathname } = new URL(url, 'http://localhost');

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (pathname !== '/api/sante') return envoyerJson(reponse, 404, { erreur: 'Introuvable' });
      if (methode !== 'GET') {
        reponse.setHeader('Allow', 'GET');
        return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
      }
      return envoyerJson(reponse, 200, { ok: true, schema: versionSchema(base) });
    }

    if (methode !== 'GET' && methode !== 'HEAD') {
      reponse.setHeader('Allow', 'GET, HEAD');
      return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
    }
    if (await servirFichier(dossierBackoffice, pathname, methode, reponse)) return;

    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('Page introuvable');
  }
}

function envoyerJson(reponse: ServerResponse, statut: number, donnees: unknown): void {
  reponse.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(donnees));
}
