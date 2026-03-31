import { api } from './authService';

// Types for Topic Management
export interface Topic {
  id: number;
  topic_name: string;
  is_active: boolean;
  sort_order: number;
  category?: string;
  created_at: string;
  updated_at: string;
}

export interface TopicCreateDTO {
  topic_name: string;
  is_active?: boolean;
  sort_order?: number;
  category?: string;
}

export interface TopicUpdateDTO {
  topic_name?: string;
  is_active?: boolean;
  sort_order?: number;
  category?: string;
}

export interface TopicFilters {
  is_active?: boolean;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

export interface SortOrderUpdate {
  id: number;
  sort_order: number;
}

// Helper function to get the shared axios instance
const getAuthorizedAxios = () => {
  return api;
};

// Topic management service functions
const topicService = {
  // Get topics with pagination and filters
  getTopics: async (
    page: number = 1,
    limit: number = 20,
    filters?: TopicFilters
  ): Promise<PaginatedResponse<Topic>> => {
    try {
      let url = `/topics?page=${page}&limit=${limit}`;

      // Add filters to URL if they exist
      if (filters) {
        if (filters.is_active !== undefined) url += `&is_active=${filters.is_active}`;
        if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`;
      }

      const api = getAuthorizedAxios();
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching topics:', error);
      throw error;
    }
  },

  // Get a single topic by ID
  getTopicById: async (topicId: number): Promise<Topic> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/topics/${topicId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching topic with ID ${topicId}:`, error);
      throw error;
    }
  },

  // Create a new topic
  createTopic: async (topicData: TopicCreateDTO): Promise<Topic> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/topics', topicData);
      return response.data;
    } catch (error) {
      console.error('Error creating topic:', error);
      throw error;
    }
  },

  // Update a topic
  updateTopic: async (topicId: number, topicData: TopicUpdateDTO): Promise<Topic> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/topics/${topicId}`, topicData);
      return response.data;
    } catch (error) {
      console.error(`Error updating topic with ID ${topicId}:`, error);
      throw error;
    }
  },

  // Toggle topic activation status
  toggleTopicStatus: async (topicId: number, isActive: boolean): Promise<Topic> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/topics/${topicId}/status`, { is_active: isActive });
      return response.data;
    } catch (error) {
      console.error(`Error toggling status for topic with ID ${topicId}:`, error);
      throw error;
    }
  },

  // Update sort order for multiple topics
  updateSortOrder: async (topics: SortOrderUpdate[]): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.put('/topics/sort-order', { topics });
    } catch (error) {
      console.error('Error updating sort order:', error);
      throw error;
    }
  }
};

export default topicService;
