import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from './ui/button';
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
  const [isAdding, setIsAdding] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [callDate, setCallDate] = useState('');
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

      let call: Call;
      if (calls.length === 0) {
        // No record found — build a stub. Backend will create a new call row
        // when it sees a negative ID in call_ids (see MySQLSubmissionRepository).
        call = {
          id: -1,
          call_id: conversationId.trim(),
          csr_id: 0,
          customer_id: null,
          call_date: callDate,
          duration: 0,
          recording_url: null,
          transcript: null,
        };
      } else {
        call = calls[0];
      }

      if (selectedCalls.some(c => c.call_id === call.call_id)) {
        setError(`Conversation ID "${call.call_id}" is already added`);
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
      setCallDate('');
      setIsAdding(false);
      setError(null);

    } catch (error) {
      console.error('Error adding call:', error);
      setError('Failed to add call. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCall = (index: number) => {
    const updatedCalls = selectedCalls.filter((_, i) => i !== index);
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

  const inputCls = 'w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#00aeef] transition-colors disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';
  const labelCls = 'block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1';

  const handleCancel = () => {
    setIsAdding(false);
    setConversationId('');
    setCallDate('');
    setError(null);
  };

  const InlineForm = () => (
    <div className="border border-[#00aeef]/30 rounded-lg bg-[#00aeef]/[0.03] px-3.5 py-3 space-y-3">
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded-md text-[12px] text-red-700">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Conversation ID</label>
          <input
            type="text"
            value={conversationId}
            onChange={e => setConversationId(e.target.value)}
            placeholder="Enter conversation ID…"
            className={inputCls}
            disabled={isLoading}
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls}>
            Call Date <span className="text-red-400 normal-case tracking-normal">*</span>
          </label>
          <input
            type="date"
            value={callDate}
            onChange={e => setCallDate(e.target.value)}
            className={inputCls}
            disabled={isLoading}
            required
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isLoading}
          className="h-7 px-2 text-[12px]"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleAddCall}
          disabled={isLoading || !conversationId.trim() || !callDate.trim()}
          className="h-7 px-3 text-[12px] bg-[#00aeef] hover:bg-[#0095cc] text-white"
        >
          {isLoading ? 'Adding…' : 'Add Call'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Selected Calls List */}
      {selectedCalls.length === 0 && !isAdding && (
        <div className="flex items-center justify-between py-2 px-1">
          <p className="text-[13px] text-slate-400">No calls added yet</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
            disabled={disabled}
            className="h-7 px-2 text-[12px] text-[#00aeef] hover:text-[#0095cc] hover:bg-[#00aeef]/10"
          >
            <Plus size={12} className="mr-1" />
            Add Your First Call
          </Button>
        </div>
      )}

      {/* Inline add form — empty state */}
      {selectedCalls.length === 0 && isAdding && <InlineForm />}

      {/* Calls list */}
      {selectedCalls.length > 0 && (
        <div className="space-y-2">
          {selectedCalls.map((call, index) => (
            <div key={`${call.call_id}-${index}`} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-5 h-5 rounded-full bg-[#00aeef]/10 flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-semibold text-[#00aeef]">{index + 1}</span>
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[13px] text-slate-700">
                      <span className="font-medium">Call ID:</span> {call.call_id}
                    </span>
                    <span className="text-[13px] text-slate-700">
                      <span className="font-medium">Call Date:</span> {formatCallDate(call.call_date)}
                    </span>
                    {call.customer_id && (
                      <span className="text-[12px] text-slate-400 shrink-0">· {call.customer_id}</span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveCall(index)}
                  disabled={disabled}
                  className="h-6 w-6 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0"
                >
                  <X size={13} />
                </Button>
              </div>
              <div className="px-3 py-2.5 space-y-3">
                {call.recording_url && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Audio</p>
                    <audio controls className="w-full h-8">
                      <source src={call.recording_url} type="audio/mpeg" />
                    </audio>
                  </div>
                )}
                {call.transcript && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Transcript</p>
                    <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md p-2.5 bg-slate-50">
                      <div
                        className="text-[12px] text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }}
                      />
                    </div>
                  </div>
                )}
                {!call.recording_url && !call.transcript && (
                  <p className="text-[12px] text-slate-400 italic">No audio or transcript available</p>
                )}
              </div>
            </div>
          ))}

          {/* Inline add form — after existing calls */}
          {isAdding
            ? <InlineForm />
            : (
              <div className="flex justify-end pt-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAdding(true)}
                  disabled={disabled}
                  className="h-7 px-2 text-[12px] text-[#00aeef] hover:text-[#0095cc] hover:bg-[#00aeef]/10"
                >
                  <Plus size={12} className="mr-1" />
                  Add Another Call
                </Button>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
};

export default MultipleCallSelector;
