# QA Form API Examples

This document provides examples of using the Form Builder API endpoints.

## Authentication

All endpoints require authentication. You need to include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Create a Form

**Endpoint:** `POST /api/forms`

**Request Body Example:**

```json
{
  "form_name": "Customer Service Quality Assessment",
  "created_by": 1,
  "is_active": true,
  "categories": [
    {
      "category_name": "Communication Skills",
      "weight": 0.4,
      "questions": [
        {
          "question_text": "Did the agent introduce themselves and the company properly?",
          "question_type": "YES_NO",
          "weight": 0.2,
          "is_na_allowed": true
        },
        {
          "question_text": "Rate the agent's clarity of communication",
          "question_type": "SCALE",
          "weight": 0.3,
          "scale_min": 1,
          "scale_max": 5,
          "is_na_allowed": false
        },
        {
          "question_text": "Additional communication notes",
          "question_type": "TEXT",
          "weight": 0
        }
      ]
    },
    {
      "category_name": "Technical Knowledge",
      "weight": 0.35,
      "questions": [
        {
          "question_text": "Did the agent accurately identify the customer's technical issue?",
          "question_type": "YES_NO",
          "weight": 0.5,
          "is_na_allowed": false
        },
        {
          "question_text": "Rate the agent's troubleshooting process",
          "question_type": "SCALE",
          "weight": 0.5,
          "scale_min": 1,
          "scale_max": 5,
          "is_na_allowed": false
        }
      ]
    },
    {
      "category_name": "Process Adherence",
      "weight": 0.25,
      "questions": [
        {
          "question_text": "The following questions assess the agent's adherence to company procedures",
          "question_type": "INFO_BLOCK",
          "weight": 0
        },
        {
          "question_text": "Did the agent follow the proper verification process?",
          "question_type": "YES_NO",
          "weight": 0.3,
          "is_na_allowed": true
        },
        {
          "question_text": "Did the agent offer additional assistance before ending the call?",
          "question_type": "YES_NO",
          "weight": 0.2,
          "is_na_allowed": false,
          "conditional_logic": [
            {
              "source_question_id": 5,
              "operator": "EQUALS",
              "value": "YES"
            }
          ]
        }
      ]
    }
  ]
}
```

**Response:**

```json
{
  "message": "Form created successfully",
  "form_id": 1
}
```

### 2. Get All Forms

**Endpoint:** `GET /api/forms`

**Query Parameters:**
- `is_active` (optional): Filter by active status (true or false)

**Response:**

```json
[
  {
    "id": 1,
    "form_name": "Customer Service Quality Assessment",
    "version": 1,
    "created_by": 1,
    "created_at": "2023-06-15T10:30:22Z",
    "is_active": true
  },
  {
    "id": 2,
    "form_name": "Technical Support Evaluation",
    "version": 1,
    "created_by": 1,
    "created_at": "2023-06-10T08:15:45Z",
    "is_active": true
  }
]
```

### 3. Get Form by ID

**Endpoint:** `GET /api/forms/:id`

**Response:**

```json
{
  "id": 1,
  "form_name": "Customer Service Quality Assessment",
  "version": 1,
  "created_by": 1,
  "created_at": "2023-06-15T10:30:22Z",
  "is_active": true,
  "categories": [
    {
      "id": 1,
      "form_id": 1,
      "category_name": "Communication Skills",
      "weight": 0.4,
      "questions": [
        {
          "id": 1,
          "category_id": 1,
          "question_text": "Did the agent introduce themselves and the company properly?",
          "question_type": "YES_NO",
          "weight": 0.2,
          "is_na_allowed": true
        },
        {
          "id": 2,
          "category_id": 1,
          "question_text": "Rate the agent's clarity of communication",
          "question_type": "SCALE",
          "weight": 0.3,
          "scale_min": 1,
          "scale_max": 5,
          "is_na_allowed": false
        },
        {
          "id": 3,
          "category_id": 1,
          "question_text": "Additional communication notes",
          "question_type": "TEXT",
          "weight": 0
        }
      ]
    },
    {
      "id": 2,
      "form_id": 1,
      "category_name": "Technical Knowledge",
      "weight": 0.35,
      "questions": [
        {
          "id": 4,
          "category_id": 2,
          "question_text": "Did the agent accurately identify the customer's technical issue?",
          "question_type": "YES_NO",
          "weight": 0.5,
          "is_na_allowed": false
        },
        {
          "id": 5,
          "category_id": 2,
          "question_text": "Rate the agent's troubleshooting process",
          "question_type": "SCALE",
          "weight": 0.5,
          "scale_min": 1,
          "scale_max": 5,
          "is_na_allowed": false
        }
      ]
    },
    {
      "id": 3,
      "form_id": 1,
      "category_name": "Process Adherence",
      "weight": 0.25,
      "questions": [
        {
          "id": 6,
          "category_id": 3,
          "question_text": "The following questions assess the agent's adherence to company procedures",
          "question_type": "INFO_BLOCK",
          "weight": 0
        },
        {
          "id": 7,
          "category_id": 3,
          "question_text": "Did the agent follow the proper verification process?",
          "question_type": "YES_NO",
          "weight": 0.3,
          "is_na_allowed": true
        },
        {
          "id": 8,
          "category_id": 3,
          "question_text": "Did the agent offer additional assistance before ending the call?",
          "question_type": "YES_NO",
          "weight": 0.2,
          "is_na_allowed": false,
          "conditional_logic": [
            {
              "source_question_id": 5,
              "operator": "EQUALS",
              "value": "YES"
            }
          ]
        }
      ]
    }
  ]
}
```

## Form Structure Rules

1. **Category Weights:** All category weights must sum to 1.0 (100%)
2. **Question Types:**
   - `YES_NO`: Binary choice (Yes/No)
   - `SCALE`: Numeric range (requires scale_min and scale_max)
   - `N_A`: Optional for Yes/No or Scale questions (set is_na_allowed to true)
   - `TEXT`: Free-text input for notes (not scored)
   - `INFO_BLOCK`: Instructional text, no input required (not scored)
3. **Scale Questions:** Must have valid scale_min and scale_max values where scale_min < scale_max
4. **Conditional Logic:** Show/hide questions based on answers to previous questions

## Error Handling

The API returns appropriate HTTP status codes:
- 400: Bad Request (invalid input)
- 401: Unauthorized (missing or invalid JWT)
- 404: Not Found (form ID doesn't exist)
- 500: Server Error 