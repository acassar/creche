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
l'adresse http://localhost:8080. Il est réservé à la direction : au premier
lancement, la page de connexion propose de choisir le mot de passe direction
(au moins 8 caractères), uniquement depuis le navigateur du PC lui-même.
Ensuite, il est demandé à chaque connexion ; la session se ferme après
30 minutes sans activité, et 5 essais faux bloquent les essais 5 minutes.
Le mot de passe est stocké haché (scrypt), jamais en clair.

Les pages sont assemblées par le serveur, sans framework ni build :
`backoffice/gabarit.html` porte l'en-tête et le menu, communs à toutes, et
`backoffice/pages/<écran>.html` le contenu de chaque écran (la liste des écrans
est dans `serveur/pages.ts`). `backoffice/public/` contient les fichiers servis
tels quels (feuille de style) : seuls ses `.css`, `.js` et images sont
accessibles.

## Essayer sans rien installer

[Ouvrir dans un Codespace GitHub](https://codespaces.new/acassar/creche) :
GitHub prépare l'environnement dans le navigateur (sur le quota gratuit du
compte), installe les outils, lance le serveur et ouvre le backoffice dans un
nouvel onglet. La configuration est dans `.devcontainer/devcontainer.json`.
Pensez à arrêter le Codespace après usage pour ne pas consommer le quota.

Un Codespace tourne sur les serveurs de GitHub : il sert à essayer l'app avec
des données fictives, jamais avec de vrais enfants. Laissez le port redirigé
en privé (réglage par défaut).

## Licence

Ce code est distribué sous licence [GNU AGPL v3](LICENSE).
Pour un usage qui ne respecte pas les conditions de l'AGPL (intégration dans un
produit fermé, revente), une licence commerciale est disponible : contactez
l'auteur.
