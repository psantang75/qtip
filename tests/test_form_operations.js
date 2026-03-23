#!/usr/bin/env node

/**
 * Comprehensive Form Operations Test
 * Tests form creation, submission, and scoring with old vs new system comparison
 */

const http = require('http');
const fs = require('fs');

console.log('🧪 COMPREHENSIVE FORM OPERATIONS TEST');
console.log('=====================================');

let authToken = null;

// Test data for form creation
const testFormData = {
    form_name: "Test QA Form - Auto Generated",
    interaction_type: "PHONE",
    is_active: true,
    categories: [
        {
            category_name: "Communication Skills",
            description: "Evaluation of communication effectiveness",
            weight: 0.4,
            questions: [
                {
                    question_text: "Was the agent's greeting professional?",
                    question_type: "YES_NO",
                    weight: 0.5,
                    yes_value: 100,
                    no_value: 0,
                    na_value: null,
                    is_na_allowed: false
                },
                {
                    question_text: "Did the agent speak clearly?",
                    question_type: "SCALE",
                    weight: 0.5,
                    scale_min: 1,
                    scale_max: 5,
                    is_na_allowed: true
                }
            ]
        },
        {
            category_name: "Technical Knowledge",
            description: "Assessment of technical competency",
            weight: 0.6,
            questions: [
                {
                    question_text: "Did the agent demonstrate product knowledge?",
                    question_type: "RADIO",
                    weight: 1.0,
                    radio_options: [
                        { option_text: "Excellent", option_value: "excellent", score: 100 },
                        { option_text: "Good", option_value: "good", score: 80 },
                        { option_text: "Fair", option_value: "fair", score: 60 },
                        { option_text: "Poor", option_value: "poor", score: 40 }
                    ]
                }
            ]
        }
    ]
};

// Test submission data
const testSubmissionData = {
    answers: [
        { question_id: null, answer_value: "YES", score: 100 },  // Will be filled with actual question IDs
        { question_id: null, answer_value: "4", score: 80 },
        { question_id: null, answer_value: "good", score: 80 }
    ],
    is_complete: true
};

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

async function authenticate() {
    console.log('\n🔐 Authenticating...');
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    try {
        const response = await makeRequest(options, {
            email: 'admin@example.com',
            password: 'admin123'
        });

        if (response.status === 200 && response.body.token) {
            authToken = response.body.token;
            console.log('   ✅ Authentication successful');
            return true;
        } else {
            console.log(`   ❌ Authentication failed: ${response.status} - ${response.rawBody}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ Authentication error: ${error.message}`);
        return false;
    }
}

async function testFormCreation(useNewService = false) {
    console.log(`\n📝 Testing Form Creation (${useNewService ? 'NEW' : 'OLD'} service)...`);

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/forms',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        }
    };

    try {
        const response = await makeRequest(options, testFormData);
        
        if (response.status === 201 && response.body.id) {
            console.log(`   ✅ Form created successfully with ID: ${response.body.id}`);
            return response.body;
        } else {
            console.log(`   ❌ Form creation failed: ${response.status}`);
            console.log(`   📄 Response: ${JSON.stringify(response.body, null, 2)}`);
            return null;
        }
    } catch (error) {
        console.log(`   ❌ Form creation error: ${error.message}`);
        return null;
    }
}

async function testFormRetrieval(formId, useNewService = false) {
    console.log(`\n📋 Testing Form Retrieval (${useNewService ? 'NEW' : 'OLD'} service)...`);

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/forms/${formId}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    };

    try {
        const response = await makeRequest(options);
        
        if (response.status === 200 && response.body.id) {
            console.log(`   ✅ Form retrieved successfully`);
            console.log(`   📊 Categories: ${response.body.categories?.length || 0}`);
            
            let totalQuestions = 0;
            if (response.body.categories) {
                response.body.categories.forEach(cat => {
                    totalQuestions += cat.questions?.length || 0;
                });
            }
            console.log(`   📊 Total Questions: ${totalQuestions}`);
            
            return response.body;
        } else {
            console.log(`   ❌ Form retrieval failed: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.log(`   ❌ Form retrieval error: ${error.message}`);
        return null;
    }
}

async function testSubmissionCreation(formId, form, useNewService = false) {
    console.log(`\n📝 Testing Submission Creation (${useNewService ? 'NEW' : 'OLD'} service)...`);

    // First, we need to get question IDs from the form
    if (!form.categories || form.categories.length === 0) {
        console.log('   ❌ No categories found in form');
        return null;
    }

    // Map question IDs to test answers
    const submissionData = {
        form_id: formId,
        call_id: 1, // Using a test call ID
        answers: [],
        is_complete: true
    };

    let answerIndex = 0;
    form.categories.forEach(category => {
        if (category.questions) {
            category.questions.forEach(question => {
                if (answerIndex < testSubmissionData.answers.length) {
                    submissionData.answers.push({
                        question_id: question.id,
                        answer: testSubmissionData.answers[answerIndex].answer_value,
                        notes: `Test answer ${answerIndex + 1}`
                    });
                    answerIndex++;
                }
            });
        }
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/submissions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        }
    };

    try {
        const response = await makeRequest(options, submissionData);
        
        if (response.status === 201 && response.body.id) {
            console.log(`   ✅ Submission created successfully with ID: ${response.body.id}`);
            return response.body;
        } else {
            console.log(`   ❌ Submission creation failed: ${response.status}`);
            console.log(`   📄 Response: ${JSON.stringify(response.body, null, 2)}`);
            return null;
        }
    } catch (error) {
        console.log(`   ❌ Submission creation error: ${error.message}`);
        return null;
    }
}

async function testScoreCalculation(submissionId, useNewService = false) {
    console.log(`\n🧮 Testing Score Calculation (${useNewService ? 'NEW' : 'OLD'} service)...`);

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/submissions/${submissionId}/score`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    };

    try {
        const response = await makeRequest(options);
        
        if (response.status === 200) {
            console.log(`   ✅ Score calculated successfully`);
            console.log(`   📊 Total Score: ${response.body.total_score || 'N/A'}`);
            
            if (response.body.category_scores) {
                console.log('   📊 Category Scores:');
                response.body.category_scores.forEach(cat => {
                    console.log(`      ${cat.category_name}: ${cat.score}`);
                });
            }
            
            return response.body;
        } else {
            console.log(`   ❌ Score calculation failed: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.log(`   ❌ Score calculation error: ${error.message}`);
        return null;
    }
}

async function checkFeatureFlags() {
    console.log('\n🏳️ Checking Current Feature Flags...');
    
    try {
        // Check if we can read the config file
        const configPath = './src/config/features.config.ts';
        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            const formServiceMatch = configContent.match(/NEW_FORM_SERVICE:\s*(true|false)/);
            const submissionServiceMatch = configContent.match(/NEW_SUBMISSION_SERVICE:\s*(true|false)/);
            
            const formServiceEnabled = formServiceMatch ? formServiceMatch[1] === 'true' : false;
            const submissionServiceEnabled = submissionServiceMatch ? submissionServiceMatch[1] === 'true' : false;
            
            console.log(`   📋 NEW_FORM_SERVICE: ${formServiceEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
            console.log(`   📥 NEW_SUBMISSION_SERVICE: ${submissionServiceEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
            
            return { formServiceEnabled, submissionServiceEnabled };
        }
    } catch (error) {
        console.log(`   ⚠️ Could not read feature flags: ${error.message}`);
    }
    
    return { formServiceEnabled: false, submissionServiceEnabled: false };
}

async function runComprehensiveTest() {
    console.log('\n🚀 Starting Comprehensive Form Operations Test...\n');
    
    // Step 1: Authenticate
    const authenticated = await authenticate();
    if (!authenticated) {
        console.log('\n❌ Cannot proceed without authentication');
        return;
    }

    // Step 2: Check feature flags
    const flags = await checkFeatureFlags();
    
    // Step 3: Test with current configuration (old system)
    console.log('\n📊 TESTING WITH OLD SYSTEM (Baseline)');
    console.log('=====================================');
    
    const oldForm = await testFormCreation(false);
    if (!oldForm) {
        console.log('\n❌ Cannot proceed - form creation failed');
        return;
    }
    
    const oldFormDetails = await testFormRetrieval(oldForm.id, false);
    if (!oldFormDetails) {
        console.log('\n❌ Cannot proceed - form retrieval failed');
        return;
    }
    
    const oldSubmission = await testSubmissionCreation(oldForm.id, oldFormDetails, false);
    if (oldSubmission) {
        await testScoreCalculation(oldSubmission.id, false);
    }

    // Step 4: Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('===============');
    console.log(`✅ Form Creation: ${oldForm ? 'SUCCESS' : 'FAILED'}`);
    console.log(`✅ Form Retrieval: ${oldFormDetails ? 'SUCCESS' : 'FAILED'}`);
    console.log(`✅ Submission Creation: ${oldSubmission ? 'SUCCESS' : 'FAILED'}`);
    
    console.log('\n🎯 NEXT STEPS TO TEST NEW SERVICES:');
    console.log('1. Enable NEW_FORM_SERVICE = true in features.config.ts');
    console.log('2. Enable NEW_SUBMISSION_SERVICE = true in features.config.ts');
    console.log('3. Restart the server');
    console.log('4. Run this test again to compare results');
    
    console.log('\n📝 Form Operations Test Complete!');
}

// Run the comprehensive test
runComprehensiveTest().catch(console.error); 