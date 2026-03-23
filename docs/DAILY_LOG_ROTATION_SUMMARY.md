# Daily Log Rotation - Implementation Summary

## 🎯 Issue Identified

**Problem**: In production, logs were being created in `/api/dist/iisnode` folder but previous day logs were missing.

**Root Cause**: Winston logger was configured with **size-based rotation** instead of **daily rotation**. Logs only rotated when file size reached 5MB, causing old files to be overwritten instead of preserved by date.

---

## ✅ Changes Implemented (Ready for Deployment)

### 1. Package Installation
- ✅ Installed `winston-daily-rotate-file@5.0.0` package
- ✅ Updated `backend/package.json` with new dependency

### 2. Logger Configuration Updated
- ✅ Modified `backend/src/config/logger.ts`:
  - Added `DailyRotateFile` import
  - Replaced size-based `File` transports with `DailyRotateFile` transports
  - Configured daily rotation at midnight
  - Set 30-day retention period
  - Enabled automatic compression (gzip) for old logs
  - Added 20MB max file size as secondary rotation trigger

### 3. Backend Compilation
- ✅ Successfully built TypeScript to JavaScript
- ✅ Generated `backend/dist/config/logger.js` (compiled at 8:57 AM)

### 4. Documentation Created
- ✅ `docs/LOGGING_CONFIGURATION.md` - Comprehensive logging guide
- ✅ `docs/FIX_DAILY_LOG_ROTATION.md` - Quick deployment reference
- ✅ `web.config.example` - IIS/iisnode configuration template
- ✅ This summary document

---

## 📊 Before vs After

| Feature | Before (Size-Based) | After (Daily Rotation) |
|---------|---------------------|----------------------|
| **Rotation Trigger** | File size (5MB) | Daily at midnight + size (20MB) |
| **File Naming** | `error.log`, `error.log.1` | `error-2025-11-06.log` |
| **Retention** | Last 5-10 files | 30 days (date-based) |
| **Compression** | None | Automatic gzip |
| **Date Tracking** | ❌ No | ✅ Yes |
| **Previous Day Logs** | ❌ Missing/Overwritten | ✅ Preserved |

---

## 📁 New Log File Structure

After deployment, your logs will be organized like this:

```
logs/
├── error-2025-11-06.log          (today's errors)
├── error-2025-11-05.log.gz       (yesterday's errors, compressed)
├── error-2025-11-04.log.gz       (compressed)
├── combined-2025-11-06.log       (today's all logs)
├── combined-2025-11-05.log.gz    (compressed)
├── access-2025-11-06.log         (today's HTTP access logs)
└── access-2025-11-05.log.gz      (compressed)
```

- **Current day**: `.log` (uncompressed, actively written)
- **Previous days**: `.log.gz` (compressed automatically)
- **Retention**: Files older than 30 days are automatically deleted

---

## 🚀 Deployment Steps for Production

### Step 1: Deploy Updated Code

Copy these files to your production server:

```powershell
# Files that changed:
backend/package.json
backend/package-lock.json
backend/dist/config/logger.js
backend/dist/config/logger.js.map
```

**OR** rebuild on production server:

```powershell
cd C:\path\to\your\production\app\backend
npm install
npm run build
```

### Step 2: Restart Application

**If using PM2:**
```powershell
pm2 restart all
```

**If using IIS/iisnode:**
```powershell
# Option A: Restart IIS
iisreset /noforce

# Option B: Restart App Pool
$appPoolName = "YourAppPoolName"
Restart-WebAppPool -Name $appPoolName

# Option C: Touch web.config (triggers iisnode restart)
(Get-Item web.config).LastWriteTime = Get-Date
```

### Step 3: Verify Logs Are Being Created

```powershell
# Navigate to app directory
cd C:\path\to\your\production\app

# Check if daily log files exist
Get-ChildItem logs\*.log

# Expected output (with today's date):
# error-2025-11-06.log
# combined-2025-11-06.log
# access-2025-11-06.log

# Verify logs are being written
Get-Content logs\combined-2025-11-06.log -Tail 20
```

### Step 4: Configure IIS (If Applicable)

If you're using IIS/iisnode, update your `web.config`:

```xml
<iisnode 
  node_env="production"
  loggingEnabled="false"
  <!-- Disable iisnode logs since Winston now handles everything -->
/>
```

See `web.config.example` for complete IIS configuration.

### Step 5: Monitor Next Day

- Wait until after midnight
- Verify new log files are created with the new date
- Verify previous day's logs are compressed (`.log.gz`)
- Verify logs older than 30 days are deleted (after 30 days)

---

## ⚙️ Configuration Options

You can customize the logging behavior by editing `backend/src/config/logger.ts`:

### Change Retention Period
```typescript
maxFiles: '7d'   // Keep for 7 days
maxFiles: '14d'  // Keep for 14 days
maxFiles: '90d'  // Keep for 90 days
```

### Change Max File Size
```typescript
maxSize: '10m'   // Rotate at 10MB
maxSize: '50m'   // Rotate at 50MB
maxSize: '100m'  // Rotate at 100MB
```

### Disable Compression
```typescript
zippedArchive: false  // Keep logs uncompressed
```

### Change Rotation Frequency
```typescript
datePattern: 'YYYY-MM-DD-HH'  // Hourly logs
datePattern: 'YYYY-MM-DD'     // Daily logs (default)
datePattern: 'YYYY-MM'        // Monthly logs
```

After any changes, remember to:
```powershell
npm run build
pm2 restart all  # or restart IIS
```

---

## 🔍 Troubleshooting

### Issue: Logs still not rotating daily

**Check these:**
- ✅ `NODE_ENV=production` environment variable is set
- ✅ Application is running continuously (not restarting daily)
- ✅ Server timezone is configured correctly
- ✅ `logs/` directory has write permissions
- ✅ Verify the new code is deployed (check logger.js timestamp)

**Verify:**
```powershell
# Check NODE_ENV
$env:NODE_ENV

# Check if new logger.js is deployed
Get-Item backend\dist\config\logger.js | Select-Object LastWriteTime, Length

# Check logs directory permissions
Get-Acl logs\
```

### Issue: Previous day logs still missing

**Possible causes:**
1. New configuration not yet deployed
2. App not restarted after deployment
3. Still using old compiled code

**Solution:**
```powershell
# Rebuild and restart
cd backend
npm run build
pm2 restart all  # or restart IIS

# Verify correct code is running
Get-Content backend\dist\config\logger.js -First 5
# Should see: "DailyRotateFile" in the imports
```

### Issue: Logs found in multiple locations

You may see logs in different locations:

1. **`logs/`** - Your application logs (Winston) ✅ Primary logs
2. **`/api/dist/iisnode/`** - IIS/iisnode logs ⚠️ Can be disabled
3. **Windows Event Viewer** - System/application logs

**Recommendation**: 
- Use Winston logs (`logs/` directory) as primary logging
- Disable or minimize iisnode logging in `web.config`
- Use Event Viewer only for system-level issues

### Issue: Disk space filling up

**Quick fixes:**
```powershell
# Reduce retention period (in logger.ts)
maxFiles: '7d'  # Instead of '30d'

# Manually clean old logs
Get-ChildItem logs\*.log* | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item

# Check disk usage
Get-ChildItem logs -Recurse | Measure-Object -Property Length -Sum | ForEach-Object { [math]::Round($_.Sum / 1MB, 2) }
```

---

## 📋 Production Deployment Checklist

- [ ] Code changes reviewed
- [ ] Backend rebuilt: `npm run build`
- [ ] Dependencies installed: `npm install`
- [ ] Files deployed to production server
- [ ] Environment variable `NODE_ENV=production` is set
- [ ] `logs/` directory exists with write permissions
- [ ] Application restarted (PM2 or IIS)
- [ ] Logs being created: Verified `logs/*.log` files exist
- [ ] Logs have today's date in filename
- [ ] Application functioning normally
- [ ] IIS/iisnode logging configured (if applicable)
- [ ] Monitoring set up for log rotation
- [ ] Documentation reviewed by team
- [ ] Backup of old configuration (if needed)

---

## 📈 Benefits of This Fix

1. **✅ Date-Based Tracking**: Each day's logs in separate files
2. **✅ Historical Analysis**: Can review logs from any specific day
3. **✅ Automatic Cleanup**: Old logs deleted after 30 days
4. **✅ Space Efficient**: Automatic compression saves disk space
5. **✅ Compliance**: Meets audit/compliance requirements for log retention
6. **✅ Debugging**: Easy to correlate issues with specific dates
7. **✅ Performance**: Smaller daily files load faster than large rotated files

---

## 📚 Additional Resources

- **Comprehensive Guide**: `docs/LOGGING_CONFIGURATION.md`
- **Quick Reference**: `docs/FIX_DAILY_LOG_ROTATION.md`
- **IIS Configuration**: `web.config.example`
- **Production Guide**: `docs/PRODUCTION_GUIDE.md`
- **Winston Documentation**: https://github.com/winstonjs/winston
- **Daily Rotate File Plugin**: https://github.com/winstonjs/winston-daily-rotate-file

---

## 🆘 Need Help?

If you encounter issues during deployment:

1. Check the troubleshooting section above
2. Review detailed documentation in `docs/LOGGING_CONFIGURATION.md`
3. Verify environment variables and file permissions
4. Check application logs for errors
5. Ensure the compiled code is the latest version

---

## 📝 Next Steps

1. **Deploy to Development/Staging First**: Test the changes before production
2. **Monitor for 48 Hours**: Ensure daily rotation works correctly
3. **Adjust Retention**: Modify `maxFiles` if 30 days is too long/short
4. **Set Up Monitoring**: Alert if logs aren't being created
5. **Document Your Deployment**: Note any environment-specific changes

---

**Status**: ✅ Ready for Production Deployment

**Deployment Date**: _____________ (fill in after deployment)

**Deployed By**: _____________ (fill in after deployment)

**Verification Completed**: ☐ Yes ☐ No

---

