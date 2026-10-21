const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const files = ['src/opendir', 'src/rename', 'src/open_rename', 'src/shortcuts', 'tests/runtime', 'tests/integration'];
const bundle = names => names.map(name => fs.readFileSync(path.join(root, 'build', name + '.js'), 'utf8')).join('\n');
fs.writeFileSync(path.join(root, 'build/functions.js'), bundle(files));
if (process.argv.includes('--functions')) process.exit(0);

const manifest = require('../manifest.json');
if (manifest.version !== require('../package.json').version) throw new Error('Version mismatch.');
const archive = zipSync({
  'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)),
  'bootstrap.js': Buffer.from(bundle([...files, 'tests/server', 'src/bootstrap'])),
});
const dest = path.join(root, 'dist', `${manifest.name}-${manifest.version}.xpi`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, archive);
console.log(dest);
