// Chaque entrée fait passer le schéma à la version suivante (index + 1).
// On n'en modifie jamais une déjà publiée : on en ajoute une nouvelle.
export const migrations: readonly string[] = [
  `CREATE TABLE parametres (
     cle    TEXT PRIMARY KEY,
     valeur TEXT NOT NULL
   ) STRICT;`,
];
