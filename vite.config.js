import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Vite plugin: API endpoint to save default-data.json with backup rotation (max 3).
function saveDefaultDataPlugin() {
  return {
    name: 'save-default-data',
    configureServer(server) {
      server.middlewares.use('/api/save-default', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const publicDir = path.resolve(process.cwd(), 'public');
            const mainFile = path.join(publicDir, 'default-data.json');

            // Rotate existing backups: 2→3, 1→2, current→1
            for (let i = 2; i >= 1; i--) {
              const src = i === 1
                ? path.join(publicDir, 'default-data.backup-1.json')
                : path.join(publicDir, `default-data.backup-${i}.json`);
              const dst = path.join(publicDir, `default-data.backup-${i + 1}.json`);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, dst);
              }
            }
            // Current → backup-1
            if (fs.existsSync(mainFile)) {
              fs.copyFileSync(mainFile, path.join(publicDir, 'default-data.backup-1.json'));
            }

            // Write new default-data.json
            // Validate it's proper JSON first
            const parsed = JSON.parse(body);
            fs.writeFileSync(mainFile, JSON.stringify(parsed, null, 2), 'utf-8');

            // List existing backups for response
            const backups = [];
            for (let i = 1; i <= 3; i++) {
              const f = path.join(publicDir, `default-data.backup-${i}.json`);
              if (fs.existsSync(f)) {
                const stat = fs.statSync(f);
                backups.push({ file: `default-data.backup-${i}.json`, size: stat.size, modified: stat.mtime.toISOString() });
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, backups }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), saveDefaultDataPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
