/**
 * Copy email templates (.hbs partials + per-template subject/body files)
 * from src/services/email/templates → dist/services/email/templates after
 * tsc runs. Required because TemplateRenderer.ts resolves the templates
 * dir via `path.resolve(__dirname, 'templates')`, which becomes
 * dist/services/email/ at runtime — and tsc doesn't carry non-.ts files.
 *
 * Cross-platform: pure Node (no shell), works in PowerShell + bash.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'services', 'email', 'templates');
const DST = path.resolve(__dirname, '..', 'dist', 'services', 'email', 'templates');

function copyDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else if (entry.name.endsWith('.hbs')) {
      fs.copyFileSync(src, dst);
    }
  }
}

if (!fs.existsSync(SRC)) {
  console.error(`[copy_email_templates] source dir not found: ${SRC}`);
  process.exit(1);
}

copyDir(SRC, DST);

const count = fs
  .readdirSync(DST, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.hbs')).length;

console.log(`[copy_email_templates] copied ${count} .hbs files to ${DST}`);
