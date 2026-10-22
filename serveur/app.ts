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
import type { EcranFiches, Resultat } from './reglages.ts';
import { ecranEnfants } from './ecran-enfants.ts';
import { ecranEquipe } from './ecran-equipe.ts';

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

// /enfants/12 (enregistrer la fiche 12), /enfants/12/archiver…
const routeFiche = /^(\/[a-z]+)\/([1-9]\d{0,8})(?:\/([a-z]+))?$/;

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
  const maintenant = options.maintenant ?? Date.now;
  const sessions = creerSessions(dureeSession, options.maintenant);
  const limiteur = creerLimiteur(maxEchecs, dureeBlocage, options.maintenant);
  const ecransFiches = new Map<string, EcranFiches>(
    [ecranEnfants(base, maintenant), ecranEquipe(base, maintenant)].map((ecran) => [ecran.chemin, ecran]),
  );

  // L'écran de fiches que désigne l'adresse : sa liste, ou une fiche (et une action permise).
  function trouverFiches(pathname: string): { ecran: EcranFiches; id?: number; action?: string } | undefined {
    const liste = ecransFiches.get(pathname);
    if (liste) return { ecran: liste };
    const [, chemin = '', id, action] = routeFiche.exec(pathname) ?? [];
    const ecran = ecransFiches.get(chemin);
    if (!ecran || (action !== undefined && !ecran.actions.has(action))) return undefined;
    return { ecran, id: Number(id), ...(action === undefined ? {} : { action }) };
  }

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
    const { pathname, searchParams } = new URL(url, 'http://localhost');
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
      // Toute autre route d'API (dont les écritures des réglages) exige la direction,
      // et une écriture doit venir d'une page du serveur lui-même.
      if (!connecte) return envoyerJson(reponse, 401, { erreur: 'Connexion requise' });
      if (methode !== 'GET' && methode !== 'HEAD' && !origineValide(requete)) {
        return envoyerJson(reponse, 403, { erreur: 'Requête refusée' });
      }
      return envoyerJson(reponse, 404, { erreur: 'Introuvable' });
    }

    const fiches = trouverFiches(pathname);
    const fiche = fiches?.id !== undefined;

    if (methode === 'POST' && (pathname === '/connexion' || pathname === '/deconnexion' || fiches)) {
      // Toute écriture doit venir d'une page du serveur lui-même : un autre
      // site ouvert dans le navigateur ne peut rien envoyer à sa place.
      if (!origineValide(requete)) {
        reponse.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return void reponse.end('Requête refusée');
      }
      if (pathname === '/deconnexion') {
        sessions.fermer(jeton);
        return rediriger(reponse, '/connexion', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      }
      if (pathname === '/connexion') return seConnecter(requete, reponse);
      if (!connecte || !fiches) return rediriger(reponse, '/connexion');
      const champs = await lireFormulaire(requete);
      if (champs === null) {
        reponse.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
        return void reponse.end('Formulaire trop long');
      }
      return repondre(reponse, 'POST', fiches.ecran.ecrire(champs, fiches.id, fiches.action));
    }

    if (methode !== 'GET' && methode !== 'HEAD') {
      const permis = fiche ? 'POST' : pathname === '/connexion' || fiches ? 'GET, HEAD, POST' : 'GET, HEAD';
      reponse.setHeader('Allow', permis);
      return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
    }
    if (fiche) {
      reponse.setHeader('Allow', 'POST');
      return envoyerJson(reponse, 405, { erreur: 'Méthode non autorisée' });
    }

    if (pathname === '/connexion') {
      if (connecte) return rediriger(reponse, '/');
      return envoyerPage(reponse, methode, 200, pageConnexion(requete, ''));
    }

    const page = pagesPrivees.get(pathname);
    if (page) {
      if (!connecte) return rediriger(reponse, '/connexion');
      if (fiches) return repondre(reponse, methode, fiches.ecran.afficher(searchParams));
      return envoyerPage(reponse, methode, 200, page);
    }

    if (await servirFichier(join(dossier, 'public'), pathname, methode, reponse)) return;

    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('Page introuvable');
  }

  async function seConnecter(requete: IncomingMessage, reponse: ServerResponse): Promise<void> {
    const adresse = requete.socket.remoteAddress ?? '';
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

    // L'essai compte comme un échec avant même la vérification (asynchrone) :
    // des essais envoyés tous en même temps sont ainsi bloqués eux aussi.
    if (limiteur.bloque(adresse)) {
      return envoyerPage(reponse, 'POST', 429, pageConnexion(requete, 'Trop d’essais. Réessayez dans quelques minutes.'));
    }
    limiteur.echec(adresse);
    if (!(await verifier(motDePasse, empreinte))) {
      return envoyerPage(reponse, 'POST', 401, pageConnexion(requete, 'Mot de passe incorrect.'));
    }
    limiteur.reussite(adresse);
    return ouvrirSession(reponse);
  }

  function repondre(reponse: ServerResponse, methode: string, resultat: Resultat): Promise<void> | void {
    if ('redirection' in resultat) return rediriger(reponse, resultat.redirection);
    return envoyerPage(reponse, methode, resultat.statut, resultat.page);
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

// La requête vient du PC lui-même, et sous un nom du PC : un site malveillant
// qui ferait pointer son propre nom vers 127.0.0.1 (« DNS rebinding ») est exclu.
function estLocale(requete: IncomingMessage): boolean {
  const adresse = requete.socket.remoteAddress;
  if (adresse !== '127.0.0.1' && adresse !== '::1' && adresse !== '::ffff:127.0.0.1') return false;
  const hote = `http://${requete.headers.host ?? ''}`;
  return URL.canParse(hote) && nomsLocaux.has(new URL(hote).hostname);
}

const nomsLocaux = new Set(['localhost', '127.0.0.1', '[::1]']);

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
