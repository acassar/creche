// Outils communs aux tests du serveur HTTP.
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { ouvrirBase } from '../serveur/base.ts';
import { creerServeur, type Options } from '../serveur/app.ts';

export const motDePasse = 'Les-Petits-Pas-2026';

export interface ServeurDeTest {
  adresse: string;
  base: DatabaseSync;
}

export async function demarrer(t: TestContext, options: Options = {}): Promise<ServeurDeTest> {
  const base = ouvrirBase(':memory:');
  const serveur = creerServeur(base, options).listen(0);
  t.after(() => { serveur.close(); if (base.isOpen) base.close(); });
  await new Promise<void>((ok) => serveur.once('listening', ok));
  return { adresse: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`, base };
}

// Envoie un formulaire comme le ferait le navigateur depuis une page du serveur.
export function envoyerFormulaire(
  adresse: string,
  chemin: string,
  champs: Record<string, string>,
  { cookie, origine = adresse }: { cookie?: string; origine?: string | null } = {},
): Promise<Response> {
  const entetes: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origine !== null) entetes.Origin = origine;
  if (cookie !== undefined) entetes.Cookie = cookie;
  return fetch(`${adresse}${chemin}`, {
    method: 'POST',
    redirect: 'manual',
    headers: entetes,
    body: new URLSearchParams(champs),
  });
}

// « session=… » tiré de l'en-tête Set-Cookie, prêt à renvoyer dans Cookie.
export function cookieDe(reponse: Response): string {
  const entete = reponse.headers.get('set-cookie') ?? '';
  const cookie = entete.split(';')[0] ?? '';
  if (!cookie.startsWith('session=') || cookie === 'session=') throw new Error(`Pas de session : « ${entete} »`);
  return cookie;
}

// Choisit le mot de passe direction (premier lancement, depuis le PC) et renvoie la session ouverte.
export async function choisirMotDePasse(adresse: string): Promise<string> {
  const reponse = await envoyerFormulaire(adresse, '/connexion', { mot_de_passe: motDePasse, confirmation: motDePasse });
  if (reponse.status !== 303) throw new Error(`Choix du mot de passe refusé : ${reponse.status}`);
  return cookieDe(reponse);
}

export async function seConnecter(adresse: string, mdp = motDePasse): Promise<Response> {
  return envoyerFormulaire(adresse, '/connexion', { mot_de_passe: mdp });
}

export function page(adresse: string, chemin: string, cookie?: string, method = 'GET'): Promise<Response> {
  return fetch(`${adresse}${chemin}`, { method, redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}

// fetch normalise les « .. » de l'adresse : pour tester le chemin brut, on passe par node:http.
export function requeteBrute(adresse: string, chemin: string, cookie?: string): Promise<number> {
  const { port } = new URL(adresse);
  return new Promise((ok, echec) => {
    request({ host: '127.0.0.1', port, path: chemin, headers: cookie ? { Cookie: cookie } : {} }, (reponse) => {
      reponse.resume();
      ok(reponse.statusCode ?? 0);
    }).on('error', echec).end();
  });
}
