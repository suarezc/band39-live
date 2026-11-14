// node tools/bundle.cjs  — inline css/ and js/ from index.html into vexo-companion.html
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, f) => `<style>\n${fs.readFileSync(path.join(dir, f), 'utf8')}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${fs.readFileSync(path.join(dir, f), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.writeFileSync(path.join(dir, 'vexo-companion.html'), html);
console.log('vexo-companion.html', html.length, 'bytes');
