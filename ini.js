require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dateToday = new Date().toISOString().split('T')[0];

async function runFullPipelineTest() {
    console.log(`====================================================`);
    console.log(`🚀 DEBUT DU JEU DE TEST GLOBAL (3 TABLES - ECRITURE & LECTURE)`);
    console.log(`====================================================\n`);

    // --- NETTOYAGE DES IDS DU .ENV ---
    const t1Ds = process.env.NOTION_CATALOGUE_DATASOURCE_ID?.trim().replace(/-/g, "");
    const t1Db = process.env.NOTION_CATALOGUE_DATABASE_ID?.trim().replace(/-/g, "");

    const t2Ds = process.env.NOTION_INSIGHT_DATASOURCE_ID?.trim().replace(/-/g, "");
    const t2Db = process.env.NOTION_INSIGHT_DATABASE_ID?.trim().replace(/-/g, "");

    const t3Ds = process.env.NOTION_RECAPS_DATASOURCE_ID?.trim().replace(/-/g, "");
    const t3Db = process.env.NOTION_RECAPS_DATABASE_ID?.trim().replace(/-/g, "");

    // =================================================================
    // 📊 TABLE 1 : CATALOGUE PROJETS
    // =================================================================
    console.log(`🔹 [TABLE 1] - CATALOGUE PROJETS`);
    console.log(`----------------------------------------------------`);
    try {
        console.log(`⏳ Écriture d'un projet test sur DB...`);
        await notion.request({
            path: "pages",
            method: "POST",
            body: {
                parent: { database_id: t1Db },
                properties: {
                    'Projet': { title: [{ text: { content: "Projet Prototype IA" } }] }
                }
            }
        });
        console.log(`✅ Écriture Table 1 OK !`);
    } catch (err) {
        console.error(`❌ Échec Écriture Table 1 : ${err.message}`);
    }

    try {
        console.log(`⏳ Lecture du catalogue sur DATASOURCE...`);
        const res = await notion.request({ path: `data_sources/${t1Ds}/query`, method: 'POST', body: {} });
        console.log(`✅ Lecture Table 1 OK ! Lignes trouvées : ${res.results?.length || 0}`);
    } catch (err) {
        console.error(`❌ Échec Lecture Table 1 : ${err.message}`);
    }


    // =================================================================
    // 📥 TABLE 2 : CONFESSIONS / SIGNAUX FAIBLES
    // =================================================================
    console.log(`\n🔹 [TABLE 2] - SIGNAUX FAIBLES`);
    console.log(`----------------------------------------------------`);
    try {
        console.log(`⏳ Écriture d'un signal faible test sur DB...`);
        await notion.request({
            path: "pages",
            method: "POST",
            body: {
                parent: { database_id: t2Db },
                properties: {
                    'Insight': { title: [{ text: { content: "L'utilisateur se plaint de la lenteur de l'authentification." } }] },
                    'Projet': { rich_text: [{ text: { content: "Projet Prototype IA" } }] }
                }
            }
        });
        console.log(`✅ Écriture Table 2 OK !`);
    } catch (err) {
        console.error(`❌ Échec Écriture Table 2 : ${err.message}`);
    }

    try {
        console.log(`⏳ Lecture des signaux sur DATASOURCE...`);
        const res = await notion.request({ path: `data_sources/${t2Ds}/query`, method: 'POST', body: {} });
        console.log(`✅ Lecture Table 2 OK ! Lignes trouvées : ${res.results?.length || 0}`);
    } catch (err) {
        console.error(`❌ Échec Lecture Table 2 : ${err.message}`);
    }


    // =================================================================
    // 🗓️ TABLE 3 : RÉCAPITULATIFS HEBDOS
    // =================================================================
    console.log(`\n🔹 [TABLE 3] - RÉCAPITULATIFS HEBDOS`);
    console.log(`----------------------------------------------------`);
    try {
        console.log(`⏳ Écriture d'un rapport synthétisé sur DB...`);
        await notion.request({
            path: "pages",
            method: "POST",
            body: {
                parent: { database_id: t3Db },
                properties: {
                    'Nom': { title: [{ text: { content: `Rapport Test - ${dateToday}` } }] },
                    'Projet': { rich_text: [{ text: { content: "Projet Prototype IA" } }] },
                    'Contenu': { rich_text: [{ text: { content: "- Optimiser l'authentification mobile." } }] }
                }
            }
        });
        console.log(`✅ Écriture Table 3 OK !`);
    } catch (err) {
        console.error(`❌ Échec Écriture Table 3 : ${err.message}`);
    }

    try {
        console.log(`⏳ Lecture des rapports sur DATASOURCE...`);
        const res = await notion.request({ path: `data_sources/${t3Ds}/query`, method: 'POST', body: {} });
        console.log(`✅ Lecture Table 3 OK ! Lignes trouvées : ${res.results?.length || 0}`);
    } catch (err) {
        console.error(`❌ Échec Lecture Table 3 : ${err.message}`);
    }

    console.log(`\n====================================================`);
    console.log(`🏁 FIN DU DIAGNOSTIC GLOBAL`);
    console.log(`====================================================`);
}

runFullPipelineTest();