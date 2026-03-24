// @ts-nocheck
import React from 'react';
import { HiXMark, HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '../ui/Button';
import type { CoachingSessionDetails } from '../../types/manager.types';

interface CoachingSessionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: CoachingSessionDetails | null;
  onCompleteSession?: (sessionId: number) => void;
  onReopenSession?: (sessionId: number) => void;
  onDownloadAttachment?: (sessionId: number, filename: string) => void;
  completingSession?: boolean;
  reopeningSession?: boolean;
  formatDate: (dateString: string) => string;
  formatCoachingType: (type: string | null | undefined) => string;
  setError?: (error: string) => void;
}

const CoachingSessionDetailsModal: React.FC<CoachingSessionDetailsModalProps> = ({
  isOpen,
  onClose,
  session,
  onCompleteSession,
  onReopenSession,
  onDownloadAttachment,
  completingSession = false,
  reopeningSession = false,
  formatDate,
  formatCoachingType,
  setError
}) => {
  // Updated shared modal component - v2.0
  if (!isOpen || !session) return null;

  const handleDownloadAttachment = async () => {
    if (!session.attachment_filename || !onDownloadAttachment) return;
    
    try {
      await onDownloadAttachment(session.id, session.attachment_filename);
    } catch (error) {
      if (setError) {
        setError('Failed to download attachment.');
      }
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <div className="flex items-center justify-between mb-4">
            <h3 
              id="modal-title"
              className="text-lg font-medium text-gray-900"
            >
              Coaching Session Details
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
              aria-label="Close modal"
            >
              <HiXMark className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                  {session.status.replace('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                  {formatCoachingType(session.coaching_type)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CSR Name
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                  {session.csr_name}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Date
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                  {formatDate(session.session_date)}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Topics
              </label>
              <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 min-h-[40px]">
                {session.topics && session.topics.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {session.topics.map((topic, index) => (
                      <span 
                        key={index}
                        className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                ) : session.topic ? (
                  <span>{session.topic}</span>
                ) : (
                  <span className="text-gray-500">No topics</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 min-h-[100px]">
                {session.notes ? (
                  <span className="whitespace-pre-wrap">{session.notes}</span>
                ) : (
                  <span className="text-gray-500">No notes</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attachment
              </label>
              <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                {session.attachment_filename ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadAttachment}
                    className="text-blue-600 hover:text-blue-800 p-0"
                  >
                    <HiOutlineDocumentArrowDown className="h-4 w-4 mr-1" />
                    {session.attachment_filename}
                  </Button>
                ) : (
                  <span className="text-gray-500">No attachment</span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div>
                {session.status === 'COMPLETED' && onReopenSession && (
                  <Button
                    variant="secondary"
                    onClick={() => onReopenSession(session.id)}
                    loading={reopeningSession}
                    disabled={reopeningSession}
                  >
                    {reopeningSession ? 'Re-opening...' : 'Re-Open'}
                  </Button>
                )}
              </div>
              <div className="flex space-x-3">
                {session.status === 'SCHEDULED' && onCompleteSession && (
                  <Button
                    variant="primary"
                    onClick={() => onCompleteSession(session.id)}
                    loading={completingSession}
                    disabled={completingSession}
                  >
                    {completingSession ? 'Completing...' : 'Mark as Completed'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoachingSessionDetailsModal; 