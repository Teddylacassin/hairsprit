# Hairsprit — Carte de fidélité digitale

Application complète de carte de fidélité pour un salon de barbier :
- **Côté client** : création de compte, carte virtuelle avec QR code (recto/verso animé), points, récompenses, historique des visites, demande de réservation.
- **Côté barber (admin)** : connexion sécurisée, scanner de QR code, ajout de points, liste des clients, gestion des récompenses, gestion des réservations, statistiques.

Stack : **Node.js + Express** (API) + **SQLite** (base de données, un seul fichier) + **HTML/CSS/JS vanilla** (aucun build, aucune dépendance lourde côté front).

---

## 1. Structure du projet

```
hairsprit/
├── server.js              # Point d'entrée du serveur
├── db.js                  # Connexion + schéma SQLite + seed initial
├── middleware/auth.js     # Authentification JWT (client / admin)
├── routes/client.js       # API côté client
├── routes/admin.js        # API côté admin
├── public/
│   ├── index.html         # App client (carte de fidélité)
│   ├── admin.html         # App admin (barber)
│   ├── css/style.css      # Design premium noir & blanc
│   └── js/
│       ├── client.js
│       └── admin.js
├── .env.example
└── package.json
```

---

## 2. Lancer le projet en local

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus.

```bash
cd hairsprit
npm install
cp .env.example .env
```

Ouvrez le fichier `.env` et changez au minimum :
- `JWT_SECRET` → une longue chaîne aléatoire (ex : générez-en une sur https://randomkeygen.com)
- `ADMIN_DEFAULT_PASSWORD` → le mot de passe de votre compte barber

Puis lancez le serveur :

```bash
npm start
```

L'application est accessible sur :
- **Espace client** : http://localhost:3000
- **Espace barber (admin)** : http://localhost:3000/admin

Au premier démarrage, un compte admin est créé automatiquement avec l'identifiant et le mot de passe définis dans `.env` (par défaut `admin` / `hairsprit2026` si vous ne les changez pas — **à modifier avant la mise en ligne**).

> Toute la base de données est stockée dans un seul fichier `hairsprit.db` créé automatiquement à la racine du projet.

---

## 3. Comment fonctionne le système de fidélité

- **1 coupe scannée par le barber = 1 point** (le barber peut aussi créditer plusieurs points d'un coup si besoin, ex. prestation combo).
- Les récompenses sont **entièrement modifiables** depuis l'espace admin (`Récompenses`) : nom, seuil de points, description, activer/désactiver. Par défaut :
  - 5 points → 5 € de réduction
  - 10 points → coupe ou produit offert
- Chaque client a un **QR code unique et permanent**, visible au dos de sa carte virtuelle (il suffit de toucher/cliquer la carte pour la retourner).
- Le barber scanne ce QR code depuis `/admin` → onglet **Scanner**, ce qui affiche la fiche du client et un bouton "+1 point".

---

## 4. Mettre l'application en ligne (déploiement)

La solution la plus simple pour ce type d'app (Node + SQLite en un seul dossier) est **Render.com** (gratuit pour démarrer). Railway.app fonctionne aussi de façon très similaire.

### Option recommandée : Render.com

1. **Créez un dépôt Git** avec tous ces fichiers (GitHub, GitLab...) :
   ```bash
   cd hairsprit
   git init
   git add .
   git commit -m "Hairsprit - carte de fidélité"
   git branch -M main
   git remote add origin https://github.com/votre-compte/hairsprit.git
   git push -u origin main
   ```

2. Allez sur [render.com](https://render.com) → **New** → **Web Service** → connectez votre dépôt GitHub.

3. Configurez le service :
   - **Build command** : `npm install`
   - **Start command** : `npm start`
   - **Instance type** : Free (ou payant pour de meilleures performances)

4. Dans l'onglet **Environment**, ajoutez vos variables (les mêmes que dans `.env`) :
   - `JWT_SECRET`
   - `ADMIN_DEFAULT_USERNAME`
   - `ADMIN_DEFAULT_PASSWORD`

5. **Important — persistance de la base de données** : sur le plan gratuit de Render, le disque est effacé à chaque redéploiement. Pour un usage réel en production, ajoutez un **disque persistant** (Render → onglet *Disks* → montez-le par exemple sur `/opt/render/project/src/data`, et changez dans `db.js` le chemin du fichier `hairsprit.db` pour pointer vers ce dossier). C'est gratuit jusqu'à 1 Go sur Render.

6. Une fois déployé, votre app sera accessible à une adresse du type :
   `https://hairsprit.onrender.com` (client) et `https://hairsprit.onrender.com/admin` (barber).

7. Vous pouvez ensuite relier un **nom de domaine personnalisé** (ex : `fidelite.hairsprit.fr`) depuis les réglages du service sur Render.

### Alternative : Railway.app

Le principe est identique (connecter le dépôt Git, définir les variables d'environnement, Railway détecte automatiquement Node.js). Railway propose un disque persistant plus simple à activer nativement.

### Alternative avancée (si vous grandissez) : base de données externe

Si le salon se développe (plusieurs barbers, plusieurs sites, gros volume), il est recommandé de remplacer SQLite par une base **PostgreSQL managée** (Render, Railway, Supabase et Neon en proposent gratuitement) pour éviter toute perte de données liée au disque. Le code est structuré simplement (toutes les requêtes SQL sont dans `db.js`, `routes/client.js` et `routes/admin.js`) pour faciliter cette migration plus tard.

---

## 5. Utilisation quotidienne au salon

- Gardez `/admin` ouvert sur une **tablette ou un smartphone du salon** (ajoutez-le à l'écran d'accueil pour un accès en un tap, comme une app).
- Après chaque coupe : onglet **Scanner** → scannez le QR code du client (affiché au dos de sa carte dans son propre téléphone) → **+1 point**.
- Le client voit son solde de points et ses récompenses se mettre à jour immédiatement sur son téléphone.
- Consultez l'onglet **Statistiques** régulièrement pour suivre la fidélisation (visites, nouveaux clients, top clients).

---

## 6. Sécurité — points à vérifier avant mise en production

- Changez impérativement `JWT_SECRET` et le mot de passe admin par défaut.
- Servez l'application en HTTPS (Render/Railway le font automatiquement).
- Le compte client se connecte uniquement par numéro de téléphone (pas de mot de passe) : c'est volontairement simple pour un usage carte de fidélité. Si vous souhaitez plus de sécurité (ex. code SMS), cela peut être ajouté ultérieurement.
- Pensez à faire des sauvegardes régulières du fichier `hairsprit.db` (ou de votre base Postgres si vous migrez).

---

Besoin d'ajouter une fonctionnalité (ex. notifications SMS, système de parrainage, plusieurs salons) ? Le code est volontairement clair et modulaire (`routes/`, `public/js/`) pour être facilement étendu.
