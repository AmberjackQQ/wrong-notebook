const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSources() {
  try {
    const items = await prisma.errorItem.findMany({
      select: {
        id: true,
        source: true,
        paperLevel: true,
        questionText: true,
      },
      take: 10
    });

    console.log('Error Items with source/paperLevel fields:');
    items.forEach(item => {
      console.log(`ID: ${item.id}`);
      console.log(`  Source: ${item.source || 'NULL'}`);
      console.log(`  PaperLevel: ${item.paperLevel || 'NULL'}`);
      console.log(`  QuestionText: ${item.questionText?.substring(0, 50) || 'NULL'}...`);
      console.log('---');
    });

    const countWithSource = await prisma.errorItem.count({
      where: {
        source: {
          not: null
        }
      }
    });

    const countWithPaperLevel = await prisma.errorItem.count({
      where: {
        paperLevel: {
          not: null
        }
      }
    });

    console.log(`\nTotal items with source: ${countWithSource}`);
    console.log(`Total items with paperLevel: ${countWithPaperLevel}`);
    console.log(`Total items: ${await prisma.errorItem.count()}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSources();