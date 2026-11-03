import { describe, expect, it } from "vitest";
import {
  buildExpectedMappings,
  parsePortalSql,
} from "@/lib/services/database-reconciliation.service";

const SAMPLE_SQL = `
INSERT INTO \`users\` (\`id\`, \`email\`, \`first_name\`, \`last_name\`, \`tenant_id\`) VALUES

(51, 'lerma.manzano@asiaprimephilscorp.com.ph', 'Lerma M.', 'Bernabe', 'd1177859-1696-4389-8851-267a72c2717b'),
(54, 'noracruz@asiaprimephilscorp.com.ph', 'Nora T.', 'Cruz', '7ec2a886-f7f5-40a6-8bab-c7ff425829fd'),
(55, 'alexzaraspe.appc@gmail.com', 'Alexander B.', 'Zaraspe', 'd3c6ddbc-dbc0-4b9c-a164-8e9d5bb50bdd');

INSERT INTO \`vcards\` (\`id\`, \`tenant_id\`, \`company\`) VALUES
(24, 'd1177859-1696-4389-8851-267a72c2717b', 'AsiaPrime Philippines Corporation'),

(26, '7ec2a886-f7f5-40a6-8bab-c7ff425829fd', 'AsiaPrime Philippines Corporation'),

(27, 'd3c6ddbc-dbc0-4b9c-a164-8e9d5bb50bdd', 'AsiaPrime Philippines Corporation'),

(34, 'ea4f4c81-73df-4478-9215-b484f17f7413', NULL);
`;



describe("parsePortalSql", () => {

  it("parses UUID tenant_id values from legacy users and vcards", () => {

    const dataset = parsePortalSql(SAMPLE_SQL, "test-request");

    expect(dataset.sourceMode).toBe("sql");
    expect(dataset.users).toHaveLength(3);
    expect(dataset.users[0].tenant_id).toBe("d1177859-1696-4389-8851-267a72c2717b");
    expect(dataset.vcards).toHaveLength(3);
    expect(dataset.vcards.every((v) => v.company === "AsiaPrime Philippines Corporation")).toBe(true);
  });



  it("skips vcards with empty or invalid company names", () => {
    const dataset = parsePortalSql(SAMPLE_SQL, "test-request");
    expect(dataset.vcards.some((v) => v.id === 34)).toBe(false);
  });
});



describe("buildExpectedMappings", () => {
  it("maps users to company names via shared tenant_id", () => {
    const source = parsePortalSql(SAMPLE_SQL, "test-request");
    const { mappings, sourceStats } = buildExpectedMappings(source);
    expect(sourceStats.unique_company_names).toBe(1);
    expect(sourceStats.users_with_vcards).toBe(3);
    expect(mappings).toHaveLength(3);

    const emails = mappings.map((m) => m.userEmail).sort();
    expect(emails).toEqual([
      "alexzaraspe.appc@gmail.com",
      "lerma.manzano@asiaprimephilscorp.com.ph",
      "noracruz@asiaprimephilscorp.com.ph",
    ]);

    for (const mapping of mappings) {
      expect(mapping.vcardCompany).toBe("AsiaPrime Philippines Corporation");
      expect(mapping.normalizedCompany).toBe("asiaprime philippines corporation");
    }
  });
});
