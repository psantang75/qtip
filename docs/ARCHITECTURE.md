# Backend Architecture Documentation

## Clean Architecture Implementation

This backend follows **Clean Architecture** principles with clear separation of concerns across layers.

## Architecture Layers

```
📁 routes/           # HTTP Layer (Thin)
  ├── form.routes.ts
  ├── user.routes.ts
  └── ...
      ↓
📁 controllers/      # Request/Response Handling
  ├── form.controller.ts
  ├── user.controller.ts
  └── ...
      ↓
📁 services/         # Business Logic
  ├── FormService.ts
  ├── UserService.ts
  └── ...
      ↓
📁 repositories/     # Data Access Layer
  ├── MySQLFormRepository.ts
  ├── UserRepository.ts
  └── ...
      ↓
📁 models/          # Domain Models
  ├── Form.ts
  ├── User.ts
  └── ...
```

## Layer Responsibilities

### 1. Routes Layer (`/routes`)
- **Purpose**: HTTP routing and middleware application
- **Responsibilities**:
  - Define route endpoints
  - Apply authentication middleware
  - Delegate to controllers
- **Example**:
```typescript
router.post('/', authenticate, createForm);
router.get('/:id', authenticate, getFormById);
```

### 2. Controllers Layer (`/controllers`)
- **Purpose**: HTTP request/response handling
- **Responsibilities**:
  - Parse request parameters
  - Validate input format
  - Call appropriate service methods
  - Format HTTP responses
  - Handle service errors
- **Pattern**:
```typescript
export const createForm = async (req: Request, res: Response) => {
  try {
    const formData = req.body;
    const createdBy = req.user?.userId || 1;
    
    const result = await formService.createForm(formData, createdBy);
    return res.status(201).json(result);
  } catch (error) {
    // Handle errors appropriately
  }
};
```

### 3. Services Layer (`/services`)
- **Purpose**: Business logic and validation
- **Responsibilities**:
  - Implement business rules
  - Validate data structure
  - Coordinate between repositories
  - Handle complex operations
  - Throw business-specific errors
- **Pattern**:
```typescript
export class FormService {
  async createForm(formData: CreateFormDTO, createdBy: number) {
    await this.validateFormStructure(formData);
    const normalizedData = this.normalizeFormData(formData, createdBy);
    return await this.formRepository.createForm(normalizedData);
  }
}
```

### 4. Repositories Layer (`/repositories`)
- **Purpose**: Data access and persistence
- **Responsibilities**:
  - Database operations (CRUD)
  - Query execution
  - Transaction management
  - Data mapping
- **Pattern**:
```typescript
export class MySQLFormRepository {
  async createForm(formData: CreateFormDTO): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Database operations
      await connection.commit();
      return formId;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}
```

## Benefits of This Architecture

### ✅ **Separation of Concerns**
- Each layer has a single responsibility
- Changes in one layer don't affect others
- Easy to test individual components

### ✅ **Dependency Inversion**
- Controllers depend on Services (abstractions)
- Services depend on Repositories (abstractions)
- Database details are isolated in repositories

### ✅ **Testability**
- Each layer can be unit tested independently
- Easy to mock dependencies
- Clear interfaces between layers

### ✅ **Maintainability**
- Code is organized and predictable
- Easy to locate specific functionality
- Consistent patterns across features

### ✅ **Scalability**
- Easy to add new features following the same pattern
- Clear extension points
- Modular structure

## Error Handling Pattern

### Service Errors
```typescript
export class FormServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
  }
}
```

### Controller Error Handling
```typescript
catch (error) {
  if (error instanceof FormServiceError) {
    return res.status(error.statusCode).json({ 
      error: error.message,
      code: error.code 
    });
  }
  return res.status(500).json({ error: 'Internal server error' });
}
```

## Key Improvements Made

### ✅ **Removed Legacy Code**
- Deleted 1000+ lines of duplicate database logic from controllers
- Eliminated confusion between different patterns

### ✅ **Consistent Architecture**
- All features now follow the same layered pattern
- Consistent error handling across controllers
- Standardized request/response flow

### ✅ **Professional Standards**
- Clean separation of concerns
- Proper dependency injection
- Comprehensive error handling
- Clear documentation

### ✅ **Fixed Technical Issues**
- Proper ID mapping for conditional questions
- Complete form update functionality
- Transaction management
- Foreign key constraint handling

## Adding New Features

When adding new features, follow this pattern:

1. **Define Models** in `/models`
2. **Create Repository** for data access
3. **Create Service** for business logic
4. **Create Controller** for HTTP handling
5. **Define Routes** with proper middleware
6. **Add Error Handling** using service error pattern

This ensures consistency and maintainability across the entire codebase. 