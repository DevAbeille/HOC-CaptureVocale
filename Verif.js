require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function interrogerDataSource() {
    // L'ID de ta base (qui est l'ID de la data source)
    const cleanedId = (process.env.NOTION_DATABASE_ID || "").trim().replace(/-/g, "");

    console.log("====================================================");
    console.log("📡 REQUÊTE NATIVE SUR DATA SOURCE (Selon la Doc) 🚀");
    console.log("====================================================");

    try {
        // C'est l'URL exacte mentionnée dans ta documentation pour les Data Sources !
        const response = await notion.request({
            path: `data_sources/${cleanedId}/query`,
            method: 'POST',
            body: {} 
        });

        console.log("✅ Connexion réussie à la Data Source !");
        
        if (response.results && response.results.length > 0) {
            const premiereLigne = response.results[0];
            
            // Extraction dynamique du nom du parent/source si Notion l'inclut dans la ligne
            let nomDeLaBase = "Référentiel projet (Confirmé via interface)";
            if (premiereLigne.parent && premiereLigne.parent.database_id) {
                // On garde une trace si besoin
            }

            console.log(`ℹ️  Nom de la base connectée : "${nomDeLaBase}"`);

            console.log("\n📋 COLONNES RECONNUES DANS TA DATA SOURCE :");
            console.log("----------------------------------------------------");
            if (premiereLigne.properties) {
                console.log(Object.keys(premiereLigne.properties));
            } else {
                console.log("⚠️ Lignes trouvées, mais le format des propriétés est différent. Voici l'objet brut d'une ligne :");
                console.log(Object.keys(premiereLigne));
            }
            console.log("----------------------------------------------------");
        } else {
            console.log("\n⚠️ La Data Source a répondu mais elle ne contient aucune ligne.");
            console.log("👉 Va sur Notion et écris une ligne de test dans ton tableau pour l'activer.");
        }

    } catch (error) {
        console.log("\n❌ Échec de la requête Data Source :");
        console.log(`• Code Erreur : ${error.code}`);
        console.log(`• Message : ${error.message}`);
    }
    console.log("====================================================");
}

interrogerDataSource();