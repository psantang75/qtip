# PhoneSystem Integration Guide

This guide explains how to integrate the PhoneSystem database with QTIP to retrieve call recording audio URLs for QA manual reviews.

## Overview

The PhoneSystem integration allows QA Analysts to:
- Enter a conversation ID in the manual review form
- Automatically retrieve the corresponding audio URL from the PhoneSystem database
- Play the audio recording directly in the QA review interface
- Note: Call metadata (duration, date, CSR ID, customer ID) is not available due to simplified table structure

## Architecture

The integration uses the secondary database connection to access the PhoneSystem database:

```
QTIP Application (Primary DB) ←→ PhoneSystem Database (Secondary DB)
     ↓                                    ↓
  Main Application Data              Call Recordings
  (Users, Forms, Submissions)        (Audio URLs Only)
```

## Configuration

### 1. Environment Variables

Add the following variables to your `.env` file:

```env
# ===============================================
# PHONESYSTEM DATABASE CONFIGURATION
# ===============================================
DB2_HOST=localhost
DB2_PORT=3306
DB2_USER=phonesystem_user
DB2_PASSWORD=YOUR_SECURE_PHONESYSTEM_PASSWORD_HERE
DB2_NAME=PhoneSystem
DB2_CONNECTION_LIMIT=10
```

### 2. Database Schema

The PhoneSystem database should contain a `tempRecording` table with the following structure:

```sql
CREATE TABLE tempRecording (
  ConversationID VARCHAR(255) NOT NULL,
  Recordings TEXT NOT NULL,
  INDEX idx_conversation_id (ConversationID)
);
```

### 3. Database Permissions

Ensure the PhoneSystem database user has the following permissions:

```sql
GRANT SELECT ON PhoneSystem.tempRecording TO 'phonesystem_user'@'%';
GRANT SELECT ON PhoneSystem.* TO 'phonesystem_user'@'%';
```

## API Endpoints

### 1. Get Audio URL by Recording ID

**Endpoint:** `GET /api/phone-system/recording/:conversationId`

**Description:** Retrieves audio URL and metadata for a specific conversation ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "conversation_id": "CALL123456",
    "audio_url": "https://example.com/recordings/call123456.mp3"
  }
}
```

### 2. Get Multiple Audio URLs

**Endpoint:** `POST /api/phone-system/recordings/batch`

**Description:** Retrieves audio URLs for multiple conversation IDs.

**Request Body:**
```json
{
  "conversationIds": ["CALL123456", "CALL789012", "CALL345678"]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "conversation_id": "CALL123456",
      "audio_url": "https://example.com/recordings/call123456.mp3"
    }
  ],
  "count": 1
}
```

### 3. Get All Recordings

**Endpoint:** `GET /api/phone-system/recordings`

**Description:** Gets all recordings (since date filtering is not available due to simplified table structure).

**Query Parameters:**
- `limit`: Maximum number of results (default: 100, max: 1000)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "conversation_id": "CALL123456",
      "audio_url": "https://example.com/recordings/call123456.mp3"
    }
  ],
  "count": 1,
  "filters": {
    "limit": 100
  }
}
```

### 4. Health Check

**Endpoint:** `GET /api/phone-system/health`

**Description:** Tests the PhoneSystem database connection.

**Response:**
```json
{
  "success": true,
  "message": "PhoneSystem database connection is healthy",
  "status": "connected"
}
```

### 5. Database Statistics

**Endpoint:** `GET /api/phone-system/stats`

**Description:** Retrieves PhoneSystem database statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRecordings": 15000,
    "latestRecording": null,
    "oldestRecording": null
  }
}
```

## Frontend Integration

### 1. Manual Review Form

The QA Manual Review form now includes a call recording ID input field:

1. **Enter Conversation ID**: QA Analyst enters the conversation ID
2. **Fetch Audio**: Click "Fetch Audio" button or press Enter
3. **Audio Player**: Audio URL is retrieved and displayed in an audio player
4. **Note**: Call metadata (date, duration, CSR ID, customer ID) is not available

### 2. Usage Flow

```
1. QA Analyst navigates to Manual Reviews
2. Selects a form and CSR
3. Enters conversation ID in the Call Details section
4. Clicks "Fetch Audio" to retrieve audio URL from PhoneSystem
5. Audio player appears with the retrieved recording
6. QA Analyst can listen to the call while completing the review
```

### 3. Error Handling

The integration includes comprehensive error handling:

- **Recording Not Found**: Displays "No audio found for this conversation ID"
- **Database Connection Error**: Shows appropriate error message
- **Network Error**: Handles API communication failures
- **Invalid Conversation ID**: Validates input format

## Testing

### 1. Test Script

Use the provided test script to verify the integration:

```bash
node test_phone_system_connection.js
```

### 2. Manual Testing

1. **Start the application**:
   ```bash
   # Backend
   cd backend && npm start
   
   # Frontend
   cd frontend && npm run dev
   ```

2. **Navigate to QA Manual Reviews**:
   - Go to `/qa/manual-reviews`
   - Select a form and CSR
   - Enter a valid conversation ID
   - Click "Fetch Audio"

3. **Verify functionality**:
   - Audio URL is retrieved successfully
   - Audio player displays the recording
   - Note: Call metadata fields will be empty or show default values

### 3. Database Testing

Test the PhoneSystem database connection directly:

```sql
-- Test connection
SELECT 1 as test;

-- Test tempRecording table
SELECT COUNT(*) FROM tempRecording;

-- Test specific recording
SELECT * FROM tempRecording WHERE ConversationID = 'YOUR_TEST_CONVERSATION_ID';
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check DB2_* environment variables
   - Verify PhoneSystem database is accessible
   - Ensure database user has correct permissions

2. **Recording Not Found**
   - Verify conversation ID exists in tempRecording table
   - Check ConversationID column format
   - Ensure database contains test data
   - Note: Only ConversationID and Recordings columns are available

3. **Audio URL Not Loading**
   - Verify audio URL is accessible
   - Check CORS settings for audio domain
   - Test audio URL in browser directly

4. **Authentication Errors**
   - Ensure user is logged in
   - Check JWT token is valid
   - Verify user has QA Analyst role

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
// In browser console
localStorage.setItem('debug', 'phone-system:*');

// In backend logs
LOG_LEVEL=debug
```

### Health Checks

Monitor the PhoneSystem integration health:

```bash
# Test database connection
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/phone-system/health

# Get database statistics
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/phone-system/stats
```

## Security Considerations

1. **Database Access**
   - Use dedicated database user with minimal permissions
   - Enable SSL/TLS for database connections
   - Regularly rotate database passwords

2. **API Security**
   - All endpoints require authentication
   - Implement rate limiting for API calls
   - Validate and sanitize conversation IDs

3. **Audio URL Security**
   - Ensure audio URLs are from trusted domains
   - Implement URL validation
   - Consider audio URL expiration policies

## Performance Optimization

1. **Database Indexing**
   - Index ConversationID column for fast lookups
   - Note: Date-based queries are not available due to simplified table structure

2. **Caching**
   - Cache frequently accessed recordings
   - Implement audio URL caching
   - Use Redis for session management

3. **Connection Pooling**
   - Configure appropriate connection limits
   - Monitor connection pool usage
   - Implement connection health checks

## Future Enhancements

1. **Bulk Operations**
   - Batch conversation ID processing
   - Bulk audio URL retrieval
   - Mass recording metadata updates

2. **Advanced Search**
   - Search by CSR ID
   - Search by customer ID
   - Full-text search in transcripts

3. **Audio Processing**
   - Audio format conversion
   - Audio quality optimization
   - Automatic transcript generation

4. **Integration Features**
   - Real-time recording sync
   - Webhook notifications
   - API rate limiting controls 