const Database = require('better-sqlite3');
const fs = require('fs');

const sourceDbPath = 'data/dev.db';
const targetDbPath = 'prisma/dev.db';

console.log('=== Syncing Missing ErrorItem-Tag Relations ===\n');

const sourceDb = new Database(sourceDbPath, { readonly: true });
const targetDb = new Database(targetDbPath);

try {
    const sourceRelations = sourceDb.prepare('SELECT * FROM _ErrorItemToKnowledgeTag').all();
    console.log(`Found ${sourceRelations.length} relations in source database`);

    let syncedRelations = 0;
    let skippedRelations = 0;
    let errorRelations = 0;

    sourceRelations.forEach(sourceRelation => {
        // Use column names A (errorItemId) and B (knowledgeTagId)
        const sourceErrorItemId = sourceRelation.A;
        const sourceTagId = sourceRelation.B;

        // Find corresponding error item in target (by original ID)
        const targetErrorItem = targetDb.prepare('SELECT id FROM ErrorItem WHERE id = ?').get(sourceErrorItemId);
        if (!targetErrorItem) {
            console.log(`⚠ Error item not found: ${sourceErrorItemId}`);
            errorRelations++;
            return;
        }

        // Find corresponding tag in target (by original ID)
        const targetTag = targetDb.prepare('SELECT id FROM KnowledgeTag WHERE id = ?').get(sourceTagId);
        if (!targetTag) {
            console.log(`⚠ Tag not found: ${sourceTagId}`);
            errorRelations++;
            return;
        }

        // Check if relation already exists
        const existingRelation = targetDb.prepare(`
            SELECT * FROM _ErrorItemToKnowledgeTag
            WHERE "A" = ? AND "B" = ?
        `).get(targetErrorItem.id, targetTag.id);

        if (!existingRelation) {
            targetDb.prepare(`
                INSERT INTO _ErrorItemToKnowledgeTag ("A", "B")
                VALUES (?, ?)
            `).run(targetErrorItem.id, targetTag.id);
            syncedRelations++;
            console.log(`✓ Created relation: errorItem=${targetErrorItem.id}, tag=${targetTag.id}`);
        } else {
            skippedRelations++;
        }
    });

    console.log(`\n=== Results ===`);
    console.log(`Relations synced: ${syncedRelations}`);
    console.log(`Relations skipped (already existed): ${skippedRelations}`);
    console.log(`Relations with errors: ${errorRelations}`);
    console.log(`\n✅ Relation sync completed!`);

} catch (error) {
    console.error('❌ Relation sync failed:', error);
    process.exit(1);
} finally {
    sourceDb.close();
    targetDb.close();
}
