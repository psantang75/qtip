import React, { useState } from 'react';
import type { FormCategory } from '../types/form.types';

interface FormCategoriesProps {
  categories: FormCategory[];
  onAddCategory: (category: FormCategory) => void;
  onEditCategory: (index: number, category: FormCategory) => void;
  onRemoveCategory: (index: number) => void;
  error?: string;
}

const FormCategories: React.FC<FormCategoriesProps> = ({
  categories,
  onAddCategory,
  onEditCategory,
  onRemoveCategory,
  error,
}) => {
  const [categoryName, setCategoryName] = useState('');
  const [weight, setWeight] = useState('');
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Calculate total weight of all categories
  const totalWeight = categories.reduce((sum, category) => sum + category.weight, 0);
  const formattedTotalWeight = (Math.round(totalWeight * 100) / 100).toFixed(2);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    if (!categoryName.trim()) {
      setLocalError('Category name is required');
      return;
    }
    
    const weightValue = parseFloat(weight);
    if (isNaN(weightValue) || weightValue <= 0 || weightValue > 1) {
      setLocalError('Weight must be a number between 0 and 1');
      return;
    }
    
    // Check if new total weight would exceed 1
    const otherCategoriesWeight = categories.reduce(
      (sum, category, index) => (editIndex === index ? sum : sum + category.weight),
      0
    );
    
    if (otherCategoriesWeight + weightValue > 1.001) { // Allow small rounding errors
      setLocalError(`Total weight cannot exceed 1. Current total: ${otherCategoriesWeight.toFixed(2)}`);
      return;
    }
    
    const newCategory: FormCategory = {
      category_name: categoryName,
      weight: weightValue,
      questions: [],
    };
    
    if (editIndex !== null) {
      onEditCategory(editIndex, newCategory);
      setEditIndex(null);
    } else {
      onAddCategory(newCategory);
    }
    
    // Reset form
    setCategoryName('');
    setWeight('');
    setLocalError(null);
  };

  const startEditing = (index: number) => {
    const category = categories[index];
    setCategoryName(category.category_name);
    setWeight(category.weight.toString());
    setEditIndex(index);
  };

  const cancelEditing = () => {
    setCategoryName('');
    setWeight('');
    setEditIndex(null);
    setLocalError(null);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Form Categories</h3>
      
      {(error || localError) && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error || localError}
        </div>
      )}
      
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">
            Total weight: {formattedTotalWeight}
            <span className={totalWeight > 0.99 && totalWeight < 1.01 ? 'text-green-600 ml-2' : 'text-yellow-600 ml-2'}>
              {totalWeight > 0.99 && totalWeight < 1.01 ? '✓' : '(Should sum to 1.0)'}
            </span>
          </p>
        </div>
        
        <form onSubmit={handleSubmit} className="mb-4 border border-gray-200 p-4 rounded">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-3">
              <label htmlFor="categoryName" className="block text-sm font-medium text-gray-700 mb-1">
                Category Name*
              </label>
              <input
                type="text"
                id="categoryName"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Enter category name"
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div className="md:col-span-2">
              <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">
                Weight* (0-1)
              </label>
              <input
                type="number"
                id="weight"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g., 0.25"
                min="0"
                max="1"
                step="0.05"
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>
          
          <div className="mt-4 flex justify-end space-x-2">
            {editIndex !== null && (
              <button
                type="button"
                onClick={cancelEditing}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-2 bg-primary-blue hover:bg-blue-600 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {editIndex !== null ? 'Update Category' : 'Add Category'}
            </button>
          </div>
        </form>
      </div>
      
      {categories.length === 0 ? (
        <div className="text-center py-6 text-gray-500 border border-dashed border-gray-300 rounded">
          No categories added yet. Add a category to continue.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category Name
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Weight
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Questions
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {categories.map((category, index) => (
                <tr key={index} className={editIndex === index ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                  <td className="py-3 px-4 text-sm">{category.category_name}</td>
                  <td className="py-3 px-4 text-sm">{category.weight.toFixed(2)}</td>
                  <td className="py-3 px-4 text-sm">{category.questions.length}</td>
                  <td className="py-3 px-4 text-sm space-x-2">
                    <button
                      onClick={() => startEditing(index)}
                      className="text-blue-600 hover:text-blue-900"
                      disabled={editIndex !== null}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onRemoveCategory(index)}
                      className="text-red-600 hover:text-red-900"
                      disabled={editIndex !== null}
                    >
                      Remove
                    </button>
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

export default FormCategories; 