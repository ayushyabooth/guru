import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  target: 'chrome109',
  format: 'esm',
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: {
    'react': 'preact/compat',
    'react-dom': 'preact/compat',
  },
};

const configs = [
  {
    ...commonOptions,
    entryPoints: ['src/content/index.tsx'],
    outfile: 'dist/content.js',
    format: 'iife',  // Content scripts can't use ESM
  },
  {
    ...commonOptions,
    entryPoints: ['src/background/service-worker.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
  },
  {
    ...commonOptions,
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
    format: 'iife',
  },
];

async function run() {
  if (isWatch) {
    const contexts = await Promise.all(configs.map(c => context(c)));
    await Promise.all(contexts.map(c => c.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(configs.map(c => build(c)));
    console.log('Build complete.');
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
