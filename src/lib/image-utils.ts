/**
 * 读取图片文件并转为 Base64
 * 不做压缩，保留原始分辨率与画质，保证打印到 A4 纸上文字清晰
 * @param file 原始图片文件
 * @returns Base64 字符串
 */
export async function processImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}
