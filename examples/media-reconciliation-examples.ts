/**
 * Media Reconciliation - Usage Examples
 * 
 * This file contains practical examples of how to use the reconciliation functions
 * for various use cases.
 */

import {
  reconcileMediaRecords,
  updateMediaRecordsWithEmailMapping,
} from "../lib/reconcileMediaRecords";
import {
  extractEmailsFromSQLFile,
  saveEmailMappingToFile,
  loadEmailMappingFromFile,
  filterEmailMapping,
  validateEmailMapping,
} from "../lib/sqlEmailExtractor";
import fs from "fs";

/**
 * Example 1: Basic Reconciliation
 * 
 * Compare media records from old and new database
 */
export async function example1BasicReconciliation() {
  console.log("Example 1: Basic Reconciliation\n");

  try {
    const results = await reconcileMediaRecords(
      "media_records.json",
      "reconciliation_results.json"
    );

    console.log("Summary:");
    console.log(`  Total old records: ${results.summary.total_old_records}`);
    console.log(`  Total new records: ${results.summary.total_new_records}`);
    console.log(`  Matched: ${results.summary.matched_records}`);
    console.log(`  Mismatched: ${results.summary.mismatched_records}`);
    console.log(`  Records with email: ${results.summary.records_with_email_update}`);

    // Display first 5 mismatches
    console.log("\nFirst 5 mismatches:");
    results.details.mismatches.slice(0, 5).forEach((mismatch, index) => {
      console.log(`  ${index + 1}. Record ${mismatch.old_record_id}`);
      console.log(`     Type: ${mismatch.model_type}`);
      console.log(`     Status: ${mismatch.status}`);
      if (mismatch.email_from_old_db) {
        console.log(`     Email: ${mismatch.email_from_old_db}`);
      }
    });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 2: Extract Email Mapping from SQL
 * 
 * Parse old database SQL dump and create email mapping
 */
export async function example2ExtractEmailMapping() {
  console.log("Example 2: Extract Email Mapping from SQL\n");

  try {
    const result = await extractEmailsFromSQLFile(
      "databases/u517833616_Portal (1).sql"
    );

    console.log("Extraction Results:");
    console.log(`  Total users found: ${result.stats.totalUsers}`);
    console.log(`  Total vcards found: ${result.stats.totalVcards}`);
    console.log(`  Total mappings created: ${result.stats.totalMappings}`);

    // Display sample mappings
    console.log("\nSample email mappings:");
    const mappingEntries = Object.entries(result.mapping).slice(0, 5);
    mappingEntries.forEach(([key, email]) => {
      console.log(`  ${key} => ${email}`);
    });

    // Validate mappings
    const validation = validateEmailMapping(result.mapping);
    console.log("\nValidation:");
    console.log(`  Valid: ${validation.valid}`);
    if (validation.errors.length > 0) {
      console.log(`  Errors: ${validation.errors.length}`);
      validation.errors.slice(0, 3).forEach((err) => {
        console.log(`    - ${err}`);
      });
    }

    // Save to file
    await saveEmailMappingToFile(result.mapping, "email_mapping.json");
    console.log("\nEmail mapping saved to: email_mapping.json");
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 3: Update Database with Email Mappings
 * 
 * Find user emails and update media records in new database
 */
export async function example3UpdateDatabase() {
  console.log("Example 3: Update Database with Email Mappings\n");

  try {
    const updated = await updateMediaRecordsWithEmailMapping(
      "media_records.json",
      "email_mapping.json"
    );

    console.log(`Updated ${updated.length} media records\n`);

    // Display first 5 updates
    console.log("First 5 updates:");
    updated.slice(0, 5).forEach((record, index) => {
      console.log(`  ${index + 1}. Media ID: ${record.new_media_id}`);
      console.log(`     User ID: ${record.user_id}`);
      console.log(`     File: ${record.file_name}`);
      console.log(`     URL: ${record.file_url}`);
      console.log();
    });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 4: Analyze Reconciliation Results
 * 
 * Parse and analyze the reconciliation results
 */
export async function example4AnalyzeResults() {
  console.log("Example 4: Analyze Reconciliation Results\n");

  try {
    const results = JSON.parse(
      fs.readFileSync("reconciliation_results.json", "utf-8")
    );

    // Group mismatches by status
    const mismatchesByStatus = results.details.mismatches.reduce(
      (acc: Record<string, number>, mismatch: Record<string, string>) => {
        const status = mismatch.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log("Mismatches by status:");
    Object.entries(mismatchesByStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Group by model type
    const mismatchesByModel = results.details.mismatches.reduce(
      (acc: Record<string, number>, mismatch: Record<string, string>) => {
        const modelType = mismatch.model_type.split("\\").pop() || "Unknown";
        acc[modelType] = (acc[modelType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log("\nMismatches by model type:");
    Object.entries(mismatchesByModel).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Count records with email found
    const withEmail = results.details.mismatches.filter(
      (m: Record<string, string>) => m.email_from_old_db
    ).length;
    console.log(`\nRecords with email found: ${withEmail}`);

    // Show sample mismatches with email
    console.log("\nSample mismatches with email:");
    results.details.mismatches
      .filter((m: Record<string, string>) => m.email_from_old_db)
      .slice(0, 3)
      .forEach((mismatch: Record<string, string>, index: number) => {
        console.log(`  ${index + 1}. Record ${mismatch.old_record_id}`);
        console.log(`     Email: ${mismatch.email_from_old_db}`);
        console.log(`     Reason: ${mismatch.status}`);
      });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 5: Filter and Export Specific Records
 * 
 * Filter reconciliation results and export to different format
 */
export async function example5FilterAndExport() {
  console.log("Example 5: Filter and Export Specific Records\n");

  try {
    const results = JSON.parse(
      fs.readFileSync("reconciliation_results.json", "utf-8")
    );

    // Find mismatches for a specific model type
    const modelType = "App\\\\Models\\\\Vcard";
    const vcardMismatches = results.details.mismatches.filter(
      (m: Record<string, string>) => m.model_type === modelType
    );

    console.log(`Mismatches for ${modelType}: ${vcardMismatches.length}`);

    // Export to CSV format
    const csvHeader =
      "old_record_id,model_type,model_id,file_name,status,email\n";
    const csvRows = vcardMismatches
      .map(
        (m: Record<string, string>) =>
          `${m.old_record_id},"${m.model_type}",${m.model_id},"${m.old_file_name}",${m.status},"${m.email_from_old_db || "N/A"}"`
      )
      .join("\n");

    fs.writeFileSync(
      "mismatches_vcards.csv",
      csvHeader + csvRows,
      "utf-8"
    );

    console.log("Exported to: mismatches_vcards.csv");

    // Create email list for support
    const emails = [
      ...new Set(
        vcardMismatches
          .filter((m: Record<string, string>) => m.email_from_old_db)
          .map((m: Record<string, string>) => m.email_from_old_db)
      ),
    ];

    fs.writeFileSync(
      "affected_users.txt",
      emails.join("\n"),
      "utf-8"
    );

    console.log(`\nExtracted ${emails.length} unique user emails`);
    console.log("Saved to: affected_users.txt");
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 6: Filter Email Mapping
 * 
 * Load email mapping and filter for specific types
 */
export async function example6FilterEmailMapping() {
  console.log("Example 6: Filter Email Mapping\n");

  try {
    const mapping = await loadEmailMappingFromFile("email_mapping.json");

    console.log(`Total mappings: ${Object.keys(mapping).length}\n`);

    // Filter for users only
    const userMappings = filterEmailMapping(mapping, /^user:/);
    console.log(`User mappings: ${Object.keys(userMappings).length}`);

    // Filter for bizcards only
    const bizcardMappings = filterEmailMapping(mapping, /^bizcard:/);
    console.log(`Bizcard mappings: ${Object.keys(bizcardMappings).length}`);

    // Display sample
    console.log("\nSample user mappings:");
    Object.entries(userMappings)
      .slice(0, 5)
      .forEach(([key, email]) => {
        console.log(`  ${key} => ${email}`);
      });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Example 7: Full Workflow - Complete Reconciliation
 * 
 * Run complete reconciliation workflow
 */
export async function example7FullWorkflow() {
  console.log("Example 7: Full Reconciliation Workflow\n");

  try {
    // Step 1: Extract emails
    console.log("Step 1: Extracting email mappings...");
    const emailData = await extractEmailsFromSQLFile(
      "databases/u517833616_Portal (1).sql"
    );
    await saveEmailMappingToFile(emailData.mapping, "email_mapping.json");
    console.log(`  ✓ Extracted ${emailData.stats.totalMappings} email mappings\n`);

    // Step 2: Reconcile
    console.log("Step 2: Running reconciliation...");
    const reconcileResults = await reconcileMediaRecords(
      "media_records.json",
      "reconciliation_results.json"
    );
    console.log(
      `  ✓ Matched ${reconcileResults.summary.matched_records} records`
    );
    console.log(
      `  ✓ Found ${reconcileResults.summary.mismatched_records} mismatches\n`
    );

    // Step 3: Update
    console.log("Step 3: Updating database records...");
    const updateResults = await updateMediaRecordsWithEmailMapping(
      "media_records.json",
      "email_mapping.json"
    );
    console.log(`  ✓ Updated ${updateResults.length} records\n`);

    // Step 4: Report
    console.log("Step 4: Generating report...");
    const report = {
      timestamp: new Date().toISOString(),
      workflow: "Full Reconciliation",
      steps: {
        email_extraction: {
          total_mappings: emailData.stats.totalMappings,
          total_users: emailData.stats.totalUsers,
          total_vcards: emailData.stats.totalVcards,
        },
        reconciliation: {
          total_old_records: reconcileResults.summary.total_old_records,
          total_new_records: reconcileResults.summary.total_new_records,
          matched: reconcileResults.summary.matched_records,
          mismatched: reconcileResults.summary.mismatched_records,
        },
        database_updates: {
          records_updated: updateResults.length,
        },
      },
    };

    fs.writeFileSync(
      "workflow_report.json",
      JSON.stringify(report, null, 2),
      "utf-8"
    );
    console.log("  ✓ Report saved to: workflow_report.json\n");

    console.log("═════════════════════════════════════════");
    console.log("Workflow completed successfully!");
    console.log("═════════════════════════════════════════");
  } catch (error) {
    console.error(
      "Workflow error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  const examples = [
    example1BasicReconciliation,
    example2ExtractEmailMapping,
    example3UpdateDatabase,
    example4AnalyzeResults,
    example5FilterAndExport,
    example6FilterEmailMapping,
    example7FullWorkflow,
  ];

  for (let i = 0; i < examples.length; i++) {
    console.log("\n" + "=".repeat(60) + "\n");
    try {
      await examples[i]();
    } catch (error) {
      console.error(
        `Example ${i + 1} failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    console.log("\n" + "=".repeat(60));
  }
}

const examples = {
  example1BasicReconciliation,
  example2ExtractEmailMapping,
  example3UpdateDatabase,
  example4AnalyzeResults,
  example5FilterAndExport,
  example6FilterEmailMapping,
  example7FullWorkflow,
};

// Run a specific example
if (require.main === module) {
  const exampleNum = process.argv[2] || "1";
  const exampleKey = `example${exampleNum}` as keyof typeof examples;

  if (exampleKey in examples) {
    const exampleFn = examples[exampleKey];
    exampleFn().catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  } else {
    console.log("Usage: npx ts-node examples/media-reconciliation-examples.ts [1-7]");
    console.log("Examples:");
    console.log("  1 - Basic Reconciliation");
    console.log("  2 - Extract Email Mapping from SQL");
    console.log("  3 - Update Database with Email Mappings");
    console.log("  4 - Analyze Reconciliation Results");
    console.log("  5 - Filter and Export Specific Records");
    console.log("  6 - Filter Email Mapping");
    console.log("  7 - Full Workflow - Complete Reconciliation");
  }
}

export default examples;
