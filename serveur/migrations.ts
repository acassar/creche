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
  // L'équipe : une professionnelle désactivée (départ, fin de contrat) ne
  // signe plus de saisies mais reste l'autrice de celles qu'elle a faites.
  `CREATE TABLE equipe (
     id           INTEGER PRIMARY KEY,
     prenom       TEXT    NOT NULL CHECK (length(prenom) BETWEEN 1 AND 30),
     couleur      TEXT    NOT NULL CHECK (length(couleur) BETWEEN 1 AND 20),
     desactive_le TEXT
   ) STRICT;`,
  // Boutons de l'écran Repas. Âges en mois révolus, bornes comprises (NULL :
  // pas de limite). ordre : position d'affichage, du plus petit au plus grand.
  `CREATE TABLE boutons_repas (
     id           INTEGER PRIMARY KEY,
     libelle      TEXT    NOT NULL CHECK (length(libelle) BETWEEN 1 AND 30),
     comportement TEXT    NOT NULL CHECK (comportement IN ('compteur', 'appreciation', 'quantite')),
     age_min      INTEGER CHECK (age_min BETWEEN 0 AND 84),
     age_max      INTEGER CHECK (age_max BETWEEN 0 AND 84),
     ordre        INTEGER NOT NULL,
     desactive_le TEXT,
     CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max)
   ) STRICT;`,
];
