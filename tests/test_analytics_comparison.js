const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// Test configuration
const TEST_CONFIG = {
  email: 'admin1@test.com',
  password: 'Pass1234',
  runs: 3, // Number of performance test runs
};

let authToken = '';

// Utility function to make authenticated requests
const makeRequest = async (method, endpoint, data = null) => {
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
  
  return axios(config);
};

// Performance measurement utility
const measurePerformance = async (testName, testFunction) => {
  const results = [];
  
  for (let i = 0; i < TEST_CONFIG.runs; i++) {
    const start = Date.now();
    try {
      const result = await testFunction();
      const duration = Date.now() - start;
      results.push({ success: true, duration, result });
    } catch (error) {
      const duration = Date.now() - start;
      results.push({ success: false, duration, error: error.message });
    }
  }
  
  const successful = results.filter(r => r.success);
  const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
  const minDuration = Math.min(...successful.map(r => r.duration));
  const maxDuration = Math.max(...successful.map(r => r.duration));
  
  return {
    testName,
    runs: TEST_CONFIG.runs,
    successful: successful.length,
    failed: results.length - successful.length,
    avgDuration: Math.round(avgDuration),
    minDuration,
    maxDuration,
    results: results[0]?.result // Return first successful result for comparison
  };
};

// Test data comparison utility
const compareResults = (oldResult, newResult, testName) => {
  console.log(`\n📊 COMPARING RESULTS: ${testName}`);
  
  if (!oldResult || !newResult) {
    console.log('❌ Cannot compare - missing results');
    return false;
  }
  
  // Helper function to deeply compare objects
  const deepEqual = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    
    if (typeof a === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      
      if (keysA.length !== keysB.length) return false;
      
      for (let key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
      }
      return true;
    }
    
    return false;
  };
  
  const isEqual = deepEqual(oldResult, newResult);
  
  if (isEqual) {
    console.log('✅ Data matches exactly');
  } else {
    console.log('❌ Data differences detected');
    console.log('OLD Result:', JSON.stringify(oldResult, null, 2));
    console.log('NEW Result:', JSON.stringify(newResult, null, 2));
  }
  
  return isEqual;
};

// Test functions for each analytics endpoint
const testFilterOptions = async () => {
  const response = await makeRequest('GET', '/analytics/filters');
  return response.data;
};

const testQAScoreTrends = async () => {
  const filters = {
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    departments: [],
    users: []
  };
  const response = await makeRequest('POST', '/analytics/qa-score-trends', filters);
  return response.data;
};

const testQAScoreDistribution = async () => {
  const filters = {
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    departments: [],
    users: []
  };
  const response = await makeRequest('POST', '/analytics/qa-score-distribution', filters);
  return response.data;
};

const testPerformanceGoals = async () => {
  const filters = {
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    departments: [],
    users: []
  };
  const response = await makeRequest('POST', '/analytics/performance-goals', filters);
  return response.data;
};

const testExportCSV = async () => {
  const filters = {
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    departments: [],
    users: [],
    format: 'csv'
  };
  const response = await makeRequest('POST', '/analytics/export-qa-scores', filters);
  return response.data;
};

// Main comparison function
const runComparison = async () => {
  console.log('🚀 QTIP Analytics System Comparison');
  console.log('=====================================');
  
  try {
    // Authenticate
    console.log('\n🔐 Authenticating...');
    const authResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: TEST_CONFIG.email,
      password: TEST_CONFIG.password
    });
    
    if (authResponse.data.token) {
      authToken = authResponse.data.token;
      console.log('✅ Authentication successful');
    } else {
      throw new Error('Failed to get auth token');
    }
    
    const testSuites = [
      { name: 'Filter Options', testFn: testFilterOptions },
      { name: 'QA Score Trends', testFn: testQAScoreTrends },
      { name: 'QA Score Distribution', testFn: testQAScoreDistribution },
      { name: 'Performance Goals', testFn: testPerformanceGoals },
      { name: 'Export CSV', testFn: testExportCSV }
    ];
    
    const results = {
      old: {},
      new: {},
      performance: {},
      accuracy: {}
    };
    
    // Test OLD system (feature flag OFF)
    console.log('\n📊 TESTING OLD ANALYTICS SYSTEM');
    console.log('=================================');
    
    for (const suite of testSuites) {
      console.log(`\n🧪 Testing ${suite.name} (OLD)...`);
      const perf = await measurePerformance(`OLD ${suite.name}`, suite.testFn);
      results.old[suite.name] = perf;
      
      console.log(`   ⏱️  Avg: ${perf.avgDuration}ms, Min: ${perf.minDuration}ms, Max: ${perf.maxDuration}ms`);
      console.log(`   📈 Success: ${perf.successful}/${perf.runs}`);
    }
    
    // Switch to NEW system
    console.log('\n🔄 SWITCHING TO NEW ANALYTICS SERVICE...');
    await makeRequest('POST', '/admin/feature-flags', { 
      feature: 'NEW_ANALYTICS_SERVICE', 
      enabled: true 
    }).catch(() => {
      console.log('⚠️  Manual feature flag switching required');
      console.log('   Please set NEW_ANALYTICS_SERVICE to true in features.config.ts');
      console.log('   Then restart the server and run this script again with --new-only flag');
    });
    
    // Wait a moment for the change to take effect
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test NEW system (feature flag ON)
    console.log('\n📊 TESTING NEW ANALYTICS SERVICE');
    console.log('=================================');
    
    for (const suite of testSuites) {
      console.log(`\n🧪 Testing ${suite.name} (NEW)...`);
      const perf = await measurePerformance(`NEW ${suite.name}`, suite.testFn);
      results.new[suite.name] = perf;
      
      console.log(`   ⏱️  Avg: ${perf.avgDuration}ms, Min: ${perf.minDuration}ms, Max: ${perf.maxDuration}ms`);
      console.log(`   📈 Success: ${perf.successful}/${perf.runs}`);
    }
    
    // Compare results
    console.log('\n📋 ACCURACY COMPARISON');
    console.log('======================');
    
    let allAccurate = true;
    for (const suite of testSuites) {
      const oldResult = results.old[suite.name]?.results;
      const newResult = results.new[suite.name]?.results;
      const isAccurate = compareResults(oldResult, newResult, suite.name);
      results.accuracy[suite.name] = isAccurate;
      if (!isAccurate) allAccurate = false;
    }
    
    // Performance comparison
    console.log('\n⚡ PERFORMANCE COMPARISON');
    console.log('========================');
    
    for (const suite of testSuites) {
      const oldPerf = results.old[suite.name];
      const newPerf = results.new[suite.name];
      
      if (oldPerf && newPerf) {
        const improvement = ((oldPerf.avgDuration - newPerf.avgDuration) / oldPerf.avgDuration * 100);
        const status = improvement > 0 ? '🚀 FASTER' : improvement < -10 ? '🐌 SLOWER' : '➡️  SIMILAR';
        
        console.log(`\n${suite.name}:`);
        console.log(`   OLD: ${oldPerf.avgDuration}ms avg`);
        console.log(`   NEW: ${newPerf.avgDuration}ms avg`);
        console.log(`   ${status}: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
        
        results.performance[suite.name] = {
          oldAvg: oldPerf.avgDuration,
          newAvg: newPerf.avgDuration,
          improvement: improvement
        };
      }
    }
    
    // Summary
    console.log('\n📊 FINAL SUMMARY');
    console.log('================');
    console.log(`✅ Data Accuracy: ${allAccurate ? 'PASSED' : 'FAILED'}`);
    
    const avgImprovement = Object.values(results.performance)
      .reduce((sum, p) => sum + p.improvement, 0) / Object.keys(results.performance).length;
    
    console.log(`⚡ Performance: ${avgImprovement > 0 ? '+' : ''}${avgImprovement.toFixed(1)}% average improvement`);
    
    if (allAccurate && avgImprovement >= 0) {
      console.log('\n🎉 MIGRATION READY: New system maintains accuracy and improves/maintains performance!');
    } else if (allAccurate) {
      console.log('\n⚠️  REVIEW NEEDED: Accurate but slower performance');
    } else {
      console.log('\n❌ ISSUES FOUND: Data accuracy problems detected');
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Comparison failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    throw error;
  }
};

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`
Analytics Comparison Tool

Usage: node test_analytics_comparison.js [options]

Options:
  --help          Show this help
  --new-only      Test only the new system (assumes feature flag is already enabled)
  --old-only      Test only the old system

Example:
  node test_analytics_comparison.js          # Full comparison
  node test_analytics_comparison.js --new-only  # Test new system only
`);
  process.exit(0);
}

// Run the comparison
if (require.main === module) {
  runComparison()
    .then(() => {
      console.log('\n✅ Comparison completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Comparison failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runComparison }; 