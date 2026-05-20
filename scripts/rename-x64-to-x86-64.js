const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

for (const name of fs.readdirSync(distDir)) {
  if (name.includes('-x64')) {
    const from = path.join(distDir, name);
    const to = path.join(distDir, name.replace('-x64', '-x86-64'));
    fs.renameSync(from, to);
    console.log(`renamed ${name} -> ${path.basename(to)}`);
  }
}

const ymlPath = path.join(distDir, 'latest-mac.yml');
if (fs.existsSync(ymlPath)) {
  const before = fs.readFileSync(ymlPath, 'utf8');
  const after = before.replace(/-x64\.dmg/g, '-x86-64.dmg');
  if (before !== after) {
    fs.writeFileSync(ymlPath, after);
    console.log('updated latest-mac.yml');
  }
}
