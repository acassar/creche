import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

// Seuls ces types de fichiers sont servis : tout autre fichier du dossier reste privé.
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Le navigateur ne charge que ce qui vient du serveur lui-même.
const politique = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/**
 * Cherche dans `dossier` le fichier demandé par `pathname`.
 * « / » donne index.html et « /enfants » donne enfants.html.
 * Renvoie le chemin absolu, ou null si la demande ne désigne pas un fichier servable.
 */
export function resoudreChemin(dossier: string, pathname: string): string | null {
  let chemin: string;
  try {
    chemin = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (chemin.includes('\0') || chemin.includes('\\')) return null;
  if (chemin.endsWith('/')) chemin += 'index';
  if (extname(chemin) === '') chemin += '.html';
  if (!(extname(chemin) in types)) return null;

  const racine = resolve(dossier);
  const complet = resolve(racine, `.${chemin}`);
  return complet.startsWith(racine + sep) ? complet : null;
}

export async function servirFichier(
  dossier: string,
  pathname: string,
  methode: string,
  reponse: ServerResponse,
): Promise<boolean> {
  const chemin = resoudreChemin(dossier, pathname);
  if (chemin === null) return false;

  let contenu: Buffer;
  try {
    contenu = await readFile(chemin);
  } catch {
    return false;
  }

  const type = types[extname(chemin)] ?? 'application/octet-stream';
  reponse.writeHead(200, {
    'Content-Type': type,
    'Content-Length': contenu.length,
    'Cache-Control': 'no-cache',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': politique } : {}),
  });
  reponse.end(methode === 'HEAD' ? undefined : contenu);
  return true;
}
