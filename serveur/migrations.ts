// Chaque entrée fait passer le schéma à la version suivante (index + 1).
// On n'en modifie jamais une déjà publiée : on en ajoute une nouvelle.
export const migrations: readonly string[] = [
  `CREATE TABLE parametres (
     cle    TEXT PRIMARY KEY,
     valeur TEXT NOT NULL
   ) STRICT;`,
  // Les enfants ne sont jamais supprimés : archive_le (date) les retire des
  // listes sans perdre leur historique. jours : lundi = 1, mardi = 2, mercredi = 4…
  `CREATE TABLE enfants (
     id         INTEGER PRIMARY KEY,
     prenom     TEXT    NOT NULL CHECK (length(prenom) BETWEEN 1 AND 50),
     naissance  TEXT    NOT NULL CHECK (naissance GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
     a_savoir   TEXT    NOT NULL DEFAULT '' CHECK (length(a_savoir) <= 200),
     jours      INTEGER NOT NULL CHECK (jours BETWEEN 1 AND 31),
     archive_le TEXT
   ) STRICT;`,
];
