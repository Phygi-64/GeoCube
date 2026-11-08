# 🌍 GeoCube

**GeoCube** est un jeu multijoueur voxel 3D (style Minecraft) avec mode clicker / idle, système d'inventaire persistant, quêtes, cartes à collectionner, amis et échanges en direct, accessible sur le Web et sur mobile (Android via Capacitor).

---

## 🚀 Fonctionnalités Principales

- **🎮 Monde Voxel 3D en temps réel** : Pose et destruction de blocs, physique, textures personnalisées, multijoueur fluide synchronisé via Socket.IO.
- **⛏️ Mini-jeu Clicker / Idle** : Génération automatique de pièces avec pioches, villageois, golems, cités d'or et dragons du néant.
- **📜 Quêtes & Progression** : Quêtes de construction et de distance parcourue dans le monde débloquant des récompenses.
- **🤝 Social & Multijoueur** : Système d'amis avec statut en ligne, requêtes d'amis, chat global et système d'échanges (Trading) de ressources en direct.
- **📦 Multi-Mondes** : Prise en charge des mondes **Alpha** et **Beta** sur la même instance serveur.
- **📱 Compatible Mobile & PC** : Contrôles tactiles complets, orientation paysage forcée, export APK Android prêt à l'emploi.

---

## 🛠️ Installation et Démarrage Local

### Prérequis
- [Node.js](https://nodejs.org/) (version 18 ou supérieure recommandée)
- Git

### Lancement en local
```bash
# 1. Cloner le dépôt
git clone https://github.com/Phygi-64/GeoCube.git
cd GeoCube

# 2. Installer les dépendances
npm install

# 3. Démarrer le serveur
npm start
```

Le serveur sera accessible sur **http://localhost:30000** :
- **Jeu & Interface Web** : `http://localhost:30000`
- **Health Check / Statut** : `http://localhost:30000/health`

---

## ☁️ Guide d'Hébergement Gratuit du Serveur

Voici les meilleures solutions pour héberger le serveur GeoCube **100% gratuitement** avec support complet des **WebSockets (Socket.IO)** :

---

### Option 1 (Recommandée & Rapide) : Render.com 🏆

[Render.com](https://render.com) offre un niveau gratuit (**Free Web Service**) idéal pour Node.js et WebSockets avec déploiement automatique dès que tu pousses sur GitHub.

#### Étapes :
1. Crée un compte gratuit sur [Render.com](https://render.com) (connexion directe avec ton compte GitHub).
2. Clique sur **"New +"** puis sélectionne **"Web Service"**.
3. Associe ton dépôt GitHub : **`Phygi-64/GeoCube`**.
4. Renseigne les paramètres suivants :
   - **Name** : `geocube` (ou le nom de ton choix)
   - **Region** : Frankfurt (EU) (ou le plus proche de chez toi)
   - **Branch** : `main`
   - **Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `node src/server/server.js`
   - **Instance Type** : `Free`
5. Clique sur **"Create Web Service"**.
6. Ton serveur est en ligne en ~2 minutes sur une URL du type :
   `https://geocube.onrender.com`

> 💡 **Astuce pour empêcher la mise en veille gratuite sur Render** :  
> Le plan gratuit de Render met le serveur en veille après 15 minutes sans requête (le réveil prend ~30 à 45 secondes).  
> Pour le garder éveillé 24h/24 gratuitement :
> 1. Crée un compte gratuit sur [cron-job.org](https://cron-job.org) ou [UptimeRobot](https://uptimerobot.com).
> 2. Ajoute un moniteur HTTP qui envoie une requête GET toutes les 10 minutes sur ton endpoint :  
>    `https://geocube.onrender.com/health`  
> Le serveur restera actif 24h/24 sans jamais s'endormir !

---

### Option 2 : Koyeb ⚡

[Koyeb.com](https://www.koyeb.com) offre un service gratuit ("Free Eco Tier") sur une infrastructure globale ultra-rapide.

#### Étapes :
1. Crée un compte sur [Koyeb.com](https://www.koyeb.com).
2. Clique sur **"Create Service"** > **"GitHub"**.
3. Sélectionne `Phygi-64/GeoCube`.
4. Koyeb détectera automatiquement le `Dockerfile` présent dans le projet.
5. Déploie en 1 clic ! L'URL sera disponible sous la forme `https://<nom-de-ton-app>.koyeb.app`.

---

### Option 3 (Le Graal 24h/24) : Oracle Cloud Always Free 👑

Si tu souhaites un **véritable serveur VPS dédié Linux**, actif 24h/24 sans aucune mise en veille et avec une persistance disque garantie :

1. Inscris-toi sur [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) ("Always Free").
2. Crée une instance de calcul gratuite (Ampere ARM avec jusqu'à 4 vCPU et 24 Go de RAM offerts à vie).
3. Installe Node.js et PM2 :
   ```bash
   sudo apt update && sudo apt install -y nodejs npm git
   sudo npm install -g pm2
   ```
4. Clone le dépôt et lance GeoCube :
   ```bash
   git clone https://github.com/Phygi-64/GeoCube.git
   cd GeoCube
   npm install
   pm2 start src/server/server.js --name "geocube"
   pm2 startup
   pm2 save
   ```
5. Tu as un serveur dédié permanent 100% gratuit !

---

## 📱 Compilation de l'APK Android (Capacitor)

Pour générer l'application mobile Android :

```bash
# 1. Synchroniser les fichiers web avec Capacitor
npx cap sync android

# 2. Compiler l'APK de débogage
./build_apk.bat
```

L'APK sera généré dans :
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📁 Structure du Projet

```text
GeoCube/
├── src/
│   ├── client/              # Interface Web, Three.js, UI
│   │   ├── index.html       # Structure HTML, menus, HUD
│   │   ├── client.js        # Logique jeu 3D, Socket.IO, Quêtes, Clicker
│   │   ├── style.css        # Styles Pixel-Art, responsive mobile
│   │   └── assets/          # Textures 3D, icônes, sons
│   └── server/              # Backend Node.js
│       ├── server.js        # Serveur unifié Express + Socket.IO + multi-mondes
│       ├── server_alpha.js  # Serveur autonome Alpha (port 30001)
│       ├── server_beta.js   # Serveur autonome Beta (port 30002)
│       ├── users.json       # Persistance des profils joueurs et inventaires
│       └── world_alpha.json # Blocs posés dans le monde Alpha
├── android/                 # Projet Android natif (Capacitor)
├── Dockerfile               # Configuration conteneur prête pour le déploiement cloud
├── render.yaml              # Blueprint 1-clic pour Render.com
└── package.json             # Dépendances et scripts de lancement
```

---

## 📝 Licence

Projet développé avec passion par **Phygi** et la **GeoCube Team** (Watercube Studio). Licence ISC.
