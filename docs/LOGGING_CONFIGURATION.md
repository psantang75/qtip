# Logging Configuration and Daily Log Rotation

## Overview

The QTIP application now uses **daily log rotation** with the `winston-daily-rotate-file` package to ensure logs are created for each day and retained for a specified period.

## What Changed

### Previous Configuration (Size-based Rotation)
- Logs rotated only when file size reached 5MB
- Files were renamed with numeric suffixes (e.g., `error.log.1`, `error.log.2`)
- Old logs were overwritten when `maxFiles` limit was reached
- **Problem**: No date-based log files, previous day logs were missing

### New Configuration (Daily Rotation)
- **Date-based filenames**: Logs are created with date stamps (e.g., `error-2025-11-06.log`)
- **Daily rotation**: New log file created automatically at midnight
- **Retention period**: Logs kept for 30 days (configurable)
- **Compression**: Old logs are automatically gzipped to save disk space
- **Size limit**: Individual log files also rotate if they exceed 20MB

## Log Files

### Production Log Files (in `logs/` directory)

1. **Error Logs**: `error-YYYY-MM-DD.log`
   - Contains only ERROR level logs
   - Retention: 30 days
   - Max size: 20MB per file

2. **Combined Logs**: `combined-YYYY-MM-DD.log`
   - Contains all log levels (INFO, WARN, ERROR, DEBUG)
   - Retention: 30 days
   - Max size: 20MB per file

3. **Access Logs**: `access-YYYY-MM-DD.log`
   - Contains HTTP request/response logs
   - Retention: 30 days
   - Max size: 20MB per file

### Log File Examples
```
logs/
├── error-2025-11-06.log
├── error-2025-11-05.log.gz
├── error-2025-11-04.log.gz
├── combined-2025-11-06.log
├── combined-2025-11-05.log.gz
├── access-2025-11-06.log
└── access-2025-11-05.log.gz
```

## Configuration Details

### Daily Rotation Settings

```typescript
new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',          // Date format in filename
  level: 'error',                      // Log level filter
  format: logFormat,                   // JSON structured format
  maxSize: '20m',                      // Rotate if file exceeds 20MB
  maxFiles: '30d',                     // Keep logs for 30 days
  zippedArchive: true,                 // Compress old logs
  handleExceptions: true               // Capture unhandled exceptions
})
```

### Customization Options

You can customize the logging behavior via environment variables or by modifying `backend/src/config/logger.ts`:

#### Change Retention Period
```typescript
maxFiles: '90d'  // Keep logs for 90 days
maxFiles: '14d'  // Keep logs for 14 days
```

#### Change Max File Size
```typescript
maxSize: '50m'   // Rotate at 50MB
maxSize: '10m'   // Rotate at 10MB
```

#### Change Date Pattern
```typescript
datePattern: 'YYYY-MM-DD-HH'  // Hourly rotation
datePattern: 'YYYY-MM'        // Monthly rotation
```

#### Disable Compression
```typescript
zippedArchive: false  // Keep logs uncompressed
```

## IIS/iisnode Configuration

If you're running the application through IIS using iisnode (as indicated by logs in `/api/dist/iisnode`), you may also need to configure iisnode logging separately.

### Create/Update web.config

Create or update `web.config` in your application root (if using IIS):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="iisnode" path="backend/dist/index.js" verb="*" modules="iisnode" />
    </handlers>
    
    <iisnode
      node_env="production"
      loggingEnabled="true"
      logDirectory="iisnode"
      maxLogFileSizeInKB="512"
      maxTotalLogFileSizeInKB="5120"
      maxLogFiles="5"
      watchedFiles="web.config;*.js"
      debuggingEnabled="false"
      devErrorsEnabled="false" />
      
    <rewrite>
      <rules>
        <rule name="NodeInspector" patternSyntax="ECMAScript" stopProcessing="true">
          <match url="^backend/dist/index.js\/debug[\/]?" />
        </rule>
        <rule name="StaticContent">
          <action type="Rewrite" url="public{REQUEST_URI}"/>
        </rule>
        <rule name="DynamicContent">
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="True"/>
          </conditions>
          <action type="Rewrite" url="backend/dist/index.js"/>
        </rule>
      </rules>
    </rewrite>
    
    <!-- Security headers -->
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="DENY" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

### iisnode Log Management

iisnode creates its own logs in the `iisnode` directory. These are **separate** from your application logs. To manage them:

1. **Limit log file size**: Use `maxLogFileSizeInKB` setting
2. **Limit total log size**: Use `maxTotalLogFileSizeInKB` setting
3. **Limit number of files**: Use `maxLogFiles` setting
4. **Disable iisnode logs** (if using Winston logging): Set `loggingEnabled="false"`

### Recommended Approach

Since you now have comprehensive Winston logging with daily rotation, you can:

1. **Disable or minimize iisnode logging**:
   ```xml
   <iisnode loggingEnabled="false" />
   ```

2. **Or keep minimal iisnode logging** for startup/crash issues only:
   ```xml
   <iisnode 
     loggingEnabled="true"
     logDirectory="logs/iisnode"
     maxLogFiles="3" />
   ```

3. **Rely on Winston logs** for application-level logging

## Monitoring and Maintenance

### Check Log Disk Usage

Monitor the `logs/` directory size to ensure it doesn't fill up disk space:

```powershell
# PowerShell command to check log directory size
Get-ChildItem -Path ".\logs" -Recurse | Measure-Object -Property Length -Sum | Select-Object @{Name="Size(MB)";Expression={[math]::Round($_.Sum / 1MB, 2)}}
```

### Manual Log Cleanup

If needed, you can manually clean up old logs:

```powershell
# Remove logs older than 30 days
Get-ChildItem -Path ".\logs\*.log*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
```

### Log Rotation Events

The `winston-daily-rotate-file` transport emits events that you can listen to:

```typescript
const errorRotateTransport = new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d'
});

// Listen to rotation events
errorRotateTransport.on('rotate', (oldFilename, newFilename) => {
  console.log(`Log rotated from ${oldFilename} to ${newFilename}`);
});

errorRotateTransport.on('new', (newFilename) => {
  console.log(`New log file created: ${newFilename}`);
});

errorRotateTransport.on('archive', (zipFilename) => {
  console.log(`Log archived: ${zipFilename}`);
});
```

## Troubleshooting

### Issue: Logs not rotating at midnight

**Possible causes:**
1. Server timezone not configured correctly
2. Application not running continuously
3. No log entries being written

**Solution:**
- Check server timezone: `$env:TZ`
- Ensure application is running as a service
- Verify logs are being written: Check current day's log file

### Issue: Old logs not being deleted

**Possible causes:**
1. `maxFiles` setting not configured
2. File permissions preventing deletion
3. Files locked by another process

**Solution:**
- Verify `maxFiles: '30d'` is set in logger config
- Check file permissions on `logs/` directory
- Ensure no processes have log files open

### Issue: Disk space filling up

**Possible causes:**
1. Too many logs being generated
2. `maxFiles` retention too long
3. Compression not working

**Solution:**
- Reduce `maxFiles` from '30d' to '14d' or less
- Verify `zippedArchive: true` is set
- Reduce log level from 'debug' to 'info' in production

### Issue: Cannot find logs in expected location

**Check these locations:**
1. `logs/` directory in application root
2. `/api/dist/iisnode/` (if using IIS/iisnode)
3. Current working directory when app starts
4. Check `NODE_ENV` environment variable is set to 'production'

## Production Deployment Checklist

- [ ] `winston-daily-rotate-file` package installed
- [ ] `backend/src/config/logger.ts` updated with DailyRotateFile transports
- [ ] Backend rebuilt: `npm run build`
- [ ] `logs/` directory exists with proper permissions
- [ ] `NODE_ENV=production` environment variable set
- [ ] Application restarted to use new configuration
- [ ] Verify logs are being created with date stamps
- [ ] Configure log monitoring/alerting
- [ ] Set up automated log backup (optional)
- [ ] Configure iisnode logging (if using IIS)

## Log Analysis Tools

### View today's errors
```powershell
Get-Content logs/error-$(Get-Date -Format "yyyy-MM-dd").log -Tail 50
```

### Search for specific errors
```powershell
Select-String -Path "logs/error-*.log" -Pattern "Database connection failed"
```

### Count errors per day
```powershell
Get-ChildItem logs/error-*.log | ForEach-Object { 
    [PSCustomObject]@{
        Date = $_.Name -replace 'error-|.log'
        ErrorCount = (Get-Content $_.FullName | Measure-Object -Line).Lines
    }
}
```

### Extract structured JSON logs
```powershell
# Parse JSON logs for analysis
Get-Content logs/combined-$(Get-Date -Format "yyyy-MM-dd").log | ForEach-Object { 
    ConvertFrom-Json $_ 
} | Where-Object { $_.level -eq "ERROR" } | Format-Table timestamp, message, userId
```

## References

- [Winston Documentation](https://github.com/winstonjs/winston)
- [winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file)
- [iisnode Configuration](https://github.com/azure/iisnode/blob/master/src/samples/configuration/web.config)

