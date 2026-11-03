import fs from "fs";
import path from "path";

/**
 * SQL Email Extractor
 * 
 * Parses old Portal database SQL dump and extracts email mappings
 * for users and related entities (vcards, galleries, etc.)
 */

interface EmailMapping {
  [key: string]: string; // "user:123" => "email@domain.com" or "bizcard:456" => "email@domain.com"
}

interface ParsedUser {
  id: number;
  email: string;
  name?: string;
}

interface ParsedVcard {
  id: number;
  user_id?: number;
  email: string;
  name?: string;
}

/**
 * Extract users from SQL INSERT statements
 */
export function extractUsersFromSQL(sqlContent: string): ParsedUser[] {
  const users: ParsedUser[] = [];

  // Match INSERT INTO `users` ... VALUES (...)
  // This regex handles multi-line inserts
  const userInsertPattern =
    /INSERT INTO `users`[^;]*VALUES\s*\((.*?)\)(?=\s*[,;])/gi;
  const matches = sqlContent.matchAll(userInsertPattern);

  for (const match of matches) {
    try {
      const valuesStr = match[1];
      const values = parseInsertValues(valuesStr);

      // Typical users table structure:
      // id, serial_id, custom_uri, role, first_name, ..., email, ..., created_at, updated_at
      if (values[0] && values[7]) {
        // Assuming email is around column 8 based on common Laravel structure
        const userId = parseInt(values[0]);
        const email = values[7];

        if (!isNaN(userId) && email && email.includes("@")) {
          users.push({
            id: userId,
            email: email.toLowerCase(),
          });
        }
      }
    } catch (error) {
      console.warn(
        "Failed to parse user row:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return users;
}

/**
 * Extract vcards/bizcards from SQL INSERT statements
 */
export function extractVcardsFromSQL(sqlContent: string): ParsedVcard[] {
  const vcards: ParsedVcard[] = [];

  // Match different table names for vcards: vcards, Bizcard, vcard_profiles, etc.
  const tableNames = [
    "vcards",
    "Bizcard",
    "vcard_profiles",
    "vcard_covers",
    "bizcard",
  ];

  for (const tableName of tableNames) {
    const pattern = new RegExp(
      `INSERT INTO \`${tableName}\`[^;]*VALUES\\s*\\(([^)]*)\\)(?=\\s*[,;])`,
      "gi"
    );
    const matches = sqlContent.matchAll(pattern);

    for (const match of matches) {
      try {
        const valuesStr = match[1];
        const values = parseInsertValues(valuesStr);

        if (values[0] && values[7]) {
          // Assuming: id, user_id, name, ..., email
          const vcardId = parseInt(values[0]);
          const userId = values[1] ? parseInt(values[1]) : undefined;
          const email = values[7];

          if (!isNaN(vcardId) && email && email.includes("@")) {
            vcards.push({
              id: vcardId,
              user_id: isNaN(userId!) ? undefined : userId,
              email: email.toLowerCase(),
            });
          }
        }
      } catch (error) {
        console.warn(
          "Failed to parse vcard row:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  return vcards;
}

/**
 * Parse individual values from SQL INSERT value list
 * Handles quoted strings, numbers, NULL, and special characters
 */
function parseInsertValues(valuesStr: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    const nextChar = valuesStr[i + 1];

    // Handle quote start/end
    if ((char === "'" || char === '"') && (i === 0 || valuesStr[i - 1] !== "\\")) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
        quoteChar = "";
      } else {
        current += char;
      }
    }
    // Handle comma separator (outside quotes)
    else if (char === "," && !inQuote) {
      values.push(current.trim());
      current = "";
    }
    // Handle regular characters
    else {
      current += char;
    }
  }

  // Add last value
  if (current.trim()) {
    values.push(current.trim());
  }

  return values;
}

/**
 * Clean and normalize extracted values
 */
function cleanValue(value: string): string {
  if (!value) return "";

  // Remove outer quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  // Handle escaped characters
  value = value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  return value.trim();
}

/**
 * Create email mapping from extracted users and vcards
 */
export function createEmailMapping(
  users: ParsedUser[],
  vcards: ParsedVcard[]
): EmailMapping {
  const mapping: EmailMapping = {};

  // Map users
  for (const user of users) {
    mapping[`user:${user.id}`] = user.email;
  }

  // Map vcards
  for (const vcard of vcards) {
    mapping[`bizcard:${vcard.id}`] = vcard.email;

    // If vcard has user_id, also map the relationship
    if (vcard.user_id) {
      mapping[`vcard_user:${vcard.user_id}`] = vcard.email;
    }
  }

  return mapping;
}

/**
 * Main function: Parse SQL and extract email mapping
 */
export async function extractEmailsFromSQLFile(
  sqlFilePath: string
): Promise<{
  users: ParsedUser[];
  vcards: ParsedVcard[];
  mapping: EmailMapping;
  stats: {
    totalUsers: number;
    totalVcards: number;
    totalMappings: number;
  };
}> {
  try {
    console.log(`Reading SQL file: ${sqlFilePath}`);

    // Check if file exists
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`SQL file not found: ${sqlFilePath}`);
    }

    // Read file in chunks if large
    const fileSize = fs.statSync(sqlFilePath).size;
    console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");

    console.log("Extracting users...");
    const users = extractUsersFromSQL(sqlContent);
    console.log(`Found ${users.length} users`);

    console.log("Extracting vcards...");
    const vcards = extractVcardsFromSQL(sqlContent);
    console.log(`Found ${vcards.length} vcards`);

    console.log("Creating email mapping...");
    const mapping = createEmailMapping(users, vcards);
    console.log(`Created ${Object.keys(mapping).length} mappings`);

    return {
      users,
      vcards,
      mapping,
      stats: {
        totalUsers: users.length,
        totalVcards: vcards.length,
        totalMappings: Object.keys(mapping).length,
      },
    };
  } catch (error) {
    throw new Error(
      `Failed to extract emails from SQL: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Save email mapping to JSON file
 */
export async function saveEmailMappingToFile(
  mapping: EmailMapping,
  outputPath: string
): Promise<void> {
  try {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2), "utf-8");
    console.log(`Saved email mapping to ${outputPath}`);
  } catch (error) {
    throw new Error(
      `Failed to save email mapping: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load email mapping from JSON file
 */
export async function loadEmailMappingFromFile(
  filePath: string
): Promise<EmailMapping> {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Mapping file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as EmailMapping;
  } catch (error) {
    throw new Error(
      `Failed to load email mapping: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Merge multiple email mappings
 */
export function mergeEmailMappings(...mappings: EmailMapping[]): EmailMapping {
  const result: EmailMapping = {};

  for (const mapping of mappings) {
    Object.assign(result, mapping);
  }

  return result;
}

/**
 * Filter email mapping by key pattern
 */
export function filterEmailMapping(
  mapping: EmailMapping,
  pattern: RegExp | string
): EmailMapping {
  const result: EmailMapping = {};
  const regex =
    typeof pattern === "string" ? new RegExp(pattern) : pattern;

  for (const [key, value] of Object.entries(mapping)) {
    if (regex.test(key)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Validate email mapping
 */
export function validateEmailMapping(
  mapping: EmailMapping
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, email] of Object.entries(mapping)) {
    // Validate key format
    if (!key.includes(":")) {
      errors.push(`Invalid key format: ${key} (expected "type:id")`);
    }

    // Validate email format
    if (!email.includes("@") || !email.includes(".")) {
      errors.push(`Invalid email format for ${key}: ${email}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export type { EmailMapping, ParsedUser, ParsedVcard };
