const Database = require('better-sqlite3');

const dbPath = 'prisma/dev.db';
const db = new Database(dbPath);

try {
    // 获取第一个用户ID
    const user = db.prepare('SELECT id FROM User LIMIT 1').get();
    if (!user) {
        console.log('没有找到用户，请先创建用户');
        process.exit(1);
    }

    // 获取第一个错题ID
    const errorItem = db.prepare('SELECT id FROM ErrorItem LIMIT 1').get();
    if (!errorItem) {
        console.log('没有找到错题，请先创建错题');
        process.exit(1);
    }

    // 创建一个包含示例图片的测试数据
    const testImages = [
        {
            id: 'test-img-1',
            dataUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzNmNzZmOSIvPjx0ZXh0IHg9IjEwIiB5PSI1MCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiPueQhiDlvLrorq7nmoTmg4Xngrnnu6 tors=livemodeLVudGVyPjwvdmV0ZXh0Pjwvc3ZnPg==',
            name: '测试解析图片1'
        },
        {
            id: 'test-img-2',
            dataUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzFmNzczNCIvPjx0ZXh0IHg9IjEwIiB5PSI1MCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiPuaXoOeQhiDlvLrorq7nmoTmg4Xngrnnu6 tors=livemodeLVudGVyPjwvdmV0ZXh0Pjwvc3ZnPg==',
            name: '测试解析图片2'
        }
    ];

    const analysisImagesJson = JSON.stringify(testImages);

    // 更新第一个错题，添加解析内容和图片
    const result = db.prepare(`
        UPDATE ErrorItem
        SET analysis = ?, analysisImages = ?
        WHERE id = ?
    `).run('这是一道测试题目的解析内容。\n\n第一步：理解题目\n第二步：分析条件\n第三步：得出结论', analysisImagesJson, errorItem.id);

    if (result.changes > 0) {
        console.log(`✅ 成功为错题 ${errorItem.id} 添加了解析内容和图片`);
        console.log('解析内容：');
        console.log('- 文本：这是一道测试题目的解析内容...');
        console.log('- 图片：2张SVG测试图片');
    } else {
        console.log('❌ 更新失败');
    }

    // 验证更新
    const updated = db.prepare('SELECT analysis, analysisImages FROM ErrorItem WHERE id = ?').get(errorItem.id);
    console.log('\n验证更新结果：');
    console.log('解析文本:', updated.analysis ? '已设置' : '未设置');
    console.log('解析图片:', updated.analysisImages ? '已设置' : '未设置');

} catch (error) {
    console.error('错误:', error);
} finally {
    db.close();
}
