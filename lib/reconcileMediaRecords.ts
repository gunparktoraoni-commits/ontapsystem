import fs from "fs";
import { PrismaClient } from "@prisma/client";

/**
 * Media Record Reconciliation Function
 * 
 * This function reconciles media records between:
 * 1. media_records.json (exported from old Portal database)
 * 2. New database via Prisma ORM
 * 3. Old database (u517833616_Portal (1).sql)
 * 
 * Process:
 * - Loads media records from JSON
 * - Compares against new database by model_type and model_id
 * - Identifies mismatches
 * - Fetches email from old database records
 * - Updates new database records with media URLs if found
 */

interface OldMediaRecord {
  id: number;
  model_type: string;
  model_id: number;
  uuid: string;
  collection_name: string;
  name: string;
  file_name: string;
  created_at: string;
  updated_at: string;
  migration_script: string;
}

interface MediaRecordsJSON {
  metadata: {
    total_records: number;
    filtered_model_types: string[];
    exported_date: string;
    source: string;
    description: string;
  };
  media_records: OldMediaRecord[];
}

interface ReconciliationResult {
  timestamp: string;
  summary: {
    total_old_records: number;
    total_new_records: number;
    matched_records: number;
    mismatched_records: number;
    records_with_email_update: number;
  };
  details: {
    mismatches: MismatchDetail[];
    updated_records: UpdatedRecordDetail[];
    errors: ErrorDetail[];
  };
}

interface MismatchDetail {
  old_record_id: number;
  model_type: string;
  model_id: number;
  old_file_name: string;
  status: "not_found_in_new_db" | "uuid_mismatch" | "file_name_mismatch";
  email_from_old_db?: string;
}

interface UpdatedRecordDetail {
  new_media_id: number;
  user_id: number;
  file_name: string;
  file_url: string;
  old_media_id: number;
}

interface ErrorDetail {
  error: string;
  context: Record<string, unknown>;
}

/**
 * Extract user/bizcard info from model_type and model_id
 * Model types like "App\\Models\\User", "App\\Models\\Vcard", etc.
 */
function parseModelType(modelType: string): {
  type: string;
  isUser: boolean;
  isBizcard: boolean;
} {
  const normalizedType = modelType.replace(/\\\\/g, "\\").toLowerCase();

  return {
    type: normalizedType,
    isUser: normalizedType.includes("user"),
    isBizcard: normalizedType.includes("vcard"),
  };
}

/**
 * Maps old model types to new database relations
 */
function mapModelTypeToRelation(
  modelType: string,
  modelId: number
): { related_type: string; related_id: number } | null {
  const normalized = modelType.replace(/\\\\/g, "\\").toLowerCase();

  // User model
  if (normalized.includes("user")) {
    return {
      related_type: "user",
      related_id: modelId,
    };
  }

  // Vcard/Bizcard model
  if (normalized.includes("vcard")) {
    return {
      related_type: "bizcard",
      related_id: modelId,
    };
  }

  // Gallery model
  if (normalized.includes("gallery")) {
    return {
      related_type: "gallery",
      related_id: modelId,
    };
  }

  // Product model
  if (normalized.includes("product")) {
    return {
      related_type: "product",
      related_id: modelId,
    };
  }

  // Service model
  if (normalized.includes("service") && !normalized.includes("vcard")) {
    return {
      related_type: "service",
      related_id: modelId,
    };
  }

  return null;
}

/**
 * Load media records from JSON file
 */
async function loadMediaRecordsFromJSON(
  filePath: string
): Promise<MediaRecordsJSON> {
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to load media records from JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Find user email from old database based on user_id or bizcard owner
 * This would require access to the old Portal database
 * For now, we'll create a lookup from the SQL dump if available
 */
async function findEmailFromOldDatabase(
  userId: number | null,
  bizcardId: number | null
): Promise<string | null> {
  // In a real scenario, you would query the old database or parse the SQL dump
  // For now, this is a placeholder that demonstrates the pattern
  // You would need to:
  // 1. Parse the SQL dump to extract user/vcard data
  // 2. Create a lookup map of user_id/vcard_id to email
  // 3. Return the email if found

  // This function would be implemented when you have access to the old database structure
  return null;
}

/**
 * Main reconciliation function
 */
export async function reconcileMediaRecords(
  jsonFilePath: string = "media_records.json",
  outputFilePath: string = "reconciliation_results.json"
): Promise<ReconciliationResult> {
  const prisma = new PrismaClient();
  const result: ReconciliationResult = {
    timestamp: new Date().toISOString(),
    summary: {
      total_old_records: 0,
      total_new_records: 0,
      matched_records: 0,
      mismatched_records: 0,
      records_with_email_update: 0,
    },
    details: {
      mismatches: [],
      updated_records: [],
      errors: [],
    },
  };

  try {
    // Load old media records from JSON
    console.log("Loading media records from JSON...");
    const mediaJSON = await loadMediaRecordsFromJSON(jsonFilePath);
    const oldRecords = mediaJSON.media_records;
    result.summary.total_old_records = oldRecords.length;

    console.log(`Loaded ${oldRecords.length} old media records`);

    // Get all new media records from database
    console.log("Fetching media records from new database...");
    const newRecords = await prisma.media.findMany({
      select: {
        media_id: true,
        user_id: true,
        related_type: true,
        related_id: true,
        file_name: true,
        file_url: true,
      },
    });
    result.summary.total_new_records = newRecords.length;

    console.log(`Found ${newRecords.length} new media records`);

    // Create lookup map for new records by related_type and related_id
    const newRecordsMap = new Map<string, typeof newRecords[0][]>();
    newRecords.forEach((record) => {
      const key = `${record.related_type}:${record.related_id}`;
      if (!newRecordsMap.has(key)) {
        newRecordsMap.set(key, []);
      }
      newRecordsMap.get(key)!.push(record);
    });

    // Process each old record
    console.log("Reconciling records...");
    for (const oldRecord of oldRecords) {
      try {
        const modelInfo = parseModelType(oldRecord.model_type);
        const mapping = mapModelTypeToRelation(
          oldRecord.model_type,
          oldRecord.model_id
        );

        if (!mapping) {
          result.details.errors.push({
            error: "Unknown model type",
            context: {
              old_record_id: oldRecord.id,
              model_type: oldRecord.model_type,
            },
          });
          continue;
        }

        // Look up in new database
        const lookupKey = `${mapping.related_type}:${mapping.related_id}`;
        const matchingNewRecords = newRecordsMap.get(lookupKey) || [];

        // Find matching record by file name
        const matchedRecord = matchingNewRecords.find(
          (nr) =>
            nr.file_name === oldRecord.file_name ||
            nr.file_name?.includes(oldRecord.name)
        );

        if (!matchedRecord) {
          // Record not found in new database
          const mismatch: MismatchDetail = {
            old_record_id: oldRecord.id,
            model_type: oldRecord.model_type,
            model_id: oldRecord.model_id,
            old_file_name: oldRecord.file_name,
            status: "not_found_in_new_db",
          };

          // Try to find email from old database
          const userEmail = await findEmailFromOldDatabase(
            modelInfo.isUser ? oldRecord.model_id : null,
            modelInfo.isBizcard ? oldRecord.model_id : null
          );

          if (userEmail) {
            mismatch.email_from_old_db = userEmail;
            result.summary.records_with_email_update++;
          }

          result.details.mismatches.push(mismatch);
          result.summary.mismatched_records++;
        } else {
          // Record found - verify details
          if (matchedRecord.file_name === oldRecord.file_name) {
            result.summary.matched_records++;
          } else {
            // File name mismatch detected
            result.details.mismatches.push({
              old_record_id: oldRecord.id,
              model_type: oldRecord.model_type,
              model_id: oldRecord.model_id,
              old_file_name: oldRecord.file_name,
              status: "file_name_mismatch",
            });
            result.summary.mismatched_records++;
          }
        }
      } catch (error) {
        result.details.errors.push({
          error: `Failed to process record: ${error instanceof Error ? error.message : String(error)}`,
          context: {
            old_record_id: oldRecord.id,
          },
        });
      }
    }

    // Save results to file
    console.log(`Saving reconciliation results to ${outputFilePath}...`);
    fs.writeFileSync(
      outputFilePath,
      JSON.stringify(result, null, 2),
      "utf-8"
    );

    console.log("\nReconciliation Summary:");
    console.log(`Total old records: ${result.summary.total_old_records}`);
    console.log(`Total new records: ${result.summary.total_new_records}`);
    console.log(`Matched records: ${result.summary.matched_records}`);
    console.log(`Mismatched records: ${result.summary.mismatched_records}`);
    console.log(
      `Records with email found: ${result.summary.records_with_email_update}`
    );
    console.log(`\nDetailed results saved to: ${outputFilePath}`);

    return result;
  } catch (error) {
    console.error(
      "Reconciliation failed:",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Advanced reconciliation: Update new database records with email from old database
 * This function finds mismatched records and attempts to update them
 */
export async function updateMediaRecordsWithEmailMapping(
  jsonFilePath: string = "media_records.json",
  emailMappingPath: string = "email_mapping.json"
): Promise<UpdatedRecordDetail[]> {
  const prisma = new PrismaClient();
  const updatedRecords: UpdatedRecordDetail[] = [];

  try {
    // Load email mapping from file (created by parsing old database)
    console.log("Loading email mapping...");
    let emailMapping: Record<string, string> = {};

    if (fs.existsSync(emailMappingPath)) {
      emailMapping = JSON.parse(
        fs.readFileSync(emailMappingPath, "utf-8")
      ) as Record<string, string>;
    }

    // Load old media records
    console.log("Loading media records from JSON...");
    const mediaJSON = await loadMediaRecordsFromJSON(jsonFilePath);
    const oldRecords = mediaJSON.media_records;

    // Process each old record
    for (const oldRecord of oldRecords) {
      try {
        const mapping = mapModelTypeToRelation(
          oldRecord.model_type,
          oldRecord.model_id
        );

        if (!mapping) continue;

        // Check if we have email for this record
        const emailKey = `${mapping.related_type}:${mapping.related_id}`;
        const userEmail = emailMapping[emailKey];

        if (!userEmail) continue;

        // Try to find user by email
        const user = await prisma.user.findUnique({
          where: { email: userEmail },
          select: { user_id: true },
        });

        if (!user) {
          console.warn(
            `User not found for email: ${userEmail} (${emailKey})`
          );
          continue;
        }

        // Check if media record exists for this user
        const existingMedia = await prisma.media.findFirst({
          where: {
            user_id: user.user_id,
            file_name: oldRecord.file_name,
          },
        });

        if (existingMedia) {
          // Build file URL based on collection and file name
          const fileUrl = buildFileUrl(oldRecord.collection_name, oldRecord.file_name);

          // Update the record with the file URL
          await prisma.media.update({
            where: { media_id: existingMedia.media_id },
            data: {
              file_url: fileUrl,
            },
          });

          updatedRecords.push({
            new_media_id: Number(existingMedia.media_id),
            user_id: Number(user.user_id),
            file_name: oldRecord.file_name,
            file_url: fileUrl,
            old_media_id: oldRecord.id,
          });

          console.log(
            `Updated media record ${existingMedia.media_id} for user ${user.user_id}`
          );
        }
      } catch (error) {
        console.error(
          `Failed to update record ${oldRecord.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log(`Updated ${updatedRecords.length} media records`);
    return updatedRecords;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Build file URL based on collection name and file name
 * Assumes files are stored in a CDN or cloud storage
 */
function buildFileUrl(collectionName: string, fileName: string): string {
  // Example implementation - adjust based on your actual storage setup
  const baseUrl = process.env.MEDIA_BASE_URL || "https://cdn.example.com";
  return `${baseUrl}/media/${collectionName}/${fileName}`;
}

/**
 * Export utility to create email mapping from SQL dump
 * Parses the old Portal database SQL file and creates a mapping
 */
export async function createEmailMappingFromSQL(
  sqlFilePath: string,
  outputPath: string = "email_mapping.json"
): Promise<Record<string, string>> {
  const emailMapping: Record<string, string> = {};

  try {
    // This would require:
    // 1. Reading the SQL file
    // 2. Parsing INSERT statements for users and vcards
    // 3. Creating a mapping of user_id/vcard_id to email

    // For now, this is a placeholder showing the expected structure
    // In production, you would use a SQL parser or query the actual database

    const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");

    // Simple regex to extract user emails (this is a basic example)
    const userInserts = sqlContent.match(
      /INSERT INTO `users`[\s\S]*?VALUES\s*\(([\s\S]*?)\);/
    ) || [];

    for (const insert of userInserts) {
      // Parse user_id and email from INSERT statement
      // This is simplified - in production use proper SQL parsing
      const match = insert.match(
        /\((\d+),.*?'([^']*@[^']*)',/
      );
      if (match) {
        const userId = match[1];
        const email = match[2];
        emailMapping[`user:${userId}`] = email;
      }
    }

    // Save mapping to file
    fs.writeFileSync(
      outputPath,
      JSON.stringify(emailMapping, null, 2),
      "utf-8"
    );

    console.log(
      `Created email mapping with ${Object.keys(emailMapping).length} entries`
    );
    return emailMapping;
  } catch (error) {
    console.error(
      "Failed to create email mapping:",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

// Export types for use in other modules
export type {
  OldMediaRecord,
  MediaRecordsJSON,
  ReconciliationResult,
  MismatchDetail,
  UpdatedRecordDetail,
  ErrorDetail,
};
