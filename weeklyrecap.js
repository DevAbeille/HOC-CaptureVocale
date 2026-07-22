require('dotenv').config();
const { Client } = require('@notionhq/client');
const { GoogleGenAI } = require('@google/genai');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runWeeklyRecapPipeline() {
    console.log("🚀 Lancement du traitement hebdomadaire des signaux faibles...");

    try {
        // 1. Calculer la date d'il y a 7 jours pour filtrer les nouveautés
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const isoWeekAgo = oneWeekAgo.toISOString();

        // On nettoie l'ID d'ajout de la table des confessions
        const cleanedDatabaseId = process.env.NOTION_DATABASE_ID.trim().replace(/-/g, "");
        
        // 2. Récupérer tous les insights collectés cette semaine (via l'endpoint classique pages/query ou databases/query)
        const response = await notion.request({
            path: `databases/${cleanedDatabaseId}/query`,
            method: 'POST',
            body: {
                filter: {
                    property: 'Created time',
                    date: {
                        on_or_after: isoWeekAgo
                    }
                }
            }
        });

        if (!response.results || response.results.length === 0) {
            console.log("📋 Aucun signal faible collecté cette semaine. Fin du script.");
            return;
        }

        // 3. Regrouper les insights par projet dans un objet JS
        const insightsParProjet = {};
        response.results.forEach(page => {
            const props = page.properties;
            const propProjet = props['Projet'];
            const propInsight = props['Insight'];

            let projectName = "Général";
            if (propProjet && propProjet.rich_text && propProjet.rich_text.length > 0) {
                projectName = propProjet.rich_text[0].plain_text.trim();
            }

            let insightText = "";
            if (propInsight && propInsight.title && propInsight.title.length > 0) {
                insightText = propInsight.title[0].plain_text.trim();
            }

            if (insightText) {
                if (!insightsParProjet[projectName]) {
                    insightsParProjet[projectName] = [];
                }
                insightsParProjet[projectName].push(insightText);
            }
        });

        // 4. Boucler sur chaque projet pour générer la synthèse et l'insérer
        const projets = Object.keys(insightsParProjet);
        
        // ID d'AJOUT pour la table des rapports (Le conteneur parent)
        const cleanedRecapsDbId = process.env.NOTION_RECAPS_DATABASE_ID.trim().replace(/-/g, "");

        for (const proj of projets) {
            console.log(`🧠 Synthèse Gemini en cours pour le projet : ${proj}...`);
            const listeInsights = insightsParProjet[proj].map(ins => `- ${ins}`).join('\n');

            const prompt = `Tu es l'analyste stratégique de l'agence de design HOC.
Voici une liste d'insights et de retours terrain bruts collectés cette semaine pour le projet "${proj}" :

${listeInsights}

Fais une synthèse condensée, claire et actionnable de ces retours sous forme de puces (3 puces maximum). 
Sois direct, professionnel et utilise un ton constructif orienté design de service. Ne mets pas d'introduction ni de conclusion, donne directement les puces.`;

            // Appel à Gemini 2.5 Flash
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            const rapportSynthese = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text || "Aucun rapport généré.";
            
            // 5. Écriture du rapport via l'ID d'AJOUT (database_id)
            console.log(`💾 Publication du rapport dans la base de données Notion...`);
            const dateAujourdhui = new Date().toISOString().split('T')[0];

            await notion.request({
                path: "pages",
                method: "POST",
                body: {
                    parent: { database_id: cleanedRecapsDbId }, // Utilisation stricte de l'id d'ajout
                    properties: {
                        'Nom': {
                            title: [
                                { text: { content: `Rapport Hebdo - ${dateAujourdhui}` } }
                            ]
                        },
                        'Projet': {
                            rich_text: [
                                { text: { content: proj } }
                            ]
                        },
                        'Contenu': {
                            rich_text: [
                                { text: { content: rapportSynthese } }
                            ]
                        }
                    }
                }
            });
            console.log(`✅ Rapport publié avec succès pour ${proj} !`);
        }

        console.log("🎉 Tous les récapitulatifs hebdomadaires ont été générés et distribués avec succès.");

    } catch (error) {
        console.error("❌ Erreur critique lors de l'exécution du Cron hebdomadaire :", error);
    }
}

runWeeklyRecapPipeline();