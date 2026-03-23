const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:3000/api';
const TEST_CONVERSATION_ID = 'TEST123456'; // Replace with a real conversation ID from your PhoneSystem database

// Test authentication token (you'll need to get this from a successful login)
let authToken = '';

// Helper function to make authenticated requests
const makeAuthenticatedRequest = async (method, endpoint, data = null) => {
  try {
    const config = {
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { 'Authorization': `Bearer ${authToken}` })
      },
      ...(data && { data })
    };

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`Error making ${method} request to ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// Test functions
const testPhoneSystemConnection = async () => {
  console.log('🔍 Testing PhoneSystem database connection...');
  
  try {
    const response = await makeAuthenticatedRequest('GET', '/phone-system/health');
    console.log('✅ PhoneSystem connection test:', response);
    return response.success;
  } catch (error) {
    console.error('❌ PhoneSystem connection test failed:', error.message);
    return false;
  }
};

const testGetAudioUrl = async (conversationId) => {
  console.log(`🔍 Testing audio URL retrieval for conversation ID: ${conversationId}`);
  
  try {
    const response = await makeAuthenticatedRequest('GET', `/phone-system/recording/${conversationId}`);
    console.log('✅ Audio URL retrieval test:', response);
    return response;
  } catch (error) {
    console.error('❌ Audio URL retrieval test failed:', error.message);
    return null;
  }
};

const testGetDatabaseStats = async () => {
  console.log('🔍 Testing database statistics retrieval...');
  
  try {
    const response = await makeAuthenticatedRequest('GET', '/phone-system/stats');
    console.log('✅ Database statistics test:', response);
    return response;
  } catch (error) {
    console.error('❌ Database statistics test failed:', error.message);
    return null;
  }
};

const testGetAllRecordings = async () => {
  console.log('🔍 Testing get all recordings...');
  
  try {
    const response = await makeAuthenticatedRequest('GET', '/phone-system/recordings?limit=10');
    console.log('✅ Get all recordings test:', response);
    return response;
  } catch (error) {
    console.error('❌ Get all recordings test failed:', error.message);
    return null;
  }
};

// Main test function
const runTests = async () => {
  console.log('🚀 Starting PhoneSystem API tests...\n');

  // Test 1: Database connection
  const connectionTest = await testPhoneSystemConnection();
  console.log('');

  if (!connectionTest) {
    console.log('❌ Database connection failed. Stopping tests.');
    return;
  }

  // Test 2: Database statistics
  await testGetDatabaseStats();
  console.log('');

  // Test 3: Audio URL retrieval
  await testGetAudioUrl(TEST_CONVERSATION_ID);
  console.log('');

  // Test 4: Get all recordings
  await testGetAllRecordings();
  console.log('');

  console.log('✅ All PhoneSystem API tests completed!');
};

// Instructions for running the test
console.log(`
📋 PhoneSystem API Test Script
===============================

This script tests the PhoneSystem database connection and API endpoints.

Prerequisites:
1. Make sure the backend server is running on http://localhost:3000
2. Ensure the secondary database (PhoneSystem) is configured in your .env file
3. Get a valid authentication token by logging in to the application

To get an authentication token:
1. Start the frontend application
2. Log in with valid credentials
3. Open browser developer tools
4. Go to Application/Storage tab
5. Find the JWT token in localStorage
6. Copy the token and update the 'authToken' variable in this script

Environment Variables Required:
- DB2_HOST: PhoneSystem database host
- DB2_USER: PhoneSystem database user
- DB2_PASSWORD: PhoneSystem database password
- DB2_NAME: PhoneSystem database name (should be 'PhoneSystem')

Test Conversation ID:
- Update TEST_CONVERSATION_ID with a real conversation ID from your PhoneSystem database

Running the test:
node test_phone_system_connection.js
`);

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testPhoneSystemConnection,
  testGetAudioUrl,
  testGetDatabaseStats,
  testGetAllRecordings
}; 