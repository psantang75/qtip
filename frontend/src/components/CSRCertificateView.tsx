import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Certificate } from '../types/csr.types';

interface CSRCertificateViewProps {
  certificate: Certificate;
  isOpen: boolean;
  onClose: () => void;
}

const CSRCertificateView: React.FC<CSRCertificateViewProps> = ({ certificate, isOpen, onClose }) => {
  const { user } = useAuth();
  
  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleDownload = () => {
    // TODO: Implement actual PDF download
    const element = document.createElement('a');
    const text = `Certificate of Completion\n\nThis is to certify that the recipient has successfully completed\n${certificate.courseName}\n\nIssued on: ${formatDate(certificate.issuedDate)}\nCertificate ID: CERT-${certificate.id}`;
    const file = new Blob([text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `certificate-${certificate.id}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Certificate of Completion
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Certificate Preview */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-100 border-2 border-blue-200 rounded-lg p-8 mb-6">
              <div className="text-center">
                {/* Header */}
                <div className="mb-8">
                  <div className="w-20 h-20 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h1 className="text-3xl font-bold text-gray-800 mb-2">Certificate of Completion</h1>
                  <div className="w-24 h-1 bg-blue-600 mx-auto"></div>
                </div>

                {/* Content */}
                <div className="mb-8">
                  <p className="text-lg text-gray-600 mb-4">This is to certify that</p>
                  <h2 className="text-2xl font-bold text-gray-800 mb-4">
                    {user?.username || user?.email || 'Recipient Name'}
                  </h2>
                  <p className="text-lg text-gray-600 mb-2">has successfully completed</p>
                  <h3 className="text-xl font-semibold text-blue-700 mb-6">
                    {certificate.courseName}
                  </h3>
                </div>

                {/* Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Issued Date</p>
                    <p className="font-semibold text-gray-700">{formatDate(certificate.issuedDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Certificate ID</p>
                    <p className="font-semibold text-gray-700">CERT-{certificate.id}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Download Certificate
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CSRCertificateView; 