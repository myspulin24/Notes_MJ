/**
 * Sets the version in the three files that have to agree.
 *
 *     node scripts/set-version.mjs 1.1.1     (or: npm run version:set 1.1.1)
 *
 * package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json each carry
 * the version separately. The one that actually matters is tauri.conf.json,
 * because that is what ends up in the built binary and what the updater
 * compares against latest.json - so a stale value there means the app either
 * never notices a new release or offers one that is already installed. Bumping
 * by hand and missing a file is easy; this makes it one command.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

// Plain semver only. The updater parses these with a real semver library, and
// something like "1.1" or "v1.1.0" fails there rather than here, which is a
// much worse place to find out.
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Použití: node scripts/set-version.mjs 1.2.3');
  process.exit(1);
}

const pkgPath = 'package.json';
const cargoPath = 'src-tauri/Cargo.toml';
const confPath = 'src-tauri/tauri.conf.json';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const previous = pkg.version;
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = version;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

// Only the version in [package]; a dependency pinned to the same string must
// not be rewritten, so anchor on the first occurrence after the [package] head.
const cargo = readFileSync(cargoPath, 'utf8');
const packageBlock = /(\[package\][\s\S]*?\nversion = ")[^"]+(")/;
if (!packageBlock.test(cargo)) {
  console.error(`Nenašel jsem version v ${cargoPath} — soubor musíte upravit ručně.`);
  process.exit(1);
}
writeFileSync(cargoPath, cargo.replace(packageBlock, `$1${version}$2`));

console.log(`${previous} -> ${version}`);
console.log('Upraveno: package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json');
console.log('');
console.log('Dál:');
console.log(`  git commit -am "${version}"`);
console.log(`  git tag v${version}`);
console.log('  git push --follow-tags');
