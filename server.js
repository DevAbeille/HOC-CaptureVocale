require('dotenv').config(); 
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
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
            return res.status(400).json({ success: false, error: "Email et mot de passe requis." });
        }

        if (!process.env.NOTION_CONTACT_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "Configuration serveur incomplète (NOTION_CONTACT_DATASOURCE_ID manquant)." });
        }
        
        const dsId = process.env.NOTION_CONTACT_DATASOURCE_ID.trim().replace(/-/g, "");
        console.log(`🔍 [Auth] Recherche des identifiants pour : ${email}`);

        // Requête sur la Data Source pour valider le couple Email et Password
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
            console.log(`✅ [Auth] Connexion validée pour : ${email}`);
            return res.json({ success: true });
        } else {
            console.log(`⚠️ [Auth] Échec de connexion : Identifiants introuvables pour ${email}`);
            return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect." });
        }

    } catch (error) {
        console.error("❌ Erreur lors de l'authentification :", error);
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
            return res.status(400).json({ success: false, error: "Champs manquants." });
        }

        console.log(`➕ [Auth] Demande d'inscription pour l'adresse : ${email}`);

        if (!process.env.NOTION_CONTACT_DATABASE_ID) {
            return res.status(500).json({ success: false, error: "Configuration serveur incomplète (NOTION_CONTACT_DATABASE_ID manquant)." });
        }
        
        const dbId = process.env.NOTION_CONTACT_DATABASE_ID.trim().replace(/-/g, "");

        // Ajout de la nouvelle ligne utilisateur dans la table des contacts Notion
        // Insertion avec 'Email' comme colonne principale (Title)
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
                            { text: { content: "" } } // Vide par défaut à la création
                        ]
                    }
                }
            }
        });

        console.log(`✅ [Auth] Utilisateur [${email}] créé avec succès dans Notion.`);
        res.json({ success: true });

    } catch (error) {
        console.error("❌ Erreur lors de la création du compte dans Notion :", error);
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
        console.log("🔍 Récupération globale du Catalogue des projets (Table 1)...");
        
        if (!process.env.NOTION_CATALOGUE_DATASOURCE_ID) {
            return res.status(500).json({ success: false, error: "NOTION_CATALOGUE_DATASOURCE_ID manquante." });
        }
        const dsId = process.env.NOTION_CATALOGUE_DATASOURCE_ID.trim().replace(/-/g, "");

        const response = await notion.request({
            path: `data_sources/${dsId}/query`, 
            method: 'POST',
            body: {} // Tout récupérer sans filtre
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
        console.log(`📋 Liste du catalogue transmise à l'application mobile :`, listeProjets);

        res.json({ success: true, projects: listeProjets });

    } catch (error) {
        console.error("❌ Erreur lors du fetch du catalogue projets :", error);
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

        console.log(`🔍 Recherche des collaborateurs assignés au projet : ${project}`);
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
        console.error("❌ Erreur lors de la récupération des membres :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Enregistrement de la liaison locale ou simulation d'abonnement
 */
app.post('/api/user/projects', async (req, res) => {
    try {
        const { email, project } = req.body;
        console.log(`🔗 Liaison locale enregistrée : [${email}] <-> Projet [${project}]`);
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

        console.log(`🔍 Extraction des rapports hebdos (Table 3) pour : ${project}`);
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
            listeRecaps = ["Aucun rapport historique consolidé pour le moment sur ce projet."];
        }

        res.json({ success: true, contenu: listeRecaps });

    } catch (error) {
        console.error("❌ Erreur lors de la récupération des rapports :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * ==========================================================================
 * ÉTAPE 4 : Pipeline Gemini — Transcription et nettoyage audio en direct
 * ==========================================================================
 */
app.post('/api/confess', upload.single('audio'), async (req, res) => {
    try {
        const audioFile = req.file;

        if (!audioFile) {
            return res.status(400).json({ success: false, error: "Fichier audio manquant." });
        }

        // Détection ou définition du MIME type
        let detectedMimeType = audioFile.mimetype;
        if (!detectedMimeType || detectedMimeType === 'application/octet-stream') {
            detectedMimeType = 'audio/webm'; 
        }

        // Récupération directe du Buffer depuis la mémoire (compatible Serverless Vercel)
        const audioBuffer = audioFile.buffer;

        const audioPart = {
            inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: detectedMimeType
            }
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                audioPart,
                `Tu es l'intelligence artificielle du "Confessionnal IA", un outil de capture de signaux faibles et d'insights terrain pour des projets de design et de conseil.

                Analyse l'audio fourni et respecte STRICTEMENT les règles suivantes :

                1. Si l'audio est vide ou inexploitable :
                Réponds EXACTEMENT et UNIQUEMENT avec la phrase suivante, sans aucune autre fioriture :
                rien n'est dit

                2. Si l'audio contient des informations :
                Extrais et synthétise de manière claire et concise toutes les informations clés sous la forme d'un insight actionnable. Va droit au but, retire les tics de langage et supprime les hésitations.`
            ]
        });

        const generatedText = response.candidates?.[0]?.content?.parts?.[0]?.text || "Rien n'a pu être généré.";

        res.json({ 
            success: true, 
            anonymizedInsight: generatedText.trim() 
        });

    } catch (error) {
        console.error("❌ Erreur Gemini :", error);
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

        console.log(`➕ Insertion d'un nouveau signal terrain dans la Table 2 [Projet: ${project}]...`);

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

        console.log("✅ Signal injecté avec succès dans la Table 2 de Notion !");
        res.json({ success: true });

    } catch (error) {
        console.error("❌ Erreur lors de l'insertion dans la Table 2 :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`====== SÉCURITÉ ET COUPLAGE SCHÉMAS ACTIVÉS ======`);
    console.log(`🔊 Serveur connecté aux flux Notion sur http://localhost:${PORT}`);
    console.log(`===================================================`);
});
