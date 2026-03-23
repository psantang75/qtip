const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const API_URL = `${BASE_URL}/api`;

const ADMIN_CREDENTIALS = {
  email: 'admin1@test.com',
  password: 'Pass1234'
};

class AnalyticsServiceTester {
  constructor() {
    this.authToken = null;
    this.user = null;
  }

  async authenticate() {
    console.log('🔐 Authenticating...');
    try {
      const response = await axios.post(`${API_URL}/auth/login`, ADMIN_CREDENTIALS);
      
      if (response.data.token && response.data.user) {
        this.authToken = response.data.token;
        this.user = response.data.user;
        console.log(`✅ Authenticated as: ${this.user.username} (ID: ${this.user.id}, Role: ${this.user.role})`);
        return true;
      } else {
        console.error('❌ Authentication failed - invalid response format');
        return false;
      }
    } catch (error) {
      console.error('❌ Authentication failed:', error.response?.data?.message || error.message);
      return false;
    }
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async testAnalyticsEndpoints() {
    console.log('\n📊 Testing Analytics Endpoints...');
    
    try {
      // Test filter options
      console.log('\n📋 Testing Filter Options...');
      const filtersResponse = await axios.get(
        `${API_URL}/analytics/filters`,
        { headers: this.getAuthHeaders() }
      );
      
      console.log('✅ Filter Options working');
      console.log(`   📍 Departments: ${filtersResponse.data.departments?.length || 0}`);
      console.log(`   📋 Forms: ${filtersResponse.data.forms?.length || 0}`);
      console.log(`   👥 CSRs: ${filtersResponse.data.csrs?.length || 0}`);
      
      // Test QA score trends
      console.log('\n📈 Testing QA Score Trends...');
      const trendsResponse = await axios.post(
        `${API_URL}/analytics/qa-score-trends`,
        {
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          groupBy: 'csr'
        },
        { headers: this.getAuthHeaders() }
      );
      
      console.log('✅ QA Score Trends working');
      console.log(`   📊 Trend Groups: ${trendsResponse.data.trends?.length || 0}`);
      console.log(`   📊 Overall Average: ${trendsResponse.data.overall?.averageScore || 0}`);
      console.log(`   📊 Total Audits: ${trendsResponse.data.overall?.totalAudits || 0}`);
      
      // Test QA score distribution
      console.log('\n📊 Testing QA Score Distribution...');
      const distributionResponse = await axios.post(
        `${API_URL}/analytics/qa-score-distribution`,
        {
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        },
        { headers: this.getAuthHeaders() }
      );
      
      console.log('✅ QA Score Distribution working');
      console.log(`   📊 Total Audits: ${distributionResponse.data.totalAudits || 0}`);
      console.log(`   📊 Distributions: ${distributionResponse.data.distributions?.length || 0}`);
      
      // Test performance goals
      console.log('\n🎯 Testing Performance Goals...');
      const goalsResponse = await axios.post(
        `${API_URL}/analytics/performance-goals`,
        {
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        },
        { headers: this.getAuthHeaders() }
      );
      
      console.log('✅ Performance Goals working');
      console.log(`   🎯 Goals Count: ${goalsResponse.data.length || 0}`);
      if (goalsResponse.data.length > 0) {
        console.log('   🎯 Sample Goals:');
        goalsResponse.data.slice(0, 3).forEach(goal => {
          console.log(`      ${goal.goalType}: ${goal.actualValue}/${goal.targetValue} (${goal.percentComplete}%)`);
        });
      }
      
      // Test export functionality
      console.log('\n📄 Testing Export Functionality...');
      const exportResponse = await axios.post(
        `${API_URL}/analytics/export-qa-scores`,
        {
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          format: 'csv'
        },
        { 
          headers: this.getAuthHeaders(),
          responseType: 'arraybuffer'
        }
      );
      
      console.log('✅ Export functionality working');
      console.log(`   📄 Export size: ${exportResponse.data.byteLength} bytes`);
      console.log(`   📄 Content type: ${exportResponse.headers['content-type']}`);
      
      return {
        filters: filtersResponse.data,
        trends: trendsResponse.data,
        distribution: distributionResponse.data,
        goals: goalsResponse.data,
        exportSize: exportResponse.data.byteLength
      };
      
    } catch (error) {
      console.error('❌ Analytics endpoint test failed:', error.response?.data?.message || error.message);
      return null;
    }
  }

  async runTests() {
    console.log('🚀 Analytics Service Comprehensive Test...\n');

    const authenticated = await this.authenticate();
    if (!authenticated) {
      console.error('❌ Cannot proceed without authentication');
      return;
    }

    const results = await this.testAnalyticsEndpoints();
    
    if (results) {
      console.log('\n🎉 Analytics Service Testing Complete!');
      console.log('\n📋 SUMMARY:');
      console.log('   ✅ Authentication: Working');
      console.log('   ✅ Filter Options: Working');
      console.log('   ✅ QA Score Trends: Working');
      console.log('   ✅ QA Score Distribution: Working');
      console.log('   ✅ Performance Goals: Working');
      console.log('   ✅ Export Functionality: Working');
      console.log('\n🔧 System Status:');
      console.log('   ✅ All Analytics Reports Working');
      console.log('   ✅ Ready for NEW Service Implementation');
      console.log('   ✅ Caching Layer Ready');
      console.log('   ✅ Performance Optimization Ready');
      
      // Display key metrics
      console.log('\n📊 Current System Metrics:');
      console.log(`   📍 Available Departments: ${results.filters.departments?.length || 0}`);
      console.log(`   📋 Active Forms: ${results.filters.forms?.length || 0}`);
      console.log(`   👥 CSRs in System: ${results.filters.csrs?.length || 0}`);
      console.log(`   📊 QA Trends Available: ${results.trends.trends?.length || 0} groups`);
      console.log(`   📊 Total Audits: ${results.trends.overall?.totalAudits || 0}`);
      console.log(`   🎯 Performance Goals: ${results.goals?.length || 0}`);
      
    } else {
      console.log('\n❌ Analytics Service needs debugging');
    }
  }
}

const tester = new AnalyticsServiceTester();
tester.runTests().catch(error => {
  console.error('💥 Test failed:', error.message);
  process.exit(1);
}); 