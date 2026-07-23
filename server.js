require('dotenv').config(); 
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai'); 
const { Client } = require('@notionhq/client');

// Initialisation du client officiel Notion
const notion = new Client({ 
    auth: process.env.NOTION_TOKEN 
});

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));
app.use(express.json());

// ROUTE RACINE : Servir le fichier index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Stockage en mémoire RAM pour l'environnement Serverless (Vercel)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

/**
 * ==========================================================================
 * ÉTAPE 1 : Authentification — Connexion d'un utilisateur (Table Contacts)
 * PATTERN B : Lecture & Filtrage via l'endpoint data_sources
 * ==========================================================================
 */
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: "Identifiants hoc requis pour l'accès." });
        }

        if (!process.env.NOTION_CONTACT_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "Configuration serveur hoc incomplète (NOTION_CONTACT_DATASOURCE_ID manquant)." });
        }
        
        const dsId = process.env.NOTION_CONTACT_DATASOURCE_ID.trim().replace(/-/g, "");
        console.log(`⚡ [hoc Auth] Vérification des accès pour : ${email}`);

        const response = await notion.request({
            path: `data_sources/${dsId}/query`,
            method: 'POST',
            body: {
                filter: {
                    and: [
                        { property: 'Email', email: { equals: email } },
                        { property: 'Password', rich_text: { equals: password } }
                    ]
                }
            }
        });

        if (response && response.results && response.results.length > 0) {
            console.log(`🎯 [hoc Auth] Accès accordé à l'espace pour : ${email}`);
            return res.json({ success: true });
        } else {
            console.log(`⚠️ [hoc Auth] Accès refusé : Identifiants invalides pour ${email}`);
            return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect." });
        }

    } catch (error) {
        console.error("❌ [hoc Auth] Erreur lors de l'authentification :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 1.2 : Authentification — Inscription / Création de compte (Table Contacts)
 * PATTERN A : Écriture pure via /pages dans la DATABASE parente
 * ==========================================================================
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: "Champs d'inscription incomplets." });
        }

        console.log(`➕ [hoc Auth] Création d'un nouveau profil collaborateur : ${email}`);

        if (!process.env.NOTION_CONTACT_DATABASE_ID) {
            return res.status(500).json({ success: false, error: "Configuration serveur hoc incomplète (NOTION_CONTACT_DATABASE_ID manquant)." });
        }
        
        const dbId = process.env.NOTION_CONTACT_DATABASE_ID.trim().replace(/-/g, "");

        await notion.request({
            path: "pages",
            method: "POST",
            body: {
                parent: { database_id: dbId },
                properties: {
                    'Email': {
                        title: [
                            { text: { content: email } }
                        ]
                    },
                    'Password': {
                        rich_text: [
                            { text: { content: password } }
                        ]
                    },
                    'Projets Rejoints': {
                        rich_text: [
                            { text: { content: "" } }
                        ]
                    }
                }
            }
        });

        console.log(`✨ [hoc Auth] Profil [${email}] enregistré dans le Workspace.`);
        res.json({ success: true });

    } catch (error) {
        console.error("❌ [hoc Auth] Erreur lors de la création du compte :", error);
        res.status(500).json({ success: false, error: "Erreur d'écriture Notion : " + error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 2 : Récupérer dynamiquement la liste globale des projets (Table 1)
 * PATTERN B : Lecture seule via la DATA_SOURCE du Catalogue
 * ==========================================================================
 */
app.get('/api/projects', async (req, res) => {
    try {
        console.log("🔍 [hoc Catalogue] Synchronisation des projets actifs...");
        
        if (!process.env.NOTION_CATALOGUE_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "NOTION_CATALOGUE_DATASOURCE_ID manquante." });
        }
        const dsId = process.env.NOTION_CATALOGUE_DATASOURCE_ID.trim().replace(/-/g, "");

        const response = await notion.request({
            path: `data_sources/${dsId}/query`, 
            method: 'POST',
            body: {}
        });

        const projetsUniques = new Set();

        if (response && response.results) {
            response.results.forEach(page => {
                if (page.properties) {
                    const propProjet = page.properties['Projet'] || page.properties['projet'];
                    if (propProjet && propProjet.title && propProjet.title.length > 0) {
                        const nomProjet = propProjet.title[0].plain_text.trim();
                        if (nomProjet) projetsUniques.add(nomProjet);
                    }
                }
            });
        }

        const listeProjets = Array.from(projetsUniques);
        console.log(`📋 [hoc Catalogue] ${listeProjets.length} projet(s) chargé(s) :`, listeProjets);

        res.json({ success: true, projects: listeProjets });

    } catch (error) {
        console.error("❌ [hoc Catalogue] Erreur lors de la récupération des projets :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 2.5 : Récupérer les membres actifs assignés à un projet
 * PATTERN B : Lecture & Filtrage via l'endpoint data_sources des Insights
 * ==========================================================================
 */
app.get('/api/projects/members', async (req, res) => {
    try {
        const { project } = req.query;
        if (!project) {
            return res.status(400).json({ success: false, error: "Nom de projet manquant." });
        }

        console.log(`🔍 [hoc Équipe] Extraction des contributeurs du projet : ${project}`);
        if (!process.env.NOTION_INSIGHT_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "NOTION_INSIGHT_DATASOURCE_ID manquante." });
        }
        const dsId = process.env.NOTION_INSIGHT_DATASOURCE_ID.trim().replace(/-/g, "");

        const response = await notion.request({
            path: `data_sources/${dsId}/query`,
            method: 'POST',
            body: {
                filter: {
                    property: 'Projet',
                    rich_text: { equals: project }
                }
            }
        });

        const membres = new Set();
        if (response && response.results) {
            response.results.forEach(page => {
                if (page.properties && page.properties['Insight']) {
                    const txt = page.properties['Insight'].title?.[0]?.plain_text || "";
                    if (txt.startsWith("Affectation : ")) {
                        membres.add(txt.replace("Affectation : ", "").trim());
                    }
                }
            });
        }

        res.json({ success: true, members: Array.from(membres) });
    } catch (error) {
        console.error("❌ [hoc Équipe] Erreur lors de la récupération des membres :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Enregistrement de la liaison locale ou simulation d'abonnement
 */
app.post('/api/user/projects', async (req, res) => {
    try {
        const { email, project } = req.body;
        console.log(`🔗 [hoc User] Liaison enregistrée : [${email}] <-> Projet [${project}]`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 3 : Extraction des comptes-rendus / Récaps Hebdos (Table 3)
 * PATTERN B : Lecture & Filtrage via l'endpoint data_sources
 * ==========================================================================
 */
app.post('/api/projects/recap', async (req, res) => {
    try {
        const { project } = req.body;
        if (!project) {
            return res.status(400).json({ success: false, error: "Nom du projet manquant." });
        }

        console.log(`🔍 [hoc Synthèse] Consolidation des rapports hebdomadaires : ${project}`);
        if (!process.env.NOTION_RECAPS_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "NOTION_RECAPS_DATASOURCE_ID manquante." });
        }
        const dsId = process.env.NOTION_RECAPS_DATASOURCE_ID.trim().replace(/-/g, "");

        const response = await notion.request({
            path: `data_sources/${dsId}/query`,
            method: 'POST',
            body: {
                filter: {
                    property: 'Projet',
                    rich_text: { equals: project }
                }
            }
        });

        let listeRecaps = [];

        if (response && response.results) {
            response.results.forEach(ligne => {
                if (ligne.properties) {
                    let nomRapport = "Rapport sans titre";
                    if (ligne.properties['Nom']?.title?.[0]) {
                        nomRapport = ligne.properties['Nom'].title[0].plain_text;
                    }
                    if (ligne.properties['Contenu']?.rich_text?.[0]) {
                        const textBrut = ligne.properties['Contenu'].rich_text[0].plain_text;
                        listeRecaps.push(`${nomRapport} : ${textBrut}`);
                    }
                }
            });
        }

        if (listeRecaps.length === 0) {
            listeRecaps = ["Aucune synthèse historique disponible pour ce projet pour le moment."];
        }

        res.json({ success: true, contenu: listeRecaps });

    } catch (error) {
        console.error("❌ [hoc Synthèse] Erreur lors de l'extraction :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 4 : Pipeline Gemini — Confessionnal IA (Traitement audio direct)
 * ==========================================================================
 */
app.post('/api/confess', upload.single('audio'), async (req, res) => {
    try {
        const audioFile = req.file;

        if (!audioFile) {
            return res.status(400).json({ success: false, error: "Flux audio manquant." });
        }

        let detectedMimeType = audioFile.mimetype;
        if (!detectedMimeType || detectedMimeType === 'application/octet-stream') {
            detectedMimeType = 'audio/webm'; 
        }

        const audioBuffer = audioFile.buffer;

        const audioPart = {
            inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: detectedMimeType
            }
        };

        console.log(`🎙️ [hoc Confessionnal] Analyse du flux vocal avec Gemini...`);

        const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
        audioPart // On ne laisse QUE la partie audio ici
    ],
    config: {
        // 1. Désactive la créativité / hallucination (0.0 = déterministe)
        temperature: 0.0,
        
        // 2. Isole la consigne système pour éviter les leaks dans la réponse
        systemInstruction: `Tu es un système de retranscription audio extrêmement précis.

RÈGLES IMPÉRATIVES :
1. Si l'audio ne contient AUCUNE parole humaine claire (silence, bruit de fond, souffle, grésillements) : Tu dois répondre STRICTEMENT et UNIQUEMENT par une chaîne vide (aucun mot, aucun espace, aucune ponctuation). Ne produis JAMAIS de texte d'exemple ou de fiction.
2. Si de la voix est détectée : Retranscris exactement et fidèlement les paroles prononcées, sans ajouter de commentaires.`
    }
});
        let generatedText = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
        generatedText = generatedText.trim();

        // Filtre anti-hallucination côté serveur
        const hallucinations = [
            "routine matinale", 
            "sous-titrage", 
            "merci d'avoir regardé", 
            "rien n'est dit",
            "à bientôt"
        ];
        
        if (hallucinations.some(h => generatedText.toLowerCase().includes(h))) {
            generatedText = "";
        }

        console.log(`✨ [hoc Confessionnal] Transcription finale : "${generatedText}"`);

        res.json({ 
            success: true, 
            transcript: generatedText,
            anonymizedInsight: generatedText 
        });

    } catch (error) {
        console.error("❌ [hoc Confessionnal] Erreur de traitement Gemini :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 5 : Envoyer l'insight finalisé vers Notion (Table 2)
 * PATTERN A : Écriture brute via l'endpoint /pages sur la DATABASE originale
 * ==========================================================================
 */
app.post('/api/notion', async (req, res) => {
    try {
        const { insight, project } = req.body;

        if (!insight) {
            return res.status(400).json({ success: false, error: "Contenu de l'insight manquant." });
        }

        console.log(`🎯 [hoc Insight] Injection du signal faible [Projet: ${project || "Général"}]...`);

        if (!process.env.NOTION_INSIGHT_DATABASE_ID) {
            return res.status(500).json({ success: false, error: "NOTION_INSIGHT_DATABASE_ID manquante." });
        }
        const dbId = process.env.NOTION_INSIGHT_DATABASE_ID.trim().replace(/-/g, "");

        await notion.request({
            path: "pages",
            method: "POST",
            body: {
                parent: { database_id: dbId }, 
                properties: {
                    'Insight': {
                        title: [
                            { text: { content: insight.length > 200 ? insight.substring(0, 197) + "..." : insight } }
                        ]
                    },
                    'Projet': {
                        rich_text: [
                            { text: { content: project || "Général" } }
                        ]
                    }
                }
            }
        });

        console.log("✅ [hoc Insight] Signal injecté avec succès dans le Workspace Notion !");
        res.json({ success: true });

    } catch (error) {
        console.error("❌ [hoc Insight] Erreur lors de l'injection Notion :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================================================
// ADAPTATION VERCEL SERVERLESS & DÉVELOPPEMENT LOCAL
// ==========================================================================
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`===================================================`);
        console.log(`⚡ [hoc Studio] Serveur actif sur http://localhost:${PORT}`);
        console.log(`===================================================`);
    });
}

// Export pour l'exécution serverless Vercel
module.exports = app;
