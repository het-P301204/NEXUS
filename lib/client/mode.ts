/**
 * Build-time switch for the static demo published to GitHub Pages
 * (`npm run build:pages`, which loads `.env.pages`). In every other build the
 * flag is false and the browser talks to the API server as usual.
 *
 * Not to be confused with the server's DEMO_MODE, which enables the demo
 * personas and scenarios: the static demo is a snapshot of a server that had
 * DEMO_MODE on, served without any server at all.
 */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === '1'

export const REPO_URL = 'https://github.com/het-P301204/NEXUS'
