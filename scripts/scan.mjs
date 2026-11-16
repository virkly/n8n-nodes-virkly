// Runs n8n's community-package scanner on the local `npm pack` tarball. The scanner's CLI only
// scans packages already on npm; this runs the same analyzePackage() on the unpacked tarball.
// The scanner is installed into a temp dir, not as a devDependency: it aliases TypeScript 6
// over node_modules/.bin/tsc, which breaks `n8n-node build`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCANNER = '@n8n/scan-community-package@0.43.0';
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'n8n-scan-'));
execFileSync('npm', ['install', '--prefix', join(dir, 'scanner'), '--no-save', SCANNER], {
	stdio: 'ignore',
});
execFileSync('npm', ['pack', '--pack-destination', dir], { stdio: 'ignore' });
execFileSync('tar', ['-xzf', join(dir, `${name}-${version}.tgz`), '-C', dir]);

const scanner = join(dir, 'scanner/node_modules/@n8n/scan-community-package/dist/scanner.js');
const { analyzePackage } = await import(pathToFileURL(scanner).href);
const result = await analyzePackage(join(dir, 'package'));
console.log(
	result.passed ? `✅ ${name}@${version} passed the n8n scanner` : `❌ ${result.message}`,
);
if (result.details) console.log(result.details);
process.exitCode = result.passed ? 0 : 1;
