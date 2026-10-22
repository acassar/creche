import { randomBytes } from 'node:crypto';

export interface Sessions {
  ouvrir(): string;
  // Vraie si le jeton est connu et pas expiré ; prolonge alors la session.
  valider(jeton: string | undefined): boolean;
  fermer(jeton: string | undefined): void;
}

// Sessions gardées en mémoire : un redémarrage du serveur déconnecte tout le
// monde, ce qui est acceptable pour la direction seule. Une session expire
// après `duree` millisecondes sans activité.
export function creerSessions(duree: number, maintenant: () => number = Date.now): Sessions {
  const expirations = new Map<string, number>();

  return {
    ouvrir() {
      for (const [jeton, expiration] of expirations) {
        if (expiration <= maintenant()) expirations.delete(jeton);
      }
      const jeton = randomBytes(32).toString('base64url');
      expirations.set(jeton, maintenant() + duree);
      return jeton;
    },
    valider(jeton) {
      if (jeton === undefined) return false;
      const expiration = expirations.get(jeton);
      if (expiration === undefined) return false;
      if (expiration <= maintenant()) {
        expirations.delete(jeton);
        return false;
      }
      expirations.set(jeton, maintenant() + duree);
      return true;
    },
    fermer(jeton) {
      if (jeton !== undefined) expirations.delete(jeton);
    },
  };
}
