# Run form verification query in PowerShell
# Replace FORM_ID with the actual form ID you want to check

$FORM_ID = 5  # Replace with your form ID
$DB_NAME = "qtip"
$USER = "root"
$PASSWORD = "Thrills0011**"

# Create a temporary file with the query
$TEMP_QUERY = "temp_query.sql"

# Write the queries to a temporary file
@"
-- Get basic form information
SELECT 
    f.id AS form_id,
    f.form_name,
    f.interaction_type,
    f.version,
    f.is_active,
    f.created_by,
    f.created_at,
    u.username AS creator_username
FROM 
    forms f
JOIN 
    users u ON f.created_by = u.id
WHERE 
    f.id = $FORM_ID;

-- Get form categories
SELECT 
    c.id AS category_id,
    c.category_name,
    c.description,
    c.weight
FROM 
    form_categories c
WHERE 
    c.form_id = $FORM_ID
ORDER BY 
    c.id ASC;

-- Get questions with details
SELECT 
    q.id AS question_id,
    c.category_name,
    q.question_text,
    q.question_type,
    q.weight,
    q.is_na_allowed,
    q.scale_min,
    q.scale_max,
    q.yes_value,
    q.no_value,
    q.na_value,
    q.is_conditional,
    q.condition_type,
    q.target_question_id,
    q.target_value,
    q.exclude_if_unmet
FROM 
    form_questions q
JOIN 
    form_categories c ON q.category_id = c.id
WHERE 
    c.form_id = $FORM_ID
ORDER BY 
    c.id ASC, q.id ASC;

-- Get radio options
SELECT 
    q.id AS question_id,
    q.question_text,
    o.id AS option_id,
    o.option_text,
    o.option_value,
    o.score,
    o.has_free_text
FROM 
    radio_options o
JOIN 
    form_questions q ON o.question_id = q.id
JOIN 
    form_categories c ON q.category_id = c.id
WHERE 
    c.form_id = $FORM_ID AND
    q.question_type = 'RADIO'
ORDER BY 
    q.id ASC, o.id ASC;

-- Verify category weights
SELECT 
    SUM(weight) AS total_category_weight,
    CASE
        WHEN ABS(SUM(weight) - 1.0) < 0.01 THEN 'Valid (Equals 1.0)'
        ELSE 'Invalid (Does not equal 1.0)'
    END AS weight_validity
FROM 
    form_categories
WHERE 
    form_id = $FORM_ID;
"@ | Out-File -FilePath $TEMP_QUERY -Encoding utf8

# Run the query
Write-Host "=== Verifying Form ID: $FORM_ID ==="
mysql -u $USER -p"$PASSWORD" $DB_NAME -e "source $TEMP_QUERY" --table

# Clean up
Remove-Item $TEMP_QUERY

Write-Host "=== Verification Complete ===" 