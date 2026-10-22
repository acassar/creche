import type { DatabaseSync } from 'node:sqlite';
import { echapper } from './pages.ts';
import { idDe, messageFait, type EcranFiches, type Resultat } from './reglages.ts';
import { dateDuJour, dateLisible } from './enfants.ts';
import {
  ajouterMembre, couleurLibre, couleurs, desactiverMembre, homonyme, initiales, lireMembre, listerEquipe,
  messageHomonyme, modifierMembre, reactiverMembre, verifierMembre, type Membre, type SaisieMembre,
} from './equipe.ts';

export interface EtatEcranEquipe {
  equipe: Membre[];
  // Professionnelle ouverte dans la fiche ; absente : la fiche sert à en ajouter une.
  selection?: Membre;
  // Valeurs à remettre dans la fiche après une erreur de saisie.
  saisie?: SaisieMembre;
  erreur?: string;
  succes?: string;
}

type Etat = Omit<EtatEcranEquipe, 'equipe'>;

export function ecranEquipe(base: DatabaseSync, maintenant: () => number): EcranFiches {
  function repondre(statut: number, etat: Etat): Resultat {
    const valeurs = valeursEcranEquipe({ ...etat, equipe: listerEquipe(base) });
    return { statut, page: { titre: 'Équipe', fichier: 'equipe', valeurs, privee: true, cheminActif: '/equipe' } };
  }

  return {
    chemin: '/equipe',
    actions: new Set(['desactiver', 'reactiver']),

    afficher(parametres) {
      const etat: Etat = {};
      const idConcerne = idDe(parametres.get('membre'));
      const succes = messageFait(parametres.get('fait'), idConcerne === undefined ? undefined : lireMembre(base, idConcerne)?.prenom);
      if (succes) etat.succes = succes;

      if (parametres.has('id')) {
        const idSelection = idDe(parametres.get('id'));
        const selection = idSelection === undefined ? undefined : lireMembre(base, idSelection);
        if (selection === undefined || selection.desactiveLe !== null) {
          return repondre(404, { erreur: 'Cette professionnelle n’existe pas ou a été désactivée.' });
        }
        etat.selection = selection;
      }
      return repondre(200, etat);
    },

    ecrire(champs, id, action) {
      const selection = id === undefined ? undefined : lireMembre(base, id);
      if (id !== undefined && selection === undefined) return repondre(404, { erreur: 'Cette professionnelle n’existe pas.' });

      if (selection && action === 'desactiver') {
        desactiverMembre(base, selection.id, dateDuJour(maintenant()));
        return { redirection: `/equipe?fait=desactive&membre=${selection.id}` };
      }
      if (selection && action === 'reactiver') {
        // Une homonyme arrivée entre-temps : on ne saurait plus qui signe.
        const doublon = homonyme(listerEquipe(base), selection.prenom, selection.id);
        if (doublon) return repondre(409, { erreur: `Impossible de réactiver : ${messageHomonyme(doublon)}` });
        reactiverMembre(base, selection.id);
        return { redirection: `/equipe?id=${selection.id}&fait=reactive&membre=${selection.id}` };
      }

      const resultat = verifierMembre(champs, listerEquipe(base), selection?.id);
      if ('erreur' in resultat) {
        // On remet ce qui a été tapé pour corriger sans tout ressaisir.
        const saisie = { prenom: champs.get('prenom') ?? '', couleur: champs.get('couleur') ?? '' };
        return repondre(400, { erreur: resultat.erreur, saisie, ...(selection ? { selection } : {}) });
      }
      if (selection) {
        modifierMembre(base, selection.id, resultat.saisie);
        return { redirection: `/equipe?id=${selection.id}&fait=enregistre&membre=${selection.id}` };
      }
      const nouveau = ajouterMembre(base, resultat.saisie);
      return { redirection: `/equipe?id=${nouveau}&fait=ajoute&membre=${nouveau}` };
    },
  };
}

// Valeurs des repères de backoffice/pages/equipe.html, déjà échappées.
export function valeursEcranEquipe(etat: EtatEcranEquipe): Record<string, string> {
  const actives = etat.equipe.filter((m) => m.desactiveLe === null);
  const desactivees = etat.equipe.filter((m) => m.desactiveLe !== null);
  const selection = etat.selection;
  const fiche = etat.saisie ?? selection ?? { prenom: '', couleur: couleurLibre(etat.equipe) };

  return {
    resume: actives.length === 0
      ? 'Personne dans l’équipe pour l’instant : ajoutez la première professionnelle avec le formulaire.'
      : `${actives.length} professionnelle${actives.length > 1 ? 's' : ''} · elles choisiront leur prénom sur la tablette pour signer leurs saisies.`,
    message: [
      etat.erreur ? `<p class="erreur" role="alert">${echapper(etat.erreur)}</p>` : '',
      etat.succes ? `<p class="succes" role="status">${echapper(etat.succes)}</p>` : '',
    ].join(''),
    liste: actives.length === 0 ? '' : tableau(actives, selection?.id),
    desactivees: desactivees.length === 0 ? '' : listeDesactivees(desactivees),
    titreFiche: selection ? echapper(selection.prenom) : 'Ajouter une professionnelle',
    nouveau: selection ? '<a class="bouton-lien" href="/equipe">+ Ajouter une professionnelle</a>' : '',
    action: selection ? `/equipe/${selection.id}` : '/equipe',
    prenom: echapper(fiche.prenom),
    couleurs: [...couleurs].map(([cle, nom]) => `<label class="case"><input type="radio" name="couleur" value="${cle}"${fiche.couleur === cle ? ' checked' : ''} required> <span class="pastille couleur-${cle}" aria-hidden="true"></span> ${nom}</label>`).join('\n'),
    desactiver: selection
      ? `<form method="post" action="/equipe/${selection.id}/desactiver" class="archiver">
  <button type="submit" class="secondaire">Désactiver ${echapper(selection.prenom)}</button>
  <p class="aide">Elle n’apparaît plus sur la tablette ; ses saisies passées restent signées de son prénom et elle peut être réactivée.</p>
</form>`
      : '',
  };
}

function pastille(membre: Membre): string {
  return `<span class="pastille couleur-${echapper(membre.couleur)}" aria-hidden="true">${echapper(initiales(membre.prenom))}</span>`;
}

function tableau(equipe: Membre[], idSelection: number | undefined): string {
  const lignes = equipe.map((m) => {
    const actif = m.id === idSelection ? ' aria-current="true"' : '';
    return `    <tr${actif}>
      <td>${pastille(m)} <a href="/equipe?id=${m.id}">${echapper(m.prenom)}</a></td>
      <td>${echapper(couleurs.get(m.couleur) ?? m.couleur)}</td>
    </tr>`;
  });
  return `<table>
  <thead>
    <tr><th scope="col">Prénom</th><th scope="col">Couleur</th></tr>
  </thead>
  <tbody>
${lignes.join('\n')}
  </tbody>
</table>`;
}

function listeDesactivees(equipe: Membre[]): string {
  const elements = equipe.map((m) => `    <li>
      <span>${pastille(m)} ${echapper(m.prenom)} · désactivée le ${dateLisible(m.desactiveLe ?? '')}</span>
      <form method="post" action="/equipe/${m.id}/reactiver"><button type="submit" class="secondaire">Réactiver</button></form>
    </li>`);
  return `<details class="archives">
  <summary>Professionnelles désactivées (${equipe.length})</summary>
  <ul>
${elements.join('\n')}
  </ul>
</details>`;
}
