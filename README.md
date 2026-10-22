# Crèche

Application de transmissions pour une crèche : les professionnelles saisissent
sur tablette les repas, siestes, changes, soins et le mot du soir, pour
plusieurs enfants d'un coup et en un ou deux taps.

Tout reste dans la crèche : un petit serveur tourne sur le PC du bureau
(base SQLite), sert le backoffice dans son navigateur et l'app des tablettes
par le Wi-Fi local. Pas de cloud, pas de compte externe.

Les tâches sont suivies dans les [issues](https://github.com/acassar/creche/issues).

## Démarrer le serveur

Il faut Node.js 22.18 ou plus récent. Le code est en TypeScript, exécuté
directement par Node (sans étape de build). Le serveur n'a aucune dépendance
à l'exécution ; `typescript` et `@types/node` servent seulement à vérifier les
types pendant le développement.

```sh
npm start          # serveur sur le port 8080, données dans donnees/
npm install        # une fois, pour les outils de développement
npm run verifier   # vérification des types puis tests
```

On n'utilise que la syntaxe TypeScript que Node sait ignorer (pas d'`enum` ni
de `namespace`) : `tsc` le vérifie avec `erasableSyntaxOnly`.

Variables utiles : `PORT` (8080 par défaut) et `CRECHE_DONNEES` (dossier de la
base SQLite ; par défaut `donnees/` à la racine du projet, quel que soit le
dossier de lancement). `GET /api/sante` indique si le serveur répond et la
version du schéma de la base.

## Backoffice

Une fois le serveur lancé, le backoffice s'ouvre dans le navigateur du PC à
l'adresse http://localhost:8080. Ses pages sont de simples fichiers HTML et
CSS dans `backoffice/`, servis tels quels (pas de framework ni de build) :
`/enfants` sert `backoffice/enfants.html`. Seuls les fichiers `.html`, `.css`,
`.js` et les images de ce dossier sont accessibles.

## Licence

Ce code est distribué sous licence [GNU AGPL v3](LICENSE).
Pour un usage qui ne respecte pas les conditions de l'AGPL (intégration dans un
produit fermé, revente), une licence commerciale est disponible : contactez
l'auteur.
