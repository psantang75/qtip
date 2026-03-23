# Fix: Daily Log Rotation Issue - Quick Reference

## Problem
Previous day logs were missing because Winston was using **size-based rotation** instead of **daily rotation**.

## Solution Implemented
✅ Installed `winston-daily-rotate-file` package
✅ Updated `backend/src/config/logger.ts` to use daily rotation
✅ Backend rebuilt with new configuration

## What's New

### Old Behavior
- Logs rotated only when reaching 5MB
- Files named: `error.log`, `error.log.1`, `error.log.2`
- Old logs got overwritten
- No date-based tracking

### New Behavior
- ✅ Logs rotate **daily at midnight**
- ✅ Date-stamped filenames: `error-2025-11-06.log`
- ✅ Keep logs for **30 days** (configurable)
- ✅ Old logs **compressed automatically** (gzip)
- ✅ Also rotate if file exceeds **20MB**

## Deployment Steps

### 1. Install Dependencies (Already Done)
```bash
cd backend
npm install winston-daily-rotate-file
```

### 2. Rebuild Backend (Already Done)
```bash
cd backend
npm run build
```

### 3. Deploy to Production
Copy the updated files to your production server:
- `backend/package.json` (updated dependencies)
- `backend/package-lock.json` (updated lock file)
- `backend/dist/config/logger.js` (compiled output)
- `backend/node_modules/` (or run npm install on server)

### 4. Update Production Server

#### Option A: If using PM2
```bash
# On production server
cd /path/to/your/app/backend
npm install
npm run build
pm2 restart all
```

#### Option B: If using IIS/iisnode
```bash
# On production server
cd C:\inetpub\wwwroot\your-app\backend
npm install
npm run build
# Restart IIS Application Pool or touch web.config to restart
iisreset /noforce
```

### 5. Configure IIS (If Using IIS/iisnode)

**Important**: If you're running through IIS, you need to:

1. **Copy `web.config.example` to `web.config`** (if you don't have one)
2. **Disable or minimize iisnode logging** since Winston now handles all logging
3. **Update web.config** with this setting:
   ```xml
   <iisnode 
     loggingEnabled="false"
     node_env="production" 
   />
   ```

### 6. Verify Deployment

After deployment, verify logs are being created correctly:

```powershell
# Check if daily log files exist
Get-ChildItem logs/

# Expected output:
# error-2025-11-06.log
# combined-2025-11-06.log
# access-2025-11-06.log

# Verify logs are being written
Get-Content logs/combined-2025-11-06.log -Tail 10
```

### 7. Monitor for 24+ Hours

- Wait until next day (after midnight)
- Verify new log files are created with the new date
- Verify previous day's logs are retained and compressed

## Configuration Options

You can customize the rotation behavior in `backend/src/config/logger.ts`:

```typescript
// Change retention period
maxFiles: '14d'   // Keep for 14 days
maxFiles: '90d'   // Keep for 90 days

// Change max file size
maxSize: '10m'    // Rotate at 10MB
maxSize: '50m'    // Rotate at 50MB

// Disable compression
zippedArchive: false

// Change date pattern
datePattern: 'YYYY-MM-DD-HH'  // Hourly logs
datePattern: 'YYYY-MM'        // Monthly logs
```

## Troubleshooting

### Logs still not rotating daily
- ✅ Verify `NODE_ENV=production` is set
- ✅ Check application is running continuously
- ✅ Verify server timezone is correct
- ✅ Check `logs/` directory permissions

### Old logs not being deleted
- ✅ Verify `maxFiles: '30d'` is set in logger config
- ✅ Check file permissions
- ✅ Ensure no processes have files locked

### Cannot find logs
Check these locations:
1. `{app-root}/logs/` directory
2. `/api/dist/iisnode/` (iisnode logs - separate from Winston)
3. Verify working directory when app starts

### Disk space issues
- Reduce retention: `maxFiles: '7d'`
- Verify compression is working: `zippedArchive: true`
- Reduce log level: `LOG_LEVEL=info` (instead of `debug`)

## Rollback Plan (If Needed)

If you need to revert to the old configuration:

1. Restore old `backend/src/config/logger.ts` from git:
   ```bash
   git checkout HEAD~1 -- backend/src/config/logger.ts
   ```

2. Uninstall winston-daily-rotate-file:
   ```bash
   npm uninstall winston-daily-rotate-file
   ```

3. Rebuild and redeploy:
   ```bash
   npm run build
   pm2 restart all
   ```

## Testing Locally

To test the daily rotation locally:

1. Set `NODE_ENV=production` in your `.env` file
2. Start the backend: `npm run prod`
3. Generate some logs by making API requests
4. Check `logs/` directory for daily log files
5. Verify filenames include today's date

## Monitoring

Set up monitoring to track:
- ✅ Log file creation daily
- ✅ Disk space usage in `logs/` directory
- ✅ Old logs being compressed and deleted
- ✅ Log rotation events

## Additional Resources

- 📄 [Full Documentation](./LOGGING_CONFIGURATION.md)
- 📄 [IIS/iisnode Setup](../web.config.example)
- 📄 [Production Deployment Guide](./PRODUCTION_GUIDE.md)

## Support

If you encounter issues:
1. Check the detailed documentation: `docs/LOGGING_CONFIGURATION.md`
2. Review application logs for errors
3. Verify environment variables are set correctly
4. Check file/directory permissions

