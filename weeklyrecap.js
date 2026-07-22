import { Client } from '@notionhq/client';
import { GoogleGenAI } from '@google/genai';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
    // 1. Protection par secret pour Vercel Cron Jobs / Trigger manuel
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, error: 'Accès non autorisé' });
    }

    // Accepter uniquement GET (Vercel Cron) ou POST
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    console.log("🚀 [Serverless] Lancement du traitement hebdomadaire HOC...");

    try {
        // 2. Filtrer les insights des 7 derniers jours
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const isoWeekAgo = oneWeekAgo.toISOString();

        const cleanedDatabaseId = (process.env.NOTION_DATABASE_ID || "").trim().replace(/-/g, "");

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
            console.log("📋 Aucun signal faible collecté cette semaine.");
            return res.status(200).json({ 
                success: true, 
                message: "Aucun signal faible collecté cette semaine. Aucun rapport à générer." 
            });
        }

        // 3. Regroupement par projet
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

        const projets = Object.keys(insightsParProjet);
        const cleanedRecapsDbId = (process.env.NOTION_RECAPS_DATABASE_ID || "").trim().replace(/-/g, "");
        const rapportsGeneres = [];

        // 4. Génération Gemini & Écriture Notion pour chaque projet
        for (const proj of projets) {
            console.log(`🧠 Synthèse Gemini en cours pour : ${proj}...`);
            const listeInsights = insightsParProjet[proj].map(ins => `- ${ins}`).join('\n');

            const prompt = `Tu es l'analyste stratégique de l'agence de design HOC.
Voici une liste d'insights et de retours terrain bruts collectés cette semaine pour le projet "${proj}" :

${listeInsights}

Fais une synthèse condensée, claire et actionnable de ces retours sous forme de puces (3 puces maximum). 
Sois direct, professionnel et utilise un ton constructif orienté design de service. Ne mets pas d'introduction ni de conclusion, donne directement les puces.`;

            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            const rapportSynthese = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text || "Aucun rapport généré.";
            const dateAujourdhui = new Date().toISOString().split('T')[0];

            await notion.request({
                path: "pages",
                method: "POST",
                body: {
                    parent: { database_id: cleanedRecapsDbId },
                    properties: {
                        'Nom': {
                            title: [{ text: { content: `Rapport Hebdo - ${dateAujourdhui}` } }]
                        },
                        'Projet': {
                            rich_text: [{ text: { content: proj } }]
                        },
                        'Contenu': {
                            rich_text: [{ text: { content: rapportSynthese } }]
                        }
                    }
                }
            });

            rapportsGeneres.push(proj);
        }

        return res.status(200).json({
            success: true,
            message: `Synthèses générées avec succès pour : ${rapportsGeneres.join(', ')}`
        });

    } catch (error) {
        console.error("❌ Erreur critique Serverless :", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || "Erreur interne lors de la génération." 
        });
    }
}
