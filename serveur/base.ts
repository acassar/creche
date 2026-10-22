import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations as migrationsParDefaut } from './migrations.ts';

export function ouvrirBase(chemin: string, migrations: readonly string[] = migrationsParDefaut): DatabaseSync {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });
  const base = new DatabaseSync(chemin);
  try {
    base.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrer(base, migrations);
  } catch (erreur) {
    base.close();
    throw erreur;
  }
  return base;
}

export function versionSchema(base: DatabaseSync): number {
  const ligne = base.prepare('PRAGMA user_version').get() as { user_version: number };
  return ligne.user_version;
}

function migrer(base: DatabaseSync, migrations: readonly string[]): void {
  const actuelle = versionSchema(base);
  if (actuelle > migrations.length) {
    throw new Error(`Base en version ${actuelle}, plus récente que ce serveur (${migrations.length}).`);
  }
  for (const [version, sql] of migrations.entries()) {
    if (version < actuelle) continue;
    base.exec('BEGIN');
    try {
      base.exec(sql);
      base.exec(`PRAGMA user_version = ${version + 1}`);
      base.exec('COMMIT');
    } catch (erreur) {
      base.exec('ROLLBACK');
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      throw new Error(`Échec de la migration ${version + 1} : ${message}`);
    }
  }
}
