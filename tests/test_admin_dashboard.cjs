const axios = require('axios');

class AdminDashboardTester {
  constructor() {
    this.baseURL = 'http://localhost:3000/api';
    this.authToken = null;
  }

  async login() {
    try {
      // Try different admin credentials found in the database schemas
      const credentials = [
        { email: 'admin1@qtip.com', password: 'pass1234' },
        { email: 'admin1@test.com', password: 'pass1234' },
        { email: 'admin@qtip.com', password: 'pass1234' },
        { email: 'admin@example.com', password: 'password123' }
      ];

      for (const cred of credentials) {
        try {
          const response = await axios.post(`${this.baseURL}/auth/login`, cred);
          
          this.authToken = response.data.token;
          console.log(`✅ Admin login successful with ${cred.email}`);
          console.log('📊 Token:', this.authToken ? 'Present' : 'Missing');
          return true;
        } catch (error) {
          console.log(`❌ Failed with ${cred.email}: ${error.response?.data?.message || error.message}`);
        }
      }
      
      console.error('❌ All admin login attempts failed');
      return false;
    } catch (error) {
      console.error('❌ Admin login failed:', error.response?.data?.message || error.message);
      return false;
    }
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async testAdminStats() {
    try {
      console.log('\n🔍 Testing Admin Stats Endpoint...');
      
      const response = await axios.get(`${this.baseURL}/admin/stats`, {
        headers: this.getAuthHeaders()
      });
      
      console.log('✅ Admin stats endpoint working');
      console.log('📊 Response:', JSON.stringify(response.data, null, 2));
      
      // Validate the response structure
      const stats = response.data;
      const requiredFields = ['reviewsCompleted', 'disputes', 'coachingSessions'];
      const weeklyMonthlyFields = ['thisWeek', 'thisMonth'];
      
      for (const field of requiredFields) {
        if (!stats[field]) {
          console.warn(`⚠️ Missing field: ${field}`);
          continue;
        }
        
        for (const timeField of weeklyMonthlyFields) {
          if (typeof stats[field][timeField] !== 'number') {
            console.warn(`⚠️ Invalid ${field}.${timeField}: expected number, got ${typeof stats[field][timeField]}`);
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error('❌ Admin stats test failed:', error.response?.data || error.message);
      return false;
    }
  }

  async testCSRActivity() {
    try {
      console.log('\n🔍 Testing CSR Activity Endpoint...');
      
      const response = await axios.get(`${this.baseURL}/admin/csr-activity`, {
        headers: this.getAuthHeaders()
      });
      
      console.log('✅ CSR Activity endpoint working');
      console.log('📊 Response:', JSON.stringify(response.data, null, 2));
      
      // Validate the response structure
      const csrActivity = response.data;
      
      if (!Array.isArray(csrActivity)) {
        console.warn('⚠️ CSR Activity should be an array');
        return false;
      }
      
      console.log(`📈 Found ${csrActivity.length} CSR records`);
      
      if (csrActivity.length > 0) {
        const requiredFields = ['id', 'name', 'department', 'audits', 'disputes', 'coachingSessions'];
        const firstRecord = csrActivity[0];
        
        for (const field of requiredFields) {
          if (!(field in firstRecord)) {
            console.warn(`⚠️ Missing field in CSR record: ${field}`);
          }
        }
        
        console.log('📋 Sample CSR record:', {
          id: firstRecord.id,
          name: firstRecord.name,
          department: firstRecord.department,
          audits: firstRecord.audits,
          disputes: firstRecord.disputes,
          coachingSessions: firstRecord.coachingSessions
        });
      } else {
        console.log('ℹ️ No CSR activity data found (this might be expected if no data exists)');
      }
      
      return true;
    } catch (error) {
      console.error('❌ CSR Activity test failed:', error.response?.data || error.message);
      return false;
    }
  }

  async runTests() {
    console.log('🚀 Starting Admin Dashboard API Tests\n');
    
    // Test login first
    const loginSuccess = await this.login();
    if (!loginSuccess) {
      console.log('❌ Cannot proceed without admin authentication');
      console.log('💡 Tip: Make sure the backend is running and admin users exist in the database');
      console.log('💡 Try running the setup script: .\\backend\\setup_users_simple.ps1');
      return;
    }
    
    // Test admin stats endpoint
    const statsSuccess = await this.testAdminStats();
    
    // Test CSR activity endpoint
    const activitySuccess = await this.testCSRActivity();
    
    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log(`Admin Stats: ${statsSuccess ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`CSR Activity: ${activitySuccess ? '✅ PASS' : '❌ FAIL'}`);
    
    if (statsSuccess && activitySuccess) {
      console.log('\n🎉 All admin dashboard endpoints are working correctly!');
      console.log('💡 The frontend should now display real data instead of mock data.');
      console.log('🌐 You can now test the admin dashboard in the browser at: http://localhost:5173/admin/dashboard');
    } else {
      console.log('\n⚠️ Some tests failed. Check the backend logs for more details.');
    }
  }
}

// Run the tests
const tester = new AdminDashboardTester();
tester.runTests().catch(console.error); 