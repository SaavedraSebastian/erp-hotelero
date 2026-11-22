import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './server/app.ts';
import { closeDatabasePool, initDatabasePool } from './server/config/database.ts';
import { loadAndValidateEnv } from './server/config/env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const env = loadAndValidateEnv();
  initDatabasePool();

  const app = createApp();

  const distPath = path.resolve(__dirname, 'dist');
  const indexPath = path.join(distPath, 'index.html');
  const isProduction =
    env.nodeEnv === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(indexPath));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (!fs.existsSync(indexPath)) {
      console.warn(`[SGH-ERP] Advertencia: no se encontró ${indexPath}. Ejecuta "npm run build" antes de iniciar en producción.`);
    }
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      if (!fs.existsSync(indexPath)) {
        res.status(503).send('Aplicación aún no compilada (falta dist/index.html).');
        return;
      }
      res.sendFile(indexPath);
    });
  }

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'server',
        message: 'SGH-ERP server iniciado',
        port: env.port,
        mode: isProduction ? 'production' : 'development',
      })
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'server',
        message: `Señal ${signal} recibida, cerrando servidor y pool PostgreSQL`,
      })
    );

    server.close(async () => {
      await closeDatabasePool();
      process.exit(0);
    });

    setTimeout(async () => {
      await closeDatabasePool();
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer().catch((err) => {
  const safeMsg = err instanceof Error ? err.message : 'Error fatal al iniciar el servidor';
  console.error('[SGH-ERP] Fatal startup error:', safeMsg);
  process.exit(1);
});
