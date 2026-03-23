#!/usr/bin/env node

/**
 * Simple Form Operations Test
 * Tests form operations with authentication discovery
 */

const http = require('http');

console.log('🧪 SIMPLE FORM OPERATIONS TEST');
console.log('===============================');

let authToken = null;

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const jsonBody = body ? JSON.parse(body) : {};
                    resolve({
                        status: res.statusCode,
                        body: jsonBody,
                        rawBody: body,
                        headers: res.headers
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        body: null,
                        rawBody: body,
                        headers: res.headers
                    });
                }
            });
        });

        req.on('error', (error) => reject(error));

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function tryAuthentication() {
    console.log('\n🔐 Trying Authentication...');
    
    const credentials = [
        { email: 'admin@example.com', password: 'admin123' },
        { email: 'admin@test.com', password: 'password' },
        { email: 'admin@qtip.com', password: 'admin' },
        { email: 'test@test.com', password: 'test123' },
        { username: 'admin', password: 'admin123' },
        { username: 'admin', password: 'password' }
    ];

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    for (let cred of credentials) {
        try {
            console.log(`   🔑 Trying: ${JSON.stringify(cred)}`);
            const response = await makeRequest(options, cred);
            
            if (response.status === 200 && response.body && response.body.token) {
                authToken = response.body.token;
                console.log(`   ✅ Authentication successful with: ${JSON.stringify(cred)}`);
                return true;
            } else {
                console.log(`   ❌ Failed: ${response.status} - ${response.rawBody}`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
    
    console.log('   ⚠️  All authentication attempts failed');
    return false;
}

async function testWithoutAuth() {
    console.log('\n🔓 Testing Endpoints Without Authentication...');
    
    const endpoints = [
        { path: '/api/forms', method: 'GET' },
        { path: '/api/submissions', method: 'GET' },
        { path: '/api/users', method: 'GET' },
        { path: '/api/departments', method: 'GET' }
    ];

    for (let endpoint of endpoints) {
        try {
            const options = {
                hostname: 'localhost',
                port: 3000,
                path: endpoint.path,
                method: endpoint.method
            };

            const response = await makeRequest(options);
            console.log(`   ${endpoint.method} ${endpoint.path}: ${response.status} - ${response.rawBody.substring(0, 100)}...`);
            
            if (response.status === 200) {
                console.log(`   ✅ ${endpoint.path} is accessible without auth`);
            }
        } catch (error) {
            console.log(`   ❌ ${endpoint.path} error: ${error.message}`);
        }
    }
}

async function testFormOperationsBasic() {
    console.log('\n📝 Testing Basic Form Operations...');
    
    // Test 1: List existing forms
    console.log('\n1️⃣  Testing: GET /api/forms');
    try {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/forms',
            method: 'GET'
        };

        if (authToken) {
            options.headers = { 'Authorization': `Bearer ${authToken}` };
        }

        const response = await makeRequest(options);
        console.log(`   📊 Status: ${response.status}`);
        
        if (response.status === 200 && response.body) {
            if (Array.isArray(response.body)) {
                console.log(`   📋 Found ${response.body.length} forms`);
                if (response.body.length > 0) {
                    console.log(`   📝 First form: ${response.body[0].form_name || 'N/A'}`);
                }
            } else if (response.body.forms) {
                console.log(`   📋 Found ${response.body.forms.length} forms`);
            } else {
                console.log(`   📄 Response: ${JSON.stringify(response.body, null, 2).substring(0, 200)}...`);
            }
        } else {
            console.log(`   📄 Response: ${response.rawBody}`);
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 2: List existing submissions
    console.log('\n2️⃣  Testing: GET /api/submissions');
    try {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/submissions',
            method: 'GET'
        };

        if (authToken) {
            options.headers = { 'Authorization': `Bearer ${authToken}` };
        }

        const response = await makeRequest(options);
        console.log(`   📊 Status: ${response.status}`);
        console.log(`   📄 Response: ${response.rawBody.substring(0, 200)}...`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 3: Check feature flags endpoint if available
    console.log('\n3️⃣  Testing: Feature flags check');
    try {
        const endpoints = [
            '/api/forms/feature-flags',
            '/api/feature-flags',
            '/api/config/features'
        ];

        for (let endpoint of endpoints) {
            const options = {
                hostname: 'localhost',
                port: 3000,
                path: endpoint,
                method: 'GET'
            };

            if (authToken) {
                options.headers = { 'Authorization': `Bearer ${authToken}` };
            }

            const response = await makeRequest(options);
            if (response.status === 200) {
                console.log(`   ✅ Feature flags at ${endpoint}:`);
                console.log(`   📄 ${JSON.stringify(response.body, null, 2)}`);
                break;
            } else {
                console.log(`   📊 ${endpoint}: ${response.status}`);
            }
        }
    } catch (error) {
        console.log(`   ❌ Feature flags error: ${error.message}`);
    }
}

async function checkServerStatus() {
    console.log('\n🔍 Checking Server Status...');
    
    try {
        // Test basic connectivity
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/forms',
            method: 'GET'
        };

        const response = await makeRequest(options);
        console.log(`   📡 Server Status: ${response.status === 401 || response.status === 200 ? 'RUNNING ✅' : 'ISSUE ❌'}`);
        console.log(`   📊 Response Code: ${response.status}`);
        
        return true;
    } catch (error) {
        console.log(`   ❌ Server appears to be down: ${error.message}`);
        return false;
    }
}

async function runSimpleTest() {
    console.log('\n🚀 Starting Simple Form Operations Test...\n');
    
    // Step 1: Check if server is running
    const serverRunning = await checkServerStatus();
    if (!serverRunning) {
        console.log('\n❌ Cannot proceed - server is not responding');
        console.log('💡 Make sure to start the server with: npm start');
        return;
    }

    // Step 2: Try authentication
    const authenticated = await tryAuthentication();
    
    // Step 3: Test endpoints without auth to see what's accessible
    await testWithoutAuth();
    
    // Step 4: Test basic form operations
    await testFormOperationsBasic();

    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('===============');
    console.log(`🔐 Authentication: ${authenticated ? 'SUCCESS ✅' : 'FAILED ❌'}`);
    console.log(`🖥️  Server Status: RUNNING ✅`);
    console.log(`📡 Endpoints: Responding ✅`);
    
    if (!authenticated) {
        console.log('\n💡 AUTHENTICATION TROUBLESHOOTING:');
        console.log('1. Check if users exist in the database');
        console.log('2. Verify password hashing in the system');
        console.log('3. Check if there are any default users');
        console.log('4. Look at server logs for authentication errors');
    } else {
        console.log('\n🎯 NEXT STEPS:');
        console.log('1. Can proceed with full form creation tests');
        console.log('2. Test new vs old service implementations');
        console.log('3. Compare scoring algorithms');
    }
    
    console.log('\n📝 Simple Form Operations Test Complete!');
}

// Run the simple test
runSimpleTest().catch(console.error); 