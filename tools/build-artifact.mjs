// Converts the single-file Vite build (dist/index.html) into a page body
// suitable for publishing as a claude.ai Artifact (no <html>/<head>/<body>
// wrappers: title, font link, styles, markup and the inlined module script).
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-artifact/index.html', 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));

const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const links = head.match(/<link[^>]+fonts\.googleapis[^>]*>/g) ?? [];
const styles = head.match(/<style[\s\S]*?<\/style>/g) ?? [];
const scripts = head.match(/<script[\s\S]*?<\/script>/g) ?? [];

const out = [title, ...links, ...styles, body.trim(), ...scripts].join('\n');
writeFileSync('dist-artifact/artifact.html', out);
console.log(`dist-artifact/artifact.html written (${(out.length / 1024).toFixed(0)} KB)`);
