#!/usr/bin/env python3
"""
Script to add authentication error handling to all catch blocks in React components.
This adds the handleErrorIfAuthentication check before displaying error messages.
"""

import os
import re
from pathlib import Path

# Directory to process
FRONTEND_DIR = Path("frontend/src/components")

# Import statement to add
IMPORT_STATEMENT = "import { handleErrorIfAuthentication } from '../utils/errorHandling';"

# Patterns to match catch blocks with error handling
CATCH_PATTERNS = [
    # Pattern 1: catch (error) { ... } with setError or similar
    (
        r'(\} catch \((?:error|err)(?::\s*any)?\) \{[\s\S]{1,30}?)(console\.error\([^\)]+\);?\s*)((?:setError|setErrorMessage)\()',
        r'\1\2\n        // Check for authentication errors (401) - let the axios interceptor handle redirect\n        if (handleErrorIfAuthentication(\3)) {\n          return;\n        }\n        \n        \4'
    ),
]

def has_error_handling_import(content):
    """Check if file already imports handleErrorIfAuthentication"""
    return 'handleErrorIfAuthentication' in content

def add_import_statement(content):
    """Add the error handling import after other imports"""
    if has_error_handling_import(content):
        return content
    
    # Find the last import statement
    import_pattern = r"(import .+ from .+;)"
    imports = list(re.finditer(import_pattern, content))
    
    if imports:
        last_import = imports[-1]
        insert_pos = last_import.end()
        return content[:insert_pos] + '\n' + IMPORT_STATEMENT + content[insert_pos:]
    
    return content

def needs_auth_check(catch_block):
    """Check if a catch block already has authentication error checking"""
    auth_check_patterns = [
        r'handleErrorIfAuthentication',
        r'if \(.*\.status === 401\)',
        r'if \(.*response.*status.*401\)',
        r'isAuthenticationError',
    ]
    
    for pattern in auth_check_patterns:
        if re.search(pattern, catch_block):
            return False
    return True

def process_file(filepath):
    """Process a single file to add authentication error handling"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        modified = False
        
        # Check if this file has error handling that might need updates
        if 'catch' not in content or ('setError' not in content and 'setErrorMessage' not in content):
            return False
        
        # Add import if needed
        if not has_error_handling_import(content):
            content = add_import_statement(content)
            modified = True
        
        # Find all catch blocks that need updating
        # This is a complex pattern - we'll need to do this more carefully
        
        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
            
        return False
        
    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return False

def main():
    """Main function to process all files"""
    if not FRONTEND_DIR.exists():
        print(f"Directory not found: {FRONTEND_DIR}")
        return
    
    files_processed = 0
    files_modified = 0
    
    # Process all .tsx and .ts files
    for filepath in FRONTEND_DIR.rglob("*.tsx"):
        if filepath.name.endswith('.tsx') or filepath.name.endswith('.ts'):
            files_processed += 1
            if process_file(filepath):
                files_modified += 1
                print(f"Modified: {filepath}")
    
    print(f"\nProcessed {files_processed} files")
    print(f"Modified {files_modified} files")

if __name__ == "__main__":
    print("Note: This script requires manual review of changes.")
    print("It's recommended to update files individually for accuracy.")
    # main()

