import React from 'react';
import { BarChart3 } from 'lucide-react';

const TrainerReports: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center">
            <BarChart3 className="h-16 w-16 mx-auto mb-6 text-gray-400" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Add Admin Analytics Section Here
            </h1>
            <p className="text-gray-500">
              This section is reserved for future analytics functionality.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrainerReports; 