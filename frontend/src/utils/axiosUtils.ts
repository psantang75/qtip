import axios from 'axios';

/**
 * Helper function to create an axios instance with authorization headers
 * @returns Axios instance with auth headers
 */
export const getAuthorizedAxios = () => {
  const token = localStorage.getItem('token');
  return axios.create({
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  });
}; 