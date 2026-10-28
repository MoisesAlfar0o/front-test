// Guardrails de código generado para step definitions
// Reglas inquebrantables del repositorio (ADR 0001, ADR 0004, CLAUDE.md)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const RULES = [
  {
    id: 'NO_WAIT_FOR_TIMEOUT',
    level: 'ERROR',
    pattern: /\bwaitForTimeout\s*\(/,
    message: 'Prohibido waitForTimeout: usar aserciones web-first con expect(locator).toBeVisible().',
  },
  {
    id: 'NO_NETWORKIDLE',
    level: 'ERROR',
    pattern: /\bnetworkidle\b/,
    message: 'Prohibido networkidle: la red puede variar; esperar el estado del DOM en su lugar.',
  },
  {
    id: 'NO_XPATH',
    level: 'ERROR',
    pattern: /(?:\bxpath\s*=|(?<!:)\/\/[a-zA-Z0-9_\-*]+)/,
    message: 'Prohibido XPath: priorizar getByRole > getByLabel > getByPlaceholder > getByText > getByTestId.',
  },
  {
    id: 'NO_CREDENTIALS',
    level: 'CRITICAL',
    pattern: /(?:password|passwd|apiKey|token|secret|credencial)\s*[:=]\s*['"][^'"]{4,}['"]/i,
    message: 'Posible presencia de credenciales o secretos en código. Nunca guardar contraseñas (ADR 0002).',
  },
  {
    id: 'AVOID_NTH',
    level: 'WARNING',
    pattern: /\.nth\s*\(\s*\d+\s*\)/,
    message: 'Uso de .nth() sin justificación: frágil ante cambios de orden. Preferir filtros semánticos (filter({ hasText })).',
  },
];

export function auditStepContent(content, fileName = '') {
  const issues = [];
  const lines = content.split('\n');

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    // Ignorar líneas de comentarios
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return;
    }

    for (const rule of RULES) {
      if (rule.pattern.test(lineText)) {
        issues.push({
          file: fileName,
          line: lineNum,
          rule: rule.id,
          level: rule.level,
          message: rule.message,
          snippet: trimmed.slice(0, 120),
        });
      }
    }
  });

  return issues;
}

export async function auditDirectory(dirPath) {
  const issues = [];
  if (!fs.existsSync(dirPath)) return issues;

  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        const text = await fsp.readFile(full, 'utf8').catch(() => '');
        issues.push(...auditStepContent(text, path.relative(dirPath, full)));
      }
    }
  }

  await walk(dirPath);
  return issues;
}
