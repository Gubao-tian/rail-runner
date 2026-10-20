/* 开发期小工具：从 REA 浏览器场景结果文件里提取截图（base64）写成 PNG
 * 用法：node tools/shot.mjs <capture.json> <out.png>
 */
import fs from 'node:fs';

const [, , input, output] = process.argv;
const text = fs.readFileSync(input, 'utf8');
const m = text.match(/"data_base64"\s*:\s*"([A-Za-z0-9+/=]+)"/);
if (!m) {
  console.error('未找到 data_base64');
  process.exit(1);
}
const buf = Buffer.from(m[1], 'base64');
fs.writeFileSync(output, buf);
console.log('wrote ' + output + ' (' + buf.length + ' bytes)');
