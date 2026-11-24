import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

type PluginFactory = () => unknown;

interface NodeProcessLike {
  cwd?: () => string;
  env?: Record<string, string | undefined>;
}

const createReactPlugin = react as unknown as PluginFactory;
const createTailwindPlugin = tailwindcss as unknown as PluginFactory;
const nodeProcess = (globalThis as { process?: NodeProcessLike }).process;
const rootDir: string = nodeProcess?.cwd ? nodeProcess.cwd() : '.';
const disableHmr: boolean = nodeProcess?.env?.DISABLE_HMR === 'true';

export default {
  base: './',
  plugins: [createReactPlugin(), createTailwindPlugin()],
  build: {
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: !disableHmr,
    watch: disableHmr
      ? null
      : {
          ignored: ['**/docs/**', '**/.git/**', '**/*.zip', '**/dist/**'],
        },
  },
};
