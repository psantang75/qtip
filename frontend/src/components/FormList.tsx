import React, { useState, useEffect } from 'react';
import { getAllForms, deactivateForm } from '../services/formService';
import Button from './ui/Button';
import type { FormListItem } from '../types/form.types';

interface FormListProps {
  onCreateNew: () => void;
  onEdit: (formId: number) => void;
  onDuplicate: (formId: number) => void;
  onPreview: (formId: number) => void;
}

const FormList: React.FC<FormListProps> = ({ onCreateNew, onEdit, onDuplicate, onPreview }) => {
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    loadForms();
  }, [activeFilter]);

  const loadForms = async () => {
    try {
      setLoading(true);
      const data = await getAllForms(activeFilter);
      setForms(data);
      setError(null);
    } catch (err) {
      setError('Failed to load forms. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (formId: number) => {
    if (window.confirm('Are you sure you want to deactivate this form?')) {
      try {
        await deactivateForm(formId);
        await loadForms();
      } catch (err) {
        setError('Failed to deactivate form. Please try again.');
        console.error(err);
      }
    }
  };

  const filteredForms = forms.filter(form => 
    form.form_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Review Forms</h2>
        <button
          onClick={onCreateNew}
          className="bg-primary-blue hover:bg-blue-600 text-white font-medium py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Create New Form
        </button>
      </div>

      <div className="flex mb-6 space-x-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search forms..."
            className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div>
          <select
            value={activeFilter === undefined ? 'all' : activeFilter.toString()}
            onChange={(e) => {
              const value = e.target.value;
              setActiveFilter(value === 'all' ? undefined : value === 'true');
            }}
            className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Forms</option>
            <option value="true">Active Forms</option>
            <option value="false">Inactive Forms</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-4">Loading forms...</div>
      ) : filteredForms.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No forms found. {searchTerm ? 'Try a different search term.' : 'Create a new form to get started.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Form Name
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Version
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created Date
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredForms.map((form) => (
                <tr key={form.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm">{form.form_name}</td>
                  <td className="py-3 px-4 text-sm">{form.version}</td>
                  <td className="py-3 px-4 text-sm">
                    {new Date(form.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        form.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {form.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPreview(form.id)}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(form.id)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDuplicate(form.id)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Duplicate
                    </Button>
                    {form.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeactivate(form.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FormList; 