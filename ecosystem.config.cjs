module.exports = {
  apps: [
    {
      name: 'qtip-backend',
      script: './backend/dist/index.js',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 5000
      }
    },
    {
      name: 'ie-dept-sync',
      script: './backend/dist/workers/run-dept-sync.js',
      cron_restart: '0 1 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-emp-sync',
      script: './backend/dist/workers/run-emp-sync.js',
      cron_restart: '10 1 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-calendar-sync',
      script: './backend/dist/workers/run-calendar-sync.js',
      cron_restart: '20 1 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-partition-manager',
      script: './backend/dist/workers/run-partition-manager.js',
      cron_restart: '0 0 1 * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-rollup',
      script: './backend/dist/workers/run-rollup.js',
      cron_restart: '0 2 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    }
  ],

  deploy: {
    production: {
      user: 'SSH_USERNAME',
      host: 'SSH_HOSTMACHINE',
      ref: 'origin/master',
      repo: 'GIT_REPOSITORY',
      path: 'DESTINATION_PATH',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': ''
    }
  }
}; 