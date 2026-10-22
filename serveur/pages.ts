import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Les écrans de réglages, dans l'ordre du menu. Le contenu de chacun est dans
// backoffice/pages/<fichier>.html ; l'en-tête et le menu, communs à tous,
// viennent de backoffice/gabarit.html.
export const ecrans = [
  { chemin: '/enfants', titre: 'Enfants', fichier: 'enfants' },
  { chemin: '/equipe', titre: 'Équipe', fichier: 'equipe' },
  { chemin: '/repas', titre: 'Repas', fichier: 'repas' },
  { chemin: '/traitements', titre: 'Traitements', fichier: 'traitements' },
] as const;

export const accueil = { chemin: '/', titre: 'Accueil', fichier: 'accueil' } as const;

export interface Page {
  titre: string;
  fichier: string;
  // Valeurs des {{repères}} du fragment, insérées telles quelles : à échapper avant.
  valeurs?: Record<string, string>;
  // Page réservée à la direction connectée : avec menu et bouton de déconnexion.
  privee: boolean;
  cheminActif?: string;
}

export function echapper(texte: string): string {
  return texte
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Remplace chaque {{repère}} en un seul passage : une valeur qui contient
// elle-même des accolades n'est jamais réinterprétée.
export function remplir(modele: string, valeurs: Record<string, string>): string {
  return modele.replace(/\{\{(\w+)\}\}/g, (_, nom: string) => {
    const valeur = valeurs[nom];
    if (valeur === undefined) throw new Error(`Repère {{${nom}}} sans valeur.`);
    return valeur;
  });
}

export async function rendrePage(dossier: string, page: Page): Promise<string> {
  const [gabarit, fragment] = await Promise.all([
    readFile(join(dossier, 'gabarit.html'), 'utf8'),
    readFile(join(dossier, 'pages', `${page.fichier}.html`), 'utf8'),
  ]);
  return remplir(gabarit, {
    titre: echapper(page.titre),
    deconnexion: page.privee ? deconnexion : '',
    menu: page.privee ? menu(page.cheminActif) : '',
    contenu: indenter(remplir(fragment, page.valeurs ?? {}).trimEnd(), '      '),
  });
}

const deconnexion = `    <form method="post" action="/deconnexion">
      <button type="submit">Se déconnecter</button>
    </form>`;

function menu(cheminActif: string | undefined): string {
  const liens = ecrans.map(({ chemin, titre }) => {
    const actif = chemin === cheminActif ? ' aria-current="page"' : '';
    return `        <li><a href="${chemin}"${actif}>${echapper(titre)}</a></li>`;
  });
  return `    <nav aria-label="Écrans de réglages">
      <ul>
${liens.join('\n')}
      </ul>
    </nav>`;
}

function indenter(texte: string, marge: string): string {
  return texte.split('\n').map((ligne) => (ligne === '' ? ligne : marge + ligne)).join('\n');
}
