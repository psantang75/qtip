import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { getAllForms } from '../services/formService';
import userService from '../services/userService';
import callService from '../services/callService';
import apiClient from '../services/apiClient';
import type { FormListItem, InteractionType } from '../types/form.types';
import authService from '../services/authService';
import { handleErrorIfAuthentication } from '../utils/errorHandling';
import { 
  processConditionalLogic, 
  findQuestionById,
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
  calculateFormScore,
  getQuestionScore
} from '../utils/forms';
import FormMetadataDisplay from './FormMetadataDisplay';
import type { Form as FormType } from '../types';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import { usePersistentFilters, useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

// Answer type definition for form utilities
interface AnswerType {
  question_id: number;
  answer: string;
  score: number;
  notes: string;
}

// Define interfaces based on the database schema
interface Form extends FormListItem {
  // Additional fields that might be in your Form but not in FormListItem
}

interface User {
  id: number;
  username: string;
  role_id: number;
  department_id: number | null;
}

interface Call {
  id: number;
  call_id: string;
  csr_id: number;
  customer_id: string | null;
  call_date: string;
  duration: number;
  recording_url: string | null;
  transcript: string | null;
}

interface FormCategory {
  id: number;
  form_id: number;
  category_name: string;
  category_weight: number;
  sort_order: number;
  questions: FormQuestion[];
}

interface FormQuestion {
  id: number;
  category_id: number;
  question_text: string;
  question_type: 'YES_NO' | 'SCALE' | 'TEXT' | 'INFO';
  is_required: boolean;
  is_na_allowed: boolean;
  weight: number;
  scale_min?: number;
  scale_max?: number;
  sort_order: number;
  
  // Scoring properties
  yes_value?: number;
  no_value?: number;
  na_value?: number;
  
  // Conditional logic properties
  is_conditional?: boolean;
  conditional_question_id?: number;
  conditional_value?: string;
  condition_type?: string;
  exclude_if_unmet?: boolean;
  conditional_logic?: {
    target_question_id: number;
    condition_type: string;
    target_value?: string;
    exclude_if_unmet?: boolean;
  };
  
  // Advanced conditional logic
  conditions?: Array<{
    id?: number;
    question_id?: number;
    target_question_id: number;
    condition_type: string;
    target_value?: string;
    logical_operator?: 'AND' | 'OR';
    group_id?: number;
    sort_order?: number;
  }>;
  
  // Radio options for radio questions
  radio_options?: Array<{
    id?: number;
    question_id?: number;
    option_text: string;
    option_value: string;
    score: number;
    has_free_text: boolean;
    sort_order?: number;
  }>;
}

interface FormMetadataField {
  id: number;
  form_id: number;
  field_name: string;
  field_type: string;
  is_required: boolean;
  dropdown_source: string | null;
  interaction_type: string;
}

interface FormData {
  form_id: number;
  csr_id: number;
  [key: string]: any; // For dynamic metadata fields
}

interface SubmissionAnswer {
  question_id: number;
  answer: string;
  notes: string | null;
}

interface FormFilters {
  interaction_type: string;
  search: string;
  form_id_search?: string;
}

interface CallSearchParams {
  csr_id: string;
  date_start: string;
  date_end: string;
  customer_id: string;
}

// Constants
const INTERACTION_TYPE_LABELS = {
  UNIVERSAL: 'Universal',
  CALL: 'Call',
  TICKET: 'Ticket',
  EMAIL: 'Email',
  CHAT: 'Chat'
} as const;

const SCORE_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 70,
  FAIR: 50
} as const;

const SCORE_COLORS = {
  EXCELLENT: 'text-green-600 bg-green-600',
  GOOD: 'text-primary-blue bg-primary-blue',
  FAIR: 'text-yellow-600 bg-yellow-600',
  POOR: 'text-red-600 bg-red-600'
} as const;

const QAManualReview: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Form state
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>();
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [filteredForms, setFilteredForms] = useState<FormListItem[]>([]);
  const [csrs, setCsrs] = useState<User[]>([]);
  const [selectedForm, setSelectedForm] = useState<FormListItem | null>(null);
  const [formCategories, setFormCategories] = useState<FormCategory[]>([]);
  const [metadataFields, setMetadataFields] = useState<FormMetadataField[]>([]);
  const [searchResults, setSearchResults] = useState<Call[]>([]);
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([]);
  const [callIdInput, setCallIdInput] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // UI state
  const [step, setStep] = useState<'select' | 'input' | 'review'>('select');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);
  const [answers, setAnswers] = useState<SubmissionAnswer[]>([]);
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null);

  // Persistent filter states
  const [formFilters, setFormFilters, clearFormFilters] = usePersistentFilters<FormFilters>(
    'QAManualReview',
    {
      interaction_type: 'all',
      search: '',
      form_id_search: ''
    },
    user?.id
  );

  // Persistent page sizes for both tables (client-side pagination)
  const [formsPageSize, setFormsPageSize, clearFormsPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_QAManualReview_forms`,
    10
  );
  const [callsPageSize, setCallsPageSize, clearCallsPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_QAManualReview_calls`,
    5
  );

  // Handlers for page size changes
  const handleFormsPageSizeChange = (newPageSize: number) => {
    setFormsPageSize(newPageSize);
  };
  const handleCallsPageSizeChange = (newPageSize: number) => {
    setCallsPageSize(newPageSize);
  };
  
  const [callSearchParams, setCallSearchParams] = useState<CallSearchParams>({
    csr_id: '',
    date_start: '',
    date_end: '',
    customer_id: ''
  });

  // Helper function to get score color classes
  const getScoreColorClasses = (score: number) => {
    if (score >= SCORE_THRESHOLDS.EXCELLENT) return SCORE_COLORS.EXCELLENT;
    if (score >= SCORE_THRESHOLDS.GOOD) return SCORE_COLORS.GOOD;
    if (score >= SCORE_THRESHOLDS.FAIR) return SCORE_COLORS.FAIR;
    return SCORE_COLORS.POOR;
  };

  // Helper function to format interaction type
  const formatInteractionType = (type: string) => {
    return INTERACTION_TYPE_LABELS[type as keyof typeof INTERACTION_TYPE_LABELS] || type;
  };

  // Fetch initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoading(true);
        
        // Get current user from authService
        const user = authService.getCurrentUser();
        setCurrentUser(user);
        
        // Fetch active forms using the service
        const formsData = await getAllForms(true);
        
        let formsList: FormListItem[] = [];
        if (Array.isArray(formsData)) {
          formsList = formsData;
        } else if (formsData && Array.isArray((formsData as any).forms)) {
          formsList = (formsData as any).forms;
        } else {
          formsList = [];
        }
        
        setForms(formsList);
        
        // Fetch CSRs using userService
        const csrUsers = await userService.getUsers(1, 100, { 
          role: 'CSR',
          is_active: true
        });
        
        setCsrs(csrUsers.items);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError('Failed to load initial data. Please refresh the page.');
        console.error('Error fetching initial data:', err);
      }
    };
    
    fetchInitialData();
  }, []);

  // Apply filters when formFilters change (e.g., when restored from localStorage)
  useEffect(() => {
    // Only apply filters if we have forms loaded
    if (forms.length > 0) {
      filterForms(formFilters, forms);
    }
  }, [formFilters.interaction_type, formFilters.search, formFilters.form_id_search, forms]);

  // Fetch forms based on current filters
  const fetchFormsWithFilters = async (filters: FormFilters) => {
    try {
      setIsLoading(true);
      
      const formsData = await getAllForms(true);
      
      let formsList: FormListItem[] = [];
      if (Array.isArray(formsData)) {
        formsList = formsData;
      } else if (formsData && Array.isArray((formsData as any).forms)) {
        formsList = (formsData as any).forms;
      } else {
        formsList = [];
      }
      
      setForms(formsList);
      filterForms(filters, formsList);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError('Failed to load forms. Please try again.');
      console.error('Error fetching forms:', err);
    }
  };

  // Handle form filter changes
  const handleFormFilterChange = (newFilters: Record<string, any>) => {
    const filters: FormFilters = {
      interaction_type: newFilters.interaction_type || 'all',
      search: newFilters.search || '',
      form_id_search: newFilters.form_id_search || ''
    };
    
    setFormFilters(filters);
    fetchFormsWithFilters(filters);
  };

  // Handle clear form filters
  const handleClearFormFilters = () => {
    clearFormFilters();
    const defaultFilters: FormFilters = {
      interaction_type: 'all',
      search: '',
      form_id_search: ''
    };
    setFormFilters(defaultFilters);
    fetchFormsWithFilters(defaultFilters);
  };

  // Filter forms based on search and interaction type
  const filterForms = (filters: FormFilters, formsList?: FormListItem[]) => {
    const safeForms = Array.isArray(formsList || forms) ? (formsList || forms) : [];
    let filtered = safeForms;
    
    // Filter by interaction type
    if (filters.interaction_type !== 'all') {
      filtered = filtered.filter(form => 
        form.interaction_type === filters.interaction_type
      );
    }
    
    // Filter by form ID
    if (filters.form_id_search) {
      const formIdToSearch = filters.form_id_search.trim();
      if (formIdToSearch) {
        filtered = filtered.filter(form => 
          form.id.toString() === formIdToSearch
        );
      }
    }
    
    // Apply search filter
    if (filters.search) {
      const searchTermLower = filters.search.toLowerCase();
      filtered = filtered.filter(form => 
        form.form_name.toLowerCase().includes(searchTermLower)
      );
    }
    
    setFilteredForms(filtered);
  };

  // Handle form selection
  const handleFormSelect = async (formId: number) => {
    try {
      navigate(`/qa/manual-reviews/form?formId=${formId}`);
    } catch (err) {
      setIsLoading(false);
      setError('Failed to start review. Please try again.');
      console.error('Error starting review:', err);
    }
  };

  // Handle call search
  const handleCallSearch = async () => {
    try {
      setIsLoading(true);
      const searchParams = {
        csr_id: callSearchParams.csr_id ? Number(callSearchParams.csr_id) : undefined,
        customer_id: callSearchParams.customer_id || undefined,
        date_start: callSearchParams.date_start || undefined,
        date_end: callSearchParams.date_end || undefined
      };
      
      const results = await callService.searchCalls(searchParams);
      setSearchResults(results);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError('Failed to search calls. Please try again.');
      console.error('Error searching calls:', err);
    }
  };

  // Add call by ID
  const addCallById = async () => {
    if (!callIdInput.trim()) return;
    
    try {
      setIsLoading(true);
      const call = await callService.getCallById(callIdInput.trim());
      
      // Check if call is already selected
      if (!selectedCalls.find(existingCall => existingCall.id === call.id)) {
        setSelectedCalls([...selectedCalls, call]);
      }
      
      setCallIdInput('');
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError('Invalid Call ID or call not found.');
      console.error('Error adding call:', err);
    }
  };

  // Add call from search results
  const addCallFromSearch = (call: Call) => {
    if (!selectedCalls.find(c => c.id === call.id)) {
      setSelectedCalls([...selectedCalls, call]);
    }
  };

  // Remove call from selected calls
  const removeCall = (callId: number) => {
    setSelectedCalls(selectedCalls.filter(call => call.id !== callId));
  };

  // Handle answer change
  const handleAnswerChange = (questionId: number, value: string, isNotes: boolean = false) => {
    if (isNotes) {
      const existingAnswerIndex = answers.findIndex(a => a.question_id === questionId);
      if (existingAnswerIndex >= 0) {
        const updatedAnswers = [...answers];
        updatedAnswers[existingAnswerIndex] = {
          ...updatedAnswers[existingAnswerIndex],
          notes: value
        };
        setAnswers(updatedAnswers);
      } else {
        const newAnswers = [
          ...answers,
          {
            question_id: questionId,
            answer: '',
            notes: value
          }
        ];
        setAnswers(newAnswers);
      }
      return;
    }
    
    const existingAnswerIndex = answers.findIndex(a => a.question_id === questionId);
    
    if (existingAnswerIndex >= 0) {
      const updatedAnswers = [...answers];
      updatedAnswers[existingAnswerIndex] = {
        ...updatedAnswers[existingAnswerIndex],
        answer: value
      };
      setAnswers(updatedAnswers);
      updateVisibilityMap(updatedAnswers);
    } else {
      const newAnswers = [
        ...answers,
        {
          question_id: questionId,
          answer: value,
          notes: null
        }
      ];
      setAnswers(newAnswers);
      updateVisibilityMap(newAnswers);
    }
  };

  // Update visibility map based on current answers
  const updateVisibilityMap = (currentAnswers = answers) => {
    if (!formCategories.length) return;
    
    // Convert component structure to the format expected by processConditionalLogic
    const form: FormType = {
      id: selectedForm?.id || 0,
      form_name: selectedForm?.form_name || '',
      interaction_type: ((selectedForm?.interaction_type || 'universal').toLowerCase() as any),
      is_active: true,
      metadata_fields: [],
      categories: formCategories.map(category => ({
        id: category.id,
        form_id: category.form_id,
        category_name: category.category_name,
        weight: category.category_weight,
        sort_order: category.sort_order,
        questions: category.questions.map(question => ({
          id: question.id || 0,
          category_id: question.category_id,
          question_text: question.question_text,
          question_type: question.question_type.toLowerCase() as any,
          sort_order: question.sort_order,
          weight: question.weight,
          is_conditional: question.is_conditional || false,
          is_na_allowed: question.is_na_allowed,
          yes_value: question.question_type === 'YES_NO' ? 1 : undefined,
          no_value: question.question_type === 'YES_NO' ? 0 : undefined,
          scale_min: question.question_type === 'SCALE' ? question.scale_min : undefined,
          scale_max: question.question_type === 'SCALE' ? question.scale_max : undefined,
          conditional_logic: question.is_conditional ? {
            target_question_id: question.conditional_question_id || 0,
            target_value: question.conditional_value || '',
            condition_type: (() => {
              const conditionType = question.condition_type?.toLowerCase() || 'equals';
              switch (conditionType) {
                case 'equals': return 'EQUALS';
                case 'not_equals': return 'NOT_EQUALS';
                case 'exists': return 'EXISTS';
                case 'not_exists': return 'NOT_EXISTS';
                default: return 'EQUALS';
              }
            })() as any,
            exclude_if_unmet: false
          } : undefined
        }))
      }))
    };
    
    // Convert answers array to record format
    const answersRecord: Record<number, AnswerType> = {};
    currentAnswers.forEach(answer => {
      if (!answer.answer || !answer.question_id) return;
      
      const questionFromForm = formCategories
        .flatMap(category => category.questions)
        .find(q => q.id === answer.question_id);
      
      if (!questionFromForm) return;
      
      let score = 0;
      
      if (questionFromForm.question_type === 'YES_NO') {
        score = answer.answer.toLowerCase() === 'yes' ? 1 : 0;
      } else if (questionFromForm.question_type === 'SCALE' && questionFromForm.scale_max) {
        const numValue = parseInt(answer.answer, 10);
        if (!isNaN(numValue)) {
          score = numValue;
        }
      }
      
      answersRecord[answer.question_id] = {
        question_id: answer.question_id,
        answer: answer.answer,
        score: score,
        notes: answer.notes || ''
      };
    });
    
    // Convert Answer objects to strings for conditional logic
    const answersForConditionalLogic: Record<number, string> = {};
    Object.entries(answersRecord).forEach(([questionId, answer]) => {
      answersForConditionalLogic[Number(questionId)] = answer.answer || '';
    });
    
    // Process visibility
    const newVisibilityMap = processConditionalLogic(form, answersForConditionalLogic);
    setVisibilityMap(newVisibilityMap);
    
    // Calculate scores
    const { totalScore: calculatedTotalScore, categoryScores } = calculateFormScore(form, answersRecord);
    setTotalScore(calculatedTotalScore);
    
    // Create form render data
    const formRenderData = prepareFormForRender(
      form,
      answersRecord,
      newVisibilityMap,
      categoryScores,
      calculatedTotalScore
    );
    
    setFormRenderData(formRenderData);
  };

  // Handle final submission
  const handleSubmission = async (data: FormData) => {
    if (selectedCalls.length === 0) {
      setError('Please select at least one call.');
      return;
    }
    
    // Note: Metadata validation is now handled at step transition
    // Only validate form questions at final submission
    
    // Validate that all visible required questions are answered
    const unansweredQuestions: number[] = [];
    const answeredQuestionIds = answers
      .filter(a => a.answer && a.answer.trim() !== '')
      .map(a => a.question_id);

    formCategories.forEach(category => {
      category.questions.forEach(question => {
        // Only validate visible questions that require an answer
        const isVisible = visibilityMap[question.id] !== false;
        const needsAnswer = question.question_type !== 'INFO' && question.question_type !== 'TEXT';
        
        if (isVisible && needsAnswer && !answeredQuestionIds.includes(question.id)) {
          unansweredQuestions.push(question.id);
        }
      });
    });

    if (unansweredQuestions.length > 0) {
      const questionTexts = unansweredQuestions.map(qId => {
        const question = formCategories
          .flatMap(cat => cat.questions)
          .find(q => q.id === qId);
        return question ? question.question_text : `Question ${qId}`;
      });
      
      setError(`Please answer all required visible questions:\n• ${questionTexts.join('\n• ')}`);
      return;
    }
    
    try {
      setIsLoading(true);
      
      // Prepare metadata entries
      const metadata = metadataFields.map(field => ({
        field_id: field.id,
        value: data[`metadata_${field.id}`] || ''
      }));
      
      // Submit the audit
      await apiClient.post('/submissions', {
        form_id: selectedForm?.id,
        submitted_by: currentUser?.id,
        call_ids: selectedCalls.map(call => call.id),
        metadata,
        answers: answers.filter(a => a.answer),
        total_score: totalScore
      });
      
      setIsLoading(false);
      setError(null);
      
      // Reset form state
      setStep('select');
      setSelectedForm(null);
      setFormCategories([]);
      setSelectedCalls([]);
      setAnswers([]);
      setTotalScore(null);
      
      // Show success message and navigate
      navigate('/qa/manual-reviews', { 
        state: { message: 'Audit submitted successfully!' }
      });
      
    } catch (err: any) {
      setIsLoading(false);
      
      // Check for authentication errors (401) - let the axios interceptor handle redirect
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      
      setError('Failed to submit audit. Please try again.');
      console.error('Error submitting audit:', err);
    }
  };

  // Form handler functions
  const handleFormAnswerChange = (questionId: number, value: string, type: string) => {
    handleAnswerChange(questionId, value);
  };

  const handleFormNotesChange = (questionId: number, notes: string) => {
    const answer = answers.find(a => a.question_id === questionId);
    if (answer) {
      const updatedAnswer = { ...answer, notes };
      setAnswers(answers.map(a => a.question_id === questionId ? updatedAnswer : a));
      updateVisibilityMap();
    }
  };

  // Watch form values
  const watchFormId = watch('form_id');
  const watchCsrId = watch('csr_id');
  
  useEffect(() => {
    if (watchFormId) {
      handleFormSelect(Number(watchFormId));
    }
  }, [watchFormId]);

  useEffect(() => {
    if (formCategories.length > 0) {
      if (answers.length === 0) {
        const initialAnswers = formCategories.flatMap(category =>
          category.questions.map(question => ({
            question_id: question.id,
            answer: '',
            notes: null
          }))
        );
        setAnswers(initialAnswers);
      }
      updateVisibilityMap();
    }
  }, [formCategories]);

  // Define table columns for form selection
  const formColumns: Column<FormListItem>[] = [
    {
      key: 'id',
      header: 'Form ID',
      sortable: true,
      render: (value, form) => (
        <span className="font-medium">{form.id}</span>
      )
    },
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true,
      render: (value, form) => (
        <span className="font-medium">{form.form_name}</span>
      )
    },
    {
      key: 'interaction_type',
      header: 'Type',
      sortable: true,
      render: (value, form) => (
        <span>
          {formatInteractionType(form.interaction_type)}
        </span>
      )
    },
    {
      key: 'version',
      header: 'Version',
      sortable: true
    },
    {
      key: 'created_at',
      header: 'Created Date',
      sortable: true,
      render: (value, form) => new Date(form.created_at).toLocaleDateString()
    },
    {
      key: 'id' as keyof FormListItem,
      header: 'Actions',
      sortable: false,
      render: (value, form) => (
        <Button
          variant="ghost"  
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            handleFormSelect(form.id);
          }}
          className="text-primary-blue hover:text-primary-blue-dark"
        >
          Start Review
        </Button>
      )
    }
  ];

  // Define filter fields for form selection
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      interaction_type: formFilters.interaction_type,
      search: formFilters.search,
      form_id_search: formFilters.form_id_search || ''
    };
  }, [
    formFilters.interaction_type,
    formFilters.search,
    formFilters.form_id_search
  ]);

  const formFilterFields: FilterField[] = [
    {
      key: 'interaction_type',
      label: 'Form Type',
      type: 'select',
      options: [
        { value: 'all', label: 'All Types' },
        { value: 'UNIVERSAL', label: 'Universal' },
        { value: 'CALL', label: 'Call' },
        { value: 'TICKET', label: 'Ticket' },
        { value: 'EMAIL', label: 'Email' },
        { value: 'CHAT', label: 'Chat' }
      ]
    },
    {
      key: 'form_id_search',
      label: 'Form ID',
      type: 'text',
      placeholder: 'Search by form ID'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search forms by name...'
    }
  ];

  // Define table columns for call search results
  const callColumns: Column<Call>[] = [
    {
      key: 'call_id',
      header: 'Call ID',
      sortable: true,
      render: (value, call) => (
        <span className="font-medium">{call.call_id}</span>
      )
    },
    {
      key: 'call_date',
      header: 'Date',
      sortable: true,
      render: (value, call) => new Date(call.call_date).toLocaleDateString()
    },
    {
      key: 'duration',
      header: 'Duration',
      sortable: true,
      render: (value, call) => {
        const minutes = Math.floor(call.duration / 60);
        const seconds = call.duration % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    },
    {
      key: 'customer_id',
      header: 'Customer ID',
      sortable: true,
      render: (value, call) => call.customer_id || 'N/A'
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (value, call) => (
        <Button
          variant={selectedCalls.some(c => c.id === call.id) ? "tertiary" : "primary"}
          size="sm"
          onClick={() => addCallFromSearch(call)}
          disabled={selectedCalls.some(c => c.id === call.id)}
          className={
            selectedCalls.some(c => c.id === call.id) 
              ? 'text-gray-700 cursor-not-allowed' 
              : ''
          }
        >
          {selectedCalls.some(c => c.id === call.id) ? 'Added' : 'Add'}
        </Button>
      )
    }
  ];

  // Format duration for display
  const formatDuration = (duration: number) => {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="container p-6 mx-auto">
      <h1 className="text-2xl font-bold text-neutral-900 mb-6">QA Manual Review</h1>
      
      {error && (
        <ErrorDisplay 
          message={error} 
          variant="card"
          dismissible={true}
          onDismiss={() => setError(null)} 
        />
      )}
      
      <form onSubmit={handleSubmit(step === 'review' ? handleSubmission : (data: FormData) => {
        // Validate metadata fields when moving from input to review step
        if (step === 'input') {
          const missingMetadataFields: string[] = [];
          
          metadataFields.forEach(field => {
            if (field.is_required) {
              const fieldValue = data[`metadata_${field.id}`];
              
              if (!fieldValue || fieldValue.toString().trim() === '') {
                missingMetadataFields.push(field.field_name);
              }
            }
          });

          if (missingMetadataFields.length > 0) {
            setError(`Please fill in all required form details:\n• ${missingMetadataFields.join('\n• ')}`);
            return;
          }
          
          // Clear any previous errors if validation passes
          setError(null);
          setStep('review');
        } else {
          setStep('input');
        }
      })}>
        {step === 'select' && (
          <>
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-neutral-900">Filter Forms</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearFormFilters}
                  aria-label="Clear all filters"
                >
                  Clear Filters
                </Button>
              </div>
              <FilterPanel 
                fields={formFilterFields}
                onFilterChange={handleFormFilterChange}
                initialValues={filterPanelInitialValues}
              />
            </div>
            
            <DataTable
              columns={formColumns}
              data={filteredForms}
              loading={isLoading}
              emptyMessage={
                formFilters.search || formFilters.interaction_type !== 'all' 
                  ? 'No forms found. Try adjusting your filters.' 
                  : 'No forms found. Please check with admin to create forms.'
              }
              pagination={true}
              pageSize={formsPageSize}
              onPageSizeChange={handleFormsPageSizeChange}
            />

            <input type="hidden" {...register('form_id', { required: "Please select a form" })} />
          </>
        )}
        
        {step === 'input' && selectedForm && (
          <>
            <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
              <h2 className="text-2xl font-semibold mb-4">Form Details</h2>
              <div className="mb-4">
                <p className="text-neutral-700">
                  <strong>Form:</strong> {selectedForm.form_name}
                </p>
                <p className="text-neutral-700">
                  <strong>Version:</strong> {selectedForm.version}
                </p>
                <p className="text-neutral-700">
                  <strong>Type:</strong> {formatInteractionType(selectedForm.interaction_type)}
                </p>
              </div>
              
              <h3 className="text-xl font-semibold mb-2">Select CSR</h3>
              <div className="mb-4">
                <select
                  className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                  {...register('csr_id', { required: "Please select a CSR" })}
                >
                  <option value="">Select a CSR</option>
                  {csrs.map(csr => (
                    <option key={csr.id} value={csr.id}>
                      {csr.username}
                    </option>
                  ))}
                </select>
                {errors.csr_id && (
                  <p className="text-red-600 mt-1">{errors.csr_id.message}</p>
                )}
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
              <h2 className="text-2xl font-semibold mb-4">Call Selection</h2>
              
              {/* Manual call ID input */}
              <div className="mb-4">
                <label className="block text-neutral-700 mb-2">
                  Add Call by ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-grow p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                    placeholder="Enter Call ID"
                    value={callIdInput}
                    onChange={(e) => setCallIdInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="bg-primary-blue text-white py-2 px-4 rounded hover:bg-primary-blue-dark transition-colors"
                    onClick={addCallById}
                    disabled={!callIdInput.trim() || isLoading}
                  >
                    Add Call
                  </button>
                </div>
              </div>
              
              {/* Call search */}
              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">Search Calls</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-neutral-700 mb-2">CSR</label>
                    <select
                      className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                      value={callSearchParams.csr_id}
                      onChange={(e) => setCallSearchParams({ ...callSearchParams, csr_id: e.target.value })}
                    >
                      <option value="">Any CSR</option>
                      {csrs.map(csr => (
                        <option key={csr.id} value={csr.id}>{csr.username}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-neutral-700 mb-2">Customer ID</label>
                    <input
                      type="text"
                      className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                      placeholder="Enter Customer ID"
                      value={callSearchParams.customer_id}
                      onChange={(e) => setCallSearchParams({ ...callSearchParams, customer_id: e.target.value })}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-neutral-700 mb-2">Start Date</label>
                    <input
                      type="date"
                      className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                      value={callSearchParams.date_start}
                      onChange={(e) => setCallSearchParams({ ...callSearchParams, date_start: e.target.value })}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-neutral-700 mb-2">End Date</label>
                    <input
                      type="date"
                      className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-blue"
                      value={callSearchParams.date_end}
                      onChange={(e) => setCallSearchParams({ ...callSearchParams, date_end: e.target.value })}
                    />
                  </div>
                </div>
                
                <button
                  type="button"
                  className="bg-primary-blue text-white py-2 px-4 rounded hover:bg-primary-blue-dark transition-colors"
                  onClick={handleCallSearch}
                  disabled={isLoading}
                >
                  {isLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              
              {/* Search results using DataTable */}
              {searchResults.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xl font-semibold mb-2">Search Results</h3>
                  <DataTable
                    columns={callColumns}
                    data={searchResults}
                    loading={false}
                    emptyMessage="No calls found."
                    pagination={true}
                    pageSize={callsPageSize}
                    onPageSizeChange={handleCallsPageSizeChange}
                  />
                </div>
              )}
              
              {/* Selected calls */}
              {selectedCalls.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xl font-semibold mb-2">Selected Calls ({selectedCalls.length})</h3>
                  <div className="space-y-3">
                    {selectedCalls.map((call, index) => (
                      <div key={call.id} className="border border-gray-200 rounded">
                        <div className="bg-gray-100 p-3 flex justify-between items-center">
                          <div>
                            <span className="font-medium">Call {index + 1}: {call.call_id}</span>
                            <span className="ml-4 text-sm text-gray-600">
                              {new Date(call.call_date).toLocaleDateString()} - {formatDuration(call.duration)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="bg-red-600 text-white py-1 px-2 rounded text-sm hover:bg-red-700 transition-colors"
                            onClick={() => removeCall(call.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {step === 'input' && formRenderData && (
              <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
                <h2 className="text-2xl font-semibold mb-4">Evaluation Form</h2>
                
                {metadataFields && metadataFields.length > 0 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
                    <FormMetadataDisplay
                      metadataFields={metadataFields as import('../types/form.types').FormMetadataField[]}
                      values={Object.fromEntries(
                        metadataFields.map(field => {
                          // Use field.field_name if field.id is 0 or falsy to avoid "0" keys
                          const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
                          return [
                            fieldKey,
                            watch(`metadata_${field.id}`) || ''
                          ];
                        })
                      )}
                      onChange={(fieldId, value) => {
                        setValue(`metadata_${fieldId}`, value);
                      }}
                      readonly={false}
                      currentUser={currentUser ? { id: currentUser.id, username: currentUser.username } : undefined}
                    />
                  </div>
                )}
                
                <FormRenderer
                  formRenderData={formRenderData}
                  isDisabled={false}
                  onAnswerChange={handleFormAnswerChange}
                  onNotesChange={handleFormNotesChange}
                />
              </div>
            )}
          </>
        )}
        
        {step === 'review' && selectedForm && (
          <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
            <h2 className="text-2xl font-semibold mb-4">Review Submission</h2>
            
            <div className="mb-6">
              <h3 className="text-xl font-medium mb-2">Form Details</h3>
              <p><strong>Form:</strong> {selectedForm.form_name} (v{selectedForm.version})</p>
              <p><strong>Type:</strong> {formatInteractionType(selectedForm.interaction_type)}</p>
              <p><strong>CSR:</strong> {csrs.find(c => c.id === Number(watch('csr_id')))?.username || 'N/A'}</p>
            </div>
            
            <div className="mb-6">
              <h3 className="text-xl font-medium mb-2">Selected Calls ({selectedCalls.length})</h3>
              <ul className="list-disc list-inside space-y-1">
                {selectedCalls.map(call => (
                  <li key={call.id}>
                    {call.call_id} - {new Date(call.call_date).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="mb-6">
              <h3 className="text-xl font-medium mb-2">Score</h3>
              <p className={`text-2xl font-bold ${totalScore !== null ? getScoreColorClasses(totalScore).split(' ')[0] : ''}`}>
                {totalScore !== null ? `${totalScore.toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6">
          {step !== 'select' && (
            <>
              <button
                type="button"
                className="bg-gray-500 text-white py-2 px-6 rounded hover:bg-gray-600 transition-colors"
                onClick={() => setStep(step === 'review' ? 'input' : 'select')}
                disabled={isLoading}
              >
                Back
              </button>
              
              <button
                type="submit"
                className="text-white bg-primary-blue hover:bg-primary-blue-dark py-2 px-6 rounded transition-colors"
                disabled={isLoading || (step === 'input' && selectedCalls.length === 0)}
              >
                {isLoading ? 'Processing...' : step === 'review' ? 'Submit Review' : 'Continue'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
};

export default QAManualReview; 