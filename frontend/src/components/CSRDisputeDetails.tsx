// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineSpeakerphone, HiOutlineDocumentText, HiOutlineCalendar, HiOutlinePencil } from 'react-icons/hi';
import { getDisputeDetails, updateDispute } from '../services/csrService';
import type { CSRDispute } from '../types/csr.types';
import apiClient from '../services/apiClient';
import PageHeader from './ui/PageHeader';
import Card, { CardHeader, CardTitle, CardContent } from './ui/Card';
import StatusBadge from './ui/StatusBadge';
import Button from './ui/Button';
import LoadingSpinner from './ui/LoadingSpinner';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';

// Extended interface for dispute details that includes additional fields from API
interface DisputeDetailsExtended extends CSRDispute {
  form_name?: string;
  score?: number;
  resolved_by?: number | null;
  resolved_by_name?: string | null;
}

const CSRDisputeDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dispute, setDispute] = useState<DisputeDetailsExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDisputeDetails = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        setError(null);
        // Make sure id is a valid number string before parsing
        if (id && !isNaN(Number(id))) {
          const data = await getDisputeDetails(parseInt(id));
          console.log('Dispute data received:', data);
          console.log('Attachment URL:', data.attachment_url);
          setDispute(data);
        } else {
          setError('Invalid dispute ID. Please check the URL and try again.');
        }
      } catch (error) {
        console.error('Error fetching dispute details:', error);
        setError('Failed to load dispute details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchDisputeDetails();
  }, [id]);

  const handleBackToList = () => {
    navigate('/dispute-history');
  };

  // Check if Edit button should be shown
  // Explicitly check for null/undefined to avoid false positives when resolved_by is 0 (valid user ID)
  const canEdit = dispute?.status === 'OPEN' && (dispute?.resolved_by === null || dispute?.resolved_by === undefined);

  const handleEditClick = () => {
    if (dispute) {
      setEditReason(dispute.reason);
      setEditFile(null);
      setEditError(null);
      setShowEditModal(true);
    }
  };

  const handleCloseEditModal = () => {
    setShowEditModal(false);
    setEditReason('');
    setEditFile(null);
    setEditError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Validate file size (5MB = 5 * 1024 * 1024 bytes)
      if (file.size > 5 * 1024 * 1024) {
        setEditError('File size must be less than 5MB');
        e.target.value = ''; // Clear the file input
        return;
      }
      
      // Validate file type for disputes
      const allowedTypes = [
        'application/pdf',
        'application/msword', // DOC
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'image/jpeg',
        'image/jpg',
        'image/png'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        setEditError('Invalid file type. Only PDF, DOC, DOCX, JPG, JPEG, PNG files are allowed');
        e.target.value = ''; // Clear the file input
        return;
      }
      
      setEditFile(file);
      setEditError(null);
    }
  };

  const handleSubmitEdit = async () => {
    if (!dispute || !editReason.trim()) {
      setEditError('Dispute reason is required');
      return;
    }

    if (editReason.length > 1000) {
      setEditError('Dispute reason must be less than 1000 characters');
      return;
    }

    setIsSubmitting(true);
    setEditError(null);

    try {
      const formData = new FormData();
      formData.append('reason', editReason);
      if (editFile) {
        formData.append('attachment', editFile);
      }

      await updateDispute(dispute.id, formData);
      
      // Refresh dispute details
      const updatedData = await getDisputeDetails(dispute.id);
      setDispute(updatedData);
      setShowEditModal(false);
      setEditReason('');
      setEditFile(null);
    } catch (error: any) {
      console.error('Error updating dispute:', error);
      setEditError(error.response?.data?.message || 'Failed to update dispute. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper function to format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Loading state
  if (loading) {
    return (
      <div className="container mx-auto p-6" role="main" aria-live="polite">
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" aria-label="Loading dispute details" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="container mx-auto p-6" role="main" aria-live="assertive">
        <PageHeader 
          title="Dispute Details"
        >
          <Button
            variant="ghost"
            onClick={handleBackToList}
            leftIcon={<HiOutlineArrowLeft className="h-5 w-5" />}
            aria-label="Go back to dispute history"
          >
            Back to Dispute History
          </Button>
        </PageHeader>
        
        <ErrorDisplay 
          message={error}
          variant="card"
          actionLabel="Try Again"
          onAction={() => window.location.reload()}
        />
      </div>
    );
  }

  // Not found state
  if (!dispute) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader 
          title="Dispute Details"
        >
          <Button
            variant="ghost"
            onClick={handleBackToList}
            leftIcon={<HiOutlineArrowLeft className="h-5 w-5" />}
          >
            Back to Dispute History
          </Button>
        </PageHeader>
        
        <Card variant="bordered" padding="lg">
          <div className="text-center py-12">
            <p className="text-neutral-500 text-lg">Dispute not found.</p>
            <p className="text-neutral-500 mt-2">The dispute you're looking for doesn't exist or you don't have permission to view it.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="container mx-auto p-6" role="main">
        {/* Page Header */}
        <PageHeader 
          title="Dispute Details"
        >
          <div className="flex items-center gap-3">
            {canEdit && (
              <Button
                variant="primary"
                onClick={handleEditClick}
                leftIcon={<HiOutlinePencil className="h-5 w-5" />}
                aria-label="Edit dispute"
              >
                Edit Dispute
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleBackToList}
              leftIcon={<HiOutlineArrowLeft className="h-5 w-5" />}
              aria-label="Go back to dispute history"
            >
              Back to Dispute History
            </Button>
          </div>
        </PageHeader>

      {/* Main content layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column - Dispute Information - 4 columns on large screens */}
        <div className="lg:col-span-4 space-y-6">
          {/* Basic Information Card */}
          <Card variant="bordered" padding="lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Dispute Information</h2>
            </div>
            
            <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-neutral-500 font-medium">Status:</span>
                  <span className="col-span-2 text-neutral-500">{dispute.status}</span>
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-neutral-500 font-medium">Dispute ID:</span>
                  <span className="col-span-2 text-neutral-500">#{dispute.id}</span>
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-neutral-500 font-medium">Review ID:</span>
                  <span className="col-span-2 text-neutral-500">{dispute.submission_id}</span>
                </div>
                
                {dispute.form_name && (
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-neutral-500 font-medium">Form:</span>
                    <span className="col-span-2 text-neutral-500">{dispute.form_name}</span>
                  </div>
                )}
                
                {dispute.score !== undefined && (
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-neutral-500 font-medium">Score:</span>
                    <span className="col-span-2 text-neutral-500">{dispute.score}%</span>
                  </div>
                )}
                
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-neutral-500 font-medium">Submitted:</span>
                  <span className="col-span-2 text-neutral-500">{formatDate(dispute.created_at)}</span>
                </div>
                
                {dispute.resolved_at && (
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-neutral-500 font-medium">Resolved:</span>
                    <span className="col-span-2 text-neutral-500">{formatDate(dispute.resolved_at)}</span>
                                     </div>
                 )}
             </div>
           </Card>
        </div>

        {/* Right Column - Dispute Details - 8 columns on large screens */}
        <div className="lg:col-span-8 space-y-6">
          {/* Dispute Reason Card */}
          <Card variant="bordered" padding="lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Dispute Reason</h2>
            </div>
            
            <div className="bg-neutral-50 p-4 rounded-md">
              <p className="text-neutral-500 whitespace-pre-wrap leading-relaxed">
                {dispute.reason}
              </p>
            </div>
          </Card>

          {/* Supporting Evidence */}
          {dispute.attachment_url && (
            <Card variant="bordered" padding="lg">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-neutral-900">Supporting Evidence</h2>
              </div>
              
              <div className="bg-neutral-50 p-4 rounded-md">
                <div className="flex items-center space-x-3">
                  <HiOutlineDocumentText className="h-8 w-8 text-blue-600" />
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          // Use API endpoint to download attachment (like coaching sessions)
                          const response = await apiClient.get(`/disputes/${dispute.id}/attachment`, {
                            responseType: 'blob'
                          });
                          
                          const blob = response.data;
                          const url = window.URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = dispute.attachment_url!.split('/').pop() || 'attachment';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          window.URL.revokeObjectURL(url);
                        } catch (error: any) {
                          console.error('Download failed:', error);
                          alert('Failed to download attachment. Please try again.');
                        }
                      }}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                    >
                      {dispute.attachment_url ? dispute.attachment_url.split('/').pop() || 'Attachment' : 'No file name'}
                    </button>
                    <p className="text-xs text-neutral-500">
                      Supporting evidence uploaded with dispute
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Dispute Resolution Notes */}
          <Card variant="bordered" padding="lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Dispute Resolution Notes</h2>
            </div>
            
            {dispute.resolution_notes ? (
              <div className="bg-neutral-50 p-4 rounded-md">
                <p className="text-neutral-500 whitespace-pre-wrap leading-relaxed">
                  {dispute.resolution_notes}
                </p>
              </div>
            ) : dispute.status === 'OPEN' ? (
              <div className="bg-neutral-50 p-4 rounded-md">
                <p className="text-neutral-500">Under manager review.</p>
              </div>
            ) : (
              <div className="bg-neutral-50 p-4 rounded-md">
                <p className="text-neutral-500 italic">
                  No resolution notes provided
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Edit Dispute Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-neutral-900">Edit Dispute</h2>
                <button
                  onClick={handleCloseEditModal}
                  className="text-neutral-400 hover:text-neutral-600"
                  aria-label="Close modal"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {editError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{editError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="edit-reason" className="block text-sm font-medium text-neutral-700 mb-2">
                    Dispute Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="edit-reason"
                    value={editReason}
                    onChange={(e) => {
                      setEditReason(e.target.value);
                      setEditError(null);
                    }}
                    rows={6}
                    maxLength={1000}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter your dispute reason..."
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    {editReason.length}/1000 characters
                  </p>
                </div>

                <div>
                  <label htmlFor="edit-attachment" className="block text-sm font-medium text-neutral-700 mb-2">
                    Supporting Evidence (Optional)
                  </label>
                  <input
                    id="edit-attachment"
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    Maximum file size: 5MB. Accepted formats: PDF, DOC, DOCX, JPG, JPEG, PNG
                  </p>
                  {dispute.attachment_url && (
                    <p className="mt-2 text-sm text-neutral-600">
                      Current attachment: {dispute.attachment_url.split('/').pop()}
                      {editFile && <span className="ml-2 text-blue-600">(Will be replaced)</span>}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={handleCloseEditModal}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmitEdit}
                  disabled={isSubmitting || !editReason.trim()}
                >
                  {isSubmitting ? 'Updating...' : 'Update Dispute'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
};

export default CSRDisputeDetails; 