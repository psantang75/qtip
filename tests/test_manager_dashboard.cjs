const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';

// Test login and manager dashboard endpoints
async function testManagerDashboard() {
  try {
    console.log('=== Testing Manager Dashboard Endpoints ===\n');

    // Step 1: Login as manager
    console.log('Step 1: Logging in as manager...');
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: 'manager@company.com',
      password: 'password123'
    });

    if (loginResponse.data.success) {
      console.log('✅ Login successful');
      console.log('User:', loginResponse.data.user.username, '- Role:', loginResponse.data.user.role);
    } else {
      console.log('❌ Login failed');
      return;
    }

    const token = loginResponse.data.token;
    const headers = { 'Authorization': `Bearer ${token}` };

    // Step 2: Test manager stats endpoint
    console.log('\nStep 2: Testing /api/manager/stats endpoint...');
    try {
      const statsResponse = await axios.get(`${API_BASE}/manager/stats`, { headers });
      console.log('✅ Manager stats endpoint works!');
      console.log('Stats:', JSON.stringify(statsResponse.data, null, 2));
    } catch (error) {
      console.log('❌ Manager stats endpoint failed:');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data?.message || error.message);
    }

    // Step 3: Test manager CSR activity endpoint
    console.log('\nStep 3: Testing /api/manager/csr-activity endpoint...');
    try {
      const activityResponse = await axios.get(`${API_BASE}/manager/csr-activity`, { headers });
      console.log('✅ Manager CSR activity endpoint works!');
      console.log('CSR Activity Count:', activityResponse.data.length);
      if (activityResponse.data.length > 0) {
        console.log('Sample CSR:', JSON.stringify(activityResponse.data[0], null, 2));
      }
    } catch (error) {
      console.log('❌ Manager CSR activity endpoint failed:');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data?.message || error.message);
    }

    // Step 4: Test admin endpoints for comparison
    console.log('\nStep 4: Testing admin endpoints for comparison...');
    
    // Login as admin
    const adminLoginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: 'admin@company.com',
      password: 'admin123'
    });

    if (adminLoginResponse.data.success) {
      const adminToken = adminLoginResponse.data.token;
      const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };

      try {
        const adminStatsResponse = await axios.get(`${API_BASE}/admin/stats`, { headers: adminHeaders });
        console.log('✅ Admin stats endpoint works!');
        console.log('Admin Stats:', JSON.stringify(adminStatsResponse.data, null, 2));
      } catch (error) {
        console.log('❌ Admin stats endpoint failed:', error.message);
      }

      try {
        const adminActivityResponse = await axios.get(`${API_BASE}/admin/csr-activity`, { headers: adminHeaders });
        console.log('✅ Admin CSR activity endpoint works!');
        console.log('Admin CSR Activity Count:', adminActivityResponse.data.length);
      } catch (error) {
        console.log('❌ Admin CSR activity endpoint failed:', error.message);
      }
    }

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testManagerDashboard(); 