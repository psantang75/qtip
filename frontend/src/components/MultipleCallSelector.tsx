import React, { useState, useEffect } from 'react';
import { HiPlus, HiX, HiInformationCircle } from 'react-icons/hi';
import Button from './ui/Button';
import ErrorDisplay from './ui/ErrorDisplay';
import callService from '../services/callService';
import { formatTranscriptText } from '../utils/transcriptUtils';

interface Call {
  id: number;
  call_id: string;
  csr_id: number;
  customer_id: string | null;
  call_date: string;
  duration: number;
  recording_url: string | null;
  transcript: string | null;
  csr_name?: string;
  customer_name?: string;
}

interface MultipleCallSelectorProps {
  selectedCalls: Call[];
  onCallsChange: (calls: Call[]) => void;
  disabled?: boolean;
}

const MultipleCallSelector: React.FC<MultipleCallSelectorProps> = ({
  selectedCalls,
  onCallsChange,
  disabled = false
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [callDate, setCallDate] = useState(''); // Add call date state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddCall = async () => {
    if (!conversationId.trim()) {
      setError('Please enter a conversation ID');
      return;
    }

    if (!callDate.trim()) {
      setError('Please select a call date');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if this conversation ID is already used in any submission
      const submissionCheck = await callService.checkConversationIdInSubmissions(conversationId.trim());
      
      if (submissionCheck.exists) {
        const submissionDetails = submissionCheck.submissions[0];
        setError(`This conversation ID is already used in submission #${submissionDetails.submission_id} (${submissionDetails.form_name})`);
        return;
      }

      // Search for call by external_id (conversation ID)
      const calls = await callService.searchCalls({
        external_id: conversationId.trim()
      });

      if (calls.length === 0) {
        setError(`No call found with conversation ID: ${conversationId}`);
        return;
      }

      const call = calls[0];

      // Check if call is already selected - compare by call_id (conversation ID)
      if (selectedCalls.some(selectedCall => selectedCall.call_id === call.call_id)) {
        setError(`Call with conversation ID "${call.call_id}" is already added to the submission`);
        return;
      }

      // Create call object with selected date
      const callWithDate = {
        ...call,
        call_date: callDate // Keep as YYYY-MM-DD format to avoid timezone issues
      };

      // Add call to selected calls
      const updatedCalls = [...selectedCalls, callWithDate];
      onCallsChange(updatedCalls);

      // Reset form
      setConversationId('');
      setCallDate(''); // Reset date
      setIsModalOpen(false);
      setError(null);

    } catch (error) {
      console.error('Error adding call:', error);
      setError('Failed to add call. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCall = (callId: number) => {
    const updatedCalls = selectedCalls.filter(call => call.id !== callId);
    onCallsChange(updatedCalls);
  };

  const formatCallDate = (dateString: string) => {
    // Handle date formatting to avoid timezone issues
    if (!dateString) return 'No date';
    
    // If it's already a date string in YYYY-MM-DD format, format it directly
    if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = dateString.split('-');
      return `${month}/${day}/${year}`;
    }
    
    // Otherwise, parse as Date and format
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    
    return date.toLocaleDateString();
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="space-y-4">
      {/* Selected Calls List */}
      {selectedCalls.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
          <HiInformationCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 mb-2 font-medium">No calls added yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Add calls by entering conversation IDs to associate them with this submission
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            disabled={disabled}
          >
            <HiPlus className="h-4 w-4 mr-1" />
            Add Your First Call
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {selectedCalls.map((call, index) => (
            <div
              key={call.id}
              className="p-4 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
            >
              {/* Header Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-blue-600">
                        {index + 1}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {call.call_id}
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        {formatDuration(call.duration)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                      <span>{formatCallDate(call.call_date)}</span>
                      {call.customer_id && (
                        <span>Customer: {call.customer_id}</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveCall(call.id)}
                  disabled={disabled}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                >
                  <HiX className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Audio and Transcript Information */}
              <div className="space-y-4">
                {/* Audio Control */}
                {call.recording_url && (
                  <div>
                    <span className="text-xs font-medium text-gray-700 block mb-2">Audio:</span>
                    <audio controls className="w-full h-10">
                      <source src={call.recording_url} type="audio/mpeg" />
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
                
                {/* Complete Transcript */}
                {call.transcript && (
                  <div>
                    <span className="text-xs font-medium text-gray-700 block mb-2">Transcript:</span>
                    <div className="max-h-80 overflow-y-auto border border-gray-200 rounded p-3 bg-gray-50">
                      <div 
                        className="text-xs text-gray-800 whitespace-pre-wrap break-words leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }}
                      />
                    </div>
                  </div>
                )}
                
                {/* No audio/transcript message */}
                {!call.recording_url && !call.transcript && (
                  <div className="text-xs text-gray-500 italic">
                    No audio recording or transcript available
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add another call button when calls are already selected */}
      {selectedCalls.length > 0 && (
        <div className="text-center pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            disabled={disabled}
          >
            <HiPlus className="h-4 w-4 mr-1" />
            Add Another Call
          </Button>
        </div>
      )}

      {/* Add Call Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Add Call</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsModalOpen(false);
                  setConversationId('');
                  setCallDate(''); // Reset date
                  setError(null);
                }}
              >
                <HiX className="h-5 w-5" />
              </Button>
            </div>

            {error && (
              <ErrorDisplay
                message={error}
                variant="inline"
                className="mb-4"
              />
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="conversationId" className="block text-sm font-medium text-gray-700 mb-1">
                  Conversation ID
                </label>
                <input
                  type="text"
                  id="conversationId"
                  value={conversationId}
                  onChange={(e) => setConversationId(e.target.value)}
                  placeholder="Enter conversation ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="callDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Call Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="callDate"
                  value={callDate}
                  onChange={(e) => setCallDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isLoading}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Select the date when this call occurred
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsModalOpen(false);
                    setConversationId('');
                    setCallDate(''); // Reset date
                    setError(null);
                  }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAddCall}
                  loading={isLoading}
                  disabled={!conversationId.trim() || !callDate.trim()}
                >
                  Add Call
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultipleCallSelector;
