import React from 'react';
import { HiXMark, HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '../ui/Button';
import type { CoachingSessionForm, CoachingType } from '../../types/manager.types';

interface CoachingSessionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: any; // Using any to handle different form data types
  onInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  csrOptions: Array<{ id: number; username: string }>;
  topicOptions?: Array<{ id: number; topic_name: string }>; // Active topics for dropdown
  editingSession: any; // CoachingSession object or null
  formLoading: boolean;
  formError: string | null;
  userRole: number | undefined; // 4 = trainer, 5 = manager, 1 = admin, 2 = QA
  userName?: string; // User's name to display
  csrOptionsLoading?: boolean; // Loading state for CSR options
  topicOptionsLoading?: boolean; // Loading state for topic options
  onDownloadAttachment?: (sessionId: number) => Promise<Blob>; // Optional download function
}

const CoachingSessionFormModal: React.FC<CoachingSessionFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  onInputChange,
  csrOptions,
  topicOptions = [],
  editingSession,
  formLoading,
  formError,
  userRole,
  userName,
  csrOptionsLoading = false,
  topicOptionsLoading = false,
  onDownloadAttachment
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              {editingSession ? 'Edit Coaching Session' : 'Add Coaching Session'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <HiXMark className="h-6 w-6" />
            </button>
          </div>

          {/* User Information Display */}
          {userName && (
            <div className="mb-6 pt-6">
              <div className="text-base text-gray-700 mb-5">
                <span className="font-medium">
                  Coaching Session Created by: {userName}, {userRole === 4 ? 'Trainer' : 'Manager'}
                </span>
              </div>
              <hr className="border-gray-200" />
            </div>
          )}

          {formError && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {formError}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={onInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={formLoading}
                >
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type *
                </label>
                <select
                  name="coaching_type"
                  value={formData.coaching_type}
                  onChange={onInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={formLoading}
                >
                  <option value="">Select Type</option>
                  {userRole === 4 ? (
                    // Trainer role - limited options
                    <>
                      <option value="Classroom">Classroom</option>
                      <option value="Side-by-Side">Side-by-Side</option>
                      <option value="Team Session">Team Session</option>
                    </>
                  ) : (
                    // Manager role - all options
                    <>
                      <option value="Classroom">Classroom</option>
                      <option value="Side-by-Side">Side-by-Side</option>
                      <option value="Team Session">Team Session</option>
                      <option value="1-on-1">1-on-1</option>
                      <option value="PIP">PIP</option>
                      <option value="Verbal Warning">Verbal Warning</option>
                      <option value="Written Warning">Written Warning</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CSR *
                </label>
                <select
                  name="csr_id"
                  value={formData.csr_id}
                  onChange={onInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={formLoading || csrOptionsLoading}
                >
                  <option value="">
                    {csrOptionsLoading ? 'Loading CSRs...' : 'Select CSR'}
                  </option>
                  {csrOptions.map(csr => (
                    <option key={csr.id} value={csr.id}>
                      {csr.username}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  name="session_date"
                  value={formData.session_date}
                  onChange={onInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={formLoading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Topics * (Select one or more)
              </label>
              {topicOptionsLoading ? (
                <div className="text-sm text-gray-500 py-2">Loading topics...</div>
              ) : topicOptions && topicOptions.length > 0 ? (
                <div className="border border-gray-300 rounded-md p-3 max-h-60 overflow-y-auto bg-white">
                  <div className="space-y-2">
                    {topicOptions.map(topic => {
                      const isChecked = formData.topic_ids?.includes(topic.id) || false;
                      return (
                        <label
                          key={topic.id}
                          className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const currentIds = formData.topic_ids || [];
                              let newIds: number[];
                              
                              if (e.target.checked) {
                                // Add topic ID if not already present
                                newIds = [...currentIds, topic.id];
                              } else {
                                // Remove topic ID
                                newIds = currentIds.filter(id => id !== topic.id);
                              }
                              
                              onInputChange({
                                ...e,
                                target: {
                                  ...e.target,
                                  name: 'topic_ids',
                                  value: newIds
                                }
                              } as any);
                            }}
                            disabled={formLoading || topicOptionsLoading}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700 flex-1">
                            {topic.topic_name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 py-2 border border-gray-300 rounded-md px-3">
                  No topics available
                </div>
              )}
              {formData.topic_ids && formData.topic_ids.length > 0 && (
                <p className="text-xs text-blue-600 mt-2">
                  {formData.topic_ids.length} topic{formData.topic_ids.length !== 1 ? 's' : ''} selected
                </p>
              )}
              {(!formData.topic_ids || formData.topic_ids.length === 0) && (
                <p className="text-xs text-red-500 mt-1">
                  Please select at least one topic
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={onInputChange}
                rows={4}
                maxLength={2000}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter session notes or agenda"
                disabled={formLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.notes.length}/2000 characters
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="attachment-input">
                Attachment
              </label>
              
              {/* Show existing attachment if editing */}
              {editingSession && formData.existingAttachment && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center">
                    <HiOutlineDocumentArrowDown className="h-5 w-5 text-blue-600 mr-2" />
                    <div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (editingSession && editingSession.id && onDownloadAttachment) {
                            try {
                              const blob = await onDownloadAttachment(editingSession.id);
                              const url = window.URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = formData.existingAttachment?.filename || 'attachment';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                              window.URL.revokeObjectURL(url);
                            } catch (error) {
                              console.error('Download failed:', error);
                              alert('Failed to download attachment. Please try again.');
                            }
                          }
                        }}
                        className="text-sm font-medium text-blue-900 hover:text-blue-700 underline cursor-pointer"
                        disabled={!onDownloadAttachment || !editingSession?.id}
                      >
                        {formData.existingAttachment.filename}
                      </button>
                      <p className="text-xs text-blue-600">
                        {formData.existingAttachment.size ? 
                          `${(formData.existingAttachment.size / 1024).toFixed(1)} KB` : 
                          'Unknown size'
                        }
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 mt-1">
                    Current attachment. Select a new file below to replace it.
                  </p>
                </div>
              )}
              
              <input
                id="attachment-input"
                type="file"
                name="attachment"
                onChange={onInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                aria-describedby="attachment-help"
              />
              <p id="attachment-help" className="text-xs text-gray-500 mt-1">
                Max size: 5MB. Supported formats: PDF, Word, Text, Images
                {editingSession && formData.existingAttachment && 
                  '. Selecting a new file will replace the current attachment.'
                }
              </p>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={formLoading}
              >
                {editingSession ? 'Update Session' : 'Create Session'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CoachingSessionFormModal; 