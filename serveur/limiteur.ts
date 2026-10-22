export interface Limiteur {
  bloque(cle: string): boolean;
  echec(cle: string): void;
  reussite(cle: string): void;
}

// Après `maxEchecs` mots de passe faux d'affilée depuis une même adresse,
// cette adresse est bloquée pendant `blocage` millisecondes.
export function creerLimiteur(maxEchecs: number, blocage: number, maintenant: () => number = Date.now): Limiteur {
  const etats = new Map<string, { echecs: number; bloqueJusqua: number }>();

  return {
    bloque(cle) {
      return (etats.get(cle)?.bloqueJusqua ?? 0) > maintenant();
    },
    echec(cle) {
      const etat = etats.get(cle) ?? { echecs: 0, bloqueJusqua: 0 };
      etat.echecs += 1;
      if (etat.echecs >= maxEchecs) {
        etat.echecs = 0;
        etat.bloqueJusqua = maintenant() + blocage;
      }
      etats.set(cle, etat);
    },
    reussite(cle) {
      etats.delete(cle);
    },
  };
}
