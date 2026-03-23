# QTIP Scripts Directory

This directory contains all PowerShell scripts and SQL scripts for the QTIP (Quality Training and Improvement Platform) project.

## 📁 Scripts Overview

### **Database Management Scripts**
- [`apply_migration.ps1`](./apply_migration.ps1) - Apply database migrations
- [`apply_trainer_database_fixes.ps1`](./apply_trainer_database_fixes.ps1) - Apply trainer-specific database fixes
- [`build_production_database.sql`](./build_production_database.sql) - Build production database schema
- [`deploy_database.ps1`](./deploy_database.ps1) - Deploy database changes
- [`export_production_schema.ps1`](./export_production_schema.ps1) - Export production database schema
- [`setup_production_database.ps1`](./setup_production_database.ps1) - Setup production database
- [`setup_production_database_clean.ps1`](./setup_production_database_clean.ps1) - Clean setup of production database
- [`update_scoring_schema.ps1`](./update_scoring_schema.ps1) - Update scoring schema

### **Application Deployment Scripts**
- [`deploy_application.ps1`](./deploy_application.ps1) - Deploy application to production
- [`prepare_production.ps1`](./prepare_production.ps1) - Prepare production environment
- [`start_app.ps1`](./start_app.ps1) - Start application services

### **Data Management Scripts**
- [`seed_performance_goals.ps1`](./seed_performance_goals.ps1) - Seed performance goals data
- [`rs.ps1`](./rs.ps1) - Remote sync script
- [`run_verification.ps1`](./run_verification.ps1) - Run system verification

## 🚀 Script Categories

### **Database Scripts**
These scripts handle database operations:
- **Migration Scripts**: Apply database schema changes
- **Setup Scripts**: Initialize database environments
- **Export Scripts**: Export database schemas and data
- **Cleanup Scripts**: Clean and reset database states

### **Deployment Scripts**
These scripts handle application deployment:
- **Application Deployment**: Deploy frontend and backend applications
- **Environment Preparation**: Prepare production environments
- **Configuration Management**: Handle environment-specific configurations

### **Data Management Scripts**
These scripts handle data operations:
- **Data Seeding**: Populate databases with initial data
- **Data Synchronization**: Sync data between environments
- **Verification**: Verify system integrity and data consistency

## 🔧 Usage Instructions

### **Prerequisites**
- PowerShell 5.1 or later
- SQL Server access (for database scripts)
- Appropriate permissions for target operations
- Environment variables configured

### **Running Scripts**

#### **Database Scripts**
```powershell
# Apply migrations
.\scripts\apply_migration.ps1

# Setup production database
.\scripts\setup_production_database.ps1

# Deploy database changes
.\scripts\deploy_database.ps1
```

#### **Deployment Scripts**
```powershell
# Deploy application
.\scripts\deploy_application.ps1

# Prepare production environment
.\scripts\prepare_production.ps1
```

#### **Data Management Scripts**
```powershell
# Seed performance goals
.\scripts\seed_performance_goals.ps1

# Run verification
.\scripts\run_verification.ps1

# Remote sync
.\scripts\rs.ps1
```

## 📋 Script Descriptions

### **Database Management**

#### **Migration Scripts**
- **`apply_migration.ps1`**: Applies database migrations in sequence
- **`apply_trainer_database_fixes.ps1`**: Applies specific fixes for trainer functionality

#### **Setup Scripts**
- **`setup_production_database.ps1`**: Sets up production database with all required tables and data
- **`setup_production_database_clean.ps1`**: Clean setup that drops and recreates database

#### **Deployment Scripts**
- **`deploy_database.ps1`**: Deploys database changes to target environment
- **`export_production_schema.ps1`**: Exports current production database schema

### **Application Deployment**

#### **Deployment Scripts**
- **`deploy_application.ps1`**: Deploys the complete application stack
- **`prepare_production.ps1`**: Prepares production environment for deployment

### **Data Management**

#### **Data Seeding**
- **`seed_performance_goals.ps1`**: Seeds the database with performance goals data

#### **Synchronization**
- **`rs.ps1`**: Remote synchronization script for data consistency

#### **Verification**
- **`run_verification.ps1`**: Runs comprehensive system verification

## ⚙️ Environment Configuration

### **Required Environment Variables**
- `DATABASE_CONNECTION_STRING` - Database connection string
- `PRODUCTION_URL` - Production environment URL
- `BACKUP_LOCATION` - Database backup location
- `DEPLOYMENT_TARGET` - Deployment target environment

### **Script Parameters**
Most scripts accept parameters for customization:
- **Environment**: Specify target environment (dev, staging, production)
- **Database**: Specify database name or connection
- **Backup**: Enable/disable backup operations
- **Verbose**: Enable detailed logging

## 🔒 Security Considerations

### **Access Control**
- Scripts require appropriate database permissions
- Production scripts should be run by authorized personnel only
- Backup and restore operations need elevated privileges

### **Data Protection**
- All scripts include backup procedures before destructive operations
- Sensitive data is handled according to security policies
- Audit logging is enabled for all database operations

## 📊 Monitoring and Logging

### **Log Files**
- Scripts generate log files in `logs/` directory
- Log levels: INFO, WARN, ERROR, DEBUG
- Log rotation for long-running operations

### **Monitoring**
- Database connection monitoring
- Script execution time tracking
- Error rate monitoring
- Performance metrics collection

## 🧹 Maintenance

### **Regular Tasks**
- Review and update scripts for new features
- Test scripts in development environment
- Update documentation for script changes
- Monitor script performance and reliability

### **Troubleshooting**
- Check log files for error details
- Verify environment variables are set
- Test database connectivity
- Validate script permissions

## 📝 Adding New Scripts

### **Naming Convention**
- Use descriptive names: `action_target.ps1`
- Include version numbers for multiple versions
- Use consistent naming patterns

### **Script Structure**
- Include error handling
- Add logging capabilities
- Include parameter validation
- Add help documentation

### **Documentation**
- Update this README with new scripts
- Include usage examples
- Document prerequisites and parameters
- Add troubleshooting information

## 🔍 Script Dependencies

### **PowerShell Modules**
- SQL Server PowerShell module
- Azure PowerShell module (if applicable)
- Custom QTIP modules

### **External Tools**
- SQL Server Management Studio
- Database backup tools
- File system utilities

## 📋 Pre-Execution Checklist

Before running any script:
- [ ] Verify database connectivity
- [ ] Check environment variables
- [ ] Ensure adequate disk space
- [ ] Verify backup procedures
- [ ] Test in non-production environment
- [ ] Review script parameters
- [ ] Check system permissions

---

*This scripts directory provides comprehensive automation for QTIP database management, application deployment, and data operations.*
