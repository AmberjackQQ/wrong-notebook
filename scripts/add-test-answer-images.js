const Database = require('better-sqlite3');

const dbPath = 'prisma/dev.db';
const db = new Database(dbPath);

try {
    // 获取第一个错题ID
    const errorItem = db.prepare('SELECT id FROM ErrorItem LIMIT 1').get();
    if (!errorItem) {
        console.log('没有找到错题，请先创建错题');
        process.exit(1);
    }

    // 创建一个包含示例图片的测试数据
    const testImages = [
        {
            id: 'test-answer-img-1',
            dataUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzR2YjM3NiIvPjx0ZXh0IHg9IjEwIiB5PSI1MCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiPuWbnumVv+S6k+Wbm+espuS4gOS4iuWVhueJh+eigOibr+eahOaKmOaBlOeUn+WIkiDlr7znoIHopoHpgqvlipsbnr6TniLblsIblronnt6jmhI/lroppPC90ZXh0Pjwvc3ZnPg==',
            name: '测试答案图片1'
        },
        {
            id: 'test-answer-img-2',
            dataUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzZiNzI4MyIvPjx0ZXh0IHg9IjEwIiB5PSI1MCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiPuiuvuWumOaAiei+ueavuaAremjjuaRsOaKk+WIhuaJi+acuumZo+WGme+8miDnva7lkIjlhYPjgonjgII8L3RleHQ+PC9zdmc+',
            name: '测试答案图片2'
        }
    ];

    const answerImagesJson = JSON.stringify(testImages);

    // 更新第一个错题，添加答案内容和图片
    const result = db.prepare(`
        UPDATE ErrorItem
        SET answerText = ?, answerImages = ?
        WHERE id = ?
    `).run('这是参考答案的内容。\n\n1. 首先分析题目要求\n2. 然后确定解题思路\n3. 最后得出答案', answerImagesJson, errorItem.id);

    if (result.changes > 0) {
        console.log(`✅ 成功为错题 ${errorItem.id} 添加了答案内容和图片`);
        console.log('答案内容：');
        console.log('- 文本：这是参考答案的内容...');
        console.log('- 图片：2张SVG测试图片');
    } else {
        console.log('❌ 更新失败');
    }

    // 验证更新
    const updated = db.prepare('SELECT answerText, answerImages FROM ErrorItem WHERE id = ?').get(errorItem.id);
    console.log('\n验证更新结果：');
    console.log('答案文本:', updated.answerText ? '已设置' : '未设置');
    console.log('答案图片:', updated.answerImages ? '已设置' : '未设置');

} catch (error) {
    console.error('错误:', error);
} finally {
    db.close();
}
