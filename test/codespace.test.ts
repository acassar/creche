import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lireConfig } from '../serveur/config.ts';

const racine = resolve(import.meta.dirname, '..');

test('le Codespace installe, lance le serveur et ouvre le port par défaut', () => {
  const conf = JSON.parse(readFileSync(resolve(racine, '.devcontainer', 'devcontainer.json'), 'utf8')) as {
    image: string;
    postCreateCommand: string;
    postAttachCommand: string;
    forwardPorts: number[];
    portsAttributes: Record<string, { onAutoForward: string }>;
  };
  const scripts = (JSON.parse(readFileSync(resolve(racine, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }).scripts;
  const { port } = lireConfig({});

  assert.match(conf.image, /javascript-node:22$/);
  assert.equal(conf.postCreateCommand, 'npm ci');
  assert.equal(conf.postAttachCommand, 'npm start');
  assert.ok(scripts.start, 'script npm start absent');
  assert.deepEqual(conf.forwardPorts, [port]);
  assert.equal(conf.portsAttributes[String(port)]?.onAutoForward, 'openBrowser');
});
