// `pnpm --filter @naqdpos/api dev`: development mode without putting NODE_ENV in the shared
// .env (Vite reads that file too and would build the apps in development mode).
process.env.NODE_ENV ??= 'development';
await import('./server.ts');
