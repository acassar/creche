import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const longueurMinimale = 8;

// scrypt est lent et gourmand en mémoire exprès : deviner le mot de passe à
// partir de l'empreinte coûte cher. Ces réglages prennent environ 50 ms.
const reglages = { N: 16384, r: 8, p: 1 };
const longueurCle = 32;

function deriver(motDePasse: string, sel: Buffer, options: typeof reglages): Promise<Buffer> {
  return new Promise((ok, echec) => {
    // NFC : un « é » tapé sur deux claviers différents donne la même empreinte.
    scrypt(motDePasse.normalize('NFC'), sel, longueurCle, options, (erreur, cle) => {
      if (erreur) echec(erreur);
      else ok(cle);
    });
  });
}

// Empreinte au format scrypt$N$r$p$sel$cle (base64url), avec un sel aléatoire.
export async function hacher(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await deriver(motDePasse, sel, reglages);
  const { N, r, p } = reglages;
  return ['scrypt', N, r, p, sel.toString('base64url'), cle.toString('base64url')].join('$');
}

export async function verifier(motDePasse: string, empreinte: string): Promise<boolean> {
  const morceaux = empreinte.split('$');
  if (morceaux.length !== 6 || morceaux[0] !== 'scrypt') return false;
  const [N, r, p] = morceaux.slice(1, 4).map(Number);
  if (!N || !r || !p) return false;
  const attendue = Buffer.from(morceaux[5] ?? '', 'base64url');
  const cle = await deriver(motDePasse, Buffer.from(morceaux[4] ?? '', 'base64url'), { N, r, p });
  return attendue.length === cle.length && timingSafeEqual(attendue, cle);
}
