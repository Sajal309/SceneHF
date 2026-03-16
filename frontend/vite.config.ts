import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const backendRoot = fileURLToPath(new URL('../backend', import.meta.url))
const repoDataRoot = fileURLToPath(new URL('../data', import.meta.url))
// Default OFF to avoid page reloads when the dev tab wakes from sleep.
// Set SCENEHF_DISABLE_HMR=0 to explicitly re-enable HMR.
const disableHmr = process.env.SCENEHF_DISABLE_HMR !== '0'

const apiProxy = {
    '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
    }
}

export default defineConfig({
    root: frontendRoot,
    clearScreen: false,
    // Use Vite's native esbuild TSX transform (no React Babel plugin) for faster cold start.
    esbuild: {
        jsx: 'automatic',
    },
    // Keep Vite's pre-bundle cache outside node_modules so it survives reinstalls.
    cacheDir: '.vite-cache',
    optimizeDeps: {
        // Skip broad source crawling and pre-bundle only the deps used by this app.
        entries: ['src/main.tsx'],
        noDiscovery: true,
        include: [
            'react',
            'react-dom/client',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            '@radix-ui/react-icons',
            'clsx',
            'tailwind-merge',
        ],
    },
    server: {
        host: '127.0.0.1',
        port: 5174,
        hmr: disableHmr ? false : undefined,
        proxy: apiProxy,
        watch: {
            ignored: [
                `${backendRoot}/**`,
                `${repoDataRoot}/**`,
                '**/backend/**',
                '**/data/**',
                '**/.tmp/**',
                '**/*.tmp',
                '**/jobs/**',
                /[/\\]backend[/\\].*/,
                /[/\\]data[/\\].*/,
                /[/\\]jobs[/\\].*/,
            ],
        },
    },
    preview: {
        host: '127.0.0.1',
        port: 5174,
        proxy: apiProxy
    },
})
