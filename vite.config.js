import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

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
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const publicDir = path.resolve(process.cwd(), 'public');
            const mainFile = path.join(publicDir, 'default-data.json');

            for (let i = 2; i >= 1; i--) {
              const src = i === 1
                ? path.join(publicDir, 'default-data.backup-1.json')
                : path.join(publicDir, `default-data.backup-${i}.json`);
              const dst = path.join(publicDir, `default-data.backup-${i + 1}.json`);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, dst);
              }
            }

            if (fs.existsSync(mainFile)) {
              fs.copyFileSync(mainFile, path.join(publicDir, 'default-data.backup-1.json'));
            }

            const parsed = JSON.parse(body);
            fs.writeFileSync(mainFile, JSON.stringify(parsed, null, 2), 'utf-8');

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

export default defineConfig(({ command }) => ({
  plugins: [react(), saveDefaultDataPlugin()],
  base: command === 'serve' ? '/' : '/portfolio-performance/',
  server: {
    port: 5173,
    open: true,
  },
}));
