# Development Guidelines

- After making changes, **ALWAYS** start up a new server so I can test it.
- Always look for existing code to iterate on instead of creating new code.
- Do not drastically change the patterns before trying to iterate on existing patterns.
- Always kill all existing related servers that may have been created in previous testing before trying to start a new server.
- Always prefer simple solutions.
- Avoid duplication of code whenever possible, which means checking for other areas of the codebase that might already have similar code and functionality.
- Write code that takes into account the different environments: **dev**, **test**, and **prod**.
- Be careful to only make changes that are requested or you are confident are well understood and related to the change being requested.
- When fixing an issue or bug, **do not introduce a new pattern or technology** without first exhausting all options for the existing implementation.
  - If you do introduce something new, make sure to remove the old implementation afterward so we don't have duplicate logic.
- Keep the codebase very clean and organized.
- Avoid writing scripts in files if possible, especially if the script is likely only to be run once.
- Avoid having files over **200–300 lines of code**. Refactor at that point.
- Mocking data is **only** needed for tests. Never mock data for dev or prod.
- Never add stubbing or fake data patterns to code that affects the dev or prod environments.
- **Never overwrite my `.env` file** without first asking and confirming.
- Focus on the areas of code relevant to the task.
- **Do not touch code that is unrelated** to the task.
- Write thorough tests for all major functionality.
- Avoid making major changes to the patterns and architecture of how a feature works after it has shown to work well, unless explicitly instructed.
- Always think about what other methods and areas of code might be affected by code changes.
- PowerShell which doesn't use && for command chaining
- Validate all code can be used in Rendor without errors. 
- Review changes to make sure the error "is declared but its value is never read" does not occur.

## Database Operations with PowerShell and MySQL

When working with MySQL in PowerShell, there are several important considerations to ensure smooth operation and avoid common errors:

### Setting Up MySQL Commands in PowerShell

1. **Direct Command Execution**
   ```powershell
   # AVOID - These may cause redirection errors in PowerShell
   mysql -u root -p"password" < schema.sql
   Get-Content schema.sql | mysql -u root -p"password"
   ```

   ```powershell
   # RECOMMENDED - Use the source command
   mysql -u root -p"password" -e "source schema.sql"
   ```

2. **Running MySQL Queries**
   ```powershell
   # RECOMMENDED - Use single quotes for SQL and double quotes for PowerShell
   mysql -u root -p"password" database_name -e 'SELECT * FROM table_name;'
   ```

3. **Handling Special Characters**
   ```powershell
   # RECOMMENDED - Escape special characters in SQL
   mysql -u root -p"password" database_name -e 'SELECT * FROM table_name WHERE column LIKE ''%value%'';'
   ```

### Best Practices

1. **Password Security**
   - Store credentials in environment variables or configuration files
   - Use MySQL config files for connection settings
   ```powershell
   # Set environment variable
   $env:MYSQL_PWD="your_password"
   mysql -u root database_name -e "query"
   ```

2. **Error Handling**
   ```powershell
   # Check for successful execution
   try {
       mysql -u root -p"password" database_name -e "query"
       if ($LASTEXITCODE -eq 0) {
           Write-Host "Query executed successfully"
       }
   } catch {
       Write-Error "MySQL error: $_"
   }
   ```

3. **Large SQL Files**
   ```powershell
   # For large SQL files, use the source command
   mysql -u root -p"password" -e "source large_schema.sql"
   ```

4. **Output Formatting**
   ```powershell
   # Use --table or --vertical for better output formatting
   mysql -u root -p"password" database_name --table -e "SELECT * FROM table_name;"
   ```

### Common Issues and Solutions

1. **Redirection Errors**
   - Problem: `<` and `|` operators may fail in PowerShell
   - Solution: Use the `source` command or `-e` parameter

2. **Line Ending Issues**
   - Problem: SQL files with incorrect line endings
   - Solution: Ensure files use LF or CRLF consistently
   ```powershell
   # Convert line endings if needed
   (Get-Content schema.sql -Raw) -replace "`r`n", "`n" | Set-Content schema.sql -NoNewline
   ```

3. **Character Encoding**
   - Problem: Special characters not displaying correctly
   - Solution: Use UTF-8 encoding
   ```powershell
   # Force UTF-8 encoding
   mysql -u root -p"password" --default-character-set=utf8mb4 database_name
   ```

4. **Quote Handling**
   - Problem: Mixed single and double quotes
   - Solution: Use consistent quote patterns
   ```powershell
   # RECOMMENDED
   mysql -u root -p"password" database_name -e 'SELECT * FROM `table_name` WHERE `column` = ''value'';'
   ```

### MySQL Configuration

1. **Create a MySQL Configuration File**
   ```ini
   # ~/.my.cnf
   [client]
   user=root
   password=your_password
   host=localhost
   ```

2. **Set File Permissions**
   ```powershell
   # Secure the configuration file
   icacls .my.cnf /inheritance:r
   icacls .my.cnf /grant:r "$env:USERNAME:(R)"
   ```

### Testing Database Operations

Always test your database operations in a safe environment before running them in production:

1. Create a test database
2. Test your SQL scripts
3. Verify the results
4. Clean up test data

```powershell
# Example test sequence
mysql -u root -p"password" -e "
CREATE DATABASE IF NOT EXISTS test_db;
USE test_db;
source test_schema.sql;
-- Run tests
DROP DATABASE test_db;
"
```

Database password is Thrills0011**