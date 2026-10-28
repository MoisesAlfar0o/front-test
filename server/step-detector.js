// Detección de pasos faltantes en features vs steps existentes
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

const STEP_KEYWORD_RE = /^\s*(?:Dado|Cuando|Entonces|Y|Pero)\s+(.+)$/gm;
const STEP_DEF_RE = /(?:Given|When|Then)\s*\(\s*(['"`])([^'"`]+)\1/g;

export function extractFeatureSteps(featureContent) {
  const steps = [];
  let m;
  const re = new RegExp(STEP_KEYWORD_RE);
  while ((m = re.exec(featureContent)) !== null) {
    const phrase = m[1].trim();
    if (phrase && !steps.includes(phrase)) {
      steps.push(phrase);
    }
  }
  return steps;
}

export function phraseToPattern(phrase) {
  // Convertir {string} a regex de string entre comillas, {int} a dígitos
  const escaped = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{string\\\}/g, '"[^"]+"')
    .replace(/\\\{int\\\}/g, '\\d+')
    .replace(/\\\{float\\\}/g, '\\d+(?:\\.\\d+)?');
  return new RegExp(`^${escaped}$`, 'i');
}

export async function extractImplementedPatterns(stepsDir) {
  const patterns = [];
  if (!fs.existsSync(stepsDir)) return patterns;

  async function walk(dir) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.ts') || p.endsWith('.js')) {
        const text = await fsp.readFile(p, 'utf8').catch(() => '');
        let m;
        const re = new RegExp(STEP_DEF_RE);
        while ((m = re.exec(text)) !== null) {
          patterns.push({
            pattern: phraseToPattern(m[2]),
            raw: m[2],
            file: path.relative(stepsDir, p),
          });
        }
      }
    }
  }

  await walk(stepsDir);
  return patterns;
}

export async function detectMissingSteps(featurePath, stepsDir) {
  if (!fs.existsSync(featurePath)) {
    return { total: 0, missing: [], implemented: [], count: 0 };
  }

  const content = await fsp.readFile(featurePath, 'utf8');
  const featureSteps = extractFeatureSteps(content);
  const implementedPatterns = await extractImplementedPatterns(stepsDir);

  const missing = [];
  const implemented = [];

  for (const step of featureSteps) {
    const isMatched = implementedPatterns.some((item) => item.pattern.test(step));
    if (isMatched) {
      implemented.push(step);
    } else {
      missing.push(step);
    }
  }

  return {
    total: featureSteps.length,
    missing,
    implemented,
    count: missing.length,
  };
}
