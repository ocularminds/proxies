const fs = require('node:fs');
const path = require('node:path');

// tsc only emits .js; the renderer page ships alongside the compiled output.
fs.copyFileSync(
  path.join(__dirname, '..', 'src', 'index.html'),
  path.join(__dirname, '..', 'dist', 'index.html')
);
