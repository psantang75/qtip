import React, { useState } from 'react';
import TrainerAssignTraining from '../components/TrainerAssignTraining';

interface LMSTrainerWorkflowPageProps {
  initialTab?: 'courses' | 'paths';
}

// Simple placeholder component for Training Path Management
const TrainingPathManager: React.FC = () => {
  return (
    <div className="bg-white shadow-md rounded-lg p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Training Path Management</h2>
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              Training Path Management
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                Training Path Management functionality is being developed. 
                In the meantime, you can use the Course Management tab to manage individual courses.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LMSTrainerWorkflowPage: React.FC<LMSTrainerWorkflowPageProps> = ({ initialTab = 'courses' }) => {
  const [activeTab, setActiveTab] = useState<'courses' | 'paths'>(initialTab);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">LMS Trainer Workflow</h1>
        
        <div className="bg-white shadow-md rounded-lg mb-8">
          <div className="flex border-b">
            <button
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'courses'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab('courses')}
            >
              Course Management
            </button>
            <button
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'paths'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab('paths')}
            >
              Training Path Management
            </button>
          </div>
        </div>
        
        {activeTab === 'courses' ? (
          <TrainerAssignTraining />
        ) : (
          <TrainingPathManager />
        )}
      </div>
    </div>
  );
};

export default LMSTrainerWorkflowPage; 