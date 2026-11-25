// pm2 config for a Next.js app run through node/next-server.cjs.
// Run pm2 as the site's own Linux user, not root, and `pm2 save` after changes
// so the process list survives a reboot (`pm2 startup` once per user).
module.exports = {
  apps: [{
    name: 'my-app',
    cwd: __dirname,
    script: 'next-server.cjs',
    env: {
      NODE_ENV: 'production',
      PORT: '6010',
      BIND_HOST: '127.0.0.1',
    },
    max_memory_restart: '400M',
  }],
}
