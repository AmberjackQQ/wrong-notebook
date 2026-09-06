import { describe, expect, it } from 'vitest';
import { processImageFile } from '@/lib/image-utils';

describe('processImageFile', () => {
    it('不做压缩，直接返回原始文件的 Base64 且字节一致', async () => {
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
        const file = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });

        const result = await processImageFile(file);

        expect(result).toMatch(/^data:image\/jpeg;base64,/);
        const decoded = Buffer.from(result.split(',')[1], 'base64');
        expect(Buffer.from(bytes).equals(decoded)).toBe(true);
    });
});
