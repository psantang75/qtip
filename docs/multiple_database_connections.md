# Multiple Database Connections Guide

This guide explains how to configure and use multiple database connections in the QTIP application.

## Overview

The QTIP application now supports multiple database connections, allowing you to:
- Separate operational data from analytics/reporting data
- Use different databases for different types of operations
- Improve performance by routing queries to appropriate databases
- Maintain backward compatibility with existing code

## Configuration

### 1. Environment Variables

Add the following variables to your `.env` file:

```env
# ===============================================
# PRIMARY DATABASE CONFIGURATION
# ===============================================
DB_HOST=localhost
DB_PORT=3306
DB_USER=qtip_user
DB_PASSWORD=YOUR_SECURE_DATABASE_PASSWORD_HERE
DB_NAME=qtip_production
DB_CONNECTION_LIMIT=20

# ===============================================
# SECONDARY DATABASE CONFIGURATION (Optional)
# ===============================================
DB2_HOST=localhost
DB2_PORT=3306
DB2_USER=qtip_analytics_user
DB2_PASSWORD=YOUR_SECURE_SECONDARY_DATABASE_PASSWORD_HERE
DB2_NAME=qtip_analytics
DB2_CONNECTION_LIMIT=10

# ===============================================
# DATABASE SELECTION
# ===============================================
DEFAULT_DB=primary
ANALYTICS_DB=secondary
REPORTING_DB=secondary
```

### 2. Database Setup

#### Primary Database
- Contains core application data (users, forms, submissions, etc.)
- Used for all operational queries
- Should be optimized for read/write operations

#### Secondary Database
- Contains analytics, reporting, and historical data
- Used for data analysis and reporting queries
- Can be optimized for read-heavy operations

## Usage

### Basic Usage

```typescript
import { getDatabasePool, executeQuery } from '../config/database';
import { getPoolForOperation } from '../utils/databaseUtils';

// Get a specific database pool
const primaryPool = getDatabasePool('primary');
const secondaryPool = getDatabasePool('secondary');

// Execute queries on specific databases
const users = await executeQuery('SELECT * FROM users', [], 'primary');
const analytics = await executeQuery('SELECT * FROM analytics_events', [], 'analytics');
```

### Using Database Utils

```typescript
import { 
  executeQuery, 
  executeTransaction, 
  getUserData, 
  getAnalyticsData 
} from '../utils/databaseUtils';

// Get user data from primary database
const user = await getUserData(123);

// Get analytics data from secondary database
const analytics = await getAnalyticsData({
  start: '2024-01-01',
  end: '2024-01-31'
});

// Execute a transaction on primary database
const result = await executeTransaction(async (connection) => {
  // Your transaction logic here
  await connection.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['John', 'john@example.com']);
  return { success: true };
}, 'primary');
```

### Operation Types

The following operation types are supported:

- `'primary'` - Uses the primary database
- `'secondary'` - Uses the secondary database
- `'analytics'` - Uses the secondary database (alias for analytics operations)
- `'reporting'` - Uses the secondary database (alias for reporting operations)
- `'default'` - Uses the primary database (default behavior)

## Migration from Single Database

### Existing Code Compatibility

All existing code will continue to work without changes. The default export from `database.ts` still points to the primary database pool.

```typescript
// This still works (uses primary database)
import pool from '../config/database';
const [rows] = await pool.execute('SELECT * FROM users');
```

### Gradual Migration

You can gradually migrate specific operations to use the secondary database:

```typescript
// Before (uses primary database)
const analytics = await pool.execute('SELECT * FROM analytics_events');

// After (uses secondary database)
const analytics = await executeQuery('SELECT * FROM analytics_events', [], 'analytics');
```

## Testing Database Connections

```typescript
import { 
  testDatabaseConnection, 
  testAllDatabaseConnections,
  getAllPoolStats 
} from '../config/database';

// Test a specific connection
const primaryConnected = await testDatabaseConnection('primary');
const secondaryConnected = await testDatabaseConnection('secondary');

// Test all connections
const allConnections = await testAllDatabaseConnections();
// Returns: { primary: true, secondary: true }

// Get pool statistics
const stats = getAllPoolStats();
// Returns detailed information about all connection pools
```

## Best Practices

### 1. Database Selection

- Use `primary` for operational data (users, forms, submissions)
- Use `secondary` for analytics, reporting, and historical data
- Use `analytics` alias for analytics-specific operations
- Use `reporting` alias for reporting-specific operations

### 2. Connection Management

- The application automatically manages connection pools
- Connections are reused efficiently
- Pools are created on-demand and cached

### 3. Error Handling

```typescript
try {
  const data = await executeQuery('SELECT * FROM users', [], 'primary');
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.error('Database connection failed');
  }
  throw error;
}
```

### 4. Performance Considerations

- Use appropriate connection limits for each database
- Monitor pool statistics regularly
- Consider read replicas for the secondary database if needed

## Monitoring

### Pool Statistics

```typescript
import { getAllPoolStats } from '../config/database';

const stats = getAllPoolStats();
console.log('Primary DB Stats:', stats.primary);
console.log('Secondary DB Stats:', stats.secondary);
```

### Health Checks

```typescript
import { testAllDatabaseConnections } from '../config/database';

// In your health check endpoint
app.get('/health/databases', async (req, res) => {
  const connections = await testAllDatabaseConnections();
  res.json({
    status: 'healthy',
    databases: connections
  });
});
```

## Troubleshooting

### Common Issues

1. **Secondary database not configured**
   - Check that all DB2_* environment variables are set
   - Verify the secondary database is accessible

2. **Connection pool exhausted**
   - Increase `DB_CONNECTION_LIMIT` or `DB2_CONNECTION_LIMIT`
   - Check for connection leaks in your code

3. **Performance issues**
   - Monitor query performance on each database
   - Consider database-specific optimizations

### Debug Mode

Enable debug logging to see database connection details:

```typescript
// In your application startup
if (process.env.NODE_ENV === 'development') {
  const stats = getAllPoolStats();
  console.log('Database pools initialized:', stats);
}
```

## Security Considerations

1. **Separate database users**
   - Use different users for primary and secondary databases
   - Grant minimal required permissions to each user

2. **Environment variables**
   - Never commit `.env` files to version control
   - Use secure passwords for production databases

3. **Connection encryption**
   - Enable SSL/TLS for database connections in production
   - Use secure connection strings

## Example Implementation

Here's a complete example of how to use multiple databases in a service:

```typescript
import { executeQuery, executeTransaction } from '../utils/databaseUtils';

export class AnalyticsService {
  async getUserAnalytics(userId: number, dateRange: { start: string; end: string }) {
    // Get user data from primary database
    const user = await executeQuery(
      'SELECT id, name, email FROM users WHERE id = ?',
      [userId],
      'primary'
    );

    // Get analytics data from secondary database
    const analytics = await executeQuery(
      'SELECT * FROM user_analytics WHERE user_id = ? AND date BETWEEN ? AND ?',
      [userId, dateRange.start, dateRange.end],
      'analytics'
    );

    return {
      user: user[0],
      analytics
    };
  }

  async logAnalyticsEvent(eventData: any) {
    return executeTransaction(async (connection) => {
      await connection.execute(
        'INSERT INTO analytics_events (event_type, event_data, created_at) VALUES (?, ?, NOW())',
        [eventData.type, JSON.stringify(eventData.data)]
      );
      
      // Update analytics summary
      await connection.execute(
        'UPDATE analytics_summary SET event_count = event_count + 1 WHERE event_type = ?',
        [eventData.type]
      );
    }, 'analytics');
  }
}
``` 