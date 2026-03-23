const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';
let authToken = '';

const authenticate = async () => {
  const authResponse = await axios.post(`${BASE_URL}/auth/login`, {
    email: 'admin1@test.com',
    password: 'Pass1234'
  });
  
  authToken = authResponse.data.token;
  console.log('✅ Authenticated');
};

const testEndpoint = async (method, endpoint, data = null) => {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    console.log(`\n🧪 Testing: ${method} ${endpoint}`);
    if (data) {
      console.log('📤 Request data:', JSON.stringify(data, null, 2));
    }
    
    const response = await axios(config);
    console.log('✅ Success:', response.status);
    console.log('📥 Response data:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.log('❌ Failed:', error.response?.status || 'No response');
    console.log('📥 Error data:', error.response?.data || error.message);
    throw error;
  }
};

const runDebug = async () => {
  console.log('🔍 Analytics Debug Session');
  console.log('==========================');
  
  try {
    await authenticate();
    
    // Test Filter Options (this one works)
    await testEndpoint('GET', '/analytics/filters');
    
    // Test QA Score Trends (this one fails)
    const filters = {
      startDate: '2024-01-01',
      endDate: '2024-12-31'
    };
    
    await testEndpoint('POST', '/analytics/qa-score-trends', filters);
    
  } catch (error) {
    console.error('Debug session failed:', error.message);
  }
};

runDebug(); 