import type { DatabaseSync } from 'node:sqlite';
import { echapper } from './pages.ts';
import { idDe, messageFait, type EcranFiches, type Resultat } from './reglages.ts';
import {
  ageLisible, ajouterEnfant, archiverEnfant, dateDuJour, dateLisible, joursDeLaSemaine, joursLisibles, lireEnfant,
  listerEnfants, modifierEnfant, reactiverEnfant, tousLesJours, verifierSaisie, type Enfant, type Saisie,
} from './enfants.ts';

type Etat = Omit<EtatEcran, 'enfants' | 'aujourdhui'>;

export function ecranEnfants(base: DatabaseSync, maintenant: () => number): EcranFiches {
  function repondre(statut: number, etat: Etat): Resultat {
    const valeurs = valeursEcranEnfants({ ...etat, enfants: listerEnfants(base), aujourdhui: dateDuJour(maintenant()) });
    return { statut, page: { titre: 'Enfants', fichier: 'enfants', valeurs, privee: true, cheminActif: '/enfants' } };
  }

  return {
    chemin: '/enfants',
    actions: new Set(['archiver', 'reactiver']),

    afficher(parametres) {
      const etat: Etat = {};
      const idConcerne = idDe(parametres.get('enfant'));
      const concerne = idConcerne === undefined ? undefined : lireEnfant(base, idConcerne);
      const succes = messageFait(parametres.get('fait'), concerne && `Fiche de ${concerne.prenom}`, true);
      if (succes) etat.succes = succes;

      if (parametres.has('id')) {
        const idSelection = idDe(parametres.get('id'));
        const selection = idSelection === undefined ? undefined : lireEnfant(base, idSelection);
        if (selection === undefined || selection.archiveLe !== null) {
          return repondre(404, { erreur: 'Cet enfant n’existe pas ou a été archivé.' });
        }
        etat.selection = selection;
      }
      return repondre(200, etat);
    },

    ecrire(champs, id, action) {
      const aujourdhui = dateDuJour(maintenant());
      const selection = id === undefined ? undefined : lireEnfant(base, id);
      if (id !== undefined && selection === undefined) return repondre(404, { erreur: 'Cet enfant n’existe pas.' });

      if (selection && action === 'archiver') {
        archiverEnfant(base, selection.id, aujourdhui);
        return { redirection: `/enfants?fait=archive&enfant=${selection.id}` };
      }
      if (selection && action === 'reactiver') {
        reactiverEnfant(base, selection.id);
        return { redirection: `/enfants?id=${selection.id}&fait=reactive&enfant=${selection.id}` };
      }

      const resultat = verifierSaisie(champs, aujourdhui);
      if ('erreur' in resultat) {
        // On remet ce qui a été tapé (cases cochées comprises) pour corriger sans tout ressaisir.
        const saisie = {
          prenom: champs.get('prenom') ?? '',
          naissance: champs.get('naissance') ?? '',
          aSavoir: champs.get('a_savoir') ?? '',
          jours: champs.getAll('jours').reduce((total, bit) => total | (Number(bit) & tousLesJours), 0),
        };
        return repondre(400, { erreur: resultat.erreur, saisie, ...(selection ? { selection } : {}) });
      }
      if (selection) {
        modifierEnfant(base, selection.id, resultat.saisie);
        return { redirection: `/enfants?id=${selection.id}&fait=enregistre&enfant=${selection.id}` };
      }
      const nouveau = ajouterEnfant(base, resultat.saisie);
      return { redirection: `/enfants?id=${nouveau}&fait=ajoute&enfant=${nouveau}` };
    },
  };
}

export interface EtatEcran {
  enfants: Enfant[];
  aujourdhui: string;
  // Enfant ouvert dans la fiche ; absent : la fiche sert à en ajouter un.
  selection?: Enfant;
  // Valeurs à remettre dans la fiche après une erreur de saisie.
  saisie?: Saisie;
  erreur?: string;
  succes?: string;
}

// Valeurs des repères de backoffice/pages/enfants.html, déjà échappées.
export function valeursEcranEnfants(etat: EtatEcran): Record<string, string> {
  const actifs = etat.enfants.filter((e) => e.archiveLe === null);
  const archives = etat.enfants.filter((e) => e.archiveLe !== null);
  const fiche = etat.saisie ?? etat.selection ?? { prenom: '', naissance: '', aSavoir: '', jours: tousLesJours };
  const selection = etat.selection;

  return {
    resume: actifs.length === 0
      ? 'Aucun enfant inscrit pour l’instant : ajoutez le premier avec le formulaire.'
      : `${actifs.length} enfant${actifs.length > 1 ? 's' : ''} · l’âge est calculé à partir de la date de naissance.`,
    message: [
      etat.erreur ? `<p class="erreur" role="alert">${echapper(etat.erreur)}</p>` : '',
      etat.succes ? `<p class="succes" role="status">${echapper(etat.succes)}</p>` : '',
    ].join(''),
    liste: actifs.length === 0 ? '' : tableau(actifs, etat.aujourdhui, selection?.id),
    archives: archives.length === 0 ? '' : listeArchives(archives),
    titreFiche: selection ? echapper(selection.prenom) : 'Ajouter un enfant',
    nouveau: selection ? '<a class="bouton-lien" href="/enfants">+ Ajouter un enfant</a>' : '',
    action: selection ? `/enfants/${selection.id}` : '/enfants',
    prenom: echapper(fiche.prenom),
    naissance: echapper(fiche.naissance),
    aujourdhui: etat.aujourdhui,
    age: selection && !etat.saisie ? `<p class="age">${echapper(ageLisible(selection.naissance, etat.aujourdhui))}</p>` : '',
    aSavoir: echapper(fiche.aSavoir),
    jours: joursDeLaSemaine.map(({ bit, nom }) => `<label class="case"><input type="checkbox" name="jours" value="${bit}"${fiche.jours & bit ? ' checked' : ''}> ${nom}</label>`).join('\n'),
    archiver: selection
      ? `<form method="post" action="/enfants/${selection.id}/archiver" class="archiver">
  <button type="submit" class="secondaire">Archiver ${echapper(selection.prenom)}</button>
  <p class="aide">L’enfant n’apparaît plus sur la tablette ; son historique est gardé et il peut être réactivé.</p>
</form>`
      : '',
  };
}

function tableau(enfants: Enfant[], aujourdhui: string, idSelection: number | undefined): string {
  const lignes = enfants.map((e) => {
    const actif = e.id === idSelection ? ' aria-current="true"' : '';
    return `    <tr${actif}>
      <td><a href="/enfants?id=${e.id}">${echapper(e.prenom)}</a></td>
      <td>${dateLisible(e.naissance)}</td>
      <td>${echapper(ageLisible(e.naissance, aujourdhui))}</td>
      <td>${e.aSavoir === '' ? '<span class="vide">—</span>' : `<span class="a-savoir">${echapper(e.aSavoir)}</span>`}</td>
      <td>${joursLisibles(e.jours)}</td>
    </tr>`;
  });
  return `<table>
  <thead>
    <tr><th scope="col">Prénom</th><th scope="col">Naissance</th><th scope="col">Âge</th><th scope="col">À savoir</th><th scope="col">Jours</th></tr>
  </thead>
  <tbody>
${lignes.join('\n')}
  </tbody>
</table>`;
}

function listeArchives(enfants: Enfant[]): string {
  const elements = enfants.map((e) => `    <li>
      <span>${echapper(e.prenom)} · né(e) le ${dateLisible(e.naissance)} · archivé le ${dateLisible(e.archiveLe ?? '')}</span>
      <form method="post" action="/enfants/${e.id}/reactiver"><button type="submit" class="secondaire">Réactiver</button></form>
    </li>`);
  return `<details class="archives">
  <summary>Enfants archivés (${enfants.length})</summary>
  <ul>
${elements.join('\n')}
  </ul>
</details>`;
}
