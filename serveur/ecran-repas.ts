import type { DatabaseSync } from 'node:sqlite';
import { echapper } from './pages.ts';
import { idDe, messageFait, type EcranFiches, type Resultat } from './reglages.ts';
import { ageEnMois, dateDuJour, dateLisible, listerEnfants } from './enfants.ts';
import {
  ageMaximum, agesLisibles, ajouterBouton, comportements, deplacerBouton, desactiverBouton, homonyme, lireBouton,
  listerBoutons, messageHomonyme, modifierBouton, pourAge, reactiverBouton, verifierBouton, type Bouton,
} from './repas.ts';

// Ce que l'on remet dans la fiche : tel que tapé, âges compris.
export interface FicheBouton {
  libelle: string;
  comportement: string;
  ageMin: string;
  ageMax: string;
}

export interface EtatEcranRepas {
  boutons: Bouton[];
  // Âge en mois de chaque enfant inscrit, pour dire combien voient chaque bouton.
  ages: number[];
  selection?: Bouton;
  saisie?: FicheBouton;
  erreur?: string;
  succes?: string;
}

type Etat = Omit<EtatEcranRepas, 'boutons' | 'ages'>;

export function ecranRepas(base: DatabaseSync, maintenant: () => number): EcranFiches {
  function repondre(statut: number, etat: Etat): Resultat {
    const aujourdhui = dateDuJour(maintenant());
    const ages = listerEnfants(base).filter((e) => e.archiveLe === null).map((e) => ageEnMois(e.naissance, aujourdhui));
    const valeurs = valeursEcranRepas({ ...etat, boutons: listerBoutons(base), ages });
    return { statut, page: { titre: 'Repas', fichier: 'repas', valeurs, privee: true, cheminActif: '/repas' } };
  }

  return {
    chemin: '/repas',
    actions: new Set(['monter', 'descendre', 'desactiver', 'reactiver']),

    afficher(parametres) {
      const etat: Etat = {};
      const idConcerne = idDe(parametres.get('bouton'));
      const concerne = idConcerne === undefined ? undefined : lireBouton(base, idConcerne);
      const succes = messageFait(parametres.get('fait'), concerne && `Bouton « ${concerne.libelle} »`, false);
      if (succes) etat.succes = succes;

      if (parametres.has('id')) {
        const idSelection = idDe(parametres.get('id'));
        const selection = idSelection === undefined ? undefined : lireBouton(base, idSelection);
        if (selection === undefined || selection.desactiveLe !== null) {
          return repondre(404, { erreur: 'Ce bouton n’existe pas ou a été désactivé.' });
        }
        etat.selection = selection;
      }
      return repondre(200, etat);
    },

    ecrire(champs, id, action) {
      const selection = id === undefined ? undefined : lireBouton(base, id);
      if (id !== undefined && selection === undefined) return repondre(404, { erreur: 'Ce bouton n’existe pas.' });

      if (selection && (action === 'monter' || action === 'descendre')) {
        // Déjà en haut (ou en bas) : rien à faire, on revient simplement à la liste.
        deplacerBouton(base, selection.id, action);
        return { redirection: '/repas' };
      }
      if (selection && action === 'desactiver') {
        desactiverBouton(base, selection.id, dateDuJour(maintenant()));
        return { redirection: `/repas?fait=desactive&bouton=${selection.id}` };
      }
      if (selection && action === 'reactiver') {
        // Un bouton du même nom ajouté entre-temps pour ces âges : la tablette en montrerait deux.
        const doublon = homonyme(listerBoutons(base), selection, selection.id);
        if (doublon) return repondre(409, { erreur: `Impossible de réactiver : ${messageHomonyme(doublon)}` });
        reactiverBouton(base, selection.id);
        return { redirection: `/repas?id=${selection.id}&fait=reactive&bouton=${selection.id}` };
      }

      const resultat = verifierBouton(champs, listerBoutons(base), selection?.id);
      if ('erreur' in resultat) {
        // On remet ce qui a été tapé pour corriger sans tout ressaisir.
        const saisie = {
          libelle: champs.get('libelle') ?? '',
          comportement: champs.get('comportement') ?? '',
          ageMin: champs.get('age_min') ?? '',
          ageMax: champs.get('age_max') ?? '',
        };
        return repondre(400, { erreur: resultat.erreur, saisie, ...(selection ? { selection } : {}) });
      }
      if (selection) {
        modifierBouton(base, selection.id, resultat.saisie);
        return { redirection: `/repas?id=${selection.id}&fait=enregistre&bouton=${selection.id}` };
      }
      const nouveau = ajouterBouton(base, resultat.saisie);
      return { redirection: `/repas?id=${nouveau}&fait=ajoute&bouton=${nouveau}` };
    },
  };
}

function versFiche(bouton: Bouton): FicheBouton {
  return {
    libelle: bouton.libelle,
    comportement: bouton.comportement,
    ageMin: bouton.ageMin === null ? '' : String(bouton.ageMin),
    ageMax: bouton.ageMax === null ? '' : String(bouton.ageMax),
  };
}

// Valeurs des repères de backoffice/pages/repas.html, déjà échappées.
export function valeursEcranRepas(etat: EtatEcranRepas): Record<string, string> {
  const actifs = etat.boutons.filter((b) => b.desactiveLe === null);
  const desactives = etat.boutons.filter((b) => b.desactiveLe !== null);
  const selection = etat.selection;
  const fiche = etat.saisie ?? (selection ? versFiche(selection) : { libelle: '', comportement: 'appreciation', ageMin: '', ageMax: '' });

  return {
    resume: actifs.length === 0
      ? 'Aucun bouton pour l’instant. Par exemple : « Biberon » (quantité en ml, jusqu’à 12 mois), puis « Entrée », « Plat » et « Dessert » (appréciation).'
      : `${actifs.length} bouton${actifs.length > 1 ? 's' : ''} · la tablette montre à chaque enfant ceux de son âge, dans cet ordre.`,
    message: [
      etat.erreur ? `<p class="erreur" role="alert">${echapper(etat.erreur)}</p>` : '',
      etat.succes ? `<p class="succes" role="status">${echapper(etat.succes)}</p>` : '',
    ].join(''),
    liste: actifs.length === 0 ? '' : tableau(actifs, etat.ages, selection?.id),
    desactives: desactives.length === 0 ? '' : listeDesactives(desactives),
    titreFiche: selection ? echapper(`Bouton « ${selection.libelle} »`) : 'Ajouter un bouton',
    nouveau: selection ? '<a class="bouton-lien" href="/repas">+ Ajouter un bouton</a>' : '',
    action: selection ? `/repas/${selection.id}` : '/repas',
    libelle: echapper(fiche.libelle),
    comportements: [...comportements].map(([cle, { nom, aide }]) => `<label class="case"><input type="radio" name="comportement" value="${cle}"${fiche.comportement === cle ? ' checked' : ''} required> ${nom} <span class="aide">· ${aide}</span></label>`).join('\n'),
    ageMin: echapper(fiche.ageMin),
    ageMax: echapper(fiche.ageMax),
    ageMaximum: String(ageMaximum),
    desactiver: selection
      ? `<form method="post" action="/repas/${selection.id}/desactiver" class="archiver">
  <button type="submit" class="secondaire">Désactiver ce bouton</button>
  <p class="aide">Il n’apparaît plus sur la tablette ; les repas déjà notés avec lui sont gardés et il peut être réactivé.</p>
</form>`
      : '',
  };
}

function nomComportement(cle: string): string {
  return echapper(comportements.get(cle)?.nom ?? cle);
}

function tableau(boutons: Bouton[], ages: number[], idSelection: number | undefined): string {
  const lignes = boutons.map((b, i) => {
    const actif = b.id === idSelection ? ' aria-current="true"' : '';
    const libelle = echapper(b.libelle);
    const monter = i === 0 ? '' : `<form method="post" action="/repas/${b.id}/monter"><button type="submit" class="fleche" aria-label="Monter « ${libelle} »">↑</button></form>`;
    const descendre = i === boutons.length - 1 ? '' : `<form method="post" action="/repas/${b.id}/descendre"><button type="submit" class="fleche" aria-label="Descendre « ${libelle} »">↓</button></form>`;
    const concernes = ages.filter((age) => pourAge(b, age)).length;
    return `    <tr${actif}>
      <td class="ordre">${monter}${descendre}</td>
      <td><a href="/repas?id=${b.id}">${libelle}</a></td>
      <td>${nomComportement(b.comportement)}</td>
      <td>${echapper(agesLisibles(b.ageMin, b.ageMax))}</td>
      <td>${concernes === 0 ? '<span class="vide">aucun</span>' : `${concernes} enfant${concernes > 1 ? 's' : ''}`}</td>
    </tr>`;
  });
  return `<table>
  <thead>
    <tr><th scope="col">Ordre</th><th scope="col">Libellé</th><th scope="col">Un tap note</th><th scope="col">Âges</th><th scope="col">Inscrits concernés</th></tr>
  </thead>
  <tbody>
${lignes.join('\n')}
  </tbody>
</table>`;
}

function listeDesactives(boutons: Bouton[]): string {
  const elements = boutons.map((b) => `    <li>
      <span>${echapper(b.libelle)} · ${nomComportement(b.comportement)} · ${echapper(agesLisibles(b.ageMin, b.ageMax).toLowerCase())} · désactivé le ${dateLisible(b.desactiveLe ?? '')}</span>
      <form method="post" action="/repas/${b.id}/reactiver"><button type="submit" class="secondaire">Réactiver</button></form>
    </li>`);
  return `<details class="archives">
  <summary>Boutons désactivés (${boutons.length})</summary>
  <ul>
${elements.join('\n')}
  </ul>
</details>`;
}
