const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const sourceDbPath = 'data/dev.db';
const targetDbPath = 'prisma/dev.db';

if (!fs.existsSync(sourceDbPath)) {
    console.error('Source database not found:', sourceDbPath);
    process.exit(1);
}

if (!fs.existsSync(targetDbPath)) {
    console.error('Target database not found:', targetDbPath);
    console.log('Please run "npx prisma migrate dev" first');
    process.exit(1);
}

console.log('Starting database sync...');
console.log(`Source: ${sourceDbPath}`);
console.log(`Target: ${targetDbPath}\n`);

// Open databases
const sourceDb = new Database(sourceDbPath, { readonly: true });
const targetDb = new Database(targetDbPath);

try {
    // Start transaction for data integrity
    const migrate = targetDb.transaction(() => {
        // === Users ===
        console.log('=== Syncing Users ===');
        const sourceUsers = sourceDb.prepare('SELECT * FROM User').all();
        let syncedUsers = 0;
        let skippedUsers = 0;

        sourceUsers.forEach(sourceUser => {
            const existingUser = targetDb.prepare('SELECT id FROM User WHERE email = ?').get(sourceUser.email);
            if (!existingUser) {
                targetDb.prepare(`
                    INSERT INTO User (id, email, password, name, createdAt, updatedAt, educationStage, enrollmentYear, role, isActive)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    sourceUser.id,
                    sourceUser.email,
                    sourceUser.password,
                    sourceUser.name,
                    sourceUser.createdAt,
                    sourceUser.updatedAt,
                    sourceUser.educationStage,
                    sourceUser.enrollmentYear,
                    sourceUser.role || 'user',
                    sourceUser.isActive !== 0 ? 1 : 0
                );
                syncedUsers++;
                console.log(`✓ Created user: ${sourceUser.email}`);
            } else {
                skippedUsers++;
                console.log(`- User already exists: ${sourceUser.email}`);
            }
        });
        console.log(`Users synced: ${syncedUsers}, skipped: ${skippedUsers}\n`);

        // Build user ID mapping for foreign key references
        const userMap = {};
        sourceUsers.forEach(sourceUser => {
            const targetUser = targetDb.prepare('SELECT id FROM User WHERE email = ?').get(sourceUser.email);
            if (targetUser) {
                userMap[sourceUser.id] = targetUser.id;
            }
        });

        // === Subjects ===
        console.log('=== Syncing Subjects ===');
        const sourceSubjects = sourceDb.prepare('SELECT * FROM Subject').all();
        let syncedSubjects = 0;
        let skippedSubjects = 0;
        const subjectMap = {};

        sourceSubjects.forEach(sourceSubject => {
            const targetUserId = userMap[sourceSubject.userId];
            if (!targetUserId) {
                console.log(`⚠ Skipping subject ${sourceSubject.name}: user not found`);
                return;
            }

            const existingSubject = targetDb.prepare('SELECT id FROM Subject WHERE name = ? AND userId = ?').get(sourceSubject.name, targetUserId);
            if (!existingSubject) {
                const newId = sourceSubject.id;
                targetDb.prepare(`
                    INSERT INTO Subject (id, name, userId, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?)
                `).run(newId, sourceSubject.name, targetUserId, sourceSubject.createdAt, sourceSubject.updatedAt);
                subjectMap[sourceSubject.id] = newId;
                syncedSubjects++;
                console.log(`✓ Created subject: ${sourceSubject.name}`);
            } else {
                subjectMap[sourceSubject.id] = existingSubject.id;
                skippedSubjects++;
                console.log(`- Subject already exists: ${sourceSubject.name}`);
            }
        });
        console.log(`Subjects synced: ${syncedSubjects}, skipped: ${skippedSubjects}\n`);

        // === KnowledgeTags ===
        console.log('=== Syncing KnowledgeTags ===');
        const sourceTags = sourceDb.prepare('SELECT * FROM KnowledgeTag').all();
        let syncedTags = 0;
        let skippedTags = 0;
        const tagMap = {};

        sourceTags.forEach(sourceTag => {
            const targetUserId = sourceTag.userId ? userMap[sourceTag.userId] : null;

            // First check if ID already exists
            const existingById = targetDb.prepare('SELECT id FROM KnowledgeTag WHERE id = ?').get(sourceTag.id);
            if (existingById) {
                tagMap[sourceTag.id] = existingById.id;
                skippedTags++;
                return;
            }

            // Handle parentId mapping
            const targetParentId = sourceTag.parentId ? (tagMap[sourceTag.parentId] || null) : null;

            // Check if tag already exists (by properties)
            const existingTag = targetDb.prepare(`
                SELECT id FROM KnowledgeTag
                WHERE name = ? AND subject = ? AND userId = ? AND parentId IS ?
            `).get(
                sourceTag.name,
                sourceTag.subject,
                targetUserId,
                targetParentId
            );

            if (!existingTag) {
                const newId = sourceTag.id;

                targetDb.prepare(`
                    INSERT INTO KnowledgeTag (id, name, subject, parentId, "order", code, isSystem, userId, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newId,
                    sourceTag.name,
                    sourceTag.subject,
                    targetParentId,
                    sourceTag.order,
                    sourceTag.code,
                    sourceTag.isSystem !== 0 ? 1 : 0,
                    targetUserId,
                    sourceTag.createdAt,
                    sourceTag.updatedAt
                );
                tagMap[sourceTag.id] = newId;
                syncedTags++;
            } else {
                tagMap[sourceTag.id] = existingTag.id;
                skippedTags++;
            }
        });
        console.log(`KnowledgeTags synced: ${syncedTags}, skipped: ${skippedTags}\n`);

        // === QuestionSources ===
        console.log('=== Syncing QuestionSources ===');
        const sourceSources = sourceDb.prepare('SELECT * FROM QuestionSource').all();
        let syncedSources = 0;
        let skippedSources = 0;

        sourceSources.forEach(sourceSource => {
            const targetUserId = userMap[sourceSource.userId];
            if (!targetUserId) {
                console.log(`⚠ Skipping question source ${sourceSource.name}: user not found`);
                return;
            }

            const existingSource = targetDb.prepare('SELECT id FROM QuestionSource WHERE name = ? AND userId = ?').get(sourceSource.name, targetUserId);
            if (!existingSource) {
                targetDb.prepare(`
                    INSERT INTO QuestionSource (id, name, userId, sortOrder, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(sourceSource.id, sourceSource.name, targetUserId, sourceSource.sortOrder, sourceSource.createdAt, sourceSource.updatedAt);
                syncedSources++;
                console.log(`✓ Created question source: ${sourceSource.name}`);
            } else {
                skippedSources++;
                console.log(`- Question source already exists: ${sourceSource.name}`);
            }
        });
        console.log(`QuestionSources synced: ${syncedSources}, skipped: ${skippedSources}\n`);

        // === ErrorItems ===
        console.log('=== Syncing ErrorItems ===');
        const sourceErrorItems = sourceDb.prepare('SELECT * FROM ErrorItem').all();
        let syncedErrorItems = 0;
        let skippedErrorItems = 0;
        const errorItemMap = {};

        sourceErrorItems.forEach(sourceError => {
            const targetUserId = userMap[sourceError.userId];
            if (!targetUserId) {
                console.log(`⚠ Skipping error item: user not found`);
                return;
            }

            const targetSubjectId = sourceError.subjectId ? (subjectMap[sourceError.subjectId] || null) : null;

            // Check for duplicate
            const existingError = targetDb.prepare(`
                SELECT id FROM ErrorItem
                WHERE userId = ? AND originalImageUrl = ?
            `).get(targetUserId, sourceError.originalImageUrl);

            if (!existingError) {
                const newId = sourceError.id;
                targetDb.prepare(`
                    INSERT INTO ErrorItem (
                        id, userId, subjectId, originalImageUrl, ocrText,
                        questionText, answerText, analysis, wrongAnswerText,
                        mistakeAnalysis, mistakeStatus, knowledgePoints, geogebraCommands,
                        source, errorType, userNotes, masteryLevel, gradeSemester, paperLevel,
                        createdAt, updatedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newId,
                    targetUserId,
                    targetSubjectId,
                    sourceError.originalImageUrl,
                    sourceError.ocrText,
                    sourceError.questionText,
                    sourceError.answerText,
                    sourceError.analysis,
                    sourceError.wrongAnswerText,
                    sourceError.mistakeAnalysis,
                    sourceError.mistakeStatus,
                    sourceError.knowledgePoints,
                    sourceError.geogebraCommands,
                    sourceError.source,
                    sourceError.errorType,
                    sourceError.userNotes,
                    sourceError.masteryLevel,
                    sourceError.gradeSemester,
                    sourceError.paperLevel,
                    sourceError.createdAt,
                    sourceError.updatedAt
                );
                errorItemMap[sourceError.id] = newId;
                syncedErrorItems++;
                console.log(`✓ Created error item: ${newId}`);
            } else {
                errorItemMap[sourceError.id] = existingError.id;
                skippedErrorItems++;
                console.log(`- Error item already exists: ${sourceError.id}`);
            }
        });
        console.log(`ErrorItems synced: ${syncedErrorItems}, skipped: ${skippedErrorItems}\n`);

        // === ErrorItemToKnowledgeTag relations ===
        console.log('=== Syncing ErrorItem-KnowledgeTag Relations ===');
        const sourceRelations = sourceDb.prepare('SELECT * FROM _ErrorItemToKnowledgeTag').all();
        let syncedRelations = 0;
        let skippedRelations = 0;

        sourceRelations.forEach(sourceRelation => {
            const targetErrorItemId = errorItemMap[sourceRelation.errorItemId];
            const targetTagId = tagMap[sourceRelation.knowledgeTagId];

            if (!targetErrorItemId || !targetTagId) {
                console.log(`⚠ Skipping relation: error item or tag not found`);
                skippedRelations++;
                return;
            }

            const existingRelation = targetDb.prepare(`
                SELECT * FROM _ErrorItemToKnowledgeTag
                WHERE errorItemId = ? AND knowledgeTagId = ?
            `).get(targetErrorItemId, targetTagId);

            if (!existingRelation) {
                targetDb.prepare(`
                    INSERT INTO _ErrorItemToKnowledgeTag (errorItemId, knowledgeTagId)
                    VALUES (?, ?)
                `).run(targetErrorItemId, targetTagId);
                syncedRelations++;
            } else {
                skippedRelations++;
            }
        });
        console.log(`Relations synced: ${syncedRelations}, skipped: ${skippedRelations}\n`);
    });

    // Execute migration
    migrate();
    console.log('✅ Database sync completed successfully!');

} catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
} finally {
    sourceDb.close();
    targetDb.close();
}
