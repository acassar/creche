import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { versionSchema } from './base.ts';
import { politique, servirFichier } from './statique.ts';
import { accueil, ecrans, rendrePage, type Page } from './pages.ts';
import { creerSessions } from './sessions.ts';
import { creerLimiteur } from './limiteur.ts';
import { hacher, longueurMinimale, verifier } from './mot-de-passe.ts';
import { enregistrerPremiereEmpreinte, lireEmpreinte } from './direction.ts';

const backofficeParDefaut = resolve(import.meta.dirname, '..', 'backoffice');

export const dureeSession = 30 * 60_000;
export const maxEchecs = 5;
export const dureeBlocage = 5 * 60_000;
const tailleMaxFormulaire = 4096;

// Envoyés sur toutes les réponses : pas d'affichage dans un cadre, pas de
// devinette de type par le navigateur, adresse transmise seulement au serveur lui-même
// (« no-referrer » ferait envoyer « Origin: null » aux formulaires, refusés ensuite).
const entetesSecurite = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

const pagesPrivees = new Map<string, Page>(
  [accueil, ...ecrans].map(({ chemin, titre, fichier }) => [chemin, { titre, fichier, privee: true, cheminActif: chemin }]),
);

export interface Options {
  dossierBackoffice?: string;
  // Horloge remplaçable pour tester l'expiration des sessions et le blocage.
  maintenant?: () => number;
}

export function creerServeur(base: DatabaseSync, options: Options = {}): Server {
  const dossier = options.dossierBackoffice ?? backofficeParDefaut;
  const sessions = creerSessions(dureeSession, options.maintenant);
  const limiteur = creerLimiteur(maxEchecs, dureeBlocage, options.maintenant);

  return createServer(async (requete, reponse) => {
    for (const [nom, valeur] of Object.entries(entetesSecurite)) reponse.setHeader(nom, valeur);
    try {
      await traiter(requete, reponse);
    } catch (erreur) {
      console.error(erreur);
      if (!reponse.headersSent) envoyerJson(reponse, 500, { erreur: 'Erreur interne' });
      else reponse.destroy();
    }
  });

  async function traiter(requete: IncomingMessage, reponse: ServerResponse): Promise<void> {
    const methode = requete.method ?? 'GET';
    const url = requete.url ?? '/';
    if (!URL.canParse(url, 'http://localhost')) {
      return envoyerJson(reponse, 400, { erreur: 'Adresse invalide' });
    }
    const { pathname } = new URL(url, 'http://localhost');
    const jeton = lireCookie(requete, 'session');
    const connecte = sessions.valider(jeton);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (pathname === '/api/sante') {
        if (methode !== 'GET') {
          reponse.setHeader('Allow', 'GET');
          return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
        }
        return envoyerJson(reponse, 200, { ok: true, schema: versionSchema(base) });
      }
      // Toute autre route d'API (dont les écritures des réglages) exige la direction.
      if (!connecte) return envoyerJson(reponse, 401, { erreur: 'Connexion requise' });
      return envoyerJson(reponse, 404, { erreur: 'Introuvable' });
    }

    if (methode === 'POST' && (pathname === '/connexion' || pathname === '/deconnexion')) {
      if (!origineValide(requete)) {
        reponse.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return void reponse.end('Requête refusée');
      }
      if (pathname === '/deconnexion') {
        sessions.fermer(jeton);
        return rediriger(reponse, '/connexion', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      }
      return seConnecter(requete, reponse);
    }

    if (methode !== 'GET' && methode !== 'HEAD') {
      reponse.setHeader('Allow', pathname === '/connexion' ? 'GET, HEAD, POST' : 'GET, HEAD');
      return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
    }

    if (pathname === '/connexion') {
      if (connecte) return rediriger(reponse, '/');
      return envoyerPage(reponse, methode, 200, pageConnexion(requete, ''));
    }

    const page = pagesPrivees.get(pathname);
    if (page) {
      if (!connecte) return rediriger(reponse, '/connexion');
      return envoyerPage(reponse, methode, 200, page);
    }

    if (await servirFichier(join(dossier, 'public'), pathname, methode, reponse)) return;

    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('Page introuvable');
  }

  async function seConnecter(requete: IncomingMessage, reponse: ServerResponse): Promise<void> {
    const adresse = requete.socket.remoteAddress ?? '';
    if (limiteur.bloque(adresse)) {
      return envoyerPage(reponse, 'POST', 429, pageConnexion(requete, 'Trop d’essais. Réessayez dans quelques minutes.'));
    }
    const champs = await lireFormulaire(requete);
    if (champs === null) {
      reponse.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      return void reponse.end('Formulaire trop long');
    }
    const motDePasse = champs.get('mot_de_passe') ?? '';
    const empreinte = lireEmpreinte(base);

    if (empreinte === undefined) {
      if (!estLocale(requete)) return envoyerPage(reponse, 'POST', 403, pageConnexion(requete, ''));
      if ([...motDePasse].length < longueurMinimale) {
        return envoyerPage(reponse, 'POST', 400, pageConnexion(requete, `Le mot de passe doit faire au moins ${longueurMinimale} caractères.`));
      }
      if (motDePasse !== champs.get('confirmation')) {
        return envoyerPage(reponse, 'POST', 400, pageConnexion(requete, 'Les deux mots de passe ne sont pas identiques.'));
      }
      if (!enregistrerPremiereEmpreinte(base, await hacher(motDePasse))) {
        return envoyerPage(reponse, 'POST', 409, pageConnexion(requete, 'Le mot de passe a déjà été choisi. Connectez-vous.'));
      }
      return ouvrirSession(reponse);
    }

    if (!(await verifier(motDePasse, empreinte))) {
      limiteur.echec(adresse);
      return envoyerPage(reponse, 'POST', 401, pageConnexion(requete, 'Mot de passe incorrect.'));
    }
    limiteur.reussite(adresse);
    return ouvrirSession(reponse);
  }

  function ouvrirSession(reponse: ServerResponse): void {
    // À compléter par « Secure » quand le serveur passera en HTTPS (I6).
    rediriger(reponse, '/', `session=${sessions.ouvrir()}; HttpOnly; SameSite=Strict; Path=/`);
  }

  // Sans mot de passe enregistré, la page propose de le choisir, mais
  // seulement sur le PC du bureau : une tablette du Wi-Fi ne peut pas le faire.
  function pageConnexion(requete: IncomingMessage, erreur: string): Page {
    const message = erreur === '' ? '' : `<p class="erreur" role="alert">${erreur}</p>`;
    if (lireEmpreinte(base) !== undefined) {
      return { titre: 'Connexion', fichier: 'connexion', valeurs: { message }, privee: false };
    }
    if (!estLocale(requete)) {
      return { titre: 'Premier lancement', fichier: 'premier-mot-de-passe-distant', privee: false };
    }
    return {
      titre: 'Premier lancement',
      fichier: 'premier-mot-de-passe',
      valeurs: { message, longueur: String(longueurMinimale) },
      privee: false,
    };
  }

  async function envoyerPage(reponse: ServerResponse, methode: string, statut: number, page: Page): Promise<void> {
    const html = Buffer.from(await rendrePage(dossier, page));
    reponse.writeHead(statut, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': politique,
    });
    reponse.end(methode === 'HEAD' ? undefined : html);
  }
}

function rediriger(reponse: ServerResponse, cible: string, cookie?: string): void {
  reponse.writeHead(303, { Location: cible, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) });
  reponse.end();
}

function envoyerJson(reponse: ServerResponse, statut: number, donnees: unknown): void {
  reponse.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(donnees));
}

function lireCookie(requete: IncomingMessage, nom: string): string | undefined {
  for (const morceau of (requete.headers.cookie ?? '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return valeur.join('=');
  }
  return undefined;
}

// Un formulaire ne peut être envoyé que depuis une page du serveur lui-même :
// un autre site ouvert dans le navigateur ne peut pas connecter ou déconnecter.
function origineValide(requete: IncomingMessage): boolean {
  const { origin, host } = requete.headers;
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`);
}

function estLocale(requete: IncomingMessage): boolean {
  const adresse = requete.socket.remoteAddress;
  return adresse === '127.0.0.1' || adresse === '::1' || adresse === '::ffff:127.0.0.1';
}

// Renvoie null si le formulaire dépasse la taille permise.
async function lireFormulaire(requete: IncomingMessage): Promise<URLSearchParams | null> {
  const morceaux: Buffer[] = [];
  let taille = 0;
  for await (const morceau of requete as AsyncIterable<Buffer>) {
    taille += morceau.length;
    if (taille > tailleMaxFormulaire) return null;
    morceaux.push(morceau);
  }
  return new URLSearchParams(Buffer.concat(morceaux).toString('utf8'));
}
