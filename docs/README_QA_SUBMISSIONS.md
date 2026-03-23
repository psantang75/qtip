# QA Audit Submission API

This document outlines the API endpoints for QA audit submissions in the QTIP system.

## Authentication

All routes require authentication via JWT. Include the token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Assigned Audits

Retrieves a list of calls assigned to the authenticated QA Analyst that need to be reviewed.

- **URL**: `/api/submissions/assigned`
- **Method**: `GET`
- **Auth required**: Yes (QA Analyst role)
- **Query Parameters**:
  - `page` (optional): Page number for pagination (default: 1)
  - `limit` (optional): Number of items per page (default: 10)
  
**Response**:

```json
{
  "data": [
    {
      "assignment_id": 1,
      "call_id": 42,
      "call_external_id": "CALL123456",
      "form_id": 5,
      "form_name": "Customer Service Evaluation",
      "call_date": "2023-04-15T14:30:00Z",
      "call_duration": 360,
      "csr_name": "John Smith",
      "department_name": "Sales",
      "submission_id": 0,
      "status": "DRAFT"
    }
  ],
  "pagination": {
    "total": 25,
    "page": 1,
    "limit": 10,
    "totalPages": 3
  }
}
```

### 2. Get Call Details with Form

Retrieves detailed information about a call and the form structure for review.

- **URL**: `/api/submissions/review/:callId`
- **Method**: `GET`
- **Auth required**: Yes (QA Analyst role)
- **URL Parameters**:
  - `callId`: ID of the call to review
- **Query Parameters**:
  - `formId`: ID of the form to use for the review

**Response**:

```json
{
  "call": {
    "id": 42,
    "call_id": "CALL123456",
    "csr_id": 15,
    "call_date": "2023-04-15T14:30:00Z",
    "duration": 360,
    "recording_url": "https://example.com/recordings/call123456.mp3",
    "transcript": "Hello, thank you for calling...",
    "csr_name": "John Smith",
    "department_name": "Sales"
  },
  "form": {
    "id": 5,
    "form_name": "Customer Service Evaluation",
    "version": 2,
    "categories": [
      {
        "id": 12,
        "category_name": "Greeting & Introduction",
        "weight": 0.25,
        "questions": [
          {
            "id": 45,
            "question_text": "CSR identified themselves by name",
            "question_type": "YES_NO",
            "weight": 0.5
          },
          {
            "id": 46,
            "question_text": "CSR verified customer identity",
            "question_type": "YES_NO",
            "weight": 0.5
          }
        ]
      }
    ]
  },
  "draft": {
    "id": 78,
    "status": "DRAFT",
    "total_score": null,
    "answers": [
      {
        "question_id": 45,
        "answer": "YES",
        "notes": "Agent introduced himself as John at 0:12"
      }
    ]
  }
}
```

### 3. Submit Audit

Submits a completed QA audit.

- **URL**: `/api/submissions`
- **Method**: `POST`
- **Auth required**: Yes (QA Analyst role)
- **Request Body**:

```json
{
  "form_id": 5,
  "call_id": 42,
  "answers": [
    {
      "question_id": 45,
      "answer": "YES",
      "notes": "Agent introduced himself as John at 0:12"
    },
    {
      "question_id": 46,
      "answer": "NO",
      "notes": "Agent did not verify identity properly"
    },
    {
      "question_id": 47,
      "answer": "4",
      "notes": "Very good tone and pace"
    }
  ],
  "status": "SUBMITTED"
}
```

**Response**:

```json
{
  "message": "Audit submitted successfully",
  "submission_id": 78,
  "total_score": 0.85
}
```

### 4. Save Draft

Saves a draft of an audit in progress.

- **URL**: `/api/submissions/draft`
- **Method**: `POST`
- **Auth required**: Yes (QA Analyst role)
- **Request Body**: Same as Submit Audit

**Response**:

```json
{
  "message": "Draft saved successfully",
  "submission_id": 78
}
```

### 5. Flag Submission for Review

Flags a submission for review by a manager/director.

- **URL**: `/api/submissions/flag`
- **Method**: `POST`
- **Auth required**: Yes (CSR or QA Analyst role)
- **Request Body**:

```json
{
  "submission_id": 78,
  "disputed_by": 15,
  "reason": "I believe the score is inaccurate because I did verify the customer's identity by asking for their account number."
}
```

**Response**:

```json
{
  "message": "Submission flagged for review",
  "dispute_id": 34
}
```

## Error Responses

All endpoints may return the following error responses:

- **401 Unauthorized**: Authentication required or invalid token
- **403 Forbidden**: Authenticated user does not have required permissions
- **404 Not Found**: Requested resource not found
- **400 Bad Request**: Invalid request parameters
- **500 Internal Server Error**: Unexpected server error

Example error response:

```json
{
  "message": "Not all required questions are answered",
  "unanswered": [46, 47, 48]
}
``` 