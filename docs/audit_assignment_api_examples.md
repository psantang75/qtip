# Audit Assignment API Examples

This document provides examples of using the Audit Assignment API endpoints.

## Authentication

All endpoints require authentication. You need to include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Create an Audit Assignment

**Endpoint:** `POST /api/audit-assignments`

**Request Body Example:**

```json
{
  "form_id": 1,
  "target_type": "USER",
  "target_id": 5,
  "schedule": "5 audits/week",
  "qa_id": 3,
  "start_date": "2023-07-01T00:00:00.000Z",
  "end_date": "2023-12-31T23:59:59.999Z",
  "created_by": 1
}
```

**Response:**

```json
{
  "message": "Audit assignment created successfully",
  "assignment_id": 1
}
```

### 2. Create Multiple Audit Assignments in Batch

**Endpoint:** `POST /api/audit-assignments/batch`

**Request Body Example:**

```json
{
  "assignments": [
    {
      "form_id": 1,
      "target_type": "USER",
      "target_id": 5,
      "schedule": "5 audits/week",
      "qa_id": 3,
      "start_date": "2023-07-01T00:00:00.000Z",
      "end_date": "2023-12-31T23:59:59.999Z",
      "created_by": 1
    },
    {
      "form_id": 2,
      "target_type": "DEPARTMENT",
      "target_id": 2,
      "schedule": "3 audits/month",
      "start_date": "2023-07-01T00:00:00.000Z",
      "created_by": 1
    }
  ]
}
```

**Response:**

```json
{
  "message": "Batch audit assignments created successfully",
  "assignment_ids": [1, 2]
}
```

### 3. Get All Audit Assignments

**Endpoint:** `GET /api/audit-assignments`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `is_active` (optional): Filter by active status (true or false)
- `form_id` (optional): Filter by form ID
- `target_type` (optional): Filter by target type (USER or DEPARTMENT)
- `target_id` (optional): Filter by target ID

**Response:**

```json
{
  "data": [
    {
      "id": 1,
      "form_id": 1,
      "target_id": 5,
      "target_type": "USER",
      "schedule": "5 audits/week",
      "qa_id": 3,
      "start_date": "2023-07-01T00:00:00.000Z",
      "end_date": "2023-12-31T23:59:59.999Z",
      "is_active": true,
      "created_by": 1,
      "created_at": "2023-06-15T08:30:22.000Z",
      "form_name": "Customer Service Quality Assessment",
      "target_name": "john.doe",
      "qa_name": "qa.analyst",
      "created_by_name": "admin.user"
    },
    {
      "id": 2,
      "form_id": 2,
      "target_id": 2,
      "target_type": "DEPARTMENT",
      "schedule": "3 audits/month",
      "qa_id": null,
      "start_date": "2023-07-01T00:00:00.000Z",
      "end_date": null,
      "is_active": true,
      "created_by": 1,
      "created_at": "2023-06-15T08:30:22.000Z",
      "form_name": "Technical Support Evaluation",
      "target_name": "Customer Service",
      "qa_name": null,
      "created_by_name": "admin.user"
    }
  ],
  "pagination": {
    "total": 2,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

### 4. Get Audit Assignment by ID

**Endpoint:** `GET /api/audit-assignments/:id`

**Response:**

```json
{
  "id": 1,
  "form_id": 1,
  "target_id": 5,
  "target_type": "USER",
  "schedule": "5 audits/week",
  "qa_id": 3,
  "start_date": "2023-07-01T00:00:00.000Z",
  "end_date": "2023-12-31T23:59:59.999Z",
  "is_active": true,
  "created_by": 1,
  "created_at": "2023-06-15T08:30:22.000Z",
  "form_name": "Customer Service Quality Assessment",
  "target_name": "john.doe",
  "qa_name": "qa.analyst",
  "created_by_name": "admin.user"
}
```

### 5. Update an Audit Assignment

**Endpoint:** `PUT /api/audit-assignments/:id`

**Request Body Example:**

```json
{
  "schedule": "10 audits/week",
  "qa_id": 4,
  "end_date": "2024-06-30T23:59:59.999Z"
}
```

**Response:**

```json
{
  "message": "Audit assignment updated successfully",
  "assignment_id": 1
}
```

### 6. Deactivate an Audit Assignment

**Endpoint:** `DELETE /api/audit-assignments/:id`

**Response:**

```json
{
  "message": "Audit assignment deactivated successfully",
  "assignment_id": 1
}
```

## Validation Rules

1. **Form Validation:**
   - Form ID must correspond to an existing, active form.

2. **Target Validation:**
   - For `target_type: "USER"`, the `target_id` must be a valid user ID.
   - For `target_type: "DEPARTMENT"`, the `target_id` must be a valid department ID.
   - When updating, if `target_type` is provided, `target_id` must also be provided, and vice versa.

3. **QA Analyst Validation:**
   - If `qa_id` is provided, it must correspond to a user with the QA role.

4. **Date Validation:**
   - `start_date` is required.
   - `end_date` is optional but must be greater than `start_date` if provided.

## Error Handling

The API returns appropriate HTTP status codes:
- 400: Bad Request (invalid input)
- 401: Unauthorized (missing or invalid JWT)
- 404: Not Found (assignment ID doesn't exist)
- 500: Server Error 