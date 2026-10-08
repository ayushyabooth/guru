#!/usr/bin/env node
/**
 * tsc-ratchet.js: makes "no new type errors" a gate while the old ones are
 * paid down.
 *
 * It runs the app's type check (tsconfig.json, the program `npx tsc --noEmit`
 * builds, through the TypeScript API) and counts the errors in each file. Then
 * it compares the counts with tsc-baseline.json:
 *   - a file with more errors than its baseline fails the check, and so does
 *     any error in a file the baseline doesn't list;
 *   - fewer errors pass, and the drop is printed.
 *
 *   npm run typecheck:ratchet               check against the baseline
 *   npm run typecheck:ratchet -- --update   lock in a drop
 *
 * The baseline only ever goes down. --update rewrites it from today's counts
 * and refuses when the total would go up. A file may go up in an update only
 * when the total doesn't, which covers a moved or renamed file. To raise the
 * total on purpose (say a TypeScript upgrade finds old errors), delete
 * tsc-baseline.json, run --update, and say why in the commit.
 *
 * Two inputs of the type check are generated and gitignored, so a fresh
 * checkout has neither: expo-env.d.ts (it pulls in Expo's global types) and
 * .expo/types/router.d.ts (the typed routes `expo start` writes). The check
 * builds both in memory, from node_modules and the app/ folder, with
 * expo-router's own generator. A laptop and CI see the same program, and the
 * check writes nothing.
 *
 * A syntax error makes tsc skip the type errors in every file, which would
 * read as a drop. So any syntax or config error fails the check before
 * anything is counted.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');
const BASELINE = path.join(ROOT, 'tsc-baseline.json');
const BASELINE_NAME = path.basename(BASELINE);
const EXPO_DIR = toTsPath(path.join(ROOT, '.expo'));
const EXPO_ENV = toTsPath(path.join(ROOT, 'expo-env.d.ts'));
const ROUTER_TYPES = toTsPath(path.join(ROOT, '.expo', 'types', 'router.d.ts'));

const ABOUT =
  'Type errors per file in the app, the most `npm run typecheck:ratchet` allows. ' +
  'It only goes down: fix errors, then run it with --update. See scripts/tsc-ratchet.js.';

const USAGE = `Usage: node scripts/tsc-ratchet.js [--update]

Type-checks the app and fails if any file has more type errors than
${BASELINE_NAME} allows.

  --update   rewrite ${BASELINE_NAME} from today's counts. It refuses when the
             total would go up: the baseline only ever goes down.`;

function toTsPath(file) {
  return file.split(path.sep).join('/');
}

function relative(file) {
  return toTsPath(path.relative(ROOT, file));
}

function isGenerated(file) {
  return file === EXPO_ENV || file.startsWith(`${EXPO_DIR}/`);
}

/** The generated inputs, keyed by the path tsc would read them from. */
function generatedInputs() {
  const requireContext = require('expo-router/build/testing-library/require-context-ponyfill').default;
  const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
  const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');
  const routes = getTypedRoutesDeclarationFile(
    requireContext(path.join(ROOT, 'app'), true, EXPO_ROUTER_CTX_IGNORE),
    {},
  );
  if (!routes) {
    throw new Error('expo-router could not generate the typed routes from app/.');
  }
  return new Map([
    [EXPO_ENV, '/// <reference types="expo/types" />\n'],
    [ROUTER_TYPES, routes],
  ]);
}

const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => ROOT,
  getNewLine: () => '\n',
};

function format(diagnostics) {
  return ts.formatDiagnostics(diagnostics, formatHost).trimEnd();
}

function errorsOnly(diagnostics) {
  return diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
}

/**
 * Type-check the app. Returns { blocking } when the config or the syntax is
 * broken (nothing can be counted then), otherwise { errors }.
 */
function typeCheck() {
  const configErrors = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    TSCONFIG,
    { noEmit: true },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => configErrors.push(d) },
  );
  if (!parsed) return { blocking: configErrors };

  const generated = generatedInputs();
  const rootNames = parsed.fileNames.filter((file) => !isGenerated(file)).concat([...generated.keys()]);

  // Serve the generated files from memory, and never the copies on disk.
  const host = ts.createCompilerHost(parsed.options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => generated.has(file) || (!isGenerated(file) && fileExists.call(host, file));
  host.readFile = (file) =>
    generated.has(file) ? generated.get(file) : isGenerated(file) ? undefined : readFile.call(host, file);
  host.getSourceFile = (file, language, onError, shouldCreate) =>
    generated.has(file)
      ? ts.createSourceFile(file, generated.get(file), language, true)
      : getSourceFile.call(host, file, language, onError, shouldCreate);

  const program = ts.createProgram({
    rootNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsed),
  });

  // The same order tsc uses: it reports type errors only when none of these exist.
  const blocking = errorsOnly([
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ]);
  if (blocking.length) return { blocking };
  return { errors: errorsOnly(program.getSemanticDiagnostics()) };
}

function countByFile(errors) {
  const counts = {};
  for (const d of errors) {
    const file = d.file ? relative(d.file.fileName) : '(no file)';
    counts[file] = (counts[file] || 0) + 1;
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function describe(counts) {
  const files = Object.keys(counts).length;
  return `${total(counts)} type error${total(counts) === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  const data = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const files = data && data.files;
  const valid =
    files &&
    typeof files === 'object' &&
    Object.values(files).every((n) => Number.isInteger(n) && n > 0);
  if (!valid) {
    throw new Error(`${BASELINE_NAME} is malformed: "files" must map each file to a positive whole number.`);
  }
  return files;
}

function writeBaseline(counts) {
  const files = {};
  for (const file of Object.keys(counts).sort()) files[file] = counts[file];
  const data = { about: ABOUT, total: total(files), files };
  fs.writeFileSync(BASELINE, `${JSON.stringify(data, null, 2)}\n`);
}

/** Per-file differences between two count maps. */
function compare(baseline, counts) {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort();
  const up = [];
  const down = [];
  for (const file of files) {
    const before = baseline[file] || 0;
    const after = counts[file] || 0;
    if (after > before) up.push({ file, before, after });
    if (after < before) down.push({ file, before, after });
  }
  return { up, down };
}

function list(changes) {
  const width = Math.max(...changes.map((c) => c.file.length));
  return changes.map((c) => `  ${c.file.padEnd(width)}  ${c.before} -> ${c.after}`).join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = args.filter((a) => a !== '--update');
  if (unknown.length) {
    console.error(`tsc ratchet: unknown argument ${unknown.join(' ')}\n\n${USAGE}`);
    return 1;
  }
  const update = args.includes('--update');

  const baseline = readBaseline();
  if (!baseline && !update) {
    console.error(`tsc ratchet: FAILED. No ${BASELINE_NAME}. Create it with: npm run typecheck:ratchet -- --update`);
    return 1;
  }

  const result = typeCheck();
  if (result.blocking) {
    console.error(
      'tsc ratchet: FAILED. The config or the syntax is broken, and while it is, tsc reports no type\n' +
        'errors at all, so nothing can be counted. Fix these first:\n',
    );
    console.error(format(result.blocking));
    return 1;
  }

  const counts = countByFile(result.errors);

  if (update) {
    if (!baseline) {
      writeBaseline(counts);
      console.log(`tsc ratchet: wrote ${BASELINE_NAME}: ${describe(counts)}.`);
      return 0;
    }
    const before = total(baseline);
    const after = total(counts);
    if (after > before) {
      const { up } = compare(baseline, counts);
      console.error(
        `tsc ratchet: FAILED. --update would raise the baseline from ${before} to ${after} type errors,\n` +
          'and it only goes down. Fix the new errors:\n\n' +
          `${list(up)}\n\n` +
          `To raise it on purpose, delete ${BASELINE_NAME}, run --update, and say why in the commit.`,
      );
      return 1;
    }
    const { up, down } = compare(baseline, counts);
    writeBaseline(counts);
    const change = after < before ? `down from ${before}` : 'the same total as before';
    console.log(`tsc ratchet: wrote ${BASELINE_NAME}: ${describe(counts)}, ${change}.`);
    if (down.length) console.log(`\nWent down:\n${list(down)}`);
    if (up.length) console.log(`\nWent up, within the same total (a moved or renamed file?):\n${list(up)}`);
    return 0;
  }

  const { up, down } = compare(baseline, counts);
  if (up.length) {
    const newIn = new Set(up.map((c) => c.file));
    const details = result.errors.filter((d) => newIn.has(d.file ? relative(d.file.fileName) : '(no file)'));
    console.error(
      `tsc ratchet: FAILED. More type errors than ${BASELINE_NAME} allows, in ${up.length} file${up.length === 1 ? '' : 's'}:\n\n` +
        `${list(up)}\n\n` +
        `Every type error in ${up.length === 1 ? 'that file' : 'those files'} (the new ones are among them):\n\n` +
        `${format(details)}\n\n` +
        'Fix them. The baseline only goes down: --update refuses to raise its total.',
    );
    return 1;
  }

  const before = total(baseline);
  const after = total(counts);
  if (down.length) {
    console.log(
      `tsc ratchet: passed. ${describe(counts)}, down ${before - after} from ${before}. No new errors.\n\n` +
        `${list(down)}\n\n` +
        'Lock in the drop: npm run typecheck:ratchet -- --update',
    );
  } else {
    console.log(`tsc ratchet: passed. ${describe(counts)}, the same as ${BASELINE_NAME}. No new errors.`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv);
} catch (error) {
  console.error(`tsc ratchet: FAILED. ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
}
