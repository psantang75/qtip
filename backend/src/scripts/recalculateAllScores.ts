import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

/**
 * Script to recalculate scores for all submissions
 * This is needed after fixing the conditional logic bug to ensure all score snapshots are accurate
 * 
 * Usage:
 *   npm run build && node dist/scripts/recalculateAllScores.js --dry-run    # Preview changes
 *   npm run build && node dist/scripts/recalculateAllScores.js --confirm    # Actually update DB
 */

interface ScoreComparison {
  submission_id: number;
  form_name: string;
  submitted_at: string;
  oldScore: number;
  newScore: number;
  scoreDifference: number;
  categoryChanges: Array<{
    category_name: string;
    oldScore: number;
    newScore: number;
    oldPossiblePoints: number;
    newPossiblePoints: number;
  }>;
}

async function recalculateAllScores(dryRun: boolean = true): Promise<void> {
  let connection;
  
  try {
    console.log('========================================');
    console.log('SCORE RECALCULATION SCRIPT');
    console.log('========================================');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE RUN (database will be updated)'}`);
    console.log('');

    if (!dryRun) {
      console.log('⚠️  WARNING: This will update the database!');
      console.log('Press Ctrl+C now if you want to cancel...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('');
    }

    // Get all finalized/submitted submissions with their form data
    const [submissions] = await pool.execute(
      `SELECT 
        s.id,
        s.form_id,
        s.total_score as current_total_score,
        s.submitted_at,
        f.form_name,
        ss.snapshot_data as current_snapshot
      FROM submissions s
      INNER JOIN forms f ON s.form_id = f.id
      LEFT JOIN score_snapshots ss ON s.id = ss.submission_id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED')
        AND ss.id IS NOT NULL
      ORDER BY s.id ASC`
    );

    console.log(`Found ${submissions.length} submissions to process\n`);

    const changes: ScoreComparison[] = [];
    let processedCount = 0;
    let errorCount = 0;

    for (const submission of submissions) {
      try {
        processedCount++;
        
        // Get form_id and answers for this submission
        const [answersRows] = await pool.execute(
          `SELECT question_id, answer, notes FROM submission_answers WHERE submission_id = ?`,
          [submission.id]
        );
        
        // Get categories for this form to build category name mapping
        const [categoriesRows] = await pool.execute(
          `SELECT id, category_name, weight FROM form_categories WHERE form_id = ?`,
          [submission.form_id]
        );
        const categoriesMap = new Map(categoriesRows.map((c: any) => [c.id, c.category_name]));
        
        // Import and call the scoring function dynamically (to avoid top-level import issues)
        const { calculateFormScore } = await import('../utils/scoringUtil');
        const result = await calculateFormScore(
          pool,
          submission.form_id,
          answersRows as any[]
        );

        const oldScore = parseFloat(submission.current_total_score) || 0;
        const newScore = result.total_score;
        const scoreDifference = newScore - oldScore;

        // Parse old snapshot to compare category-level changes
        const oldSnapshot = submission.current_snapshot 
          ? JSON.parse(submission.current_snapshot) 
          : [];

        const categoryChanges: any[] = [];
        
        // result.categoryScores is a Record<number, CategoryScore>
        Object.entries(result.categoryScores).forEach(([category_id, scores]: [string, any]) => {
          const catId = parseInt(category_id);
          const oldCat = oldSnapshot.find((c: any) => c.category_id === catId);
          
          if (!oldCat) {
            // New category (shouldn't happen, but handle it)
            categoryChanges.push({
              category_name: categoriesMap.get(catId) || 'Unknown',
              oldScore: 0,
              newScore: scores.raw,
              oldPossiblePoints: 0,
              newPossiblePoints: scores.possiblePoints
            });
          } else if (
            Math.abs(oldCat.raw_score - scores.raw) > 0.01 || 
            Math.abs(oldCat.possible_points - scores.possiblePoints) > 0.01
          ) {
            // Category changed
            categoryChanges.push({
              category_name: categoriesMap.get(catId) || 'Unknown',
              oldScore: oldCat.raw_score,
              newScore: scores.raw,
              oldPossiblePoints: oldCat.possible_points,
              newPossiblePoints: scores.possiblePoints
            });
          }
        });

        // Only track if there are actual changes
        if (Math.abs(scoreDifference) > 0.01 || categoryChanges.length > 0) {
          changes.push({
            submission_id: submission.id,
            form_name: submission.form_name,
            submitted_at: submission.submitted_at,
            oldScore,
            newScore,
            scoreDifference,
            categoryChanges
          });

          console.log(`[${processedCount}/${submissions.length}] Submission ${submission.id}: ${oldScore.toFixed(2)}% → ${newScore.toFixed(2)}% (${scoreDifference > 0 ? '+' : ''}${scoreDifference.toFixed(2)}%)`);
          
          if (categoryChanges.length > 0) {
            categoryChanges.forEach(cat => {
              console.log(`  └─ ${cat.category_name}: ${cat.oldScore.toFixed(2)}% → ${cat.newScore.toFixed(2)}% (possible: ${cat.oldPossiblePoints} → ${cat.newPossiblePoints})`);
            });
          }
        } else {
          // Progress indicator for unchanged submissions (every 50)
          if (processedCount % 50 === 0) {
            console.log(`[${processedCount}/${submissions.length}] Processing...`);
          }
        }

        // Actually update the database if not in dry-run mode
        if (!dryRun && (Math.abs(scoreDifference) > 0.01 || categoryChanges.length > 0)) {
          if (!connection) {
            connection = await pool.getConnection();
            await connection.beginTransaction();
          }

          // Get categories again to calculate normalized weights
          let totalIncludedWeight = 0;
          Object.entries(result.categoryScores).forEach(([category_id, scores]: [string, any]) => {
            if (scores.possiblePoints > 0) {
              const category = categoriesRows.find((c: any) => c.id === parseInt(category_id));
              if (category) {
                totalIncludedWeight += Number(category.weight);
              }
            }
          });

          // Build snapshot data with normalized weights
          const scoreSnapshot = Object.entries(result.categoryScores).map(([category_id, scores]: [string, any]) => {
            const catId = parseInt(category_id);
            const category = categoriesRows.find((c: any) => c.id === catId);
            const originalWeight = category ? Number(category.weight) : 0;
            const normalizedWeight = scores.possiblePoints > 0 && totalIncludedWeight > 0
              ? originalWeight / totalIncludedWeight
              : 0;
            
            return {
              category_id: catId,
              raw_score: scores.raw,
              weighted_score: scores.earnedPoints * normalizedWeight,
              weighted_possible: scores.possiblePoints * normalizedWeight,
              earned_points: scores.earnedPoints,
              possible_points: scores.possiblePoints,
              category_weight: normalizedWeight
            };
          });

          // Update submission total score
          await connection.execute(
            'UPDATE submissions SET total_score = ? WHERE id = ?',
            [newScore, submission.id]
          );

          // Update existing score snapshot
          const snapshot_data = JSON.stringify(scoreSnapshot);
          
          await connection.execute(
            'UPDATE score_snapshots SET snapshot_data = ?, created_at = NOW() WHERE submission_id = ?',
            [snapshot_data, submission.id]
          );
        }

      } catch (error: any) {
        errorCount++;
        console.error(`❌ Error processing submission ${submission.id}:`, error.message);
      }
    }

    // Commit transaction if we made changes
    if (!dryRun && connection) {
      await connection.commit();
      connection.release();
    }

    // Summary
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Total submissions processed: ${processedCount}`);
    console.log(`Submissions with changes: ${changes.length}`);
    console.log(`Errors: ${errorCount}`);
    console.log('');

    if (changes.length > 0) {
      console.log('Score Changes:');
      const increasedCount = changes.filter(c => c.scoreDifference > 0).length;
      const decreasedCount = changes.filter(c => c.scoreDifference < 0).length;
      console.log(`  - Increased: ${increasedCount}`);
      console.log(`  - Decreased: ${decreasedCount}`);
      console.log('');

      // Show top 10 biggest changes
      const topChanges = changes
        .sort((a, b) => Math.abs(b.scoreDifference) - Math.abs(a.scoreDifference))
        .slice(0, 10);

      console.log('Top 10 Biggest Changes:');
      topChanges.forEach((change, idx) => {
        console.log(`  ${idx + 1}. Submission ${change.submission_id} (${change.form_name}): ${change.oldScore.toFixed(2)}% → ${change.newScore.toFixed(2)}% (${change.scoreDifference > 0 ? '+' : ''}${change.scoreDifference.toFixed(2)}%)`);
      });
      console.log('');
    }

    if (dryRun) {
      console.log('✅ DRY RUN COMPLETE - No changes were made to the database');
      console.log('To actually update the database, run with --confirm flag');
    } else {
      console.log('✅ LIVE RUN COMPLETE - Database has been updated');
    }

  } catch (error: any) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = !args.includes('--confirm');

if (!isDryRun && !args.includes('--confirm')) {
  console.error('❌ Error: To update the database, you must explicitly use --confirm flag');
  console.log('Usage:');
  console.log('  node dist/scripts/recalculateAllScores.js --dry-run    # Preview changes (default)');
  console.log('  node dist/scripts/recalculateAllScores.js --confirm    # Actually update DB');
  process.exit(1);
}

// Run the script
recalculateAllScores(isDryRun)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

