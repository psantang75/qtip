const axios = require('axios');

// Function to test login with incorrect credentials
async function testDetailedLogin() {
  try {
    console.log('Testing login with incorrect credentials...');
    console.log('----------------------------------------------');
    
    const response = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'test@example.com',
      password: 'wrongpassword'
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    console.log('ERROR: Login should have failed but succeeded!');
    
  } catch (error) {
    console.log('Login failed as expected.');
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log('Response status:', error.response.status);
      console.log('Response headers:', error.response.headers);
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
      
      // Check if the error message object is what we expect
      console.log('\nResponse data type:', typeof error.response.data);
      if (typeof error.response.data === 'object') {
        console.log('Response data keys:', Object.keys(error.response.data));
        console.log('Has error property:', 'error' in error.response.data);
        if ('error' in error.response.data) {
          console.log('Error value:', error.response.data.error);
          console.log('Error value type:', typeof error.response.data.error);
        }
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response from server. Request details:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
    }
  }
}

// Run the test
testDetailedLogin(); 