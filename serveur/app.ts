import { createServer, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { versionSchema } from './base.ts';

export function creerServeur(base: DatabaseSync): Server {
  return createServer((requete, reponse) => {
    const { pathname } = new URL(requete.url ?? '/', 'http://localhost');

    if (requete.method === 'GET' && pathname === '/api/sante') {
      return envoyerJson(reponse, 200, { ok: true, schema: versionSchema(base) });
    }

    envoyerJson(reponse, 404, { erreur: 'Introuvable' });
  });
}

function envoyerJson(reponse: ServerResponse, statut: number, donnees: unknown): void {
  reponse.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(donnees));
}
