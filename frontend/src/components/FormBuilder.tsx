import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Form, FormCategory, FormWizardState, InteractionType, FormMetadataField } from '../types/form.types';
import { createForm, getFormById, updateForm } from '../services/formService';
import FormMetadata from './FormMetadata';
import FormCategories from './FormCategories';
import FormQuestions from './FormQuestions';
import FormPreview from './FormPreview';
import FormList from './FormList';

const FormStep = {
  LIST: 0,
  METADATA: 1,
  CATEGORIES: 2,
  QUESTIONS: 3,
  PREVIEW: 4,
} as const;

const STEP_TITLES = [
  'Forms List',
  'Form Details',
  'Categories',
  'Questions',
  'Preview & Save',
];

const FormBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { formId } = useParams<{ formId: string }>();
  
  const [state, setState] = useState<FormWizardState>({
    currentStep: formId ? FormStep.METADATA : FormStep.LIST,
    form: {
      form_name: '',
      interaction_type: 'CALL',
      is_active: true,
      version: 1,
      categories: [],
      metadata_fields: [],
    },
    errors: {},
    isSubmitting: false,
  });
  
  const [hasChanges, setHasChanges] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  useEffect(() => {
    if (formId) {
      loadForm(parseInt(formId));
    }
  }, [formId]);
  
  const loadForm = async (id: number) => {
    try {
      setState(prev => ({ ...prev, isSubmitting: true }));
      const formData = await getFormById(id, true); // Include inactive forms for editing
      setState(prev => ({
        ...prev,
        form: formData,
        isSubmitting: false,
        currentStep: FormStep.METADATA,
      }));
      setHasChanges(false);
    } catch (error) {
      console.error('Error loading form:', error);
      setState(prev => ({
        ...prev,
        errors: { form: 'Failed to load form data' },
        isSubmitting: false,
      }));
    }
  };
  
  const handleCreateNew = () => {
    setState({
      currentStep: FormStep.METADATA,
      form: {
        form_name: '',
        interaction_type: 'CALL',
        is_active: true,
        version: 1,
        categories: [],
        metadata_fields: [],
      },
      errors: {},
      isSubmitting: false,
    });
    navigate('/app/quality/forms');
  };
  
  const handleEdit = (formId: number) => {
    navigate('/app/quality/forms');
  };
  
  const handleDuplicate = async (formId: number) => {
    try {
      const formData = await getFormById(formId);
      
      const newForm: Form = {
        ...formData,
        id: undefined,
        form_name: `${formData.form_name} (Copy)`,
        version: 1,
        categories: formData.categories.map(category => ({
          ...category,
          id: undefined,
          form_id: undefined,
          questions: category.questions.map(question => ({
            ...question,
            id: undefined,
            category_id: undefined,
          })),
        })),
        metadata_fields: formData.metadata_fields?.map(field => ({
          ...field,
          id: undefined,
          form_id: undefined,
        })) || [],
      };
      
      setState({
        currentStep: FormStep.METADATA,
        form: newForm,
        errors: {},
        isSubmitting: false,
      });
      
      navigate('/app/quality/forms');
      setHasChanges(true);
    } catch (error) {
      console.error('Error duplicating form:', error);
    }
  };
  
  const handlePreview = (formId: number) => {
    navigate('/app/quality/forms');
  };
  
  const validateStep = (): boolean => {
    const { currentStep, form } = state;
    const errors: Record<string, string> = {};
    
    switch (currentStep) {
      case FormStep.METADATA:
        if (!form.form_name.trim()) {
          errors.form_name = 'Form name is required';
        }
        break;
        
      case FormStep.CATEGORIES:
        if (form.categories.length === 0) {
          errors.categories = 'At least one category is required';
        } else {
          const totalWeight = form.categories.reduce((sum, cat) => sum + cat.weight, 0);
          if (totalWeight < 0.99 || totalWeight > 1.01) {
            errors.categories = 'Category weights must sum to 1.0';
          }
        }
        break;
        
      case FormStep.QUESTIONS:
        const hasQuestions = form.categories.some(cat => cat.questions.length > 0);
        if (!hasQuestions) {
          errors.questions = 'At least one question is required';
        }
        break;
    }
    
    setState(prev => ({ ...prev, errors }));
    return Object.keys(errors).length === 0;
  };
  
  const goToNextStep = () => {
    if (validateStep()) {
      setState(prev => ({
        ...prev,
        currentStep: prev.currentStep + 1,
      }));
    }
  };
  
  const goToPreviousStep = () => {
    if (state.currentStep === FormStep.METADATA) {
      // Cancel button - go back to forms list
      navigate('/app/quality/forms');
    } else {
      setState(prev => ({
        ...prev,
        currentStep: Math.max(prev.currentStep - 1, FormStep.LIST),
      }));
    }
  };
  
  const handleFormNameChange = (value: string) => {
    setState(prev => ({
      ...prev,
      form: { ...prev.form, form_name: value },
      errors: { ...prev.errors, form_name: '' },
    }));
    setHasChanges(true);
  };
  
  const handleIsActiveChange = (value: boolean) => {
    setState(prev => ({
      ...prev,
      form: { ...prev.form, is_active: value },
    }));
    setHasChanges(true);
  };
  
  const handleInteractionTypeChange = (value: InteractionType) => {
    setState(prev => ({
      ...prev,
      form: { ...prev.form, interaction_type: value },
    }));
    setHasChanges(true);
  };
  
  const handleMetadataFieldsChange = (fields: FormMetadataField[]) => {
    setState(prev => ({
      ...prev,
      form: { ...prev.form, metadata_fields: fields },
    }));
    setHasChanges(true);
  };
  
  const handleAddCategory = (category: FormCategory) => {
    setState(prev => ({
      ...prev,
      form: {
        ...prev.form,
        categories: [...prev.form.categories, category],
      },
      errors: { ...prev.errors, categories: '' },
    }));
    setHasChanges(true);
  };
  
  const handleEditCategory = (index: number, category: FormCategory) => {
    setState(prev => {
      const updatedCategories = [...prev.form.categories];
      updatedCategories[index] = category;
      return {
        ...prev,
        form: {
          ...prev.form,
          categories: updatedCategories,
        },
      };
    });
    setHasChanges(true);
  };
  
  const handleRemoveCategory = (index: number) => {
    setState(prev => {
      const updatedCategories = prev.form.categories.filter((_, i) => i !== index);
      return {
        ...prev,
        form: {
          ...prev.form,
          categories: updatedCategories,
        },
      };
    });
    setHasChanges(true);
  };
  
  const handleUpdateCategory = (categoryIndex: number, updatedCategory: FormCategory) => {
    setState(prev => {
      const updatedCategories = [...prev.form.categories];
      updatedCategories[categoryIndex] = updatedCategory;
      return {
        ...prev,
        form: {
          ...prev.form,
          categories: updatedCategories,
        },
      };
    });
    setHasChanges(true);
  };
  
  const handleSaveForm = async () => {
    try {
      if (!validateStep()) return;
      
      setState(prev => ({ ...prev, isSubmitting: true }));
      
      const { form } = state;
      
      // Prepare form with proper metadata fields format
      const formToSubmit = {
        ...form,
        metadata_fields: (form.metadata_fields || []).map((field, index) => ({
          ...field,
          id: field.id || undefined, // Make sure id is undefined for new fields
          form_id: field.form_id || undefined, // Make sure form_id is undefined for new fields
          sort_order: index // Add sort_order for consistent ordering
        }))
      };
      
      console.log('Saving form with metadata fields:', formToSubmit.metadata_fields);
      
      if (form.id) {
        // Update existing form (creates new version)
        await updateForm(form.id, formToSubmit);
        setSuccessMessage(`Form "${form.form_name}" updated successfully (new version created)`);
      } else {
        // Create new form
        const result = await createForm(formToSubmit);
        setSuccessMessage(`Form "${form.form_name}" created successfully`);
      }
      
      setState(prev => ({ ...prev, isSubmitting: false }));
      setHasChanges(false);
      
      // Show success message and redirect to list view after a delay
      setTimeout(() => {
        setSuccessMessage(null);
        navigate('/app/quality/forms');
        setState(prev => ({ ...prev, currentStep: FormStep.LIST }));
      }, 3000);
      
    } catch (error) {
      console.error('Error saving form:', error);
      setState(prev => ({
        ...prev,
        errors: { form: 'Failed to save form. Please try again.' },
        isSubmitting: false,
      }));
    }
  };
  
  const renderStepContent = () => {
    const { currentStep, form, errors, isSubmitting } = state;
    
    switch (currentStep) {
      case FormStep.LIST:
        return (
          <FormList
            onCreateNew={handleCreateNew}
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
            onPreview={handlePreview}
          />
        );
        
      case FormStep.METADATA:
        return (
          <FormMetadata
            formName={form.form_name}
            interactionType={form.interaction_type}
            isActive={form.is_active}
            metadataFields={form.metadata_fields}
            version={form.version || 1}
            onFormNameChange={handleFormNameChange}
            onInteractionTypeChange={handleInteractionTypeChange}
            onIsActiveChange={handleIsActiveChange}
            onMetadataFieldsChange={handleMetadataFieldsChange}
            error={errors.form_name}
          />
        );
        
      case FormStep.CATEGORIES:
        return (
          <FormCategories
            categories={form.categories}
            onAddCategory={handleAddCategory}
            onEditCategory={handleEditCategory}
            onRemoveCategory={handleRemoveCategory}
            error={errors.categories}
          />
        );
        
      case FormStep.QUESTIONS:
        return (
          <FormQuestions
            categories={form.categories}
            onUpdateCategory={handleUpdateCategory}
          />
        );
        
      case FormStep.PREVIEW:
        return <FormPreview form={form} />;
        
      default:
        return <div>Unknown step</div>;
    }
  };
  
  // Skip navigation controls on list view
  const showNavigation = state.currentStep !== FormStep.LIST;
  const { form: currentForm } = state;
  
  return (
    <div className="container mx-auto px-4 py-6">
      {/* Success message */}
      {successMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {successMessage}
        </div>
      )}
      
      {showNavigation && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">
              {currentForm.id ? `Edit Form: ${currentForm.form_name}` : 'Create New Form'}
            </h1>
            {hasChanges && <span className="text-sm text-yellow-600">* Unsaved changes</span>}
          </div>
          
          {/* Step indicators */}
          <div className="flex items-center mb-6">
            {STEP_TITLES.slice(1).map((title, index) => {
              const stepNumber = index + 1; // Add 1 to skip LIST step in display
              const isActive = state.currentStep === stepNumber;
              const isCompleted = state.currentStep > stepNumber;
              
              return (
                <div key={stepNumber} className="flex items-center">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full font-medium text-sm ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isCompleted
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {stepNumber}
                  </div>
                  <span
                    className={`ml-2 text-sm font-medium ${
                      isActive ? 'text-blue-600' : isCompleted ? 'text-blue-800' : 'text-gray-600'
                    }`}
                  >
                    {title}
                  </span>
                  {stepNumber < STEP_TITLES.length - 1 && (
                    <div className="flex-grow border-t border-gray-300 mx-4"></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      <div className="mb-6">{renderStepContent()}</div>
      
      {/* Navigation buttons */}
      {showNavigation && (
        <div className="flex justify-between mt-8">
          <button
            type="button"
            onClick={goToPreviousStep}
            className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
            disabled={state.isSubmitting}
          >
            {state.currentStep === FormStep.METADATA ? 'Cancel' : 'Previous'}
          </button>
          
          {state.currentStep === FormStep.PREVIEW ? (
            <div className="flex space-x-4">
              <button
                type="button"
                onClick={() => {
                  navigate('/app/quality/forms', { state: { formData: state.form } });
                }}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={state.isSubmitting}
              >
                Interactive Preview
              </button>
              <button
                type="button"
                onClick={handleSaveForm}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={state.isSubmitting}
              >
                {state.isSubmitting ? 'Saving...' : currentForm.id ? 'Save as New Version' : 'Create Form'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={goToNextStep}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={state.isSubmitting}
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FormBuilder; 