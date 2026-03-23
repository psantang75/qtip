const axios = require('axios');

// Function to test login with correct credentials
async function testLoginSuccess() {
  try {
    console.log('Testing login with correct credentials...');
    
    // Using admin credentials - update these if needed
    const response = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@example.com',
      password: 'adminpass'
    });
    
    console.log('Login successful!');
    console.log('Status:', response.status);
    console.log('User information:', {
      id: response.data.user.id,
      username: response.data.user.username,
      email: response.data.user.email,
      role_id: response.data.user.role_id
    });
    console.log('Token received:', response.data.token ? 'Yes (token hidden for security)' : 'No');
    
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error response:', {
        status: error.response.status,
        data: error.response.data
      });
      
      console.error('❌ Login failed with correct credentials');
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response from server:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
    }
  }
}

// Run the test
testLoginSuccess(); 