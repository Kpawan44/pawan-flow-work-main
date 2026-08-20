// scripts/check-version.cjs
// Fails the build if package.json version doesn't match the current git tag,
// or if that tag doesn't exist yet. Run this before dist:electron / releases.

const { execSync } = require('child_process');
const pkg = require('../package.json');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const pkgVersion = pkg.version;
const expectedTag = `v${pkgVersion}`;

let currentTag;
try {
  currentTag = run('git describe --tags --exact-match HEAD');
} catch {
  console.error(`\n[version-check] FAILED`);
  console.error(`HEAD is not tagged. package.json version is ${pkgVersion}.`);
  console.error(`Expected tag "${expectedTag}" on this commit.\n`);
  console.error(`Fix:`);
  console.error(`  git tag ${expectedTag}`);
  console.error(`  git push --tags\n`);
  process.exit(1);
}

if (currentTag !== expectedTag) {
  console.error(`\n[version-check] FAILED`);
  console.error(`package.json version (${pkgVersion}) does not match current git tag (${currentTag}).\n`);
  console.error(`Fix ONE of these:`);
  console.error(`  1) Update package.json "version" to match the tag: ${currentTag.replace(/^v/, '')}`);
  console.error(`  2) Or delete the wrong tag and re-tag correctly:`);
  console.error(`       git tag -d ${currentTag}`);
  console.error(`       git push origin :refs/tags/${currentTag}`);
  console.error(`       git tag ${expectedTag}`);
  console.error(`       git push --tags\n`);
  process.exit(1);
}

console.log(`[version-check] OK — package.json (${pkgVersion}) matches git tag (${currentTag})`);
